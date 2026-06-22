import {
  createWriteStream,
  existsSync,
  readdirSync,
  rmSync,
  writeFileSync,
  type WriteStream,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { ensureDir, today } from './utils.js';
import {
  ERROR_RUNTIME_SUB_TYPES,
} from './types.js';
import type {
  BehaviorLog,
  Logger,
  NetworkLog,
  QualityLog,
  RuntimeLog,
  RuntimeSubType,
  ShieldLog,
} from './types.js';

type LogType = RuntimeLog['type'] | NetworkLog['type'] | BehaviorLog['type'] | QualityLog['type'];

export function createLogger(projectPath: string, sessionId: string, retentionDays = 7): Logger {
  const baseDir = join(projectPath, '.runtime-log-ignore');
  ensureDir(baseDir);
  const subDirs: LogType[] = ['runtime', 'network', 'behavior', 'quality'];
  for (const sub of subDirs) {
    ensureDir(join(baseDir, sub));
  }
  createGitignore(baseDir);
  cleanupExpiredLogs(baseDir, retentionDays);

  const streams = new Map<LogType, WriteStream>();
  const date = today();

  function getStream(type: LogType): WriteStream {
    if (!streams.has(type)) {
      const filePath = join(baseDir, type, `${date}.jsonl`);
      const stream = createWriteStream(filePath, { flags: 'a' });
      stream.on('error', (err) => {
        // eslint-disable-next-line no-console
        console.warn(`日志流错误 [${type}]:`, err.message);
      });
      streams.set(type, stream);
    }
    return streams.get(type)!;
  }

  function writeRecord<T extends ShieldLog>(type: LogType, record: T): void {
    const stream = getStream(type);
    const line = `${JSON.stringify(record)}\n`;
    const ok = stream.write(line);
    if (!ok) {
      stream.once('drain', () => {
        // 等待背压恢复，不阻塞业务逻辑
      });
    }
  }

  return {
    logRuntime(
      subType: RuntimeSubType,
      detail: Partial<Omit<RuntimeLog, 'type' | 'subType' | 'sessionId' | 'timestamp' | 'level'>>,
      level?: RuntimeLog['level'],
    ): void {
      const resolvedLevel = level ?? runtimeLevelFor(subType);
      const errorId = isErrorSubType(subType)
        ? generateErrorId(subType, detail.stack, detail.url)
        : undefined;
      const log: RuntimeLog = {
        type: 'runtime',
        subType,
        timestamp: new Date().toISOString(),
        level: resolvedLevel,
        url: detail.url ?? '',
        userAgent: detail.userAgent ?? '',
        message: detail.message ?? '',
        ...detail,
        sessionId,
        errorId,
      };
      writeRecord('runtime', log);
    },
    logNetwork(detail: Partial<Omit<NetworkLog, 'type' | 'sessionId' | 'timestamp'>>): void {
      const log: NetworkLog = {
        type: 'network',
        subType: detail.subType ?? 'unknown',
        sessionId,
        timestamp: new Date().toISOString(),
        level: detail.level ?? networkLevelFor(detail.response?.status),
        requestId: detail.requestId ?? '',
        method: detail.method ?? '',
        url: detail.url ?? '',
        request: detail.request ?? {
          headers: {},
          redactedHeaders: [],
          body: null,
          bodySize: 0,
          bodyTruncated: false,
        },
        response: detail.response ?? {
          status: 0,
          statusText: '',
          headers: {},
          redactedHeaders: [],
          body: null,
          bodySize: 0,
          bodyTruncated: false,
        },
        durationMs: detail.durationMs ?? 0,
        pageUrl: detail.pageUrl ?? null,
      };
      writeRecord('network', log);
    },
    logBehavior(detail: Partial<Omit<BehaviorLog, 'type' | 'sessionId' | 'timestamp' | 'level'>>): void {
      const log: BehaviorLog = {
        type: 'behavior',
        subType: detail.subType ?? 'click',
        sessionId,
        timestamp: new Date().toISOString(),
        level: 'info',
        sequence: detail.sequence ?? 0,
        pageUrl: detail.pageUrl ?? '',
        target: detail.target ?? null,
        payload: detail.payload ?? {},
        coordinates: detail.coordinates ?? null,
      };
      writeRecord('behavior', log);
    },
    logQuality(detail: Partial<Omit<QualityLog, 'type' | 'sessionId' | 'timestamp'>>): void {
      const log: QualityLog = {
        type: 'quality',
        subType: detail.subType ?? 'code-quality',
        sessionId,
        timestamp: new Date().toISOString(),
        level: detail.level ?? 'info',
        ...detail,
      };
      writeRecord('quality', log);
    },
    close(): Promise<void> {
      const closers = Array.from(streams.values()).map(
        (stream) =>
          new Promise<void>((resolve) => {
            if (stream.destroyed || stream.closed) {
              resolve();
              return;
            }
            stream.once('error', () => resolve());
            stream.end(() => resolve());
          }),
      );
      return Promise.all(closers).then(() => {});
    },
  };
}

function createGitignore(baseDir: string): void {
  const gitignorePath = join(baseDir, '.gitignore');
  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, '*\n', 'utf8');
  }
}

function cleanupExpiredLogs(baseDir: string, retentionDays: number): void {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);
  cutoff.setHours(0, 0, 0, 0);
  const subDirs: LogType[] = ['runtime', 'network', 'behavior', 'quality'];
  for (const sub of subDirs) {
    const dir = join(baseDir, sub);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      const match = file.match(/^(\d{4}-\d{2}-\d{2})\.jsonl$/);
      if (!match) continue;
      const fileDate = new Date(match[1]);
      if (fileDate < cutoff) {
        rmSync(join(dir, file));
      }
    }
  }
}

function generateErrorId(
  subType: RuntimeSubType,
  stack: string | undefined,
  url: string | undefined,
): string {
  const lines = (stack ?? '').split('\n').map((line) => line.trim()).filter(Boolean);
  const firstFrame = lines[1] ?? lines[0] ?? '';
  const normalizedFrame = firstFrame.replace(/:\d+$/, '').replace(/\?v=[a-z0-9]+/gi, '');
  return createHash('sha256')
    .update(`${subType}|${normalizedFrame}|${url ?? ''}`)
    .digest('hex')
    .slice(0, 16);
}

function runtimeLevelFor(subType: RuntimeSubType): RuntimeLog['level'] {
  if (subType === 'console-warn' || subType === 'vue-warn') return 'warn';
  if (subType === 'console-info' || subType === 'console-log') return 'info';
  return 'error';
}

// v1.4 起作为 SSOT 视图供 api.ts /suggest 复用；改实现时请同步评估上游调用方影响
export function isErrorSubType(subType: RuntimeSubType): boolean {
  return (ERROR_RUNTIME_SUB_TYPES as readonly RuntimeSubType[]).includes(subType);
}

function networkLevelFor(status: number | undefined): NetworkLog['level'] {
  if (status === undefined) return 'info';
  if (status >= 500) return 'error';
  if (status >= 400) return 'warn';
  return 'info';
}
