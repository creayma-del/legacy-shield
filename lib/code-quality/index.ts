// legacy-shield / lib / code-quality / index.ts
// ------------------------------------------------------------
// 内部 API：导出 runAll / runModule / runDiff / runWatch
// 供 lib/quality.ts 适配层调用。
// ------------------------------------------------------------

import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import chokidar from 'chokidar';
import { Command } from 'commander';
import type { CodeQualityResult, CodeQualitySummary } from '../types.js';
import { generateAndRun, processOneFile } from './lib/orchestrator.js';
import { collectChangedFiles } from './lib/git-diff.js';
import { runChild, runVitest } from './lib/runner.js';
import { legacySrcOf, SUPPORTED_EXTS, isSupportedExt, CODE_QUALITY_DIR, CODE_QUALITY_TESTS_DIR } from './lib/paths.js';
import { loadLocalLLMConfig } from './lib/load-local-config.js';

export interface CodeQualityAllOptions {
  projectPath: string;
  skip?: ('type-check' | 'lint' | 'test')[];
}

export interface CodeQualityModuleOptions {
  projectPath: string;
  targets: string[];
  model?: string;
}

export interface CodeQualityDiffOptions {
  projectPath: string;
  base?: string;
  model?: string;
}

export interface CodeQualityWatchOptions {
  projectPath: string;
  debounce?: number;
  model?: string;
}

function assertLegacyProject(projectPath: string): void {
  if (!existsSync(projectPath)) {
    throw new Error(`老项目路径不存在：${projectPath}`);
  }
  if (!existsSync(join(projectPath, 'package.json'))) {
    throw new Error(`老项目缺少 package.json：${projectPath}`);
  }
  if (!existsSync(join(projectPath, 'src'))) {
    throw new Error(`老项目缺少 src 目录：${projectPath}`);
  }
}

function createDerivedTsconfig(projectPath: string): { dir: string; file: string } {
  const tmp = mkdtempSync(join(tmpdir(), 'code-quality-'));
  const derived = {
    extends: resolve(CODE_QUALITY_DIR, 'configs/tsconfig.base.json'),
    compilerOptions: {
      // 让 vue-tsc 在临时目录解析 import / 类型库时仍能找到 legacy-shield 的 node_modules
      baseUrl: CODE_QUALITY_DIR,
      // 派生 tsconfig 写在系统临时目录，TS 从临时目录向上找不到 legacy-shield 的 node_modules/@types，
      // 必须显式指定 typeRoots 指回 legacy-shield 的 @types，否则 "types": ["node"] 解析失败 (TS2688)。
      typeRoots: [resolve(CODE_QUALITY_DIR, '../../node_modules/@types')],
      paths: {
        '@/*': [resolve(projectPath, 'src') + '/*']
      }
    },
    include: [
      resolve(projectPath, 'src') + '/**/*.js',
      resolve(projectPath, 'src') + '/**/*.jsx',
      resolve(projectPath, 'src') + '/**/*.ts',
      resolve(projectPath, 'src') + '/**/*.tsx',
      resolve(projectPath, 'src') + '/**/*.vue'
    ],
    exclude: [
      resolve(projectPath, 'node_modules') + '/**',
      resolve(projectPath, 'dist') + '/**'
    ]
  };
  const file = join(tmp, 'tsconfig.derived.json');
  writeFileSync(file, JSON.stringify(derived, null, 2), 'utf8');
  return { dir: tmp, file };
}

function safeRm(p: string): void {
  try {
    rmSync(p, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

function buildEmptySummary(): CodeQualitySummary {
  return {
    exitCode: 0,
    testStatus: 'unknown',
    eslintIssueCount: 0,
    typeCheckStatus: 'unknown'
  };
}

function mergeResults(results: CodeQualityResult[], command: string, legacyRoot: string): CodeQualityResult {
  const code = results.reduce((max, r) => Math.max(max, r.code), 0);
  const stdout = results.map((r) => r.stdout).join('\n');
  const stderr = results.map((r) => r.stderr).join('\n');
  const summary: CodeQualitySummary = {
    exitCode: code,
    testStatus: 'unknown',
    eslintIssueCount: 0,
    typeCheckStatus: 'unknown'
  };

  for (const r of results) {
    if (r.command.includes('vue-tsc') || r.command.includes('type-check')) {
      summary.typeCheckStatus = r.code === 0 ? 'passed' : 'failed';
    } else if (r.command.includes('eslint') || r.command.includes('lint')) {
      summary.eslintIssueCount += r.summary?.eslintIssueCount || 0;
    } else if (r.command.includes('vitest') || r.command.includes('test')) {
      summary.testStatus = r.code === 0 ? 'passed' : 'failed';
    }
  }

  return {
    command,
    code,
    stdout,
    stderr,
    legacyRoot,
    executedAt: new Date().toISOString(),
    summary
  };
}

export async function runAll(opts: CodeQualityAllOptions): Promise<CodeQualityResult> {
  const projectPath = resolve(opts.projectPath);
  assertLegacyProject(projectPath);

  const env = {
    ...process.env,
    LEGACY_PROJECT_PATH: projectPath
  };

  const VALID_SKIP = new Set(['type-check', 'lint', 'test']);
  const skipSet = new Set<string>();
  for (const s of opts.skip || []) {
    if (!VALID_SKIP.has(s)) {
      throw new Error(
        `[code-quality] skip 仅支持 type-check / lint / test，收到非法值：${s}`
      );
    }
    skipSet.add(s);
  }

  const results: CodeQualityResult[] = [];

  if (!skipSet.has('type-check')) {
    const { dir, file } = createDerivedTsconfig(projectPath);
    try {
      const result = await runChild(
        resolve(CODE_QUALITY_DIR, '../../node_modules/.bin/vue-tsc'),
        ['--noEmit', '-p', file],
        {
          command: 'vue-tsc type-check',
          env,
          cwd: CODE_QUALITY_DIR,
          legacyRoot: projectPath
        }
      );
      results.push(result);
    } finally {
      safeRm(dir);
    }
  }

  if (!skipSet.has('lint')) {
    const srcDir = resolve(projectPath, 'src');
    const patterns = [
      join(srcDir, '**/*.js'),
      join(srcDir, '**/*.jsx'),
      join(srcDir, '**/*.ts'),
      join(srcDir, '**/*.tsx'),
      join(srcDir, '**/*.vue')
    ];
    const result = await runChild(
      resolve(CODE_QUALITY_DIR, '../../node_modules/.bin/eslint'),
      [
        '--config',
        resolve(CODE_QUALITY_DIR, 'configs/eslint.config.ts'),
        '--no-error-on-unmatched-pattern',
        ...patterns
      ],
      {
        command: 'eslint lint',
        env,
        cwd: CODE_QUALITY_DIR,
        legacyRoot: projectPath
      }
    );
    results.push(result);
  }

  if (!skipSet.has('test')) {
    const result = await runVitest(
      [resolve(CODE_QUALITY_TESTS_DIR, '**/*.spec.js')],
      env,
      projectPath
    );
    results.push(result);
  }

  return mergeResults(results, 'code-quality all', projectPath);
}

export async function runModule(opts: CodeQualityModuleOptions): Promise<CodeQualityResult> {
  const projectPath = resolve(opts.projectPath);
  assertLegacyProject(projectPath);
  const srcRoot = legacySrcOf(projectPath);
  const files = (opts.targets || []).map((t: string) => {
    const abs = resolve(projectPath, t);
    if (!abs.startsWith(srcRoot + '/') && abs !== srcRoot) {
      throw new Error(`[code-quality] target 必须位于老项目 src 内：${t}`);
    }
    if (!isSupportedExt(abs)) {
      throw new Error(`[code-quality] 仅支持 ${SUPPORTED_EXTS.join(' / ')}：${t}`);
    }
    if (!existsSync(abs)) {
      throw new Error(`[code-quality] target 不存在：${abs}`);
    }
    return abs;
  });
  if (files.length === 0) {
    throw new Error('[code-quality] 未提供任何 target');
  }
  const { errors, vitestExit } = await generateAndRun({
    legacyRoot: projectPath,
    files,
    model: opts.model,
    runTests: true
  });
  if (errors.length > 0) {
    return {
      command: 'code-quality module',
      code: vitestExit || 1,
      stdout: '',
      stderr: errors.map((e) => `${e.file}: ${e.error.message}`).join('\n'),
      legacyRoot: projectPath,
      executedAt: new Date().toISOString(),
      summary: {
        ...buildEmptySummary(),
        exitCode: vitestExit || 1,
        testStatus: vitestExit === 0 ? 'passed' : 'failed'
      }
    };
  }
  return {
    command: 'code-quality module',
    code: vitestExit,
    stdout: '',
    stderr: '',
    legacyRoot: projectPath,
    executedAt: new Date().toISOString(),
    summary: {
      ...buildEmptySummary(),
      exitCode: vitestExit,
      testStatus: vitestExit === 0 ? 'passed' : 'failed'
    }
  };
}

export async function runDiff(opts: CodeQualityDiffOptions): Promise<CodeQualityResult> {
  const projectPath = resolve(opts.projectPath);
  assertLegacyProject(projectPath);
  const files = collectChangedFiles({ legacyRoot: projectPath, base: opts.base });
  if (files.length === 0) {
    return {
      command: 'code-quality diff',
      code: 0,
      stdout: '[code-quality] git 未检测到任何 src 内的 .js/.jsx/.ts/.tsx/.vue 变更，无需生成。',
      stderr: '',
      legacyRoot: projectPath,
      executedAt: new Date().toISOString(),
      summary: buildEmptySummary()
    };
  }
  const { errors, vitestExit } = await generateAndRun({
    legacyRoot: projectPath,
    files,
    model: opts.model,
    runTests: true
  });
  if (errors.length > 0) {
    return {
      command: 'code-quality diff',
      code: vitestExit || 1,
      stdout: '',
      stderr: errors.map((e) => `${e.file}: ${e.error.message}`).join('\n'),
      legacyRoot: projectPath,
      executedAt: new Date().toISOString(),
      summary: {
        ...buildEmptySummary(),
        exitCode: vitestExit || 1,
        testStatus: vitestExit === 0 ? 'passed' : 'failed'
      }
    };
  }
  return {
    command: 'code-quality diff',
    code: vitestExit,
    stdout: '',
    stderr: '',
    legacyRoot: projectPath,
    executedAt: new Date().toISOString(),
    summary: {
      ...buildEmptySummary(),
      exitCode: vitestExit,
      testStatus: vitestExit === 0 ? 'passed' : 'failed'
    }
  };
}

export async function runWatch(opts: CodeQualityWatchOptions): Promise<CodeQualityResult> {
  const projectPath = resolve(opts.projectPath);
  assertLegacyProject(projectPath);
  const srcRoot = legacySrcOf(projectPath);
  const debounceMs = Math.max(0, opts.debounce ?? 800);
  const env = { ...process.env, LEGACY_PROJECT_PATH: projectPath };

  const watcher = chokidar.watch(srcRoot, {
    ignored: ['**/node_modules/**', '**/dist/**', '**/.git/**'],
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 }
  });

  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  function schedule(absPath: string): void {
    if (!isSupportedExt(absPath)) return;
    const existing = timers.get(absPath);
    if (existing) clearTimeout(existing);
    const t = setTimeout(async () => {
      timers.delete(absPath);
      try {
        console.log(`\n[code-quality] 变更：${absPath}`);
        const specAbs = await processOneFile({
          legacyRoot: projectPath,
          srcAbs: absPath,
          model: opts.model
        });
        console.log(`[code-quality]  -> 已写入：${specAbs}`);
        const result = await runVitest([specAbs], env, projectPath);
        if (result.code !== 0) {
          console.error(`[code-quality]  -> vitest 退出码 ${result.code}（继续监听）`);
        }
      } catch (err: any) {
        const error = err instanceof Error ? err : new Error(String(err));
        console.error(`[code-quality] 处理失败（继续监听）：${error.message}`);
      }
    }, debounceMs);
    timers.set(absPath, t);
  }

  watcher.on('add', schedule);
  watcher.on('change', schedule);
  watcher.on('error', (err: unknown) => {
    console.error('[code-quality] chokidar 错误：', err);
  });

  const shutdown = async () => {
    console.log('\n[code-quality] watch 退出中...');
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
    try {
      await watcher.close();
    } catch {
      /* ignore */
    }
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return {
    command: 'code-quality watch',
    code: 0,
    stdout: `[code-quality] watch 启动，监听目录：${srcRoot}（防抖 ${debounceMs}ms）`,
    stderr: '',
    legacyRoot: projectPath,
    executedAt: new Date().toISOString(),
    summary: buildEmptySummary()
  };
}

// 兼容原 cli.js 的本地 LLM 配置加载；index.ts 作为内部 API 入口不直接启动 CLI，
// 但保留加载能力供调用方选择使用。
export { loadLocalLLMConfig };

// 内部调试入口（可选），暴露为 Commander 子命令。
// 注意：此入口不随 legacy-shield 主 CLI 发布，仅用于独立调试。
export function createCLI(): Command {
  const program = new Command();
  program
    .name('code-quality')
    .description('对 Vue3 + JS + Webpack 老项目进行零侵入的 TS / ESLint / Vitest 串联校验')
    .version('0.1.0');

  program
    .command('all')
    .description('依次执行 type-check -> lint -> test，任一失败整体失败')
    .requiredOption('-p, --project <path>', '老项目根目录绝对路径')
    .option('--skip <step...>', '跳过指定阶段，可多次：type-check / lint / test', [])
    .action(async (opts: any) => {
      const result = await runAll({
        projectPath: opts.project,
        skip: opts.skip || []
      });
      process.exit(result.code);
    });

  program
    .command('module')
    .description('为 --target 指定的老项目源文件生成单测并执行')
    .requiredOption('-p, --project <path>', '老项目根目录绝对路径')
    .requiredOption('-t, --target <file...>', '老项目内 src 下的源文件路径，可多次指定')
    .option('--model <model>', 'LLM 模型，默认 gpt-4o-mini')
    .action(async (opts: any) => {
      const result = await runModule({
        projectPath: opts.project,
        targets: opts.target || [],
        model: opts.model
      });
      process.exit(result.code);
    });

  program
    .command('diff')
    .description('收集 git 变更的 src 内源文件，生成单测并执行')
    .requiredOption('-p, --project <path>', '老项目根目录绝对路径')
    .option('--base <ref>', 'diff 比较基线，默认 origin/main', 'origin/main')
    .option('--model <model>', 'LLM 模型，默认 gpt-4o-mini')
    .action(async (opts: any) => {
      const result = await runDiff({
        projectPath: opts.project,
        base: opts.base,
        model: opts.model
      });
      process.exit(result.code);
    });

  program
    .command('watch')
    .description('监听老项目 src 变更，实时生成单测并执行（800ms 防抖）')
    .requiredOption('-p, --project <path>', '老项目根目录绝对路径')
    .option('--debounce <ms>', '防抖毫秒，默认 800', '800')
    .option('--model <model>', 'LLM 模型，默认 gpt-4o-mini')
    .action(async (opts: any) => {
      await runWatch({
        projectPath: opts.project,
        debounce: Number(opts.debounce),
        model: opts.model
      });
    });

  return program;
}
