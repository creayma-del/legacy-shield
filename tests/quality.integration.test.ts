import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readdirSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const cliPath = resolve('dist/cli.js');
const vitestBinPath = resolve('node_modules/.bin/vitest');
const generatedDir = resolve('tests/code-quality-generated');
const vitestConfigPath = resolve('lib/code-quality/configs/vitest.config.ts');

function createLegacyProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'shield-quality-'));
  mkdirSync(join(dir, 'src'));
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'fake-legacy', type: 'module' }),
  );
  writeFileSync(
    join(dir, 'src', 'utils.js'),
    'export function add(a, b) { return a + b; }\n',
  );
  return dir;
}

function createPlaceholderSpec(): void {
  mkdirSync(generatedDir, { recursive: true });
  writeFileSync(
    join(generatedDir, 'utils.spec.js'),
    `import { describe, it, expect } from 'vitest';\n\ndescribe('generated placeholder', () => {\n  it('passes', () => {\n    expect(true).toBe(true);\n  });\n});\n`,
  );
}

describe('quality integration', () => {
  let dir: string;

  beforeAll(() => {
    if (!existsSync(cliPath)) {
      throw new Error(`集成测试依赖 ${cliPath}，请先执行 pnpm build`);
    }
    dir = createLegacyProject();
    rmSync(generatedDir, { recursive: true, force: true });
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(generatedDir, { recursive: true, force: true });
  });

  it('runs all command with skip and exits 0', () => {
    const result = spawnSync(
      'node',
      [
        cliPath,
        'quality',
        '--project',
        dir,
        '--skip',
        'type-check',
        '--skip',
        'lint',
        '--skip',
        'test',
      ],
      { encoding: 'utf8' },
    );

    expect(result.status).toBe(0);
    expect(result.stdout + result.stderr).toContain('[legacy-shield] quality 摘要');

    const qualityDir = join(dir, '.runtime-log-ignore', 'quality');
    expect(existsSync(qualityDir)).toBe(true);
    const files = readdirSync(qualityDir);
    expect(files.length).toBeGreaterThanOrEqual(1);
  });

  it('runs module command and reports missing OPENAI_API_KEY', () => {
    const result = spawnSync(
      'node',
      [cliPath, 'quality', '--project', dir, '--target', 'src/utils.js'],
      { encoding: 'utf8' },
    );

    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toContain('OPENAI_API_KEY');
  });

  it('runs diff command and reports missing OPENAI_API_KEY', () => {
    spawnSync('git', ['init'], { cwd: dir, encoding: 'utf8' });
    spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, encoding: 'utf8' });
    spawnSync('git', ['config', 'user.name', 'Test'], { cwd: dir, encoding: 'utf8' });
    spawnSync('git', ['add', '.'], { cwd: dir, encoding: 'utf8' });
    spawnSync('git', ['commit', '-m', 'init'], { cwd: dir, encoding: 'utf8' });

    writeFileSync(
      join(dir, 'src', 'utils.js'),
      'export function add(a, b) { return a + b; }\nexport function sub(a, b) { return a - b; }\n',
    );

    const result = spawnSync(
      'node',
      [cliPath, 'quality', '--project', dir, '--base', 'HEAD'],
      { encoding: 'utf8' },
    );

    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toContain('OPENAI_API_KEY');
  });

  it('loads generated spec from stable directory when LEGACY_PROJECT_PATH is set', () => {
    createPlaceholderSpec();

    const result = spawnSync(
      vitestBinPath,
      ['run', '--config', vitestConfigPath, generatedDir],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          LEGACY_PROJECT_PATH: dir,
        },
      },
    );

    expect(result.status).toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).toContain('Test Files');
    expect(output).toContain('passed');
  });

  it('runs v1.3 quality path with platform and structured logging', () => {
    writeFileSync(
      join(dir, 'index.html'),
      '<html><head><script src="/app.js"></script></head><body></body></html>',
    );
    const result = spawnSync(
      'node',
      [
        cliPath,
        'quality',
        '--project',
        dir,
        '--platform',
        'web',
        '--skip',
        'type-check',
        '--skip',
        'lint',
        '--skip',
        'test',
      ],
      { encoding: 'utf8' },
    );

    expect(result.status).toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).toContain('[legacy-shield] quality 摘要');
    expect(output).toContain('平台类型: web');
    expect(output).toContain('结构化日志');

    const structuredLogDir = join(dir, '.legacy-shield', 'logs');
    expect(existsSync(structuredLogDir)).toBe(true);
    const files = readdirSync(structuredLogDir);
    expect(files.length).toBeGreaterThanOrEqual(1);
    expect(files[0]).toMatch(/^shield_.+\.ndjson$/);
  });
});
