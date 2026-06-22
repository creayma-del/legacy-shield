// legacy-shield / lib/code-quality / lib / git-diff.ts
// ------------------------------------------------------------
// 收集老项目 src/**/*.{js,jsx,ts,tsx,vue} 范围内的变更文件绝对路径。
// 取以下三者并集：
//   1) git diff --name-only --diff-filter=ACMRT       (已暂存 + 未暂存修改)
//   2) git ls-files --others --exclude-standard       (未跟踪新增)
//   3) git diff --name-only --diff-filter=ACMRT <base>...HEAD  (相对 base)
// 若老项目不是 git 仓库 -> 显式抛错。
// 若 base 不存在 -> warning 后跳过第 3 项（不抛错）。
// ------------------------------------------------------------

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';
import { legacySrcOf, isSupportedExt } from './paths.js';

export interface CollectChangedFilesOptions {
  legacyRoot: string;
  base?: string;
}

/**
 * @param opts - 配置项
 * @returns 老项目 src 内 .js / .vue 的绝对路径数组（去重）
 */
export function collectChangedFiles(opts: CollectChangedFilesOptions): string[] {
  const { legacyRoot, base = 'origin/main' } = opts;
  assertGitRepo(legacyRoot);
  const srcRoot = legacySrcOf(legacyRoot);
  if (!existsSync(srcRoot)) {
    throw new Error(`[code-quality] 老项目缺少 src 目录：${srcRoot}`);
  }

  const collected = new Set<string>();

  // 1) 已暂存 + 未暂存（HEAD 与工作区）
  pushLines(collected, runGit(legacyRoot, ['diff', '--name-only', '--diff-filter=ACMRT', 'HEAD']));
  // 2) 未跟踪新增
  pushLines(
    collected,
    runGit(legacyRoot, ['ls-files', '--others', '--exclude-standard'])
  );
  // 3) 相对 base
  if (refExists(legacyRoot, base)) {
    pushLines(
      collected,
      runGit(legacyRoot, ['diff', '--name-only', '--diff-filter=ACMRT', `${base}...HEAD`])
    );
  } else {
    console.warn(
      `[code-quality] base ref "${base}" 不存在或不可解析，已跳过相对 base 的 diff（仅取本地未提交并集）。`
    );
  }

  // 过滤 + 转绝对路径
  const out: string[] = [];
  for (const rel of collected) {
    if (!rel) continue;
    const abs = isAbsolute(rel) ? rel : resolve(legacyRoot, rel);
    if (!abs.startsWith(srcRoot + '/') && abs !== srcRoot) continue;
    if (!isSupportedExt(abs)) continue;
    if (!existsSync(abs)) continue; // 已删除文件不生成测试
    out.push(abs);
  }
  return [...new Set(out)];
}

function assertGitRepo(legacyRoot: string): void {
  const r = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd: legacyRoot,
    encoding: 'utf8'
  });
  if (r.status !== 0 || (r.stdout || '').trim() !== 'true') {
    throw new Error(`[code-quality] 老项目不是 git 仓库：${legacyRoot}`);
  }
}

function refExists(legacyRoot: string, ref: string): boolean {
  const r = spawnSync('git', ['rev-parse', '--verify', '--quiet', ref], {
    cwd: legacyRoot,
    encoding: 'utf8'
  });
  return r.status === 0;
}

function runGit(legacyRoot: string, args: string[]): string {
  const r = spawnSync('git', args, { cwd: legacyRoot, encoding: 'utf8' });
  if (r.status !== 0) {
    // 非致命：如 ls-files 在子目录失败，统一返回空
    return '';
  }
  return r.stdout || '';
}

function pushLines(set: Set<string>, raw: string): void {
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (t) set.add(t);
  }
}

// 导出给单元测试 / 工具复用
export const __TEST_ONLY__ = { runGit, refExists };
