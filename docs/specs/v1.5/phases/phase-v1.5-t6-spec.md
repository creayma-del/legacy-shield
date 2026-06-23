# T6：图谱分析器（hub/孤立/分层推断 + isEntry 计算）

> 版本：v1.5
> 任务编号：T6
> 对应阶段 Spec：[phase-v1.5-spec.md](phase-v1.5-spec.md)
> 对应设计文档：[design-v1.5.md](../design-v1.5.md)
> 对应执行计划：[execution-plan-v1.5.md](../execution-plan-v1.5.md)
> 依赖任务：T5（lib/knowledge-graph/graph.ts buildGraph 产出的 KnowledgeGraph 结构 + computeComponents 函数）
> 状态：已完成，已归档（冻结，不再修改）
> 评审记录：见本文档末尾（轮次 1 已通过）

---

## 1. 任务目标

在 T5（图构建器）产出的 `KnowledgeGraph` 基础上，完成图谱的分析与指标填充。具体包括：

- **isEntry 统一计算**：图构建完成后，遍历所有节点根据 `inDegree === 0 && outDegree > 0` 统一计算 `isEntry`，避免在边插入过程中因部分边未建立导致误判；
- **role 分类**：根据入度/出度与 hub 阈值，将每个 `GraphNode.role` 赋值为 `entry` / `core` / `leaf` / `isolated` / `unknown`；
- **GraphStats 完整填充**：填充 `hubCount` / `isolatedCount` / `entryCount` / `maxInDegree` / `maxOutDegree` / `unresolvedEdgeCount`（`nodeCount` / `edgeCount` / `cycleCount` / `componentCount` 已由 T5 填充）；
- **分层结构推断**：`inferLayers` 将节点划分为入口层 / 核心层 / 中间层 / 叶子层 / 孤立 5 层。

对应设计文档 §5.3（Hub / 孤立文件识别）、§5.4（分层结构推断），阶段 Spec §3.6 与交付物 D7。

---

## 2. 对应需求与验收标准

| 需求编号 | 需求描述 | 本任务验收标准 |
|---|---|---|
| REQ-1.5-6 | 识别 hub 文件（高入度节点）与孤立文件（零入度零出度） | `analyzeGraph` 后，`inDegree >= hubThreshold` 的节点 `role === 'core'`；`inDegree === 0 && outDegree === 0` 的节点 `role === 'isolated'`；`stats.hubCount` 与 `stats.isolatedCount` 与节点实际状态一致 |
| REQ-1.5-7 | 推断项目分层结构（入口文件、核心模块、叶子模块） | `inferLayers` 返回 5 个数组（entry / core / middle / leaf / isolated），节点总数等于图中节点数；入口层为 `inDegree === 0 && outDegree > 0`，核心层为 `inDegree >= hubThreshold`，叶子层为 `outDegree === 0 && inDegree > 0`，孤立为 `inDegree === 0 && outDegree === 0`，中间层为其余 |
| REQ-1.5-8 | 输出 JSON 格式知识图谱（邻接表 + 反向索引 + 节点元数据 + 图统计指标） | `analyzeGraph` 后 `GraphStats` 所有 10 个字段被完整填充（nodeCount / edgeCount / cycleCount / componentCount / hubCount / isolatedCount / entryCount / unresolvedEdgeCount / maxInDegree / maxOutDegree）；`GraphNode.role` 与 `isEntry` 字段被正确赋值 |

---

## 3. 实现步骤

### 3.1 新增 `lib/knowledge-graph/analyzer.ts`

> 本文件为图谱分析模块，不引入任何新的运行时依赖，仅依赖 T5 产出的 `KnowledgeGraph` 类型与结构。
>
> 文件顶部 import：
>
> ```typescript
> import type {
>   KnowledgeGraph,
>   GraphNode,
>   GraphStats,
>   NodeRole,
> } from './types.js';
> ```
>
> **P1 修复说明**：原 import `computeComponents` 未在 `analyzeGraph` / `inferLayers` 实现中使用，将导致 `pnpm typecheck` 失败（项目启用 `noUnusedLocals`）。T5 的 `buildGraph` 已在内部调用 `computeComponents` 填充 `GraphStats.componentCount`，T6 只需消费 `graph.stats.componentCount`，无需再次调用或导入 `computeComponents`。

### 3.2 实现 `analyzeGraph` 函数

**函数签名**：

```typescript
export function analyzeGraph(
  graph: KnowledgeGraph,
  hubThreshold: number,
): KnowledgeGraph
```

> **说明**：`analyzeGraph` 直接修改传入的 `graph` 对象（修改 `GraphNode.role` / `GraphNode.isEntry` 与 `graph.stats`），并返回该对象。这是为了保持 `KnowledgeGraph` 的单一实例引用，避免深拷贝大 Map 的开销。调用方应在 `buildGraph` 之后调用 `analyzeGraph`，传入同一实例。

**实现步骤**：

1. **统一计算 isEntry**（设计文档 §5.3 明确要求"图构建完成后统一计算"）：

   ```typescript
   for (const node of graph.nodes.values()) {
     node.isEntry = node.inDegree === 0 && node.outDegree > 0;
   }
   ```

   > **关键设计**：`isEntry` 不在 T5 的 `buildGraph` 边插入过程中计算，而是在图构建完成后统一计算。这样可避免在边插入过程中因部分边未建立而出现误判（如某文件在边插入中途暂时表现为 inDegree === 0）。

2. **计算 role 分类**（按优先级顺序判断）：

   ```typescript
   for (const node of graph.nodes.values()) {
     node.role = inferRole(node, hubThreshold);
   }
   ```

   `inferRole` 辅助函数实现：

   ```typescript
   function inferRole(node: GraphNode, hubThreshold: number): NodeRole {
     // 优先级 1：入口文件（入度=0 且出度>0）
     if (node.inDegree === 0 && node.outDegree > 0) {
       return 'entry';
     }
     // 优先级 2：孤立文件（入度=0 且出度=0）
     if (node.inDegree === 0 && node.outDegree === 0) {
       return 'isolated';
     }
     // 优先级 3：核心文件 / hub 文件（入度 >= hubThreshold）
     if (node.inDegree >= hubThreshold) {
       return 'core';
     }
     // 优先级 4：叶子文件（出度=0 且入度>0）
     if (node.outDegree === 0 && node.inDegree > 0) {
       return 'leaf';
     }
     // 优先级 5：其余
     return 'unknown';
   }
   ```

   > **优先级说明**：
   > - `entry` 与 `isolated` 都是 `inDegree === 0`，通过 `outDegree` 区分（`> 0` 为 entry，`=== 0` 为 isolated）。
   > - `core` 要求 `inDegree >= hubThreshold`，由于 `entry` / `isolated` 已拦截 `inDegree === 0` 的情况，`core` 仅在 `inDegree > 0` 且 `>= hubThreshold` 时命中（当 `hubThreshold > 0` 时）。
   > - `leaf` 要求 `outDegree === 0 && inDegree > 0`，在 `core` 之后判断，因此若某节点同时满足 `inDegree >= hubThreshold` 与 `outDegree === 0`，其 role 为 `core`（hub 文件优先于叶子文件）。
   > - `unknown` 为兜底分类，覆盖 `inDegree > 0 && inDegree < hubThreshold && outDegree > 0` 的中间层文件。

3. **填充 GraphStats 完整字段**：

   ```typescript
   let hubCount = 0;
   let isolatedCount = 0;
   let entryCount = 0;
   let maxInDegree = 0;
   let maxOutDegree = 0;

   for (const node of graph.nodes.values()) {
     if (node.inDegree >= hubThreshold) hubCount++;
     if (node.inDegree === 0 && node.outDegree === 0) isolatedCount++;
     if (node.isEntry) entryCount++;
     if (node.inDegree > maxInDegree) maxInDegree = node.inDegree;
     if (node.outDegree > maxOutDegree) maxOutDegree = node.outDegree;
   }

   graph.stats.hubCount = hubCount;
   graph.stats.isolatedCount = isolatedCount;
   graph.stats.entryCount = entryCount;
   graph.stats.maxInDegree = maxInDegree;
   graph.stats.maxOutDegree = maxOutDegree;
   graph.stats.unresolvedEdgeCount = graph.edges.filter((e) => e.unresolved).length;
   ```

   > **说明**：
   > - `hubCount` 统计 `inDegree >= hubThreshold` 的节点数（与 `role === 'core'` 的节点数可能不完全一致，因为 `core` 优先级低于 `entry` / `isolated`；但当 `hubThreshold > 0` 时，`inDegree >= hubThreshold` 蕴含 `inDegree > 0`，不会命中 `entry` / `isolated`，因此 `hubCount === core` 节点数）。
   > - `unresolvedEdgeCount` 在 T5 的 `buildGraph` 中已初始化，此处重新计算以确保与最终 edges 列表一致（防御性编程）。
   > - `nodeCount` / `edgeCount` / `cycleCount` / `componentCount` 已由 T5 填充，此处不覆盖。

4. **返回 graph**：

   ```typescript
   return graph;
   ```

### 3.3 实现 `inferLayers` 函数

**函数签名**：

```typescript
export function inferLayers(
  graph: KnowledgeGraph,
  hubThreshold: number,
): {
  entry: string[];
  core: string[];
  middle: string[];
  leaf: string[];
  isolated: string[];
}
```

**实现**：

> **P2 修复说明（5 层与 4 层差异）**：`inferLayers` 实现 5 层分类（entry / core / middle / leaf / isolated），与设计文档 §5.4 的文字描述（4 层：入口层 / 核心层 / 叶子层 / 中间层，无孤立层）存在差异，但与阶段 Spec §3.6、执行计划 T6、设计文档 §7.2 样例一致。孤立文件单独分类更合理，§5.4 文字描述遗漏孤立层，后续通过 PATCH 流程修订设计文档 §5.4 补充孤立层。

```typescript
export function inferLayers(
  graph: KnowledgeGraph,
  hubThreshold: number,
): {
  entry: string[];
  core: string[];
  middle: string[];
  leaf: string[];
  isolated: string[];
} {
  const entry: string[] = [];
  const core: string[] = [];
  const middle: string[] = [];
  const leaf: string[] = [];
  const isolated: string[] = [];

  for (const node of graph.nodes.values()) {
    // 入口层：入度=0 且出度>0
    if (node.inDegree === 0 && node.outDegree > 0) {
      entry.push(node.id);
      continue;
    }
    // 孤立：入度=0 且出度=0
    if (node.inDegree === 0 && node.outDegree === 0) {
      isolated.push(node.id);
      continue;
    }
    // 核心层：入度 >= hubThreshold（hub 文件）
    if (node.inDegree >= hubThreshold) {
      core.push(node.id);
      continue;
    }
    // 叶子层：出度=0 且入度>0
    if (node.outDegree === 0 && node.inDegree > 0) {
      leaf.push(node.id);
      continue;
    }
    // 中间层：其余文件
    middle.push(node.id);
  }

  return { entry, core, middle, leaf, isolated };
}
```

> **分层与 role 的对应关系**：
> - `entry` 层 ↔ `role === 'entry'`
> - `core` 层 ↔ `role === 'core'`
> - `leaf` 层 ↔ `role === 'leaf'`
> - `isolated` 层 ↔ `role === 'isolated'`
> - `middle` 层 ↔ `role === 'unknown'`
>
> `inferLayers` 的分类逻辑与 `inferRole` 完全一致，仅输出形式不同（`inferRole` 返回单个 role 字符串，`inferLayers` 返回 5 个节点 id 数组）。`inferLayers` 可在 `analyzeGraph` 之前或之后调用，因为它直接基于 `inDegree` / `outDegree` 判断，不依赖 `role` 字段。

### 3.4 hubThreshold 参数传递

> `hubThreshold` 由 `GraphOptions.hubThreshold` 传入（T1 定义，默认 10）。`analyzeGraph` 与 `inferLayers` 均接收该参数。调用链：
>
> ```
> CLI --hub-threshold → GraphOptions.hubThreshold → runKnowledgeGraph → analyzeGraph(graph, hubThreshold) / inferLayers(graph, hubThreshold)
> ```
>
> T10 编排入口负责从 `GraphOptions` 中提取 `hubThreshold`（默认 10）并传入本任务的函数。

### 3.5 导出清单

`lib/knowledge-graph/analyzer.ts` 导出以下符号：

- `analyzeGraph`（函数）
- `inferLayers`（函数）
- `inferRole`（辅助函数，不导出，模块内部使用）

---

## 4. 测试计划

### 4.1 单元测试

> 单元测试文件：`tests/knowledge-graph/analyzer.test.ts`（由 T12 创建，本任务需确保函数可独立测试）。

**`analyzeGraph` 测试用例**：

- **TC-A1 isEntry 统一计算**：构建一个含 3 节点的图（`a` 入度=0 出度=2，`b` 入度=1 出度=1，`c` 入度=1 出度=0），`analyzeGraph` 后 `a.isEntry === true`、`b.isEntry === false`、`c.isEntry === false`。
- **TC-A2 isEntry 初始值为 false**：构建一个含 2 节点的图（`a` 入度=0 出度=1，`b` 入度=1 出度=0），在调用 `analyzeGraph` 之前断言 `a.isEntry === false`、`b.isEntry === false`（`buildGraph` 不计算 `isEntry`），调用 `analyzeGraph` 后断言 `a.isEntry === true`、`b.isEntry === false`。
- **TC-A3 role 分类 - entry**：`inDegree === 0 && outDegree > 0` 的节点 `role === 'entry'`。
- **TC-A4 role 分类 - isolated**：`inDegree === 0 && outDegree === 0` 的节点 `role === 'isolated'`。
- **TC-A5 role 分类 - core**：`inDegree >= hubThreshold`（如 hubThreshold=10，inDegree=12）的节点 `role === 'core'`。
- **TC-A6 role 分类 - leaf**：`outDegree === 0 && inDegree > 0`（且 `inDegree < hubThreshold`）的节点 `role === 'leaf'`。
- **TC-A7 role 分类 - unknown**：`inDegree > 0 && inDegree < hubThreshold && outDegree > 0` 的节点 `role === 'unknown'`。
- **TC-A8 hub 阈值边界**：`hubThreshold=10`，`inDegree=10` 的节点 `role === 'core'`（`>=` 包含等于）；`inDegree=9` 的节点 `role !== 'core'`。
- **TC-A9 hub 阈值默认值**：`hubThreshold` 未传时默认为 10（由 T10 编排入口保证，本任务函数签名要求显式传入）。
- **TC-A10 hub 阈值为 0**：构建含 4 节点的图（`a` 入度=0 出度=1，`b` 入度=0 出度=0，`c` 入度=2 出度=1，`d` 入度=1 出度=0），传入 `hubThreshold=0`，断言 `a.role === 'entry'`、`b.role === 'isolated'`、`c.role === 'core'`（`inDegree=2 >= 0` 且 `inDegree > 0`）、`d.role === 'core'`（`inDegree=1 >= 0` 且 `inDegree > 0`）；`stats.hubCount === 2`（`c` 和 `d`）。
- **TC-A11 GraphStats 完整填充**：`analyzeGraph` 后 `stats` 的 10 个字段全部非 undefined；`hubCount` + `isolatedCount` + `entryCount` 与节点实际状态一致。
- **TC-A12 maxInDegree / maxOutDegree**：构建含 `inDegree=5` 与 `outDegree=3` 最大值的图，`stats.maxInDegree === 5`、`stats.maxOutDegree === 3`。
- **TC-A13 unresolvedEdgeCount**：构建含 2 条未解析边的图，`stats.unresolvedEdgeCount === 2`。
- **TC-A14 空图**：`nodes` 为空 Map 时，`analyzeGraph` 不抛异常，`stats` 所有计数字段为 0。

**`inferLayers` 测试用例**：

- **TC-L1 五层分类**：构建含 5 类节点的图（entry / core / middle / leaf / isolated 各 1 个），`inferLayers` 返回 5 个数组，各含 1 个节点 id。
- **TC-L2 节点总数一致**：`entry.length + core.length + middle.length + leaf.length + isolated.length === graph.nodes.size`。
- **TC-L3 入口层**：`inDegree === 0 && outDegree > 0` 的节点在 `entry` 数组中。
- **TC-L4 核心层**：`inDegree >= hubThreshold` 的节点在 `core` 数组中。
- **TC-L5 叶子层**：`outDegree === 0 && inDegree > 0` 的节点在 `leaf` 数组中。
- **TC-L6 孤立层**：`inDegree === 0 && outDegree === 0` 的节点在 `isolated` 数组中。
- **TC-L7 中间层**：不满足上述 4 类的节点在 `middle` 数组中。
- **TC-L8 hub 阈值边界**：`hubThreshold=10`，`inDegree=10` 的节点在 `core` 数组中；`inDegree=9` 的节点不在 `core` 数组中。
- **TC-L9 空图**：`nodes` 为空 Map 时，`inferLayers` 返回 5 个空数组，不抛异常。

### 4.2 集成测试 / 端到端测试

> 由 T12 在 `tests/knowledge-graph/integration.test.ts` 中覆盖，本任务不涉及。

- **simple-project 夹具端到端**：`analyzeGraph` 后 `main.ts` 的 `role === 'entry'`、`isEntry === true`；`utils/request.ts` 在 `hubThreshold` 设为夹具实际依赖数以下时 `role === 'core'`，否则 `role === 'unknown'`（夹具规模较小，需通过调低 `hubThreshold` 或增加依赖文件数来覆盖 core 场景）。
- **cycle-project 夹具端到端**：循环中的节点 role 分类正确。

### 4.3 回归测试

- 本任务为新增模块 `lib/knowledge-graph/analyzer.ts`，不修改任何既有文件，对 v1.1 ~ v1.4 无回归影响。
- T12 回归测试要求 `pnpm test` 全量通过，本任务需确保新增模块不引入编译/类型错误。

---

## 5. 风险与依赖

| 风险 / 依赖 | 影响 | 应对措施 |
|---|---|---|
| `isEntry` 在 `buildGraph` 边插入过程中被误计算 | 入口文件识别错误 | 设计文档 §5.3 明确要求"图构建完成后统一计算"；TC-A2 代码审查确认 `buildGraph` 中 `isEntry` 初始为 `false` |
| `role` 分类优先级与 `inferLayers` 分层逻辑不一致 | role 与 layers 矛盾 | `inferRole` 与 `inferLayers` 使用完全相同的判断顺序（entry → isolated → core → leaf → unknown/middle）；TC-L1 ~ TC-L7 覆盖一致性 |
| `hubThreshold=0` 时 core 分类泛滥 | 所有 `inDegree > 0` 的节点均为 core | 优先级保证 `entry` / `isolated` 先判断；TC-A10 显式覆盖 `hubThreshold=0` 场景 |
| `hubCount` 与 `core` 节点数不一致 | stats 统计错误 | 当 `hubThreshold > 0` 时，`inDegree >= hubThreshold` 蕴含 `inDegree > 0`，不会命中 `entry` / `isolated`，因此 `hubCount === core` 节点数；TC-A11 覆盖 |
| `analyzeGraph` 修改传入的 graph 对象（非纯函数） | 调用方可能因副作用产生意外行为 | 文档明确说明 `analyzeGraph` 直接修改并返回传入对象；调用方应在 `buildGraph` 之后调用，传入同一实例 |
| `inferLayers` 在 `analyzeGraph` 之前调用 | layers 分类基于 `inDegree` / `outDegree`，不依赖 `role` 字段 | `inferLayers` 的判断逻辑独立于 `role`，可在 `analyzeGraph` 之前或之后调用；但建议在 `analyzeGraph` 之后调用以保持一致性 |

---

## 6. 变更范围

- **本任务范围内**：
  - 新增 `lib/knowledge-graph/analyzer.ts`，实现 `analyzeGraph` / `inferLayers` / `inferRole`。
- **不在本任务范围内**：
  - `lib/knowledge-graph/types.ts` 类型定义（由 T1 负责）；
  - `lib/knowledge-graph/graph.ts` 图构建与算法（由 T5 负责，本任务仅消费 `KnowledgeGraph` 结构与 `computeComponents` 函数）；
  - `GraphOptions.hubThreshold` 的 CLI 参数解析与默认值传递（由 T10 编排入口负责）；
  - `KnowledgeGraph.isMonorepo` / `packages` 填充（由 T9 monorepo 模块负责）；
  - 测试夹具与测试用例（由 T12 负责）；
  - **不修改任何既有文件**（本任务仅消费 T1 / T5 产出的类型与结构）。

---

## 7. 评审记录

| 轮次 | 日期 | 结论 | P0/P1 问题 | 修复方案 |
|---|---|---|---|---|
| 1 | 2026-06-23 | 修改后通过 | P1：`computeComponents` 导入未使用（`noUnusedLocals` 报错）；P2：5 层与 4 层差异未说明、TC-A2 为代码审查项非可执行用例、§4.2 集成测试 role 描述矛盾、TC-A10 缺少显式断言 | P1：移除 `computeComponents` 导入并补充说明 T5 已填充 `componentCount`；P2：补充 5 层差异说明及 PATCH 计划、TC-A2 改为可执行测试用例（断言 `isEntry` 初始值与计算后值）、§4.2 改为条件描述（调低 `hubThreshold` 或增加依赖数覆盖 core）、TC-A10 补充 4 节点具体数据与断言 |
