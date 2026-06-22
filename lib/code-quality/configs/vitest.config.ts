// legacy-shield / lib/code-quality / configs / vitest.config.ts
// ------------------------------------------------------------
// Vitest 配置：
//   - 测试文件位于 legacy-shield/tests/code-quality-generated/ 下，import 老项目 src
//   - 通过 alias '@' -> <老项目>/src 模拟老项目常见别名（仅在设置 LEGACY_PROJECT_PATH 时启用）
//   - 老项目根目录通过 LEGACY_PROJECT_PATH 环境变量传入（由 runner.ts 注入）
// ------------------------------------------------------------

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import { CODE_QUALITY_TESTS_DIR } from '../lib/paths.js';

const legacyProjectPath = process.env.LEGACY_PROJECT_PATH;
const LEGACY_ROOT = legacyProjectPath ? resolve(legacyProjectPath) : undefined;
const LEGACY_SRC = LEGACY_ROOT ? resolve(LEGACY_ROOT, 'src') : undefined;

const alias: Record<string, string> = {};
if (LEGACY_SRC && existsSync(LEGACY_SRC)) {
  // 与多数 Vue3 + Webpack 老项目默认 alias 对齐；如老项目 alias 不同，用户可在测试文件内
  // 用相对路径 import 替代——本模块不修改老项目 webpack.config 任何内容。
  alias['@'] = LEGACY_SRC;
}

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias
  },
  test: {
    environment: 'jsdom',
    globals: true,
    // 测试文件仅来自 tests/code-quality-generated/（按用户选择：自动生成的测试文件落在该稳定目录）
    include: [resolve(CODE_QUALITY_TESTS_DIR, '**/*.{test,spec}.{js,mjs,cjs,ts,jsx,tsx}')],
    // 显式排除老项目内部的任何 spec，避免越界
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      ...(LEGACY_ROOT ? [LEGACY_ROOT + '/**'] : [])
    ]
  }
});
