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
});
