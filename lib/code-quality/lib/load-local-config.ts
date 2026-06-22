// legacy-shield / lib/code-quality / lib / load-local-config.ts
// ------------------------------------------------------------
// 在 legacy-shield 根目录尝试加载 .local-llm-config.js（不提交到远程仓库）。
//
// 优先级（高 -> 低）：
//   1. 显式环境变量 / 命令行 --model（不会被本文件覆盖）
//   2. .local-llm-config.js 中的字段
//   3. 代码内置默认值（OPENAI_BASE_URL=https://api.openai.com/v1，model=gpt-4o-mini）
//
// 支持的字段（全部可选；缺什么补什么）：
//   - OPENAI_API_KEY: string
//   - OPENAI_BASE_URL: string
//   - model: string   （默认模型；命令行 --model 优先）
// ------------------------------------------------------------

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { LEGACY_SHIELD_ROOT } from './paths.js';

const CONFIG_FILENAME = '.local-llm-config.js';

export interface LoadLocalLLMConfigResult {
  loaded: boolean;
  path?: string;
}

/**
 * 尝试读取 legacy-shield 根目录下的 .local-llm-config.js 并把字段注入 process.env。
 * 文件不存在 -> 静默返回（这是用户期望的"无配置则走原逻辑"路径）。
 * 文件存在但解析失败 -> 显式抛错（红线规则：禁止静默兜底）。
 */
export async function loadLocalLLMConfig(): Promise<LoadLocalLLMConfigResult> {
  const file = resolve(LEGACY_SHIELD_ROOT, CONFIG_FILENAME);
  if (!existsSync(file)) {
    return { loaded: false };
  }
  let mod: any;
  try {
    mod = await import(pathToFileURL(file).href);
  } catch (err: any) {
    throw new Error(
      `[code-quality] 加载 ${CONFIG_FILENAME} 失败：${err.message}`
    );
  }
  const cfg = mod.default ?? mod;
  if (!cfg || typeof cfg !== 'object') {
    throw new Error(
      `[code-quality] ${CONFIG_FILENAME} 必须默认导出一个对象（含 OPENAI_API_KEY / OPENAI_BASE_URL / model 字段，全部可选）。`
    );
  }

  const applied: string[] = [];
  // 仅在对应 env 缺失时注入，避免覆盖用户在 shell 里显式 export 的值
  if (typeof cfg.OPENAI_API_KEY === 'string' && cfg.OPENAI_API_KEY.trim() && !process.env.OPENAI_API_KEY) {
    process.env.OPENAI_API_KEY = cfg.OPENAI_API_KEY.trim();
    applied.push('OPENAI_API_KEY');
  }
  if (typeof cfg.OPENAI_BASE_URL === 'string' && cfg.OPENAI_BASE_URL.trim() && !process.env.OPENAI_BASE_URL) {
    process.env.OPENAI_BASE_URL = cfg.OPENAI_BASE_URL.trim();
    applied.push('OPENAI_BASE_URL');
  }
  if (typeof cfg.model === 'string' && cfg.model.trim() && !process.env.CODE_QUALITY_DEFAULT_MODEL) {
    process.env.CODE_QUALITY_DEFAULT_MODEL = cfg.model.trim();
    applied.push('model');
  }

  if (applied.length > 0) {
    console.log(
      `[code-quality] 已加载本地配置 ${CONFIG_FILENAME}：${applied.join(', ')}`
    );
  }
  return { loaded: true, path: file };
}
