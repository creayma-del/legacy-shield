import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { basename, join } from 'node:path';
import { analyzeLogs } from './analyzer.js';
import { generateJsonReport, generateMarkdownReport } from './reporter.js';
import { isErrorSubType } from './logger.js';
import type {
  ApiOptions,
  FixPromptResult,
  RuntimeLog,
} from './types.js';
import { today, readJsonlWithWarnings, hasShape } from './utils.js';

const DEFAULT_PORT = 3456;
const BODY_LIMIT_BYTES = 1024 * 1024;
const VALID_LOG_TYPES = ['runtime', 'network', 'behavior', 'quality'] as const;
type LogType = (typeof VALID_LOG_TYPES)[number];

class RequestEntityTooLargeError extends Error {}

function isValidDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
}

function sendJson(
  res: ServerResponse,
  statusCode: number,
  data: unknown,
  cors: boolean,
): void {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (cors) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  res.end(JSON.stringify(data));
}

async function readBody(
  req: IncomingMessage,
  limitBytes = BODY_LIMIT_BYTES,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;
    req.on('data', (chunk: Buffer) => {
      received += chunk.length;
      if (received > limitBytes) {
        req.pause();
        reject(new RequestEntityTooLargeError('request entity too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function isRuntimeLog(log: unknown): log is RuntimeLog {
  return (
    hasShape(log, ['type', 'subType', 'sessionId', 'timestamp', 'level', 'url', 'userAgent', 'message']) &&
    (log as Record<string, unknown>).type === 'runtime'
  );
}

async function generateFixPrompt(
  errorId: string,
  logDir: string,
  date: string,
): Promise<FixPromptResult | null> {
  const filePath = join(logDir, 'runtime', `${date}.jsonl`);
  const raw = readJsonlWithWarnings(filePath);
  const logs = raw.filter(isRuntimeLog);
  const matches = logs
    // v1.4：复用 logger.isErrorSubType（SSOT），新子类型自动纳入 /suggest 聚合
    .filter((l) => isErrorSubType(l.subType) && l.errorId === errorId)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  if (matches.length === 0) return null;

  const samples = matches.slice(-3);
  const representative = samples[samples.length - 1];
  const firstAt = samples[0].timestamp;
  const lastAt = samples[samples.length - 1].timestamp;
  const stack = representative.stack || '无 stack 信息';

  const prompt = `请根据以下运行时错误信息，分析根因并给出修复建议：

错误类型：${representative.subType}
错误标识：${errorId}
消息：${representative.message}
页面 URL：${representative.url}
Stack 片段：
${stack}

最近 ${samples.length} 条样本中，最早发生在 ${firstAt}，最晚发生在 ${lastAt}。
请优先检查以上 stack 指向的源码位置，并给出可执行的修复方案。`;

  return { errorId, date, prompt };
}

export function startApiServer(options: ApiOptions): http.Server {
  const { projectPath, port = DEFAULT_PORT, cors = false } = options;
  const logDir = join(projectPath, '.runtime-log-ignore');

  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      if (cors) {
        res.statusCode = 204;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.end();
        return;
      }
      sendJson(res, 404, { error: 'not found' }, cors);
      return;
    }

    try {
      const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
      const pathname = url.pathname;

      if (pathname === '/health' && req.method === 'GET') {
        sendJson(res, 200, { ok: true, project: basename(projectPath) }, cors);
        return;
      }

      if (pathname === '/logs' && req.method === 'GET') {
        const type = url.searchParams.get('type') || 'runtime';
        const date = url.searchParams.get('date') || today();
        if (!VALID_LOG_TYPES.includes(type as LogType)) {
          sendJson(
            res,
            400,
            { error: 'invalid type', detail: `type must be one of ${VALID_LOG_TYPES.join(', ')}` },
            cors,
          );
          return;
        }
        if (!isValidDate(date)) {
          sendJson(res, 400, { error: 'invalid date', detail: 'date must be YYYY-MM-DD' }, cors);
          return;
        }
        const filePath = join(logDir, type, `${date}.jsonl`);
        const logs = readJsonlWithWarnings(filePath);
        sendJson(res, 200, { type, date, count: logs.length, logs }, cors);
        return;
      }

      if (pathname === '/report' && req.method === 'GET') {
        const format = url.searchParams.get('format') || 'json';
        const date = url.searchParams.get('date') || today();
        if (format !== 'json' && format !== 'md') {
          sendJson(res, 400, { error: 'invalid format', detail: 'format must be json or md' }, cors);
          return;
        }
        if (!isValidDate(date)) {
          sendJson(res, 400, { error: 'invalid date', detail: 'date must be YYYY-MM-DD' }, cors);
          return;
        }
        const analysis = await analyzeLogs(logDir, { date });
        const report =
          format === 'md'
            ? generateMarkdownReport(analysis, { project: projectPath, date })
            : generateJsonReport(analysis, { project: projectPath, date });
        sendJson(res, 200, { format, date, report }, cors);
        return;
      }

      if (pathname === '/errors/top' && req.method === 'GET') {
        const limit = parseInt(url.searchParams.get('limit') || '10', 10);
        const date = url.searchParams.get('date') || today();
        if (!isValidDate(date)) {
          sendJson(res, 400, { error: 'invalid date', detail: 'date must be YYYY-MM-DD' }, cors);
          return;
        }
        if (Number.isNaN(limit) || limit <= 0) {
          sendJson(res, 400, { error: 'invalid limit', detail: 'limit must be a positive integer' }, cors);
          return;
        }
        const analysis = await analyzeLogs(logDir, { date });
        sendJson(res, 200, { date, limit, errors: analysis.topErrors.slice(0, limit) }, cors);
        return;
      }

      if (pathname === '/timeline' && req.method === 'GET') {
        const date = url.searchParams.get('date') || today();
        if (!isValidDate(date)) {
          sendJson(res, 400, { error: 'invalid date', detail: 'date must be YYYY-MM-DD' }, cors);
          return;
        }
        const analysis = await analyzeLogs(logDir, { date });
        sendJson(
          res,
          200,
          { date, count: analysis.behaviorTimeline.length, timeline: analysis.behaviorTimeline },
          cors,
        );
        return;
      }

      if (pathname === '/suggest' && req.method === 'POST') {
        const date = url.searchParams.get('date') || today();
        if (!isValidDate(date)) {
          sendJson(res, 400, { error: 'invalid date', detail: 'date must be YYYY-MM-DD' }, cors);
          return;
        }
        let body: string;
        try {
          body = await readBody(req);
        } catch (err) {
          if (err instanceof RequestEntityTooLargeError) {
            sendJson(res, 413, { error: 'request entity too large' }, cors);
            return;
          }
          sendJson(res, 500, { error: 'failed to read body', detail: (err as Error).message }, cors);
          return;
        }
        let payload: { errorId?: string };
        try {
          payload = JSON.parse(body) as { errorId?: string };
        } catch (parseErr) {
          sendJson(
            res,
            400,
            { error: 'invalid json', detail: (parseErr as Error).message },
            cors,
          );
          return;
        }
        const { errorId } = payload;
        if (!errorId || typeof errorId !== 'string') {
          sendJson(res, 400, { error: 'missing errorId' }, cors);
          return;
        }
        const result = await generateFixPrompt(errorId, logDir, date);
        if (result === null) {
          sendJson(res, 404, { error: 'errorId not found', errorId }, cors);
          return;
        }
        sendJson(res, 200, result, cors);
        return;
      }

      sendJson(res, 404, { error: 'not found' }, cors);
    } catch (err) {
      sendJson(res, 500, { error: 'internal error', detail: (err as Error).message }, cors);
    }
  });

  server.listen(port, '127.0.0.1');
  return server;
}
