// legacy-shield / lib/code-quality / lib / test-writer.ts
// ------------------------------------------------------------
// 幂等写盘：
//   - 文件不存在：直接写
//   - 文件存在：仅替换 AI-FILL-BEGIN/END 区域；
//     若旧文件没有该标记（用户手写过），打印 warning 并跳过覆盖。
// ------------------------------------------------------------

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { FILL_BEGIN, FILL_END } from './ast-skeleton.js';

export interface WriteTestOptions {
  specAbs: string;
  content: string;
}

export interface WriteTestResult {
  written: boolean;
  reason?: string;
}

/**
 * @param opts - 写盘选项
 * @returns 是否写入成功及原因
 */
export async function writeTest(opts: WriteTestOptions): Promise<WriteTestResult> {
  const { specAbs, content } = opts;
  await mkdir(dirname(specAbs), { recursive: true });

  if (!existsSync(specAbs)) {
    await writeFile(specAbs, content, 'utf8');
    return { written: true };
  }

  const old = await readFile(specAbs, 'utf8');
  const oldRange = locateFill(old);
  const newRange = locateFill(content);

  if (!oldRange) {
    console.warn(
      `[code-quality] 已存在的 spec 不含 AI-FILL 标记，视为用户手写测试，跳过覆盖：${specAbs}`
    );
    return { written: false, reason: 'no-marker-in-old' };
  }
  if (!newRange) {
    // LLM 输出格式异常（理论上 llm-client 已校验过 describe/expect，但未必含标记）
    console.warn(
      `[code-quality] LLM 输出不含 AI-FILL 标记，无法做区域替换，跳过覆盖：${specAbs}`
    );
    return { written: false, reason: 'no-marker-in-new' };
  }

  const newInner = content.slice(newRange.innerStart, newRange.innerEnd);
  const merged =
    old.slice(0, oldRange.innerStart) + newInner + old.slice(oldRange.innerEnd);
  await writeFile(specAbs, merged, 'utf8');
  return { written: true };
}

interface FillRange {
  innerStart: number;
  innerEnd: number;
}

function locateFill(text: string): FillRange | null {
  const begin = text.indexOf(FILL_BEGIN);
  const end = text.indexOf(FILL_END);
  if (begin === -1 || end === -1 || end <= begin) return null;
  return {
    innerStart: begin + FILL_BEGIN.length,
    innerEnd: end
  };
}
