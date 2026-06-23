import { describe, it, expect } from 'vitest';
import { collectDependencies } from '../../lib/knowledge-graph/collector.js';
import { ModuleResolver } from '../../lib/knowledge-graph/resolver.js';

const resolver = new ModuleResolver({ projectRoot: '/proj' });

describe('collectDependencies', () => {
  it('TC-COL-1: import 收集', () => {
    const code = `import { foo } from './bar';`;
    const result = collectDependencies('/proj/src/main.ts', code, resolver);
    const dep = result.dependencies.find((d) => d.spec === './bar');
    expect(dep).toBeDefined();
    expect(dep!.kind).toBe('import');
    expect(dep!.symbols).toEqual(['foo']);
  });

  it('TC-COL-2: export 本地导出', () => {
    const code = `export { foo }; export const bar = 1;`;
    const result = collectDependencies('/proj/src/main.ts', code, resolver);
    expect(result.exports).toContain('foo');
    expect(result.exports).toContain('bar');
  });

  it('TC-COL-3: re-export 依赖', () => {
    const code = `export { foo } from './bar';`;
    const result = collectDependencies('/proj/src/main.ts', code, resolver);
    const dep = result.dependencies.find((d) => d.spec === './bar');
    expect(dep).toBeDefined();
    expect(dep!.kind).toBe('re-export');
    expect(result.exports).not.toContain('foo');
  });

  it('TC-COL-4: export * ', () => {
    const code = `export * from './bar';`;
    const result = collectDependencies('/proj/src/main.ts', code, resolver);
    const dep = result.dependencies.find((d) => d.spec === './bar');
    expect(dep).toBeDefined();
    expect(dep!.kind).toBe('re-export');
    expect(dep!.symbols).toEqual(['*']);
  });

  it('TC-COL-5: export default', () => {
    const code = `export default function() {}`;
    const result = collectDependencies('/proj/src/main.ts', code, resolver);
    expect(result.exports).toContain('default');
  });

  it('TC-COL-6: require 字符串字面量', () => {
    const code = `const bar = require('./bar');`;
    const result = collectDependencies('/proj/src/main.ts', code, resolver);
    const dep = result.dependencies.find((d) => d.spec === './bar');
    expect(dep).toBeDefined();
    expect(dep!.kind).toBe('require');
  });

  it('TC-COL-7: require 变量', () => {
    const code = `const name = './bar'; const bar = require(name);`;
    const result = collectDependencies('/proj/src/main.ts', code, resolver);
    const dep = result.dependencies.find((d) => d.spec === '<dynamic>');
    expect(dep).toBeDefined();
    expect(dep!.unresolved).toBe(true);
  });

  it('TC-COL-8: dynamic import 字符串字面量', () => {
    const code = `import('./bar');`;
    const result = collectDependencies('/proj/src/main.ts', code, resolver);
    const dep = result.dependencies.find((d) => d.spec === './bar');
    expect(dep).toBeDefined();
    expect(dep!.kind).toBe('dynamic-import');
  });

  it('TC-COL-9: dynamic import 变量', () => {
    const code = `const name = './bar'; import(name);`;
    const result = collectDependencies('/proj/src/main.ts', code, resolver);
    const dep = result.dependencies.find((d) => d.spec === '<dynamic>');
    expect(dep).toBeDefined();
    expect(dep!.unresolved).toBe(true);
  });

  it('TC-COL-10: Vue SFC 解析', () => {
    const code = `<script setup lang="ts">import { format } from '../utils/format';</script><template><div/></template>`;
    const result = collectDependencies('/proj/src/components/Header.vue', code, resolver);
    const dep = result.dependencies.find((d) => d.spec === '../utils/format');
    expect(dep).toBeDefined();
    expect(dep!.kind).toBe('import');
  });

  it('TC-COL-11: Vue SFC lang=ts', () => {
    const code = `<script setup lang="ts">const x: number = 1;</script>`;
    const result = collectDependencies('/proj/src/components/Header.vue', code, resolver);
    // 不抛异常即通过
    expect(result).toBeDefined();
  });

  it('TC-COL-12: Babel 解析容错', () => {
    const code = `import { from './broken';`;
    const result = collectDependencies('/proj/src/main.ts', code, resolver);
    // 语法错误不抛异常（errorRecovery: true）
    expect(result).toBeDefined();
    expect(result.dependencies).toBeDefined();
  });

  it('TC-COL-13: 声明形式导出', () => {
    const code = `export function foo() {} export class Bar {}`;
    const result = collectDependencies('/proj/src/main.ts', code, resolver);
    expect(result.exports).toContain('foo');
    expect(result.exports).toContain('Bar');
  });

  it('TC-COL-14: parseFile 返回类型', () => {
    // 通过 collectDependencies 间接验证 parseFile
    const code = `const x: number = 1;`;
    const result = collectDependencies('/proj/src/main.ts', code, resolver);
    expect(result).toBeDefined();
    expect(result.dependencies).toBeDefined();
    expect(result.exports).toBeDefined();
  });
});
