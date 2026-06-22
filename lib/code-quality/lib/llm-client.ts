// legacy-shield / lib/code-quality / lib / llm-client.ts
// ------------------------------------------------------------
// OpenAI 兼容 HTTP API 调用（原生 fetch，无 SDK）
// 必填：OPENAI_API_KEY
// 可选：OPENAI_BASE_URL（默认 https://api.openai.com/v1）
// 默认模型：gpt-4o-mini，可由 --model 覆盖
// ------------------------------------------------------------

import { FILL_BEGIN, FILL_END } from './ast-skeleton.js';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_TIMEOUT_MS = 60_000;

export interface GenerateAssertionsOptions {
  sourceCode: string;
  skeleton: string;
  filePath: string;
  model?: string;
}

/**
 * 调用 LLM 补全骨架中的 AI-FILL 区域。
 * 输入完整骨架 + 源码，输出完整 spec 文件源码字符串。
 */
export async function generateAssertions(opts: GenerateAssertionsOptions): Promise<string> {
  const { sourceCode, skeleton, filePath, model } = opts;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      '[code-quality] 缺少 OPENAI_API_KEY 环境变量；该模块通过 OpenAI 兼容 HTTP API 生成断言，禁止静默兜底。'
    );
  }
  const baseURL = (process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
  // 模型优先级（高 -> 低）：CLI 参数 model > 本地配置（注入到 CODE_QUALITY_DEFAULT_MODEL） > 内置默认
  const useModel = model || process.env.CODE_QUALITY_DEFAULT_MODEL || DEFAULT_MODEL;

  const systemPrompt = [
    '你是一个严格的 Vitest 单元测试生成器。',
    `只允许修改用户给出的骨架中 ${FILL_BEGIN} 与 ${FILL_END} 之间的内容。`,
    '不允许新增 import；不允许修改 import / describe 标题；不允许使用任何未在骨架中导入的标识符。',
    '请基于被测源码补全 it 块内的具体 expect 断言，使其能通过 vitest run。',
    '输出必须是完整的 Vitest 测试文件源代码（ESM），不要使用 markdown 代码块包裹，不要输出任何额外解释文字。'
  ].join('\n');

  const userPrompt = [
    `被测文件路径：${filePath}`,
    '',
    '== 被测源码（开始） ==',
    sourceCode,
    '== 被测源码（结束） ==',
    '',
    '== 当前骨架（开始） ==',
    skeleton,
    '== 当前骨架（结束） =='
  ].join('\n');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS);

  let resp: Response;
  try {
    resp = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: useModel,
        temperature: 0.2,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      }),
      signal: ctrl.signal
    });
  } catch (err: any) {
    clearTimeout(timer);
    throw new Error(`[code-quality] LLM 请求失败：${err.message}`);
  }
  clearTimeout(timer);

  if (!resp.ok) {
    const text = await safeReadText(resp);
    throw new Error(
      `[code-quality] LLM 返回非 2xx：${resp.status} ${resp.statusText} -> ${text.slice(0, 500)}`
    );
  }
  let json: any;
  try {
    json = await resp.json();
  } catch (err: any) {
    throw new Error(`[code-quality] LLM 响应非 JSON：${err.message}`);
  }
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('[code-quality] LLM 响应缺少 choices[0].message.content');
  }
  const cleaned = stripCodeFence(content.trim());
  validateSpec(cleaned, filePath);
  return cleaned;
}

function stripCodeFence(text: string): string {
  // 兜底：若模型仍输出了 ```js / ```javascript / ``` 包裹，剥掉
  const fenceRe = /^```(?:[a-zA-Z]+)?\n([\s\S]*?)\n```$/;
  const m = text.match(fenceRe);
  return m ? m[1] : text;
}

function validateSpec(content: string, filePath: string): void {
  if (!content.includes('describe(')) {
    throw new Error(`[code-quality] LLM 输出缺少 describe(：${filePath}`);
  }
  if (!content.includes('expect(')) {
    throw new Error(`[code-quality] LLM 输出缺少 expect(：${filePath}`);
  }
}

async function safeReadText(resp: Response): Promise<string> {
  try {
    return await resp.text();
  } catch {
    return '<unreadable>';
  }
}
