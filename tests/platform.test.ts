import { describe, it, expect } from 'vitest';
import { detectPlatform } from '../lib/platform.js';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function createProject(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'shield-platform-'));
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

describe('detectPlatform', () => {
  it('returns explicit platform when provided', () => {
    const dir = createProject({});
    const result = detectPlatform({ projectPath: dir, explicit: 'h5' });
    expect(result.platform).toBe('h5');
    expect(result.context.explicit).toBe(true);
    expect(result.context.inferred).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it('infers h5 from uni-app dependency', () => {
    const dir = createProject({
      'package.json': JSON.stringify({ dependencies: { '@dcloudio/uni-app': '^3.0' } }),
    });
    const result = detectPlatform({ projectPath: dir });
    expect(result.platform).toBe('h5');
    expect(result.context.strategy).toBe('package-h5');
    rmSync(dir, { recursive: true, force: true });
  });

  it('infers web from next dependency', () => {
    const dir = createProject({
      'package.json': JSON.stringify({ dependencies: { next: '^14.0' } }),
    });
    const result = detectPlatform({ projectPath: dir });
    expect(result.platform).toBe('web');
    expect(result.context.strategy).toBe('package-web');
    rmSync(dir, { recursive: true, force: true });
  });

  it('infers h5 from mobile viewport', () => {
    const dir = createProject({
      'index.html': '<html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"></head></html>',
    });
    const result = detectPlatform({ projectPath: dir });
    expect(result.platform).toBe('h5');
    expect(result.context.strategy).toBe('viewport');
    rmSync(dir, { recursive: true, force: true });
  });

  it('falls back to web when no signals present', () => {
    const dir = createProject({});
    const result = detectPlatform({ projectPath: dir });
    expect(result.platform).toBe('web');
    expect(result.context.strategy).toBe('default');
    rmSync(dir, { recursive: true, force: true });
  });
});
