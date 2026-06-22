import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { runCodeQuality } from '../lib/quality.js';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAll, runModule, runDiff } from '../lib/code-quality/index.js';
import type { CodeQualityResult } from '../lib/types.js';

const DEPRECATION_MESSAGE = 'CODE_QUALITY_ROOT 已废弃，将使用 legacy-shield 内置 code-quality。';

vi.mock('../lib/code-quality/index.js', () => {
  const baseResult: CodeQualityResult = {
    command: 'code-quality all',
    code: 0,
    stdout: 'Type check passed\nTests 5 passed',
    stderr: '',
    legacyRoot: '/tmp/fake',
    executedAt: new Date().toISOString(),
    summary: {
      exitCode: 0,
      testStatus: 'passed',
      eslintIssueCount: 0,
      typeCheckStatus: 'passed',
    },
  };
  return {
    runAll: vi.fn().mockResolvedValue(baseResult),
    runModule: vi.fn().mockResolvedValue({ ...baseResult, command: 'code-quality module' }),
    runDiff: vi.fn().mockResolvedValue({ ...baseResult, command: 'code-quality diff' }),
    runWatch: vi.fn(),
    loadLocalLLMConfig: vi.fn(),
    createCLI: vi.fn(),
  };
});

function makeResult(overrides: Partial<CodeQualityResult> = {}): CodeQualityResult {
  return {
    command: 'code-quality all',
    code: 0,
    stdout: 'Type check passed\nTests 5 passed',
    stderr: '',
    legacyRoot: '/tmp/fake',
    executedAt: new Date().toISOString(),
    summary: {
      exitCode: 0,
      testStatus: 'passed',
      eslintIssueCount: 0,
      typeCheckStatus: 'passed',
    },
    ...overrides,
  };
}

describe('quality', () => {
  let fakeLegacy: string;
  const originalEnv = process.env.CODE_QUALITY_ROOT;

  beforeEach(() => {
    fakeLegacy = mkdtempSync(join(tmpdir(), 'shield-quality-'));
    mkdirSync(join(fakeLegacy, 'src'));
    writeFileSync(join(fakeLegacy, 'package.json'), JSON.stringify({ name: 'fake-legacy' }));
    vi.clearAllMocks();
  });

  afterEach(() => {
    rmSync(fakeLegacy, { recursive: true, force: true });
    if (originalEnv === undefined) {
      delete process.env.CODE_QUALITY_ROOT;
    } else {
      process.env.CODE_QUALITY_ROOT = originalEnv;
    }
  });

  it('dispatches to runAll by default and returns complete CodeQualityResult', async () => {
    const internal = makeResult({ command: 'code-quality all' });
    vi.mocked(runAll).mockResolvedValue(internal);

    const result = await runCodeQuality(fakeLegacy, {});

    expect(runAll).toHaveBeenCalledTimes(1);
    expect(runAll).toHaveBeenCalledWith({ projectPath: fakeLegacy, skip: [] });
    expect(result.command).toBe('all');
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(internal.stdout);
    expect(result.stderr).toBe(internal.stderr);
    expect(result.summary).toEqual({
      exitCode: 0,
      testStatus: 'passed',
      eslintIssueCount: 0,
      typeCheckStatus: 'passed',
    });
  });

  it('dispatches to runModule when targets provided', async () => {
    const internal = makeResult({ command: 'code-quality module', code: 0 });
    vi.mocked(runModule).mockResolvedValue(internal);

    const result = await runCodeQuality(fakeLegacy, { targets: ['src/App.vue'] });

    expect(runModule).toHaveBeenCalledTimes(1);
    expect(runModule).toHaveBeenCalledWith({ projectPath: fakeLegacy, targets: ['src/App.vue'] });
    expect(result.command).toBe('module');
  });

  it('dispatches to runDiff when base provided', async () => {
    const internal = makeResult({ command: 'code-quality diff' });
    vi.mocked(runDiff).mockResolvedValue(internal);

    const result = await runCodeQuality(fakeLegacy, { base: 'origin/main' });

    expect(runDiff).toHaveBeenCalledTimes(1);
    expect(runDiff).toHaveBeenCalledWith({ projectPath: fakeLegacy, base: 'origin/main' });
    expect(result.command).toBe('diff');
  });

  it('maps skipList to internal skip parameter', async () => {
    vi.mocked(runAll).mockResolvedValue(makeResult());

    await runCodeQuality(fakeLegacy, { skipList: ['type-check', 'test'] });

    expect(runAll).toHaveBeenCalledWith({
      projectPath: fakeLegacy,
      skip: ['type-check', 'test'],
    });
  });

  it('returns error result when internal API throws', async () => {
    vi.mocked(runAll).mockRejectedValue(new Error('internal boom'));

    const result = await runCodeQuality(fakeLegacy, {});

    expect(result.command).toBe('all');
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('internal boom');
    expect(result.summary.exitCode).toBe(1);
  });

  describe('CODE_QUALITY_ROOT deprecation', () => {
    beforeEach(() => {
      vi.resetModules();
    });

    it('prints deprecation warning when CODE_QUALITY_ROOT is set', async () => {
      process.env.CODE_QUALITY_ROOT = '/some/deprecated/path';
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const { runCodeQuality: runFresh } = await import('../lib/quality.js');
      await runFresh(fakeLegacy, {});

      expect(warnSpy).toHaveBeenCalledWith(DEPRECATION_MESSAGE);
      warnSpy.mockRestore();
    });

    it('does not print deprecation warning when CODE_QUALITY_ROOT is not set', async () => {
      delete process.env.CODE_QUALITY_ROOT;
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const { runCodeQuality: runFresh } = await import('../lib/quality.js');
      await runFresh(fakeLegacy, {});

      expect(warnSpy).not.toHaveBeenCalledWith(DEPRECATION_MESSAGE);
      warnSpy.mockRestore();
    });

    it('prints deprecation warning only once per process lifecycle', async () => {
      process.env.CODE_QUALITY_ROOT = '/some/deprecated/path';
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const { runCodeQuality: runFresh } = await import('../lib/quality.js');
      await runFresh(fakeLegacy, {});
      await runFresh(fakeLegacy, {});

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(DEPRECATION_MESSAGE);
      warnSpy.mockRestore();
    });
  });
});
