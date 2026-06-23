# T11：CLI 子命令集成（lib/cli/graph.ts runGraph 参数转换 + cli.ts 扩展）

> 版本：v1.5
> 任务编号：T11
> 对应阶段 Spec：[phase-v1.5-spec.md](phase-v1.5-spec.md)
> 对应设计文档：[design-v1.5.md](../design-v1.5.md)
> 对应执行计划：[execution-plan-v1.5.md](../execution-plan-v1.5.md)
> 依赖任务：T10（runKnowledgeGraph 编排入口）
> 状态：已完成，已归档（冻结，不再修改）
> 评审记录：见本文档末尾（轮次 1 已通过）

---

## 1. 任务目标

实现 `graph` 子命令的 CLI 层集成，将 `runKnowledgeGraph` 编排入口暴露为 `shield graph` 命令。具体包括：

- 新增 `lib/cli/graph.ts`，实现 `runGraph` 薄层适配器函数（仅参数转换与委托，不包含业务编排逻辑）；
- 扩展 `cli.ts`，静态 import `runGraph`，新增 `graph` 子命令定义与选项校验；
- 选项校验遵循现有 `api` 子命令的端口校验模式（`Number()` 转换再校验）；
- `graph` 子命令与 `quality` 子命令完全独立，运行 `shield graph` 不触发 quality 流程。

对应阶段 Spec §3.10、设计文档 §9、执行计划 T11。

---

## 2. 对应需求与验收标准

| 需求编号 | 需求描述 | 本任务验收标准 |
|---|---|---|
| REQ-1.5-10 | 新增独立 graph 子命令，与 quality/report/api 并列 | `cli.ts` 中 `program.command('graph')` 与 shield / quality / report / api 子命令并列；`shield graph --project <path>` 命令可用 |
| REQ-1.5-14 | 默认输出到 `<project>/.legacy-shield/knowledge-graph/` 目录，可通过 --out 自定义 | `--out <path>` 选项可自定义输出目录；未传时默认输出到 `<project>/.legacy-shield/knowledge-graph/` |
| REQ-1.5-15 | graph 子命令与 quality 子命令完全独立，不自动集成 | `shield graph` 不触发 quality 流程；`lib/cli/graph.ts` 不 import `lib/cli/quality.js`；`cli.ts` 中 graph 子命令的 action 不调用 `runQuality` |

---

## 3. 实现步骤

### 3.1 新增 `lib/cli/graph.ts` 文件

**职责**：作为 CLI action handler 与编排入口（T10 `runKnowledgeGraph`）之间的**薄层适配器**，仅做参数转换与委托，不包含任何业务编排逻辑（编排职责归属 T10 的 `lib/knowledge-graph/index.ts`）。

**函数签名**：
```typescript
import type { GraphOptions, GraphResult } from '../types.js';
import { runKnowledgeGraph } from '../knowledge-graph/index.js';

export async function runGraph(options: GraphOptions): Promise<GraphResult> {
  return runKnowledgeGraph(options);
}
```

**设计说明**：
- `runGraph` **仅委托** `runKnowledgeGraph`，直接透传 `GraphOptions` 并返回 `GraphResult`。
- **不包含** scanner / graph / analyzer / monorepo / output 等编排逻辑。
- 作为薄层适配器存在，便于 CLI 层（`cli.ts` action handler）注入日志、错误格式化等横切关注点，而不污染编排入口。
- 若未来需要在 CLI 层添加横切逻辑（如结构化日志、耗时埋点），可在 `runGraph` 中扩展，不影响 `runKnowledgeGraph` 的纯编排职责。

### 3.2 扩展 `cli.ts`：静态 import

在 `cli.ts` 文件顶部，与现有子命令 import 并列，**静态 import** `runGraph`：

**锚点位置**：[cli.ts#L1-L7](file:///Users/creayma/personal/legacy-shield/cli.ts#L1-L7)，在 `import { runApi } from './lib/cli/api.js';` 之后、`import { today } from './lib/utils.js';` 之前插入。

**现有 import 区**（修改前）：
```typescript
#!/usr/bin/env node
import { Command } from 'commander';
import { runShield } from './lib/cli/shield.js';
import { runQuality } from './lib/cli/quality.js';
import { runReport } from './lib/cli/report.js';
import { runApi } from './lib/cli/api.js';
import { today } from './lib/utils.js';
```

**修改后**：
```typescript
#!/usr/bin/env node
import { Command } from 'commander';
import { runShield } from './lib/cli/shield.js';
import { runQuality } from './lib/cli/quality.js';
import { runReport } from './lib/cli/report.js';
import { runApi } from './lib/cli/api.js';
import { runGraph } from './lib/cli/graph.js';
import { today } from './lib/utils.js';
```

> **关键要求**：`runGraph` 为**静态 import**（文件顶部，非 action 内动态 import），与 `runShield` / `runQuality` / `runReport` / `runApi` 一致。不使用 `await import('./lib/cli/graph.js')` 动态 import。

### 3.3 扩展 `cli.ts`：新增 graph 子命令定义

**锚点位置**：在 `api` 子命令定义块（[cli.ts#L107-L123](file:///Users/creayma/personal/legacy-shield/cli.ts#L107-L123)）之后、`program.parseAsync(...)` 调用（[cli.ts#L125](file:///Users/creayma/personal/legacy-shield/cli.ts#L125)）之前插入。

**参照模式**：现有 `api` 子命令的端口校验模式（[cli.ts#L113-L117](file:///Users/creayma/personal/legacy-shield/cli.ts#L113-L117)）：
```typescript
// 现有 api 子命令的端口校验模式（参照基准）
const port = Number(opts.port);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  throw new Error(`非法端口: ${opts.port}，必须是 0-65535 之间的整数`);
}
```

**新增 graph 子命令**：
```typescript
program
  .command('graph')
  .description('生成项目知识图谱')
  .requiredOption('--project <path>', '目标项目根路径')
  .option('--out <path>', '输出目录', '')
  .option('--concurrency <n>', '并发扫描数', '8')
  .option('--fresh', '强制全量重建，忽略缓存')
  .option('--format <format>', '输出格式（json/md/both）', 'both')
  .option('--hub-threshold <n>', 'hub 文件入度阈值', '10')
  .action(async (opts) => {
    // 选项校验：commander 传入的数值参数为字符串，需先 Number() 转换再校验
    // 参照 api 子命令的端口校验模式
    const concurrency = Number(opts.concurrency);
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new Error(`非法并发数: ${opts.concurrency}，必须是 >= 1 的整数`);
    }
    if (!['json', 'md', 'both'].includes(opts.format)) {
      throw new Error(`非法输出格式: ${opts.format}，仅支持 json/md/both`);
    }
    const hubThreshold = Number(opts.hubThreshold);
    if (!Number.isInteger(hubThreshold) || hubThreshold < 0) {
      throw new Error(`非法 hub 阈值: ${opts.hubThreshold}，必须是 >= 0 的整数`);
    }
    const result = await runGraph({
      project: opts.project,
      out: opts.out || undefined,
      concurrency,
      fresh: opts.fresh ?? false,
      format: opts.format,
      hubThreshold,
    });
    console.log(`知识图谱生成完成：${result.nodeCount} 节点、${result.edgeCount} 边、${result.cycleCount} 循环依赖`);
    console.log(`输出路径：${result.outputPath}`);
    console.log(`耗时：${result.durationMs}ms`);
  });
```

### 3.4 选项校验逻辑详解

> **校验模式参照**：现有 `api` 子命令的端口校验（[cli.ts#L114-L117](file:///Users/creayma/personal/legacy-shield/cli.ts#L114-L117)）——先 `Number()` 转换，再 `Number.isInteger()` + 范围校验，不通过则 `throw new Error(...)`。

#### 3.4.1 concurrency 校验

- commander 传入的 `--concurrency <n>` 默认为字符串 `'8'`。
- `const concurrency = Number(opts.concurrency);` 转换为数值。
- 校验 `Number.isInteger(concurrency) && concurrency >= 1`：
  - `--concurrency 0` → `Number('0')` = 0，`0 < 1` → 抛错；
  - `--concurrency abc` → `Number('abc')` = NaN，`Number.isInteger(NaN)` = false → 抛错；
  - `--concurrency 1.5` → `Number('1.5')` = 1.5，`Number.isInteger(1.5)` = false → 抛错；
  - `--concurrency 8` → 通过。
- 错误信息：`非法并发数: ${opts.concurrency}，必须是 >= 1 的整数`。

#### 3.4.2 format 校验

- commander 传入的 `--format <format>` 默认为字符串 `'both'`。
- 校验 `['json', 'md', 'both'].includes(opts.format)`：
  - `--format xml` → 不在枚举中 → 抛错；
  - `--format json` / `--format md` / `--format both` → 通过。
- 错误信息：`非法输出格式: ${opts.format}，仅支持 json/md/both`。

#### 3.4.3 hubThreshold 校验

- commander 传入的 `--hub-threshold <n>` 默认为字符串 `'10'`。
- `const hubThreshold = Number(opts.hubThreshold);` 转换为数值。
- 校验 `Number.isInteger(hubThreshold) && hubThreshold >= 0`：
  - `--hub-threshold -1` → `Number('-1')` = -1，`-1 < 0` → 抛错；
  - `--hub-threshold abc` → `Number('abc')` = NaN → 抛错；
  - `--hub-threshold 10` → 通过。
- 错误信息：`非法 hub 阈值: ${opts.hubThreshold}，必须是 >= 0 的整数`。

### 3.5 参数转换与委托

action handler 内选项校验通过后，构造 `GraphOptions` 对象并调用 `runGraph`：

```typescript
const result = await runGraph({
  project: opts.project,           // requiredOption，必有值
  out: opts.out || undefined,      // 空字符串转 undefined，由 T10 resolveOutputPath 处理默认路径
  concurrency,                     // 已校验的数值
  fresh: opts.fresh ?? false,      // commander boolean 选项，未传时为 undefined → false
  format: opts.format,             // 已校验的字符串
  hubThreshold,                    // 已校验的数值
});
```

**参数转换要点**：
- `opts.out` 为空字符串时转为 `undefined`，使 T10 `resolveOutputPath` 能正确使用默认路径 `<project>/.legacy-shield/knowledge-graph/`。
- `opts.fresh` 为 commander boolean 选项，未传时为 `undefined`，使用 `?? false` 转为 `false`。
- `concurrency` 与 `hubThreshold` 已通过 `Number()` 转换与校验，直接传入。
- `format` 已通过枚举校验，直接传入。

### 3.6 结果输出

`runGraph` 返回 `GraphResult` 后，action handler 输出结果摘要：

```typescript
console.log(`知识图谱生成完成：${result.nodeCount} 节点、${result.edgeCount} 边、${result.cycleCount} 循环依赖`);
console.log(`输出路径：${result.outputPath}`);
console.log(`耗时：${result.durationMs}ms`);
```

### 3.7 与 quality 子命令的独立性

- `lib/cli/graph.ts` **不 import** `lib/cli/quality.js`。
- `cli.ts` 中 `graph` 子命令的 action **不调用** `runQuality`。
- `shield graph` 命令仅执行知识图谱生成流程，不触发 quality 的 ESLint / tsc / 单测检查。
- `shield quality` 命令不触发知识图谱生成。
- 两个子命令共享 `cli.ts` 的 commander 程序框架，但 action handler 完全独立。

---

## 4. 测试计划

### 4.1 单元测试

> 单元测试文件：`tests/knowledge-graph/integration.test.ts`（由 T12 实现，本任务仅定义测试用例清单）

**runGraph 适配器测试用例**：

| 用例编号 | 场景 | 输入 | 预期输出 |
|---|---|---|---|
| TC-11-1 | runGraph 委托 runKnowledgeGraph | `runGraph({ project: simple-project })` | 返回 `GraphResult`，与 `runKnowledgeGraph` 直接调用结果一致 |
| TC-11-2 | runGraph 不包含编排逻辑 | 检查 `lib/cli/graph.ts` 源码 | 函数体仅 `return runKnowledgeGraph(options)`，无 scanner / graph / analyzer 调用 |

**CLI 选项校验测试用例**：

| 用例编号 | 场景 | 命令 | 预期行为 |
|---|---|---|---|
| TC-11-3 | 合法参数 | `shield graph --project /path/to/project` | 正常执行，输出结果摘要 |
| TC-11-4 | 缺少 --project | `shield graph` | commander 报错（requiredOption） |
| TC-11-5 | 非法 concurrency（0） | `shield graph --project /path --concurrency 0` | 抛错：`非法并发数: 0，必须是 >= 1 的整数` |
| TC-11-6 | 非法 concurrency（非数字） | `shield graph --project /path --concurrency abc` | 抛错：`非法并发数: abc，必须是 >= 1 的整数` |
| TC-11-7 | 非法 format | `shield graph --project /path --format xml` | 抛错：`非法输出格式: xml，仅支持 json/md/both` |
| TC-11-8 | 非法 hub-threshold（负数） | `shield graph --project /path --hub-threshold -1` | 抛错：`非法 hub 阈值: -1，必须是 >= 0 的整数` |
| TC-11-9 | 合法 --out 自定义路径 | `shield graph --project /path --out /tmp/kg` | 输出到 `/tmp/kg` |
| TC-11-10 | --fresh 标志 | `shield graph --project /path --fresh` | 忽略缓存全量重建 |
| TC-11-11 | --format json | `shield graph --project /path --format json` | 仅输出 `knowledge-graph.json` |
| TC-11-12 | --format md | `shield graph --project /path --format md` | 仅输出 `architecture-summary.md` |

**独立性测试用例**：

| 用例编号 | 场景 | 预期行为 |
|---|---|---|
| TC-11-13 | shield graph 不触发 quality | `shield graph` 执行后，quality 相关日志 / 输出不存在 |
| TC-11-14 | shield quality 不触发 graph | `shield quality` 执行后，knowledge-graph 输出目录不存在 |
| TC-11-15 | 静态 import 验证 | `cli.ts` 源码顶部含 `import { runGraph } from './lib/cli/graph.js';`，非 action 内动态 import |

### 4.2 集成测试

> 集成测试文件：`tests/knowledge-graph/integration.test.ts`（由 T12 实现）

- **CLI 端到端**：通过 `child_process.execSync` 或直接调用 `runGraph` 验证 `shield graph --project <fixture>` 完整流程。
- **默认输出路径**：不传 `--out`，验证输出到 `<project>/.legacy-shield/knowledge-graph/`。
- **自定义输出路径**：传 `--out /tmp/kg-test`，验证输出到指定目录。

### 4.3 回归测试

- 本任务修改 `cli.ts`（新增 import 与子命令定义），需验证既有子命令不受影响：
  - `shield --project <path> --target <url>` 正常工作（v1.1）；
  - `quality --project <path>` 正常工作（v1.2）；
  - `report --project <path>` 正常工作（v1.3）；
  - `api --project <path>` 正常工作（v1.4）。
- T12 回归测试要求 `pnpm test` 全量通过，v1.1~v1.4 既有测试零回归。
- **关键回归点**：`cli.ts` 新增 import 不影响既有子命令的模块加载；新增 `graph` 子命令定义不影响 commander 的子命令路由。

---

## 5. 风险与依赖

| 风险 / 依赖 | 影响 | 应对措施 |
|---|---|---|
| 依赖 T10（runKnowledgeGraph） | 上游任务延迟将阻塞 T11 | T11 依赖 T10，仅做 CLI 参数转换与 commander 注册，工作量低（1-2 人时） |
| cli.ts 修改影响既有子命令 | 既有子命令（shield / quality / report / api）回归 | 仅新增 import 与子命令定义，不修改既有子命令代码；T12 回归测试覆盖全部既有子命令 |
| commander 数值参数为字符串 | 校验逻辑失效 | 所有数值参数先 `Number()` 转换再 `Number.isInteger()` 校验，参照 api 子命令端口校验模式 |
| runGraph 包含编排逻辑 | 职责边界模糊，难以测试 | `runGraph` 仅 `return runKnowledgeGraph(options)`，不包含任何编排逻辑；编排职责归属 T10 |
| 动态 import 导致模块加载延迟 | CLI 启动变慢 | 使用静态 import（文件顶部），与其他子命令一致，不使用动态 import |

---

## 6. 变更范围

- **本任务范围内**：
  - 新增 `lib/cli/graph.ts`：`runGraph` 薄层适配器函数。
  - 扩展 `cli.ts`：新增 `import { runGraph } from './lib/cli/graph.js';` 静态 import；新增 `program.command('graph')` 子命令定义与选项校验。
- **不在本任务范围内**：
  - `lib/knowledge-graph/index.ts` 编排入口（由 T10 负责）；
  - `lib/types.ts` 类型定义（由 T1 负责）；
  - `lib/knowledge-graph/` 下所有模块文件（由 T2-T9 负责）；
  - 测试夹具与测试用例实现（由 T12 负责，本任务仅定义测试用例清单）；
  - `README.md` / `docs/api.md` 文档更新（由 T13 负责）；
  - **不修改既有子命令定义**（shield / quality / report / api 的代码保持不变）；
  - **不修改 `lib/cli/shield.ts` / `lib/cli/quality.ts` / `lib/cli/report.ts` / `lib/cli/api.ts`**。

---

## 7. 评审记录

| 轮次 | 日期 | 结论 | P0/P1 问题 | 修复方案 |
|---|---|---|---|---|
| 1 | 2026-06-23 | 通过 | 无 | — |
