// legacy-shield / lib/code-quality / lib / orchestrator.ts
// ------------------------------------------------------------
// 把 AST -> LLM -> 写盘 -> 跑测串成 pipeline，复用于 module / diff / watch 三个子命令。
// ------------------------------------------------------------

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildSkeleton } from './ast-skeleton.js';
import { generateAssertions } from './llm-client.js';
import { writeTest } from './test-writer.js';
import { runVitest } from './runner.js';
import { mirrorTestPathOf } from './paths.js';

export interface ProcessOneFileOptions {
  legacyRoot: string;
  srcAbs: string;
  model?: string;
}

export interface GenerateAndRunOptions {
  legacyRoot: string;
  files: string[];
  model?: string;
  runTests?: boolean;
}

export interface GenerateAndRunResult {
  specs: string[];
  errors: Array<{ file: string; error: Error }>;
  vitestExit: number;
}

/**
 * 处理单个文件：源码读取 -> 骨架 -> LLM 补全 -> 写盘
 * 返回该文件对应的镜像 spec 绝对路径
 */
export async function processOneFile(opts: ProcessOneFileOptions): Promise<string> {
  const { legacyRoot, srcAbs, model } = opts;
  if (!existsSync(srcAbs)) {
    throw new Error(`[code-quality] 源文件不存在：${srcAbs}`);
  }
  const sourceCode = await readFile(srcAbs, 'utf8');
  const specAbs = mirrorTestPathOf(legacyRoot, srcAbs);
  const { skeleton } = buildSkeleton({ srcAbs, specAbs, sourceCode });
  const content = await generateAssertions({
    sourceCode,
    skeleton,
    filePath: srcAbs,
    model
  });
  await writeTest({ specAbs, content });
  return specAbs;
}

/**
 * 批量：对每个文件顺序跑 processOneFile；任一失败收集错误。
 * 全部完成后，runVitest=true 时一次性 vitest run 所有成功生成的 spec。
 */
export async function generateAndRun(opts: GenerateAndRunOptions): Promise<GenerateAndRunResult> {
  const { legacyRoot, files, model, runTests = true } = opts;
  const specs: string[] = [];
  const errors: Array<{ file: string; error: Error }> = [];
  for (const srcAbs of files) {
    try {
      console.log(`[code-quality] 处理：${srcAbs}`);
      const specAbs = await processOneFile({
        legacyRoot,
        srcAbs: resolve(srcAbs),
        model
      });
      specs.push(specAbs);
      console.log(`[code-quality]  -> 已写入：${specAbs}`);
    } catch (err: any) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error(`[code-quality]  -> 失败：${srcAbs}\n${error.stack || error.message}`);
      errors.push({ file: srcAbs, error });
    }
  }

  let vitestExit = 0;
  if (runTests && specs.length > 0) {
    const env = { ...process.env, LEGACY_PROJECT_PATH: legacyRoot };
    const result = await runVitest(specs, env, legacyRoot);
    vitestExit = result.code;
  }

  return { specs, errors, vitestExit };
}
