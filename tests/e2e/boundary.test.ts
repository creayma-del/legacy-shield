import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { today } from '../../lib/utils.js';
import { startApiServer } from '../../lib/api.js';

const CLI = resolve(process.cwd(), 'dist/cli.js');

/**
 * 创建并返回一个临时老项目目录，包含 package.json 与可选的 src 目录。
 */
function createTempProject(name: string, withSrc = true): string {
  const dir = mkdtempSync(join(tmpdir(), name));
  writeFileSync(join(dir, 'package.json'), '{}');
  if (withSrc) {
    mkdirSync(join(dir, 'src'));
  }
  return dir;
}

describe('boundary cases', () => {
  it('fails on missing project path', () => {
    const result = spawnSync(
      'node',
      [CLI, 'shield', '--project', '/nonexistent', '--target', 'http://localhost:8080'],
      { encoding: 'utf8' },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('路径不存在');
  });

  it('fails on project without package.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'shield-boundary-no-pkg-'));
    mkdirSync(join(dir, 'src'));
    try {
      const result = spawnSync(
        'node',
        [CLI, 'shield', '--project', dir, '--target', 'http://localhost:8080'],
        { encoding: 'utf8' },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('package.json');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails on project without src', () => {
    const dir = mkdtempSync(join(tmpdir(), 'shield-boundary-no-src-'));
    writeFileSync(join(dir, 'package.json'), '{}');
    try {
      const result = spawnSync(
        'node',
        [CLI, 'shield', '--project', dir, '--target', 'http://localhost:8080'],
        { encoding: 'utf8' },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('src');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('report succeeds with empty logs', () => {
    const dir = createTempProject('shield-empty-');
    try {
      const result = spawnSync(
        'node',
        [CLI, 'report', '--project', dir, '--format', 'json'],
        { encoding: 'utf8' },
      );
      expect(result.status).toBe(0);
      const reportPath = join(dir, '.runtime-log-ignore', 'reports', `summary-${today()}.json`);
      expect(existsSync(reportPath)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('report succeeds with invalid date format', () => {
    const dir = createTempProject('shield-date-');
    try {
      const result = spawnSync(
        'node',
        [CLI, 'report', '--project', dir, '--date', 'not-a-date', '--format', 'json'],
        { encoding: 'utf8' },
      );
      expect(result.status).toBe(0);
      const reportPath = join(dir, '.runtime-log-ignore', 'reports', `summary-not-a-date.json`);
      expect(existsSync(reportPath)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('api returns 404 for unknown endpoint', async () => {
    const dir = createTempProject('shield-api-404-');
    const server = startApiServer({ projectPath: dir, port: 0 });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('listening', () => resolve());
        server.once('error', (err) => reject(err));
      });
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      const res = await fetch(`http://127.0.0.1:${port}/notfound`);
      expect(res.status).toBe(404);
      const data = (await res.json()) as { error: string };
      expect(data.error).toBe('not found');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('api returns 400 for invalid JSON in /suggest', async () => {
    const dir = createTempProject('shield-api-400-');
    const server = startApiServer({ projectPath: dir, port: 0 });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('listening', () => resolve());
        server.once('error', (err) => reject(err));
      });
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      const res = await fetch(`http://127.0.0.1:${port}/suggest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      });
      expect(res.status).toBe(400);
      const data = (await res.json()) as { error: string };
      expect(data.error).toBe('invalid json');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
