import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfigFile, loadAliasConfig } from '../../lib/knowledge-graph/config-loader.js';

describe('config-loader 异常路径', () => {
  let tempDir: string;

  it('TC-RES-18: jiti 加载失败降级（配置文件含语法错误）', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'cfg-loader-'));
    // 创建含语法错误的 webpack.config.js（缺少右括号）
    writeFileSync(
      join(tempDir, 'webpack.config.js'),
      `const path = require('path'\n// 语法错误：缺少右括号`,
    );

    // loadConfigFile 应返回 null（jiti 解析失败被 catch）
    const config = loadConfigFile(join(tempDir, 'webpack.config.js'));
    expect(config).toBeNull();

    // loadAliasConfig 应跳过 webpack 来源，不抛异常
    const aliasConfig = loadAliasConfig(tempDir);
    expect(aliasConfig.webpackAliases).toEqual([]);
    expect(aliasConfig.mergedAliases).toEqual([]);

    rmSync(tempDir, { recursive: true, force: true });
  });

  it('TC-RES-19: 函数式配置排除（defineConfig 返回函数）', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'cfg-loader-'));
    mkdirSync(join(tempDir, 'src'), { recursive: true });
    // 创建函数式 vite.config.ts
    writeFileSync(
      join(tempDir, 'vite.config.ts'),
      `import path from 'node:path';\nexport default (env) => ({\n  resolve: {\n    alias: { '@': path.resolve(__dirname, 'src') }\n  }\n});`,
    );

    // loadConfigFile 应返回 null（导出值为函数）
    const config = loadConfigFile(join(tempDir, 'vite.config.ts'));
    expect(config).toBeNull();

    // loadAliasConfig 应跳过 vite 来源，不抛异常
    const aliasConfig = loadAliasConfig(tempDir);
    expect(aliasConfig.viteAliases).toEqual([]);
    expect(aliasConfig.mergedAliases).toEqual([]);

    rmSync(tempDir, { recursive: true, force: true });
  });

  it('TC-RES-20: tsconfig.json 解析失败时跳过 tsconfig 来源', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'cfg-loader-'));
    mkdirSync(join(tempDir, 'src'), { recursive: true });
    // 创建含 JSON 语法错误的 tsconfig.json（缺少数组右括号）
    writeFileSync(
      join(tempDir, 'tsconfig.json'),
      `{ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["src/*" } } }`,
    );
    // 创建有效的 webpack.config.js（验证 tsconfig 失败不影响其他来源）
    writeFileSync(
      join(tempDir, 'webpack.config.js'),
      `const path = require('path');\nmodule.exports = { resolve: { alias: { '@': path.resolve(__dirname, 'src') } } };`,
    );

    // loadAliasConfig 应跳过 tsconfig 来源（tsconfig 为 null，paths 为 undefined）
    const aliasConfig = loadAliasConfig(tempDir);
    expect(aliasConfig.tsconfig).toBeNull();
    expect(aliasConfig.paths).toBeUndefined();
    // webpack 来源应正常加载
    expect(aliasConfig.webpackAliases.length).toBe(1);
    expect(aliasConfig.webpackAliases[0].find).toBe('@');
    expect(aliasConfig.mergedAliases.length).toBe(1);

    rmSync(tempDir, { recursive: true, force: true });
  });
});
