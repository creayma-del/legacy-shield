import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import httpProxy from 'http-proxy';
import { generateId, redactBody, redactHeaders, truncateBody, classifyNetworkSubType } from './utils.js';
import type { Logger, NetworkLog, StartProxyOptions } from './types.js';

const BODY_LIMIT = 64 * 1024;
const MAX_PORT_RETRIES = 10;

export interface ProxyServer {
  server: Server;
  proxy: httpProxy;
  url: string;
}

export async function startProxy(options: StartProxyOptions): Promise<ProxyServer> {
  const { target, port, logger, noBody = false, insecure = false, redactBodyFields = [] } = options;
  const targetUrl = new URL(target);

  const proxy = httpProxy.createProxyServer({
    target,
    changeOrigin: true,
    secure: !insecure,
    ws: false,
  });

  proxy.on('error', (err, req, res) => {
    logProxyError(err, req as IncomingMessage, res as ServerResponse, logger);
    try {
      const serverRes = res as ServerResponse;
      if (!serverRes.writableEnded) {
        serverRes.writeHead(502, { 'Content-Type': 'text/plain' });
        serverRes.end('Bad Gateway');
      }
    } catch {
      // 响应已关闭，忽略
    }
  });

  const server = createServer((req, res) => {
    const startTime = Date.now();
    const requestId = generateId();
    const requestBodyChunks: Buffer[] = [];
    const responseBodyChunks: Buffer[] = [];

    req.on('data', (chunk: unknown) => requestBodyChunks.push(toBuffer(chunk)));
    req.on('end', () => {
      const requestBodyBuffer = Buffer.concat(requestBodyChunks);

      const originalWrite = res.write.bind(res);
      const originalEnd = res.end.bind(res);

      res.write = ((chunk: unknown, ...args: unknown[]): boolean => {
        responseBodyChunks.push(toBuffer(chunk));
        return originalWrite(chunk as never, ...(args as never[]));
      }) as ServerResponse['write'];

      res.end = ((chunk?: unknown, ...args: unknown[]): void => {
        if (chunk) responseBodyChunks.push(toBuffer(chunk));
        const durationMs = Date.now() - startTime;
        logNetworkRequest({
          req,
          res,
          requestId,
          requestBodyBuffer,
          responseBodyChunks,
          durationMs,
          noBody,
          redactBodyFields,
          targetUrl,
          logger,
        });
        originalEnd(chunk as never, ...(args as never[]));
      }) as ServerResponse['end'];

      const bufferStream = requestBodyBuffer.length > 0 ? Readable.from(requestBodyBuffer) : undefined;
      proxy.web(req, res, { buffer: bufferStream });
    });
  });

  const actualPort = await listenWithRetry(server, port);
  const url = `http://localhost:${actualPort}`;
  return { server, proxy, url };
}

function toBuffer(chunk: unknown): Buffer {
  return Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8');
}

function totalSize(chunks: Buffer[]): number {
  return chunks.reduce((sum, chunk) => sum + chunk.length, 0);
}

function isBinaryContentType(contentType: string | undefined): boolean {
  if (!contentType) return false;
  const ct = String(contentType).toLowerCase();
  return (
    ct.startsWith('image/') ||
    ct.startsWith('audio/') ||
    ct.startsWith('video/') ||
    ct.includes('application/octet-stream') ||
    ct.includes('application/pdf') ||
    ct.includes('font/') ||
    ct.includes('/woff')
  );
}

function formatBody(buffer: Buffer, contentType: string | undefined): { body: string; encoding: 'utf8' | 'base64'; truncated: boolean } {
  if (isBinaryContentType(contentType)) {
    const truncated = buffer.length > BODY_LIMIT ? buffer.subarray(0, BODY_LIMIT) : buffer;
    return {
      body: truncated.toString('base64'),
      encoding: 'base64',
      truncated: buffer.length > BODY_LIMIT,
    };
  }
  const { body, truncated } = truncateBody(buffer, BODY_LIMIT);
  return { body, encoding: 'utf8', truncated };
}

interface LogNetworkRequestParams {
  req: IncomingMessage;
  res: ServerResponse;
  requestId: string;
  requestBodyBuffer: Buffer;
  responseBodyChunks: Buffer[];
  durationMs: number;
  noBody: boolean;
  redactBodyFields: string[];
  targetUrl: URL;
  logger: Logger;
}

function logNetworkRequest(params: LogNetworkRequestParams): void {
  const { req, res, requestId, requestBodyBuffer, responseBodyChunks, durationMs, noBody, redactBodyFields, targetUrl, logger } = params;
  const status = res.statusCode;
  const level: NetworkLog['level'] = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
  const subType = classifyNetworkSubType(req, buildFullUrl(targetUrl, req));

  const requestHeaders = redactHeaders(req.headers);
  const responseHeaders = redactHeaders(res.getHeaders() as Record<string, string | string[] | undefined>);

  const requestBodyInfo = noBody
    ? { body: null, encoding: null as 'utf8' | 'base64' | null, truncated: false }
    : formatBody(requestBodyBuffer, getHeader(req.headers['content-type']));
  const responseBodyInfo = noBody
    ? { body: null, encoding: null as 'utf8' | 'base64' | null, truncated: false }
    : formatBody(Buffer.concat(responseBodyChunks), getHeader(res.getHeader('content-type')));

  logger.logNetwork({
    requestId,
    subType,
    level,
    method: req.method ?? '',
    url: buildFullUrl(targetUrl, req),
    request: {
      headers: requestHeaders.headers,
      redactedHeaders: requestHeaders.redactedHeaders,
      body: noBody ? null : (redactBody(requestBodyInfo.body, redactBodyFields) as string),
      bodySize: requestBodyBuffer.length,
      bodyTruncated: requestBodyInfo.truncated,
      bodyEncoding: requestBodyInfo.encoding,
    },
    response: {
      status,
      statusText: res.statusMessage ?? '',
      headers: responseHeaders.headers,
      redactedHeaders: responseHeaders.redactedHeaders,
      body: noBody ? null : (redactBody(responseBodyInfo.body, redactBodyFields) as string),
      bodySize: totalSize(responseBodyChunks),
      bodyTruncated: responseBodyInfo.truncated,
      bodyEncoding: responseBodyInfo.encoding,
    },
    durationMs,
    pageUrl: getHeader(req.headers.referer) || null,
  });
}

function logProxyError(err: Error, req: IncomingMessage, _res: ServerResponse, logger: Logger): void {
  logger.logNetwork({
    subType: 'proxy-error',
    level: 'error',
    method: req.method ?? '',
    url: req.url ?? '',
    requestId: generateId(),
    durationMs: 0,
    pageUrl: null,
    request: {
      headers: {},
      redactedHeaders: [],
      body: null,
      bodySize: 0,
      bodyTruncated: false,
    },
    response: {
      status: 502,
      statusText: 'Bad Gateway',
      headers: {},
      redactedHeaders: [],
      body: null,
      bodySize: 0,
      bodyTruncated: false,
    },
  });
  // eslint-disable-next-line no-console
  console.warn('代理转发错误:', err.message);
}

function buildFullUrl(targetUrl: URL, req: IncomingMessage): string {
  const url = req.url ?? '';
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  return `${targetUrl.protocol}//${req.headers.host ?? targetUrl.host}${url}`;
}

function getHeader(value: string | string[] | number | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  if (typeof value === 'number') return String(value);
  return value;
}

function listenWithRetry(server: Server, startPort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    let attempt = 0;

    function tryListen(port: number): void {
      attempt += 1;
      server.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' && attempt < MAX_PORT_RETRIES) {
          tryListen(port + 1);
        } else {
          reject(
            new Error(
              `无法启动代理，端口 ${startPort} 至 ${startPort + MAX_PORT_RETRIES - 1} 均被占用`,
            ),
          );
        }
      });
      server.once('listening', () => {
        const address = server.address();
        resolve(typeof address === 'object' && address !== null ? address.port : port);
      });
      server.listen(port);
    }

    tryListen(startPort);
  });
}
