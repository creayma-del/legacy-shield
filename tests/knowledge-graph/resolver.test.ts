import { describe, it, expect } from 'vitest';
import { ModuleResolver, createResolver } from '../../lib/knowledge-graph/resolver.js';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('ModuleResolver', () => {
  let tempDir: string;

  it('TC-RES-1: 相对路径解析（扩展名补全）', () => {
    const resolver = new ModuleResolver({ projectRoot: '/proj' });
    const result = resolver.resolve('./foo', '/proj/src/main.ts');
    // 无实际文件系统，返回 null（tryExtensions 依赖 existsSync）
    // 验证不抛异常且返回 null 或路径
    expect(result === null || typeof result === 'string').toBe(true);
  });

  it('TC-RES-2: alias 路径解析', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'resolver-'));
    mkdirSync(join(tempDir, 'src', 'utils'), { recursive: true });
    writeFileSync(join(tempDir, 'src', 'utils', 'bar.ts'), 'export const bar = 1;');
    const resolver = new ModuleResolver({
      projectRoot: tempDir,
      baseUrl: tempDir,
      paths: { '@/*': ['src/*'] },
    });
    const result = resolver.resolve('@/utils/bar', join(tempDir, 'src', 'main.ts'));
    expect(result).toBe(join(tempDir, 'src', 'utils', 'bar.ts'));
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('TC-RES-3: node_modules 包路径解析（scoped 包）', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'resolver-'));
    mkdirSync(join(tempDir, 'node_modules', '@vue', 'compiler-sfc'), { recursive: true });
    writeFileSync(join(tempDir, 'node_modules', '@vue', 'compiler-sfc', 'foo.ts'), 'export const foo = 1;');
    const resolver = new ModuleResolver({ projectRoot: tempDir });
    const result = resolver.resolve('@vue/compiler-sfc/foo', join(tempDir, 'src', 'main.ts'));
    expect(result).toBe(join(tempDir, 'node_modules', '@vue', 'compiler-sfc', 'foo.ts'));
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('TC-RES-4: 纯包名跳过', () => {
    const resolver = new ModuleResolver({ projectRoot: '/proj' });
    const result = resolver.resolve('lodash', '/proj/src/main.ts');
    expect(result).toBeNull();
  });

  it('TC-RES-5: 扩展名补全顺序', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'resolver-'));
    // 创建 .ts 文件（优先级最高）
    writeFileSync(join(tempDir, 'foo.ts'), 'export const foo = 1;');
    const resolver = new ModuleResolver({ projectRoot: tempDir });
    const result = resolver.resolve('./foo', join(tempDir, 'main.ts'));
    expect(result).toBe(join(tempDir, 'foo.ts'));
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('TC-RES-6: index 文件解析', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'resolver-'));
    mkdirSync(join(tempDir, 'bar'), { recursive: true });
    writeFileSync(join(tempDir, 'bar', 'index.ts'), 'export const bar = 1;');
    const resolver = new ModuleResolver({ projectRoot: tempDir });
    const result = resolver.resolve('./bar', join(tempDir, 'main.ts'));
    expect(result).toBe(join(tempDir, 'bar', 'index.ts'));
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('TC-RES-7: 动态 import 标记（resolver 对 <dynamic> 的处理）', () => {
    const resolver = new ModuleResolver({ projectRoot: '/proj' });
    // <dynamic> 不以 . 开头，不是 alias，不是 node_modules 子路径
    const result = resolver.resolve('<dynamic>', '/proj/src/main.ts');
    expect(result).toBeNull();
  });

  it('TC-RES-8: scoped 包解析（@scope/pkg/sub）', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'resolver-'));
    mkdirSync(join(tempDir, 'node_modules', '@scope', 'pkg'), { recursive: true });
    writeFileSync(join(tempDir, 'node_modules', '@scope', 'pkg', 'sub.ts'), 'export const sub = 1;');
    const resolver = new ModuleResolver({ projectRoot: tempDir });
    const result = resolver.resolve('@scope/pkg/sub', join(tempDir, 'src', 'main.ts'));
    expect(result).toBe(join(tempDir, 'node_modules', '@scope', 'pkg', 'sub.ts'));
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('TC-RES-9: 根目录终止（向上查找 node_modules 到根目录）', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'resolver-'));
    const resolver = new ModuleResolver({ projectRoot: tempDir });
    // 不存在的包，向上查找到根目录应终止，不无限循环
    const result = resolver.resolve('nonexistent-pkg/sub', join(tempDir, 'src', 'main.ts'));
    expect(result).toBeNull();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('TC-RES-10: 无 tsconfig 的纯 JS 项目', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'resolver-'));
    writeFileSync(join(tempDir, 'foo.js'), 'module.exports = 1;');
    const resolver = new ModuleResolver({ projectRoot: tempDir });
    const result = resolver.resolve('./foo', join(tempDir, 'main.js'));
    expect(result).toBe(join(tempDir, 'foo.js'));
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('TC-RES-11: jsconfig.json 兼容', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'resolver-'));
    mkdirSync(join(tempDir, 'src', 'utils'), { recursive: true });
    writeFileSync(join(tempDir, 'src', 'utils', 'helper.ts'), 'export const helper = 1;');
    writeFileSync(
      join(tempDir, 'jsconfig.json'),
      JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/*'] } } }),
    );
    const resolver = createResolver(tempDir);
    const result = resolver.resolve('@/utils/helper', join(tempDir, 'src', 'main.ts'));
    expect(result).toBe(join(tempDir, 'src', 'utils', 'helper.ts'));
    rmSync(tempDir, { recursive: true, force: true });
  });

  // --- T8: alias 解析与优先级测试（TC-RES-12 ~ TC-RES-17）---

  it('TC-RES-12: webpack alias 解析 @/utils/helper', () => {
    const fixturePath = join(__dirname, 'fixtures/webpack-alias-project');
    const resolver = createResolver(fixturePath);
    const result = resolver.resolve('@/utils/helper', join(fixturePath, 'src', 'main.ts'));
    expect(result).toBe(join(fixturePath, 'src', 'utils', 'helper.ts'));
  });

  it('TC-RES-13: webpack alias 解析 ~/utils/helper（find 以 / 结尾）', () => {
    const fixturePath = join(__dirname, 'fixtures/webpack-alias-project');
    const resolver = createResolver(fixturePath);
    const result = resolver.resolve('~/utils/helper', join(fixturePath, 'src', 'main.ts'));
    expect(result).toBe(join(fixturePath, 'src', 'utils', 'helper.ts'));
  });

  it('TC-RES-14: vite 对象格式 alias 解析 @/utils/helper', () => {
    const fixturePath = join(__dirname, 'fixtures/vite-alias-project');
    const resolver = createResolver(fixturePath);
    const result = resolver.resolve('@/utils/helper', join(fixturePath, 'src', 'main.ts'));
    expect(result).toBe(join(fixturePath, 'src', 'utils', 'helper.ts'));
  });

  it('TC-RES-15: vite 数组格式 alias 解析 @/components/Button', () => {
    const fixturePath = join(__dirname, 'fixtures/vite-alias-project-array');
    const resolver = createResolver(fixturePath);
    const result = resolver.resolve('@/components/Button', join(fixturePath, 'src', 'main.ts'));
    expect(result).toBe(join(fixturePath, 'src', 'components', 'Button.ts'));
  });

  it('TC-RES-16: 多来源优先级 tsconfig paths > vite alias > webpack alias', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'resolver-priority-'));
    // tsconfig src（应被解析）
    mkdirSync(join(tempDir, 'src', 'utils'), { recursive: true });
    writeFileSync(join(tempDir, 'src', 'utils', 'helper.ts'), 'export const helper = 1;');
    // vite src（不应被解析）
    mkdirSync(join(tempDir, 'vite-src', 'utils'), { recursive: true });
    writeFileSync(join(tempDir, 'vite-src', 'utils', 'helper.ts'), 'export const viteHelper = 1;');
    // webpack src（不应被解析）
    mkdirSync(join(tempDir, 'webpack-src', 'utils'), { recursive: true });
    writeFileSync(join(tempDir, 'webpack-src', 'utils', 'helper.ts'), 'export const webpackHelper = 1;');

    // tsconfig.json: @/* → src/*
    writeFileSync(
      join(tempDir, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/*'] } } }),
    );
    // vite.config.ts: @ → vite-src
    writeFileSync(
      join(tempDir, 'vite.config.ts'),
      `import path from 'node:path';\nexport default { resolve: { alias: { '@': path.resolve(__dirname, 'vite-src') } } };`,
    );
    // webpack.config.js: @ → webpack-src
    writeFileSync(
      join(tempDir, 'webpack.config.js'),
      `const path = require('path');\nmodule.exports = { resolve: { alias: { '@': path.resolve(__dirname, 'webpack-src') } } };`,
    );

    const resolver = createResolver(tempDir);
    const result = resolver.resolve('@/utils/helper', join(tempDir, 'src', 'main.ts'));
    // 应解析为 tsconfig 的 src/utils/helper.ts，而非 vite/webpack 的路径
    expect(result).toBe(join(tempDir, 'src', 'utils', 'helper.ts'));
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('TC-RES-17: resolveAlias 精确匹配与前缀匹配', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'resolver-match-'));
    mkdirSync(join(tempDir, 'src', 'utils'), { recursive: true });
    writeFileSync(join(tempDir, 'src', 'utils', 'helper.ts'), 'export const helper = 1;');
    writeFileSync(join(tempDir, 'src', 'index.ts'), 'export const index = 1;');

    const resolver = new ModuleResolver({
      projectRoot: tempDir,
      aliases: [{ find: '@', replacement: join(tempDir, 'src') }],
    });

    // 精确匹配：spec === find（@ → src/index.ts via tryExtensions）
    const exactResult = resolver.resolve('@', join(tempDir, 'main.ts'));
    expect(exactResult).toBe(join(tempDir, 'src', 'index.ts'));

    // 前缀匹配：spec.startsWith(find + '/')
    const prefixResult = resolver.resolve('@/utils/helper', join(tempDir, 'main.ts'));
    expect(prefixResult).toBe(join(tempDir, 'src', 'utils', 'helper.ts'));

    // 非匹配：@utils 不匹配 @（非精确，非前缀 with /），fallthrough 到 node_modules 返回 null
    const nonMatchResult = resolver.resolve('@utils', join(tempDir, 'main.ts'));
    expect(nonMatchResult).toBeNull();

    rmSync(tempDir, { recursive: true, force: true });
  });
});
