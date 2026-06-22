import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createStructuredLogger } from '../lib/structured-logger.js';
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('createStructuredLogger', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'shield-logger-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates ndjson log file and writes entries', async () => {
    const sessionId = 'shield_test_session';
    const logger = createStructuredLogger({ projectPath: dir, sessionId, retentionDays: 30 });

    logger.log({
      timestamp: new Date().toISOString(),
      sessionId,
      level: 'info',
      category: 'platform',
      message: 'platform detected',
    });

    await logger.close();

    const expectedDir = join(dir, '.legacy-shield', 'logs');
    expect(existsSync(expectedDir)).toBe(true);
    const filePath = join(expectedDir, `${sessionId}.ndjson`);
    expect(existsSync(filePath)).toBe(true);

    const lines = readFileSync(filePath, 'utf8').trim().split('\n');
    expect(lines.length).toBe(1);
    const entry = JSON.parse(lines[0]);
    expect(entry.category).toBe('platform');
    expect(entry.message).toBe('platform detected');
  });

  it('uses custom logDir when provided', async () => {
    const sessionId = 'shield_test_session';
    const customDir = join(dir, 'custom-logs');
    const logger = createStructuredLogger({ projectPath: dir, sessionId, logDir: customDir, retentionDays: 30 });

    logger.log({
      timestamp: new Date().toISOString(),
      sessionId,
      level: 'warn',
      category: 'static-rule',
      message: 'rule hit',
    });

    await logger.close();

    expect(existsSync(customDir)).toBe(true);
    const filePath = join(customDir, `${sessionId}.ndjson`);
    expect(existsSync(filePath)).toBe(true);
  });

  it('cleans up expired shield ndjson files', async () => {
    const sessionId = 'shield_test_session';
    const logDir = join(dir, '.legacy-shield', 'logs');
    mkdirSync(logDir, { recursive: true });
    const oldFile = join(logDir, 'shield_old.ndjson');
    writeFileSync(oldFile, '{}');

    // 修改文件时间为 31 天前
    const oldTime = new Date();
    oldTime.setDate(oldTime.getDate() - 31);
    utimesSync(oldFile, oldTime, oldTime);

    const logger = createStructuredLogger({ projectPath: dir, sessionId, retentionDays: 30 });
    await logger.close();

    expect(existsSync(oldFile)).toBe(false);
  });
});
