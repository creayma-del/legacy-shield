// legacy-shield / lib/code-quality / lib / runner.ts
// ------------------------------------------------------------
// 子进程输出捕获：
//   - type-check / lint / vitest 统一使用 stdio: 'pipe'
//   - 通过 data 事件同时写入 process.stdout/process.stderr（保持终端可见性）
//     并累积为字符串
//   - 返回完整 CodeQualityResult，不再调用 process.exit()
// ------------------------------------------------------------

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { CODE_QUALITY_DIR, LEGACY_SHIELD_ROOT } from './paths.js';
import type { CodeQualityResult, CodeQualitySummary } from '../../types.js';

export interface RunChildOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  command: string;
  legacyRoot: string;
}

function buildBaseSummary(_code: number): CodeQualitySummary {
  return {
    exitCode: _code,
    testStatus: 'unknown',
    eslintIssueCount: 0,
    typeCheckStatus: 'unknown'
  };
}

/**
 * 通用子进程执行：保持终端可见性，同时累积 stdout/stderr 字符串。
 */
export function runChild(
  bin: string,
  args: string[],
  opts: RunChildOptions
): Promise<CodeQualityResult> {
  return new Promise((resolvePromise) => {
    if (!existsSync(bin)) {
      const stderr =
        `[code-quality] 未找到可执行文件：${bin}\n` +
        '请先在 legacy-shield 项目根目录执行 pnpm install 安装依赖。\n';
      process.stderr.write(stderr);
      resolvePromise({
        command: opts.command,
        code: 1,
        stdout: '',
        stderr,
        legacyRoot: opts.legacyRoot,
        executedAt: new Date().toISOString(),
        summary: buildBaseSummary(1)
      });
      return;
    }

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    const child = spawn(bin, args, {
      stdio: 'pipe',
      env: opts.env,
      cwd: opts.cwd
    });

    child.stdout?.on('data', (data: Buffer) => {
      process.stdout.write(data);
      stdoutChunks.push(data);
    });
    child.stderr?.on('data', (data: Buffer) => {
      process.stderr.write(data);
      stderrChunks.push(data);
    });

    child.on('exit', (code) => {
      const exitCode = code ?? 1;
      resolvePromise({
        command: opts.command,
        code: exitCode,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        legacyRoot: opts.legacyRoot,
        executedAt: new Date().toISOString(),
        summary: buildBaseSummary(exitCode)
      });
    });
    child.on('error', (err: Error) => {
      const stderr = `[code-quality] 子进程错误：${err.message}\n`;
      process.stderr.write(stderr);
      resolvePromise({
        command: opts.command,
        code: 1,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8') + stderr,
        legacyRoot: opts.legacyRoot,
        executedAt: new Date().toISOString(),
        summary: buildBaseSummary(1)
      });
    });
  });
}

/**
 * 调起 vitest run 仅运行指定 spec 文件。
 */
export function runVitest(
  specs: string[],
  env: NodeJS.ProcessEnv,
  legacyRoot?: string
): Promise<CodeQualityResult> {
  const projectPath = legacyRoot || env.LEGACY_PROJECT_PATH || '';
  const bin = resolve(LEGACY_SHIELD_ROOT, 'node_modules/.bin/vitest');
  const args = [
    'run',
    '--config',
    resolve(CODE_QUALITY_DIR, 'configs/vitest.config.ts'),
    ...specs
  ];
  return runChild(bin, args, {
    command: 'vitest run',
    env,
    cwd: CODE_QUALITY_DIR,
    legacyRoot: projectPath
  }).then((result: CodeQualityResult) => {
    const summary: CodeQualitySummary = {
      ...result.summary,
      testStatus: result.code === 0 ? 'passed' : 'failed',
      exitCode: result.code
    };
    return { ...result, summary };
  });
}
