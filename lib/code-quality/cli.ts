#!/usr/bin/env node
// legacy-shield / lib / code-quality / cli.ts
// ------------------------------------------------------------
// 内部调试入口（可选），暴露 code-quality 子命令：
//   all     - vue-tsc + ESLint + Vitest 串联校验
//   module  - 为 --target 指定文件生成单测并执行
//   diff    - 基于 git 变更生成单测并执行
//   watch   - 监听 src 变更，800ms 防抖后生成并执行
// ------------------------------------------------------------

import { createCLI, loadLocalLLMConfig } from './index.js';

(async () => {
  try {
    await loadLocalLLMConfig();
  } catch (err: any) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error('[code-quality] 本地配置加载失败：', error.message);
    process.exit(1);
  }

  const program = createCLI();
  program.parseAsync(process.argv).catch((err: any) => {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error('[code-quality] CLI 异常：', error);
    process.exit(1);
  });
})();
