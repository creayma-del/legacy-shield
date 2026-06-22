import { existsSync, statSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { NetworkSubType } from './types.js';

export interface AssertLegacyProjectOptions {
  allowNoSrc?: boolean;
}

export function assertLegacyProject(projectPath: string, options?: AssertLegacyProjectOptions): void {
  if (!projectPath) throw new Error('老项目路径不能为空');
  if (!existsSync(projectPath)) throw new Error(`路径不存在: ${projectPath}`);
  const stat = statSync(projectPath);
  if (!stat.isDirectory()) throw new Error(`路径不是目录: ${projectPath}`);
  if (!existsSync(resolve(projectPath, 'package.json'))) {
    throw new Error(`未找到 package.json: ${projectPath}`);
  }
  if (!options?.allowNoSrc && !existsSync(resolve(projectPath, 'src'))) {
    throw new Error(`未找到 src/ 目录: ${projectPath}`);
  }
}

export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

export function today(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function generateId(): string {
  return randomUUID();
}

export function generateSessionId(): string {
  const timestamp = Date.now().toString(36);
  const randomSuffix = Math.random().toString(36).slice(2, 8);
  return `shield_${timestamp}_${randomSuffix}`;
}

export function readJsonl(filePath: string): unknown[] {
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => safeJsonParse<unknown>(line))
    .filter((item): item is NonNullable<typeof item> => item !== null);
}

export function hasShape(log: unknown, required: string[]): boolean {
  if (typeof log !== 'object' || log === null) return false;
  const record = log as Record<string, unknown>;
  for (const key of required) {
    if (record[key] === undefined) return false;
  }
  return true;
}

export function readJsonlWithWarnings(filePath: string): unknown[] {
  if (!existsSync(filePath)) return [];
  const content = readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const result: unknown[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    try {
      result.push(JSON.parse(line) as unknown);
    } catch {
      // eslint-disable-next-line no-console
      console.warn(`[legacy-shield] 跳过无效日志行: ${filePath}:${i + 1}`);
    }
  }
  return result;
}

export function safeJsonParse<T = unknown>(str: string): T | null {
  try {
    return JSON.parse(str) as T;
  } catch {
    return null;
  }
}

export function truncateBody(
  body: Buffer | string | unknown,
  maxSize = 64 * 1024,
): { body: string; truncated: boolean } {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
  if (buffer.length <= maxSize) return { body: buffer.toString('utf8'), truncated: false };
  const truncatedBuffer = buffer.subarray(0, maxSize);
  return { body: truncatedBuffer.toString('utf8'), truncated: true };
}

const SENSITIVE_HEADERS = ['cookie', 'authorization', 'x-api-key', 'x-auth-token'];

export function redactHeaders(
  headers: Record<string, string | string[] | undefined>,
): { headers: Record<string, string | string[] | undefined>; redactedHeaders: string[] } {
  const redactedHeaders: string[] = [];
  const result: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (SENSITIVE_HEADERS.includes(lower)) {
      result[key] = '[REDACTED]';
      redactedHeaders.push(key);
    } else {
      result[key] = value;
    }
  }
  return { headers: result, redactedHeaders };
}

export function redactBody(body: unknown, fields = ['password', 'token', 'phone', 'idCard']): unknown {
  if (body === null || body === undefined) return body;

  if (typeof body === 'string') {
    const trimmed = body.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      const parsed = safeJsonParse<unknown>(trimmed);
      if (parsed !== null) {
        const redacted = redactBody(parsed, fields);
        return JSON.stringify(redacted);
      }
    }
    return body;
  }

  if (typeof body !== 'object') return body;
  const result: Record<string, unknown> | unknown[] = Array.isArray(body) ? [...body] : { ...body };
  for (const key of Object.keys(result)) {
    const lower = key.toLowerCase();
    if (fields.some((f) => lower.includes(f.toLowerCase()))) {
      (result as Record<string, unknown>)[key] = '[REDACTED]';
    } else {
      (result as Record<string, unknown>)[key] = redactBody((result as Record<string, unknown>)[key], fields);
    }
  }
  return result;
}

const STATIC_EXTENSIONS = ['.js', '.css', '.png', '.jpg', '.jpeg', '.svg', '.gif', '.woff', '.woff2', '.ttf', '.eot', '.ico'];

export function classifyNetworkSubType(
  req: { headers?: Record<string, unknown> },
  url: string | null | undefined,
): NetworkSubType {
  if (!url) return 'unknown';
  const lowerUrl = url.toLowerCase();
  if (STATIC_EXTENSIONS.some((ext) => lowerUrl.endsWith(ext))) return 'static-resource';
  const requestedWith = req.headers?.['x-requested-with'];
  if (typeof requestedWith === 'string' && requestedWith.toLowerCase() === 'xmlhttprequest') return 'xhr';
  if (req.headers?.['x-shield-request-type'] === 'fetch') return 'fetch';
  return 'unknown';
}
