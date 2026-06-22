import { describe, it, expect } from 'vitest';
import { resolveStartPage } from '../lib/runtime-monitor/start-page.js';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function createProject(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'shield-start-page-'));
  for (const [name, content] of Object.entries(files)) {
    const fullPath = join(dir, name);
    const parent = fullPath.split('/').slice(0, -1).join('/');
    if (parent && parent !== dir) {
      mkdirSync(parent, { recursive: true });
    }
    writeFileSync(fullPath, content);
  }
  return dir;
}

describe('resolveStartPage', () => {
  it('returns full URL as-is', async () => {
    const result = await resolveStartPage('/any', 'http://localhost:3000/app');
    expect(result.url).toBe('http://localhost:3000/app');
    expect(result.isFileUrl).toBe(false);
  });

  it('resolves existing html file to file://', async () => {
    const dir = createProject({ 'index.html': '<html></html>' });
    const result = await resolveStartPage(dir, 'index.html');
    expect(result.url).toBe(`file://${join(dir, 'index.html')}`);
    expect(result.isFileUrl).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it('falls back to root index.html', async () => {
    const dir = createProject({ 'index.html': '<html></html>' });
    const result = await resolveStartPage(dir, '/');
    expect(result.url).toBe(`file://${join(dir, 'index.html')}`);
    expect(result.isFileUrl).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it('throws when no start page can be resolved', async () => {
    const dir = createProject({});
    await expect(resolveStartPage(dir, '/missing.html')).rejects.toThrow('无法解析启动页面');
    rmSync(dir, { recursive: true, force: true });
  });
});
