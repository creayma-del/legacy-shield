import { describe, it, expect } from 'vitest';
import { scanFiles } from '../lib/custom-rules/scanner.js';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function createProject(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'shield-rules-'));
  mkdirSync(join(dir, 'src'));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, 'src', name), content);
  }
  return dir;
}

describe('custom rules', () => {
  it('SHIELD-001 detects eval and new Function', async () => {
    const dir = createProject({ 'bad.js': 'eval("x"); new Function("a", "return a");' });
    const hits = await scanFiles(dir, 'no-dangerous-apis');
    expect(hits.length).toBe(2);
    rmSync(dir, { recursive: true, force: true });
  });

  it('SHIELD-002 detects large loop without break', async () => {
    const dir = createProject({ 'loop.js': 'for(let i=0;i<arr.length;i++){ console.log(i); }' });
    const hits = await scanFiles(dir, 'no-large-loops');
    expect(hits.length).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });

  it('SHIELD-002 ignores loop with break', async () => {
    const dir = createProject({
      'loop.js': 'for(let i=0;i<arr.length;i++){ if(i===5) break; console.log(i); }',
    });
    const hits = await scanFiles(dir, 'no-large-loops');
    expect(hits.length).toBe(0);
    rmSync(dir, { recursive: true, force: true });
  });

  it('SHIELD-003 detects expensive watcher', async () => {
    const dir = createProject({ 'watch.js': 'watch(someObj.deep.prop, () => {});' });
    const hits = await scanFiles(dir, 'no-expensive-watcher');
    expect(hits.length).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });

  it('SHIELD-004 detects localStorage in loop', async () => {
    const dir = createProject({
      'storage.js': 'for(let i=0;i<10;i++){ localStorage.setItem("k", i); }',
    });
    const hits = await scanFiles(dir, 'no-sync-storage-in-loop');
    expect(hits.length).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });

  it('SHIELD-004 detects sessionStorage in loop', async () => {
    const dir = createProject({
      'storage.js': 'for(let i=0;i<10;i++){ sessionStorage.getItem("k"); }',
    });
    const hits = await scanFiles(dir, 'no-sync-storage-in-loop');
    expect(hits.length).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });

  it('SHIELD-005 detects leaked listener without removeEventListener', async () => {
    const dir = createProject({
      'listener.js': 'function mount() { window.addEventListener("resize", () => {}); }',
    });
    const hits = await scanFiles(dir, 'no-leaked-listener');
    expect(hits.length).toBe(1);
    expect(hits[0].ruleName).toBe('no-leaked-listener');
    expect(hits[0].riskType).toBe('memory-leak');
    rmSync(dir, { recursive: true, force: true });
  });

  it('SHIELD-005 ignores listener with matching removeEventListener', async () => {
    const dir = createProject({
      'listener.js': `
        function mount() {
          const handler = () => {};
          window.addEventListener("resize", handler);
          return () => window.removeEventListener("resize", handler);
        }
      `,
    });
    const hits = await scanFiles(dir, 'no-leaked-listener');
    expect(hits.length).toBe(0);
    rmSync(dir, { recursive: true, force: true });
  });

  it('SHIELD-006 detects uncleared setInterval', async () => {
    const dir = createProject({
      'timer.js': 'function start() { setInterval(() => {}, 1000); }',
    });
    const hits = await scanFiles(dir, 'no-uncleared-timer');
    expect(hits.length).toBe(1);
    expect(hits[0].ruleName).toBe('no-uncleared-timer');
    expect(hits[0].riskType).toBe('memory-leak');
    rmSync(dir, { recursive: true, force: true });
  });

  it('SHIELD-006 ignores timer with clearInterval', async () => {
    const dir = createProject({
      'timer.js': `
        function start() {
          const id = setInterval(() => {}, 1000);
          return () => clearInterval(id);
        }
      `,
    });
    const hits = await scanFiles(dir, 'no-uncleared-timer');
    expect(hits.length).toBe(0);
    rmSync(dir, { recursive: true, force: true });
  });

  it('SHIELD-007 detects large static resource import over 1MB', async () => {
    const dir = createProject({
      'asset.js': 'import big from "./big.png";',
    });
    // 创建一个超过 1MB 的测试文件
    writeFileSync(join(dir, 'src', 'big.png'), Buffer.alloc(1024 * 1024 + 1));
    const hits = await scanFiles(dir, 'no-large-resource');
    expect(hits.length).toBe(1);
    expect(hits[0].ruleName).toBe('no-large-resource');
    expect(hits[0].riskType).toBe('resource-load');
    expect(hits[0].context?.sizeBytes).toBeGreaterThan(1024 * 1024);
    rmSync(dir, { recursive: true, force: true });
  });

  it('SHIELD-007 ignores small static resource import', async () => {
    const dir = createProject({
      'asset.js': 'import small from "./small.png";',
    });
    writeFileSync(join(dir, 'src', 'small.png'), Buffer.alloc(100));
    const hits = await scanFiles(dir, 'no-large-resource');
    expect(hits.length).toBe(0);
    rmSync(dir, { recursive: true, force: true });
  });

  it('SHIELD-007 ignores remote URL resources', async () => {
    const dir = createProject({
      'asset.js': 'import remote from "https://example.com/big.png";',
    });
    const hits = await scanFiles(dir, 'no-large-resource');
    expect(hits.length).toBe(0);
    rmSync(dir, { recursive: true, force: true });
  });

  it('SHIELD-008 detects synchronous script in HTML head', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'shield-rules-'));
    writeFileSync(
      join(dir, 'index.html'),
      '<html><head>\n  <script src="/app.js"></script>\n</head></html>',
    );
    const { scanHtmlForSyncScripts } = await import('../lib/custom-rules/rules/no-sync-script.js');
    const hits = scanHtmlForSyncScripts(dir);
    expect(hits.length).toBe(1);
    expect(hits[0].ruleName).toBe('no-sync-script');
    expect(hits[0].riskType).toBe('resource-load');
    expect(hits[0].line).toBe(2);
    expect(hits[0].context?.src).toBe('/app.js');
    rmSync(dir, { recursive: true, force: true });
  });

  it('SHIELD-008 ignores async script in HTML head', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'shield-rules-'));
    writeFileSync(
      join(dir, 'index.html'),
      '<html><head>\n  <script async src="/app.js"></script>\n</head></html>',
    );
    const { scanHtmlForSyncScripts } = await import('../lib/custom-rules/rules/no-sync-script.js');
    const hits = scanHtmlForSyncScripts(dir);
    expect(hits.length).toBe(0);
    rmSync(dir, { recursive: true, force: true });
  });
});
