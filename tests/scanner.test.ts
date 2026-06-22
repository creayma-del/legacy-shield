import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { scanFiles } from '../lib/custom-rules/scanner.js';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('scanner', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'shield-scan-'));
    mkdirSync(join(dir, 'src'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('scans js file with eval', async () => {
    writeFileSync(join(dir, 'src', 'app.js'), 'eval("1+1");');
    const hits = await scanFiles(dir, 'no-dangerous-apis');
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0].ruleName).toBe('no-dangerous-apis');
  });

  it('scans vue file script', async () => {
    writeFileSync(
      join(dir, 'src', 'App.vue'),
      `
      <template><div></div></template>
      <script>
        eval("x");
      </script>
    `,
    );
    const hits = await scanFiles(dir, 'no-dangerous-apis');
    expect(hits.some((h) => h.filePath.endsWith('App.vue'))).toBe(true);
  });

  it('excludes node_modules', async () => {
    mkdirSync(join(dir, 'node_modules'));
    writeFileSync(join(dir, 'node_modules', 'evil.js'), 'eval("x");');
    const hits = await scanFiles(dir, 'no-dangerous-apis');
    expect(hits.some((h) => h.filePath.includes('node_modules'))).toBe(false);
  });

  it('supports ts file with typescript syntax', async () => {
    writeFileSync(join(dir, 'src', 'app.ts'), 'const x: string = ""; eval(x);');
    const hits = await scanFiles(dir, 'no-dangerous-apis');
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });
});
