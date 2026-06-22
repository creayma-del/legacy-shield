# legacy-shield 自定义规则开发指南

`legacy-shield` 内置了基于 Babel AST 的自定义规则扫描能力，用于检测老项目中 `ESLint` 与类型检查难以覆盖的潜在风险。本文档介绍规则结构、AST 遍历示例、注册新规则的步骤以及测试方法。

## 规则结构

一条自定义规则是一个符合 `ShieldRule` 接口的对象：

```typescript
import type { Visitor } from '@babel/traverse';
import type { RuleHit, ShieldRule } from '../../types.js';

const rule: ShieldRule = {
  id: 'SHIELD-XXX',          // 规则唯一编号
  name: 'rule-name',         // 规则短名
  severity: 'error',         // 命中级别：'error' 或 'warning'
  description: '规则描述',    // 一句话说明规则用途
  visitor: (hits: RuleHit[], filePath: string): Visitor => ({
    // Babel AST visitor
  }),
};

export default rule;
```

`visitor` 接收两个参数：

- `hits`：命中结果数组，发现违规时向其中 `push` 一个 `RuleHit`。
- `filePath`：当前扫描文件绝对路径，用于构造 `RuleHit.filePath`。

`RuleHit` 结构：

```typescript
interface RuleHit {
  ruleId: string;        // 规则 ID
  ruleName: string;      // 规则名称
  filePath: string;      // 文件路径
  line: number;          // 行号（从 1 开始）
  column: number;        // 列号（从 1 开始）
  message: string;       // 命中提示信息
  severity: 'error' | 'warning';
}
```

## AST 遍历示例

以下示例实现一条新规则：检测代码中是否存在 `debugger` 语句。

### 1. 创建规则文件

在 `lib/custom-rules/rules/` 下新建 `my-rule.ts`：

```typescript
import type { NodePath, Visitor } from '@babel/traverse';
import type * as t from '@babel/types';
import type { RuleHit, ShieldRule } from '../../types.js';

function addHit(hits: RuleHit[], rule: ShieldRule, filePath: string, node: t.Node, message: string) {
  hits.push({
    ruleId: rule.id,
    ruleName: rule.name,
    filePath,
    line: node.loc?.start.line ?? 0,
    column: (node.loc?.start.column ?? 0) + 1,
    message,
    severity: rule.severity,
  });
}

const rule: ShieldRule = {
  id: 'SHIELD-XXX',          // 替换为未使用的规则编号，如 SHIELD-005
  name: 'my-rule',
  severity: 'warning',
  description: '检测代码中遗留的 debugger 语句',
  visitor: (hits: RuleHit[], filePath: string): Visitor => ({
    DebuggerStatement(path: NodePath<t.DebuggerStatement>) {
      addHit(hits, rule, filePath, path.node, '代码中存在 debugger 语句，提交前应移除');
    },
  }),
};

export default rule;
```

### 2. 理解常用 Babel 节点

| 节点类型 | 说明 |
|---|---|
| `CallExpression` | 函数调用，如 `foo()`、`obj.bar()` |
| `MemberExpression` | 成员表达式，如 `obj.prop`、`obj['prop']` |
| `Identifier` | 标识符，如 `localStorage`、`setItem` |
| `StringLiteral` | 字符串字面量，如 `'setItem'` |
| `ForStatement` / `WhileStatement` | 循环语句 |
| `FunctionDeclaration` / `ArrowFunctionExpression` | 函数定义 |

### 3. 访问父级或兄弟节点

`@babel/traverse` 的 `path` 对象提供丰富的方法：

```typescript
// 获取父节点
const parent = path.parent;

// 判断是否在函数内部
const func = path.getFunctionParent();

// 判断是否在循环内部
const loop = path.findParent((p) => p.isForStatement() || p.isWhileStatement() || p.isDoWhileStatement());

// 查找最近的变量声明
path.scope.getBinding('foo');
```

## 注册新规则步骤

1. **在 `lib/custom-rules/rules/` 下创建规则文件**，如 `my-rule.ts`。
2. **导出默认规则对象**，类型为 `ShieldRule`。
3. **在 `lib/custom-rules/rules/index.ts` 中注册**：

   ```typescript
   import myRule from './my-rule.js';

   export const RULE_IMPLEMENTATIONS: Record<string, ShieldRule> = {
     // ... 已有规则
     'my-rule': myRule,
   };
   ```

4. **运行测试**：`pnpm test`。
5. **运行 quality 验证**：

   ```bash
   node ./dist/cli.js quality --project /path/to/legacy
   ```

   命中结果会写入 `<project>/.runtime-log-ignore/quality/<date>.jsonl`。

## 测试规则方法

### 1. 单元测试

在 `tests/custom-rules.test.ts` 中为规则添加用例：

```typescript
import { describe, it, expect } from 'vitest';
import { scanFile } from '../lib/custom-rules/index.js';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('my-rule', () => {
  it('reports debugger statement', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'shield-rule-'));
    const file = join(dir, 'bad.js');
    writeFileSync(
      file,
      `function foo() {
         debugger;
       }`,
    );
    try {
      const hits = await scanFile(file, 'my-rule');
      expect(hits.length).toBe(1);
      expect(hits[0].ruleId).toBe('SHIELD-XXX');
      expect(hits[0].severity).toBe('warning');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

### 2. 本地快速验证

在不写单元测试的情况下，可以临时调用 `scanFile`：

```bash
# 需先执行 pnpm build
node -e "
import('./dist/lib/custom-rules/index.js').then(async ({ scanFile }) => {
  const hits = await scanFile('/path/to/legacy/src/pages/index.js', 'no-dangerous-apis');
  console.log(JSON.stringify(hits, null, 2));
});
"
```

### 3. 集成到 quality

```bash
pnpm build
node ./dist/cli.js quality --project /path/to/legacy --disable-rule SHIELD-001
```

通过 `--disable-rule` 可以临时禁用已有规则，验证新规则是否生效。

## 最佳实践

1. **规则编号规范**：使用 `SHIELD-XXX` 格式，避免与已有规则冲突。
2. **severity 选择**：
   - `error`：明确会导致运行时风险或安全漏洞的写法（如 `eval`、`document.write`）。
   - `warning`：代码异味或潜在性能问题（如循环中同步存储、过大循环）。
3. **message 清晰**：命中信息应说明问题原因与建议方向。
4. **性能友好**：避免在 visitor 中频繁创建大对象或进行深层递归。
5. **Vue 支持**：扫描器会自动解析 `.vue` 文件的 `<script>` 与 `<script setup>` 块，规则无需额外处理 SFC。

## 现有规则参考

| 规则 ID | 名称 | 说明 |
|---|---|---|
| SHIELD-001 | no-dangerous-apis | 检测 eval、new Function、innerHTML、document.write |
| SHIELD-002 | no-large-loops | 检测循环上限过大的 `for` 循环 |
| SHIELD-003 | no-expensive-watcher | 检测 Vue 组件中开销过大的 watcher |
| SHIELD-004 | no-sync-storage-in-loop | 检测循环中的 localStorage 同步调用 |

阅读这些规则的源码可快速掌握 AST 遍历模式。

## Pinia / Vuex 自定义规则示例

v1.4 在 `shield` 运行时新增了 `pinia-error` / `pinia-plugin-error` / `vuex-error` / `vuex-strict-violation` 四个子类型。这些子类型属于运行时 NDJSON 日志范畴，已被 analyzer / reporter / `/logs?type=runtime` / `/errors/top` 端点自动消费 —— 自定义规则体系本身仍专注于**静态 AST 扫描**，定位「易触发运行时 store 错误」的代码模式，与运行时采集形成静/动互补。

新子类型在自定义规则消费侧的使用方式：

- **基于 `subType` 直接消费**：若需要按错误类型驱动外部告警 / 聚合脚本，可直接读取 NDJSON 文件或调用 `/logs?type=runtime`，按 `subType in ('vuex-strict-violation', 'pinia-error', ...)` 过滤。不需要扩展规则引擎本身。
- **静态规则提前拦截**：在 `lib/custom-rules/rules/` 下新增一条 `ShieldRule`，沿用本文档「规则结构 / AST 遍历示例 / 注册新规则步骤」中的写法，扫描业务代码中容易触发上述运行时错误的写法（例如在组件内直接修改 `store.state.xxx`，会触发运行时 `vuex-strict-violation`）。

### 示例：`no-vuex-state-mutation`（必选示例）

下面给出一条**完整可运行**的静态规则示例，用于在编码阶段提前发现"在组件 / 业务代码中直接修改 `store.state.xxx` 的写法"——这是触发运行时 `vuex-strict-violation` 子类型的典型代码模式。规则完全基于现有 `ShieldRule` 接口与 `scanFile` 扫描入口实现，不引入任何新的扩展点。

#### 1. 规则文件

在 `lib/custom-rules/rules/` 下新建 `no-vuex-state-mutation.ts`：

```typescript
import type { NodePath, Visitor } from '@babel/traverse';
import type * as t from '@babel/types';
import type { RuleHit, ShieldRule } from '../../types.js';

function addHit(hits: RuleHit[], rule: ShieldRule, filePath: string, node: t.Node, message: string) {
  hits.push({
    ruleId: rule.id,
    ruleName: rule.name,
    filePath,
    line: node.loc?.start.line ?? 0,
    column: (node.loc?.start.column ?? 0) + 1,
    message,
    severity: rule.severity,
  });
}

/**
 * 判断 MemberExpression 是否形如 `<storeIdent>.state.xxx[.yyy ...]`，
 * 其中 storeIdent 通常为 `store` / `$store` / `this.$store`。
 */
function isStoreStateMember(node: t.Node): boolean {
  if (node.type !== 'MemberExpression') return false;
  // 递归向 object 方向走，直到看到 `.state`
  let current: t.Expression | t.PrivateName = node;
  while (current.type === 'MemberExpression') {
    const { object, property } = current;
    if (
      property.type === 'Identifier' &&
      property.name === 'state' &&
      (object.type === 'Identifier' ||
        (object.type === 'MemberExpression' &&
          object.property.type === 'Identifier' &&
          (object.property.name === '$store' || object.property.name === 'store')))
    ) {
      return true;
    }
    current = current.object;
  }
  return false;
}

const rule: ShieldRule = {
  id: 'SHIELD-005',
  name: 'no-vuex-state-mutation',
  severity: 'error',
  description: '检测在组件 / 业务代码中直接修改 store.state.xxx 的写法（易触发运行时 vuex-strict-violation）',
  visitor: (hits: RuleHit[], filePath: string): Visitor => ({
    AssignmentExpression(path: NodePath<t.AssignmentExpression>) {
      // 形如 store.state.user.name = 'x' / this.$store.state.foo = 1
      if (path.node.left.type === 'MemberExpression' && isStoreStateMember(path.node.left.object)) {
        addHit(
          hits,
          rule,
          filePath,
          path.node,
          '禁止在组件 / 业务代码中直接修改 store.state.*，请通过 mutation 完成；该写法在 Vuex strict mode 下会触发运行时 vuex-strict-violation',
        );
      }
    },
    UpdateExpression(path: NodePath<t.UpdateExpression>) {
      // 形如 store.state.count++ / --this.$store.state.count
      if (path.node.argument.type === 'MemberExpression' && isStoreStateMember(path.node.argument.object)) {
        addHit(
          hits,
          rule,
          filePath,
          path.node,
          '禁止对 store.state.* 执行自增 / 自减；该写法在 Vuex strict mode 下会触发运行时 vuex-strict-violation',
        );
      }
    },
  }),
};

export default rule;
```

#### 2. 注册规则

在 `lib/custom-rules/rules/index.ts` 中追加注册：

```typescript
import noVuexStateMutation from './no-vuex-state-mutation.js';

export const RULE_IMPLEMENTATIONS: Record<string, ShieldRule> = {
  // ... 已有规则
  'no-vuex-state-mutation': noVuexStateMutation,
};
```

#### 3. 单元测试

在 `tests/custom-rules.test.ts` 中追加用例：

```typescript
import { describe, it, expect } from 'vitest';
import { scanFile } from '../lib/custom-rules/index.js';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('no-vuex-state-mutation', () => {
  it('reports direct mutation on store.state', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'shield-rule-'));
    const file = join(dir, 'bad.js');
    writeFileSync(
      file,
      `function bad(store) {
         store.state.user.name = 'x';
         this.$store.state.count++;
       }`,
    );
    try {
      const hits = await scanFile(file, 'no-vuex-state-mutation');
      expect(hits.length).toBe(2);
      expect(hits[0].ruleId).toBe('SHIELD-005');
      expect(hits[0].severity).toBe('error');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not report mutation inside a Vuex mutation handler context', async () => {
    // 当前规则采用保守策略：所有 store.state.* 赋值都告警。
    // 如需放过 mutations 文件内部，可在 visitor 中追加文件路径过滤。
    const dir = mkdtempSync(join(tmpdir(), 'shield-rule-'));
    const file = join(dir, 'ok.js');
    writeFileSync(file, `function ok(state) { state.user.name = 'x'; }`);
    try {
      const hits = await scanFile(file, 'no-vuex-state-mutation');
      expect(hits.length).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

#### 4. 与运行时子类型联动

- 静态阶段：`pnpm build && node ./dist/cli.js quality --project /path/to/legacy` 会把 SHIELD-005 命中写入质量日志，可在编码 / CR 阶段提前拦截。
- 运行时阶段：若违规代码仍漏入生产并被执行，`shield` 子命令会在浏览器侧产生 `subType: vuex-strict-violation` 的 NDJSON 条目，包含 `modulePath` / `mutatedKeyPath` / state 摘要等结构化上下文，可通过 `/logs?type=runtime` 与 `/errors/top` 端点消费，与静态规则形成闭环。

> 同样的写法可扩展到其他 store 错误模式，例如：检测在组件内调用 `pinia.use(...)` 之外的不安全插件注册方式，可写一条 `no-direct-pinia-plugin-mutate` 规则，复用相同的 `ShieldRule` 框架，无需引入新的扩展点。
