import { createWriteStream, existsSync, readdirSync, rmSync, mkdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { WriteStream } from 'node:fs';
import type { StructuredLogEntry, StructuredLogger } from './types.js';

export interface CreateStructuredLoggerOptions {
  projectPath: string;
  sessionId: string;
  logDir?: string;
  retentionDays?: number;
}

export function createStructuredLogger(options: CreateStructuredLoggerOptions): StructuredLogger {
  const { projectPath, sessionId, logDir, retentionDays = 30 } = options;
  const baseDir = resolve(logDir ?? join(projectPath, '.legacy-shield', 'logs'));
  mkdirSync(baseDir, { recursive: true });
  cleanupExpiredStructuredLogs(baseDir, retentionDays);

  const filePath = join(baseDir, `${sessionId}.ndjson`);
  const stream: WriteStream = createWriteStream(filePath, { flags: 'a' });
  let closed = false;

  return {
    log(entry: StructuredLogEntry): void {
      if (closed) return;
      const line = `${JSON.stringify(entry)}\n`;
      const ok = stream.write(line);
      if (!ok) {
        stream.once('drain', () => {
          // 等待背压恢复
        });
      }
    },
    close(): Promise<void> {
      if (closed) return Promise.resolve();
      closed = true;
      return new Promise((resolve) => {
        if (stream.destroyed || stream.closed) {
          resolve();
          return;
        }
        stream.once('error', () => resolve());
        stream.end(() => resolve());
      });
    },
  };
}

function cleanupExpiredStructuredLogs(baseDir: string, retentionDays: number): void {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);
  if (!existsSync(baseDir)) return;
  for (const file of readdirSync(baseDir)) {
    if (!file.startsWith('shield_') || !file.endsWith('.ndjson')) continue;
    const fullPath = join(baseDir, file);
    try {
      const stat = getMtime(fullPath);
      if (stat && stat < cutoff) {
        rmSync(fullPath);
      }
    } catch {
      // ignore cleanup errors
    }
  }
}

function getMtime(filePath: string): Date | null {
  try {
    return statSync(filePath).mtime;
  } catch {
    return null;
  }
}
