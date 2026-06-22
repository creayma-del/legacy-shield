# T3：依赖关系收集 visitor（import/export/require + exports 收集）

> 版本：v1.5
> 任务编号：T3
> 对应阶段 Spec：[phase-v1.5-spec.md](phase-v1.5-spec.md)
> 对应设计文档：[design-v1.5.md](../design-v1.5.md)
> 对应执行计划：[execution-plan-v1.5.md](../execution-plan-v1.5.md)
> 依赖任务：T1、T2
> 状态：评审中（待评审）
> 评审记录：见本文档末尾（轮次 1 待评审）

---

## 1. 任务目标

为 v1.5 知识图谱生成模块提供基于 Babel AST 的依赖关系收集能力，静态分析目标项目源码中的 `import` / `export` / `require` / `dynamic-import` 语句，输出结构化的依赖列表与导出符号列表。具体包括：
- 新增 `lib/knowledge-graph/collector.ts`，定义 `CollectedDependency` / `CollectedFile` 接口；
- 实现 `parseFile(filePath, code): { ast: File; isTs: boolean }` 函数，参考现有 `ast-skeleton.ts` 的 `pluginsFor` 实现思路与 `scanner.ts` 的 `parseCode` 实现思路；
- 实现 `collectDependencies(filePath, code, resolver): CollectedFile` 函数，通过 Babel visitor 覆盖 6 种节点类型收集依赖与导出。

对应阶段 Spec §3.4（依赖关系收集 visitor）与交付物 D4。本任务依赖 T1（类型定义）与 T2（ModuleResolver 实例），是 T4 / T5 的前置依赖。

---

## 2. 对应需求与验收标准

| 需求编号 | 需求描述 | 本任务验收标准 |
|---|---|---|
| REQ-1.5-1 | 扫描目标项目 src 下的 JS/JSX/TS/TSX/Vue 文件，构建文件级依赖图 | `collectDependencies` 返回 `CollectedFile` 类型，含 `dependencies` 与 `exports` 两个字段，为 T5 图构建器提供节点与边数据 |
| REQ-1.5-2 | 解析 import / export / require 语句，收集文件间依赖关系 | Babel visitor 覆盖 `ImportDeclaration` / `ExportNamedDeclaration` / `ExportAllDeclaration` / `ExportDefaultDeclaration` / `CallExpression`（require）/ `ImportExpression`（dynamic import）6 种节点；对每个 dep 调用 `resolver.resolve` 解析路径，解析失败标记 `unresolved: true` |

---

## 3. 实现步骤

### 3.1 新增 `lib/knowledge-graph/collector.ts` 文件结构与接口定义

- **文件位置**：`lib/knowledge-graph/collector.ts`（新增文件）。
- **导入依赖**（均为项目现有依赖，不引入新依赖）：

  ```typescript
  import { parse as babelParse } from '@babel/parser';
  import babelTraverseModule from '@babel/traverse';
  import { parse as parseSFC } from '@vue/compiler-sfc';
  import type { File } from '@babel/types';
  import { extname } from 'node:path';
  import type { ModuleResolver } from './resolver.js';
  ```

- **`@babel/traverse` ESM 兼容处理**（参考 [ast-skeleton.ts#L14](file:///Users/creayma/personal/legacy-shield/lib/code-quality/lib/ast-skeleton.ts#L14) 与 [scanner.ts#L10-L13](file:///Users/creayma/personal/legacy-shield/lib/custom-rules/scanner.ts#L10) 的实现思路）：

  ```typescript
  // @babel/traverse v7 在 ESM 下默认导出在 .default 属性上，按版本兜底取值
  const traverse = ((babelTraverseModule as any).default ?? babelTraverseModule) as any;
  ```

- **新增 `CollectedDependency` 接口**：

  ```typescript
  export interface CollectedDependency {
    /** import 路径（如 './foo', '@/utils/bar', '<dynamic>'） */
    spec: string;
    /** 依赖类型 */
    kind: 'import' | 're-export' | 'require' | 'dynamic-import';
    /** import 的符号列表（仅 import/require 边有值，re-export 为导出符号） */
    symbols: string[];
    /** 是否为未解析的边（动态 import、变量 require、路径解析失败） */
    unresolved: boolean;
    /** 源码行号 */
    line: number;
  }
  ```

- **新增 `CollectedFile` 接口**：

  ```typescript
  /** 文件收集结果：依赖列表 + 导出符号列表 */
  export interface CollectedFile {
    /** 依赖列表 */
    dependencies: CollectedDependency[];
    /** 本文件导出的符号列表（本地导出，含默认导出 'default'） */
    exports: string[];
  }
  ```

### 3.2 实现 `parseFile(filePath, code): { ast: File; isTs: boolean }` 函数

- **参考现有实现**：
  - 参考 [ast-skeleton.ts#L53-L60](file:///Users/creayma/personal/legacy-shield/lib/code-quality/lib/ast-skeleton.ts#L53) 的 `pluginsFor` 实现思路，根据后缀选择 Babel 插件；
  - 参考 [scanner.ts#L94-L112](file:///Users/creayma/personal/legacy-shield/lib/custom-rules/scanner.ts#L94) 的 `parseCode` 实现思路，独立实现 Vue SFC 解析。

- **Babel 插件配置**（与 `ast-skeleton.ts` 的 `pluginsFor` 对齐）：

  ```typescript
  function pluginsFor(ext: string): string[] {
    const base = ['importAssertions', 'topLevelAwait'];
    if (ext === '.js' || ext === '.jsx') return ['jsx', ...base];
    if (ext === '.ts') return ['typescript', ...base];
    if (ext === '.tsx') return ['typescript', 'jsx', ...base];
    return ['jsx', ...base];
  }
  ```

- **`parseFile` 函数实现**：

  ```typescript
  /**
   * 解析文件为 AST，返回 AST 与是否为 TypeScript
   * @param filePath 文件绝对路径
   * @param code 文件内容
   * @returns { ast: File; isTs: boolean }
   */
  function parseFile(filePath: string, code: string): { ast: File; isTs: boolean } {
    const ext = extname(filePath);

    // .vue 文件先用 @vue/compiler-sfc 提取 script 内容再解析
    if (ext === '.vue') {
      return parseVueSFC(filePath, code);
    }

    // .js / .jsx / .ts / .tsx 文件直接 Babel 解析
    const isTs = ext === '.ts' || ext === '.tsx';
    const ast = babelParse(code, {
      sourceType: 'module',
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true,
      errorRecovery: true,
      plugins: pluginsFor(ext) as any,
    });
    return { ast, isTs };
  }
  ```

- **`parseVueSFC` 辅助函数**（参考 [scanner.ts#L95-L106](file:///Users/creayma/personal/legacy-shield/lib/custom-rules/scanner.ts#L95) 的实现思路）：

  ```typescript
  /**
   * 解析 Vue SFC 文件，提取 <script> 或 <script setup> 内容后用 Babel 解析。
   * 参考 scanner.ts 的 parseCode 实现思路独立实现。
   */
  function parseVueSFC(filePath: string, code: string): { ast: File; isTs: boolean } {
    const { descriptor, errors } = parseSFC(code, { filename: filePath });
    if (errors && errors.length > 0) {
      // SFC 解析告警不阻断，交由后续流程处理
      console.warn(`[collector] SFC 解析存在告警：${filePath}\n${errors.map((e: any) => e.message).join('\n')}`);
    }

    const script = descriptor.scriptSetup ?? descriptor.script;
    const scriptContent = script?.content ?? '';
    const isTs = script?.lang === 'ts' || script?.lang === 'tsx';

    if (!scriptContent) {
      // 无 script 内容的 Vue 文件，返回空 AST（解析为空程序）
      const emptyAst = babelParse('', {
        sourceType: 'module',
        errorRecovery: true,
        plugins: ['jsx', 'typescript', 'importAssertions', 'topLevelAwait'],
      });
      return { ast: emptyAst, isTs };
    }

    const ast = babelParse(scriptContent, {
      sourceType: 'module',
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true,
      errorRecovery: true,
      plugins: isTs
        ? ['typescript', 'jsx', 'importAssertions', 'topLevelAwait']
        : ['jsx', 'importAssertions', 'topLevelAwait'],
    });
    return { ast, isTs };
  }
  ```

  - **`isTs` 判定**：对 `.ts` / `.tsx` 文件返回 `true`；对 `.vue` 文件，根据 `<script lang="ts">` 或 `<script setup lang="ts">` 的 `lang` 属性判定；对 `.js` / `.jsx` 文件返回 `false`。
  - **`errorRecovery: true`**：确保大规模扫描容错性，语法错误文件不抛异常。

### 3.3 实现 `collectDependencies(filePath, code, resolver): CollectedFile` 函数

- **函数签名**：

  ```typescript
  export function collectDependencies(
    filePath: string,
    code: string,
    resolver: ModuleResolver,
  ): CollectedFile
  ```

- **Babel visitor 实现**（严格按设计文档 [design-v1.5.md §4.1](../design-v1.5.md#41-babel-visitor-设计) 实现）：

  ```typescript
  export function collectDependencies(
    filePath: string,
    code: string,
    resolver: ModuleResolver,
  ): CollectedFile {
    const deps: CollectedDependency[] = [];
    const exports: string[] = [];

    let ast: File;
    try {
      const result = parseFile(filePath, code);
      ast = result.ast;
    } catch (err) {
      // Babel 解析失败（含 errorRecovery 仍无法处理的严重语法错误），返回空依赖
      console.warn(`[collector] 解析失败: ${filePath}`, err instanceof Error ? err.message : String(err));
      return { dependencies: [], exports: [] };
    }

    traverse(ast, {
      // import { foo } from './bar'
      // import bar from './bar'
      // import * as bar from './bar'
      ImportDeclaration(path: any) {
        const spec = path.node.source.value;
        const symbols = path.node.specifiers
          .map((s: any) => s.local?.name)
          .filter(Boolean);
        deps.push({
          spec,
          kind: 'import',
          symbols,
          unresolved: false,
          line: path.node.loc?.start.line ?? 0,
        });
      },

      // export { foo } from './bar'  (re-export，有 source)
      // export { foo }               (本地导出，无 source)
      // export const foo = ... / export function foo() ... (声明形式)
      ExportNamedDeclaration(path: any) {
        if (path.node.source) {
          // re-export：记录依赖，不计入本文件 exports
          const spec = path.node.source.value;
          const symbols = path.node.specifiers
            .map((s: any) => s.exported?.name)
            .filter(Boolean);
          deps.push({
            spec,
            kind: 're-export',
            symbols,
            unresolved: false,
            line: path.node.loc?.start.line ?? 0,
          });
        } else {
          // 本地导出：收集导出符号
          for (const specifier of path.node.specifiers) {
            const name = specifier?.exported?.name;
            if (name) exports.push(name);
          }
          // export const foo = ... / export function foo() ... 等声明形式
          const declaration = path.node.declaration;
          if (declaration) {
            if (declaration.type === 'VariableDeclaration') {
              for (const decl of declaration.declarations) {
                if (decl.id?.type === 'Identifier' && decl.id.name) {
                  exports.push(decl.id.name);
                }
              }
            } else if (
              declaration.type === 'FunctionDeclaration' ||
              declaration.type === 'ClassDeclaration'
            ) {
              if (declaration.id?.name) exports.push(declaration.id.name);
            }
          }
        }
      },

      // export * from './bar'
      ExportAllDeclaration(path: any) {
        const spec = path.node.source.value;
        deps.push({
          spec,
          kind: 're-export',
          symbols: ['*'],
          unresolved: false,
          line: path.node.loc?.start.line ?? 0,
        });
      },

      // export default ... / export default function foo() {}
      ExportDefaultDeclaration(path: any) {
        exports.push('default');
      },

      // require('./bar') / require(varName)
      CallExpression(path: any) {
        const callee = path.node.callee;
        if (callee.type === 'Identifier' && callee.name === 'require') {
          const arg = path.node.arguments[0];
          if (arg && arg.type === 'StringLiteral') {
            deps.push({
              spec: arg.value,
              kind: 'require',
              symbols: [],
              unresolved: false,
              line: path.node.loc?.start.line ?? 0,
            });
          } else {
            // 变量 require：标记为未解析
            deps.push({
              spec: '<dynamic>',
              kind: 'require',
              symbols: [],
              unresolved: true,
              line: path.node.loc?.start.line ?? 0,
            });
          }
        }
      },

      // import('./bar') / import(varName)
      ImportExpression(path: any) {
        const arg = path.node.source;
        if (arg && arg.type === 'StringLiteral') {
          deps.push({
            spec: arg.value,
            kind: 'dynamic-import',
            symbols: [],
            unresolved: false,
            line: path.node.loc?.start.line ?? 0,
          });
        } else {
          // 变量 dynamic import：标记为未解析
          deps.push({
            spec: '<dynamic>',
            kind: 'dynamic-import',
            symbols: [],
            unresolved: true,
            line: path.node.loc?.start.line ?? 0,
          });
        }
      },
    });

    // 解析路径：对每个 dep 调用 resolver.resolve，解析失败标记 unresolved: true
    const resolvedDeps = deps.map((dep) => {
      if (dep.unresolved || dep.spec === '<dynamic>') return dep;
      const resolved = resolver.resolve(dep.spec, filePath);
      return { ...dep, unresolved: resolved === null };
    });

    return { dependencies: resolvedDeps, exports };
  }
  ```

- **exports 收集规则说明**（与设计 §4.1 说明对齐）：
  - `ExportNamedDeclaration`（无 source）中的具名导出（含 `export const/function/class` 声明形式）→ 计入 `exports`；
  - `ExportDefaultDeclaration` → `exports` 推入 `'default'`；
  - re-export（`export { x } from './y'` / `export * from './y'`）→ **不计入**本文件 `exports`，仅作为依赖边记录（`kind: 're-export'`）。

### 3.4 解析阶段与路径解析

- **解析阶段**：在 visitor 遍历完成后，对每个 `dep` 调用 `resolver.resolve(dep.spec, filePath)`：
  - 若 `dep.unresolved` 已为 `true`（变量 require / 变量 dynamic import）或 `dep.spec === '<dynamic>'`，直接保留原 dep；
  - 否则调用 `resolver.resolve`，返回 `null` 时标记 `unresolved: true`。
- **路径解析失败处理**：`resolver.resolve` 返回 `null` 时，`dep.unresolved` 设为 `true`，`dep.spec` 保留原始 import 路径（用于调试），由 T5 图构建器决定是否将该边纳入图谱。

---

## 4. 测试计划

### 4.1 单元测试

> 单元测试在 T12 的 `tests/knowledge-graph/collector.test.ts` 中实现，本任务需确保实现可测试性。

- **import 依赖收集**：
  - `import { foo } from './bar'` → 收集 `spec='./bar'`、`kind='import'`、`symbols=['foo']`；
  - `import bar from './bar'` → 收集 `spec='./bar'`、`kind='import'`、`symbols=['bar']`（默认导入）；
  - `import * as bar from './bar'` → 收集 `spec='./bar'`、`kind='import'`、`symbols=['bar']`（命名空间导入）；
  - `import { foo as bar } from './bar'` → 收集 `spec='./bar'`、`kind='import'`、`symbols=['bar']`（别名导入，取 local.name）。
- **export 收集**：
  - `export { foo }` → `exports=['foo']`；
  - `export const bar = 1` → `exports=['bar']`（VariableDeclaration）；
  - `export function baz() {}` → `exports=['baz']`（FunctionDeclaration）；
  - `export class Qux {}` → `exports=['Qux']`（ClassDeclaration）；
  - `export default function(){}` → `exports=['default']`；
  - `export default 42` → `exports=['default']`。
- **re-export 依赖收集**：
  - `export { foo } from './bar'` → 记录为 re-export 依赖（`kind='re-export'`、`spec='./bar'`、`symbols=['foo']`），**不计入** `exports`；
  - `export * from './bar'` → 记录为 re-export 依赖（`kind='re-export'`、`spec='./bar'`、`symbols=['*']`），**不计入** `exports`。
- **require 依赖收集**：
  - `require('./bar')` → 收集 `kind='require'`、`spec='./bar'`、`unresolved=false`（路径可解析时）；
  - `require(varName)` → 收集 `kind='require'`、`spec='<dynamic>'`、`unresolved=true`。
- **dynamic import 依赖收集**：
  - `import('./bar')` → 收集 `kind='dynamic-import'`、`spec='./bar'`、`unresolved=false`（路径可解析时）；
  - `import(varName)` → 收集 `kind='dynamic-import'`、`spec='<dynamic>'`、`unresolved=true`。
- **Vue SFC 解析**：
  - `.vue` 文件能正确提取 `<script setup>` 内容并解析依赖；
  - `.vue` 文件 `<script setup lang="ts">` 的 `isTs` 返回 `true`；
  - `.vue` 文件无 `<script>` 内容时返回空依赖 `{ dependencies: [], exports: [] }`。
- **Babel 解析容错**：
  - 启用 `errorRecovery: true`，语法错误文件不抛异常（返回空依赖或部分依赖）；
  - 严重语法错误（`errorRecovery` 仍无法处理）时 `parseFile` 抛异常被 `try-catch` 捕获，返回 `{ dependencies: [], exports: [] }`。
- **路径解析集成**：
  - `resolver.resolve` 返回非 `null` 时 `unresolved=false`；
  - `resolver.resolve` 返回 `null` 时 `unresolved=true`，`spec` 保留原始路径。
- **`parseFile` 返回值**：
  - `isTs` 对 `.ts` / `.tsx` 文件返回 `true`；
  - `isTs` 对 `.js` / `.jsx` 文件返回 `false`；
  - `isTs` 对 `lang=ts` 的 Vue 文件返回 `true`。

### 4.2 集成测试 / 端到端测试

- 在 T12 的 `tests/knowledge-graph/integration.test.ts` 中通过 `simple-project` 夹具端到端验证：
  - `Header.vue` 的 `<script setup>` 依赖被正确收集；
  - `main.ts` 的 import 依赖被正确收集。

### 4.3 回归测试

- 既有 `tests/custom-rules.test.ts` 全绿（本任务新增独立模块，不修改 `lib/custom-rules/scanner.ts`）；
- 既有 `tests/quality.test.ts` 全绿（本任务不修改 `lib/code-quality/lib/ast-skeleton.ts`）；
- `pnpm typecheck` / `pnpm build` 对现有代码无新增错误。

---

## 5. 风险与依赖

| 风险 / 依赖 | 影响 | 应对措施 |
|---|---|---|
| 依赖 T1（CollectedFile / CollectedDependency 类型定义） | T1 未完成时无法定义接口 | T1 工作量低（1-2 人时），优先完成；T1 完成后可立即启动 T3 |
| 依赖 T2（ModuleResolver 实例） | T2 未完成时无法进行路径解析 | T2 与 T1 可并行启动；T1 完成后可先基于类型定义编写 T3 的 visitor 骨架（用 mock resolver） |
| Babel 解析容错性不足 | 语法错误文件抛异常中断扫描 | `parseFile` 启用 `errorRecovery: true`；`collectDependencies` 用 `try-catch` 包裹 `parseFile`，解析失败返回空依赖 |
| Vue SFC `<script setup>` 提取不完整 | Vue 文件依赖收集遗漏 | 参考 `scanner.ts` 的 `parseCode` 实现思路，优先提取 `scriptSetup`，其次 `script`；无 script 内容时返回空依赖 |
| `@babel/traverse` ESM 兼容性问题 | traverse 函数不可用 | 参考 `ast-skeleton.ts` 与 `scanner.ts` 的兜底取值：`((babelTraverseModule as any).default ?? babelTraverseModule) as any` |
| re-export 与本地导出混淆 | exports 列表错误包含 re-export 符号 | `ExportNamedDeclaration` 有 `source` 时记录为 re-export 依赖（不计入 exports），无 `source` 时才收集本地导出符号 |
| 不引入新的运行时依赖 | 复用现有 Babel 工具链 | 仅使用 `@babel/parser`、`@babel/traverse`、`@vue/compiler-sfc`，均为项目现有依赖 |

---

## 6. 变更范围

- **本任务范围内**：
  - `lib/knowledge-graph/collector.ts` 新增：`CollectedDependency` 接口、`CollectedFile` 接口、`parseFile` 函数（含 `pluginsFor` / `parseVueSFC` 辅助函数）、`collectDependencies` 函数。
- **不在本任务范围内**：
  - `lib/knowledge-graph/types.ts` 类型定义（由 T1 负责）；
  - `ModuleResolver` 类与 `createResolver` 工厂函数（由 T2 负责，本任务仅消费 `ModuleResolver` 实例）；
  - `scanFilesConcurrent` 并发扫描与 mtime 缓存（由 T4 负责，本任务仅提供 `collectDependencies` 供 T4 调用）；
  - 图构建、循环检测、连通分量（由 T5 负责）；
  - 图谱分析、hub/孤立/分层推断（由 T6 负责）；
  - 测试夹具（由 T12 负责）；
  - 不修改 `lib/custom-rules/scanner.ts` 中现有的 `parseCode` 实现（graph 模块独立实现，仅参考其实现思路）；
  - 不修改 `lib/code-quality/lib/ast-skeleton.ts` 中现有的 `pluginsFor` 实现（graph 模块独立实现，仅参考其实现思路）；
  - 不引入 `@babel/parser`、`@babel/traverse`、`@vue/compiler-sfc` 之外的新依赖。

---

## 7. 评审记录

| 轮次 | 日期 | 结论 | P0/P1 问题 | 修复方案 |
|---|---|---|---|---|
| 1 | 待评审 | 待评审 | — | — |
