# T5：图构建器（邻接表 + 反向索引 + 循环检测 + 连通分量）

> 版本：v1.5
> 任务编号：T5
> 对应阶段 Spec：[phase-v1.5-spec.md](phase-v1.5-spec.md)
> 对应设计文档：[design-v1.5.md](../design-v1.5.md)
> 对应执行计划：[execution-plan-v1.5.md](../execution-plan-v1.5.md)
> 依赖任务：T1（lib/knowledge-graph/types.ts 类型定义）、T3（lib/knowledge-graph/collector.ts CollectedFile / CollectedDependency 类型与 collectDependencies 输出）
> 状态：评审中（待评审）
> 评审记录：见本文档末尾（轮次 1 待评审）

---

## 1. 任务目标

在 T1（图谱 schema 类型定义）与 T3（依赖关系收集 visitor）产出的基础上，实现知识图谱的核心数据结构构建与图算法。具体包括：

- 基于 `Map<string, CollectedFile>` 构建 `KnowledgeGraph` 的节点表、正向邻接表、反向邻接表、边列表；
- **反向邻接表同步填充**：遍历每条边 (from, to) 时，在 `adjacency[from]` 添加 to 的**同时**在 `reverseAdjacency[to]` 添加 from，避免二次遍历；
- 实现 **DFS 三色标记法**（WHITE/GRAY/BLACK）循环依赖检测，含循环节点集合去重逻辑；
- 实现 **并查集（Union-Find）弱连通分量**计算，`find` 带路径压缩，所有边视为无向；
- 初始化 `cycles: string[][]` 与 `stats: GraphStats` 骨架（stats 完整字段由 T6 填充）。

对应设计文档 §5.1（邻接表数据结构）、§5.2（循环依赖检测算法）、§5.5（连通分量计算），阶段 Spec §3.5 与交付物 D6。

---

## 2. 对应需求与验收标准

| 需求编号 | 需求描述 | 本任务验收标准 |
|---|---|---|
| REQ-1.5-1 | 扫描目标项目 src 下的 JS/JSX/TS/TSX/Vue 文件，构建文件级依赖图 | `buildGraph` 基于 T3 的 `Map<string, CollectedFile>` 构建完整 `KnowledgeGraph`，含 nodes / adjacency / reverseAdjacency / edges 字段 |
| REQ-1.5-2 | 解析 import / export / require 语句，收集文件间依赖关系 | `buildGraph` 将每个 `CollectedFile.dependencies` 转换为 `GraphEdge`，保留 kind / symbols / unresolved / rawSpec 字段；未解析边（unresolved=true）仍纳入 edges 列表 |
| REQ-1.5-5 | 检测循环依赖并输出循环链 | `detectCycles` 基于 DFS 三色标记法检测回边，输出 `string[][]` 循环链列表；对同一循环的不同入口去重为 1 条；无环图返回空数组 |
| REQ-1.5-8 | 输出 JSON 格式知识图谱（邻接表 + 反向索引 + 节点元数据 + 图统计指标） | `buildGraph` 同步构建正向邻接表与反向邻接表，对任意边 (from, to)，`reverseAdjacency[to]` 包含 from；`computeComponents` 计算弱连通分量数，填充 `stats.componentCount` |

---

## 3. 实现步骤

### 3.1 新增 `lib/knowledge-graph/graph.ts`

> 本文件为图构建与图算法的核心模块，不引入任何新的运行时依赖，仅依赖 T1 产出的 `lib/knowledge-graph/types.ts` 类型定义与 T3 产出的 `lib/knowledge-graph/collector.ts` 中的 `CollectedFile` / `CollectedDependency` 类型。
>
> 文件顶部 import：
>
> ```typescript
> import type { FileKind } from './types.js';
> import type { CollectedFile } from './collector.js';
> import type {
>   KnowledgeGraph,
>   GraphNode,
>   GraphEdge,
>   GraphStats,
> } from './types.js';
> import { basename, extname, relative, sep } from 'node:path';
> ```

### 3.2 实现 `buildGraph` 函数

**函数签名**：

```typescript
export function buildGraph(
  projectRoot: string,
  collected: Map<string, CollectedFile>,
  resolver: { resolve: (spec: string, importer: string) => string | null },
): KnowledgeGraph
```

> **说明**：`resolver` 参数以接口形式声明（鸭子类型），不直接引用 T2 的 `ModuleResolver` 类类型，避免 T5 对 T2 产生硬依赖。T3 的 `collectDependencies` 已在收集阶段调用 `resolver.resolve` 完成 spec → 文件路径解析，`buildGraph` 阶段不再重复解析路径，仅消费 `CollectedFile.dependencies` 中已解析的结果。
>
> 但 `CollectedDependency` 中的 `spec` 字段为原始 import 路径，`buildGraph` 需要将其解析为目标文件 id 才能建立边。因此 `buildGraph` 内部仍需调用 `resolver.resolve` 将 `dep.spec` 解析为文件 id。若 T3 已在 `collectDependencies` 内完成解析并将结果存入 `CollectedDependency`，则 `buildGraph` 直接消费；若 T3 仅保留原始 spec，则 `buildGraph` 负责解析。**以 T3 实际产出为准**：T3 的 `collectDependencies` 返回的 `CollectedDependency` 含 `unresolved: boolean` 字段但不含 resolved 路径字段，因此 `buildGraph` 需对 `unresolved === false` 的依赖调用 `resolver.resolve(dep.spec, filePath)` 获取目标文件 id。

**实现步骤**：

1. **初始化数据结构**：

   ```typescript
   const nodes = new Map<string, GraphNode>();
   const adjacency = new Map<string, string[]>();
   const reverseAdjacency = new Map<string, string[]>();
   const edges: GraphEdge[] = [];
   ```

2. **构建节点表**：遍历 `collected` 的每个文件路径 `filePath`（作为节点 id），创建 `GraphNode`：

   ```typescript
   for (const filePath of collected.keys()) {
     const id = filePath;
     const relativePath = relative(projectRoot, filePath).split(sep).join('/');
     const kind = inferFileKind(filePath);
     nodes.set(id, {
       id,
       relativePath,
       kind,
       role: 'unknown',          // 由 T6 analyzeGraph 填充
       inDegree: 0,              // 由反向邻接表长度推导，构建完成后填充
       outDegree: 0,             // 由邻接表长度推导，构建完成后填充
       exports: collected.get(filePath)!.exports,
       isEntry: false,           // 由 T6 analyzeGraph 统一计算
       packageName: null,        // 单包场景为 null，monorepo 由 T9 填充
     });
     adjacency.set(id, []);
     reverseAdjacency.set(id, []);
   }
   ```

3. **构建边列表 + 邻接表 + 反向邻接表（同步填充）**：遍历每个 `CollectedFile` 的 `dependencies`，对每条依赖转换为 `GraphEdge` 并同步更新两个邻接表：

   ```typescript
   for (const [filePath, file] of collected.entries()) {
     for (const dep of file.dependencies) {
       let targetId: string | null = null;
       if (!dep.unresolved && dep.spec !== '<dynamic>') {
         targetId = resolver.resolve(dep.spec, filePath);
       }
       const edge: GraphEdge = {
         from: filePath,
         to: targetId ?? dep.spec,   // 未解析边保留原始 spec 作为 to
         kind: dep.kind,
         symbols: dep.symbols,
         unresolved: dep.unresolved || targetId === null,
         rawSpec: dep.spec,
       };
       edges.push(edge);

       // 同步填充正向邻接表（仅当目标节点存在于图中时）
       if (targetId && nodes.has(targetId)) {
         adjacency.get(filePath)!.push(targetId);
         // 同步填充反向邻接表
         reverseAdjacency.get(targetId)!.push(filePath);
       }
       // 未解析边或目标节点不在图中（如 node_modules 纯包名）不计入邻接表
     }
   }
   ```

   > **关键设计**：反向邻接表与正向邻接表在遍历边时**同步填充**，避免二次遍历边集。这是设计文档 §5.1 的明确要求。

4. **填充 inDegree / outDegree**：遍历节点表，从邻接表长度推导：

   ```typescript
   for (const [id, node] of nodes) {
     node.outDegree = adjacency.get(id)!.length;
     node.inDegree = reverseAdjacency.get(id)!.length;
   }
   ```

5. **循环检测**：调用 `detectCycles(adjacency)` 填充 `cycles`：

   ```typescript
   const cycles = detectCycles(adjacency);
   ```

6. **连通分量计算**：调用 `computeComponents` 填充 `stats.componentCount`：

   ```typescript
   const { componentCount } = computeComponents(
     Array.from(nodes.keys()),
     edges.filter((e) => !e.unresolved),  // 仅对已解析边计算连通分量
   );
   ```

7. **初始化 stats 骨架**（部分字段由 T6 填充）：

   ```typescript
   const stats: GraphStats = {
     nodeCount: nodes.size,
     edgeCount: edges.length,
     cycleCount: cycles.length,
     componentCount,
     hubCount: 0,              // 由 T6 填充
     isolatedCount: 0,         // 由 T6 填充
     entryCount: 0,            // 由 T6 填充
     unresolvedEdgeCount: edges.filter((e) => e.unresolved).length,
     maxInDegree: 0,           // 由 T6 填充
     maxOutDegree: 0,          // 由 T6 填充
   };
   ```

8. **返回 KnowledgeGraph**：

   ```typescript
   return {
     projectRoot,
     isMonorepo: false,        // 由 T9 填充
     packages: [],             // 由 T9 填充
     nodes,
     adjacency,
     reverseAdjacency,
     edges,
     cycles,
     stats,
   };
   ```

### 3.3 实现 `inferFileKind` 辅助函数

```typescript
function inferFileKind(filePath: string): FileKind {
  const ext = extname(filePath).toLowerCase();
  switch (ext) {
    case '.js':
      return 'js';
    case '.jsx':
      return 'jsx';
    case '.ts':
      return 'ts';
    case '.tsx':
      return 'tsx';
    case '.vue':
      return 'vue';
    default:
      return 'unknown';
  }
}
```

### 3.4 实现 `detectCycles` 函数（DFS 三色标记法）

**函数签名**：

```typescript
export function detectCycles(adjacency: Map<string, string[]>): string[][]
```

**实现**（严格遵循设计文档 §5.2）：

1. **三色常量定义**：

   ```typescript
   const WHITE = 0;  // 未访问
   const GRAY = 1;   // 访问中（在当前 DFS 栈中）
   const BLACK = 2;  // 已完成
   ```

2. **状态与结果容器**：

   ```typescript
   const color = new Map<string, number>();
   const cycles: string[][] = [];
   const stack: string[] = [];
   // 初始化所有节点为 WHITE
   for (const node of adjacency.keys()) {
     color.set(node, WHITE);
   }
   ```

3. **DFS 递归函数**：

   ```typescript
   function dfs(node: string): void {
     color.set(node, GRAY);
     stack.push(node);
     const neighbors = adjacency.get(node) ?? [];
     for (const neighbor of neighbors) {
       const neighborColor = color.get(neighbor) ?? WHITE;
       if (neighborColor === GRAY) {
         // 发现回边：从 stack 中找到循环起点
         const cycleStart = stack.indexOf(neighbor);
         const cycle = stack.slice(cycleStart).concat(neighbor);
         cycles.push(cycle);
       } else if (neighborColor === WHITE) {
         dfs(neighbor);
       }
       // neighborColor === BLACK 时跳过（已完成节点不再访问）
     }
     stack.pop();
     color.set(node, BLACK);
   }
   ```

   > **关键点**：发现 GRAY 邻居时，从 `stack` 中找到该邻居首次出现的位置 `cycleStart`，截取 `stack.slice(cycleStart)` 得到循环链，并 `concat(neighbor)` 拼接起点节点形成闭合链（如 `['a', 'b', 'a']`）。

4. **遍历所有节点启动 DFS**（处理非连通图）：

   ```typescript
   for (const node of adjacency.keys()) {
     if ((color.get(node) ?? WHITE) === WHITE) {
       dfs(node);
     }
   }
   ```

5. **去重**：对检测到的循环做规范化去重，将每个循环节点集合排序后作为 key，相同 key 仅保留一条：

   ```typescript
   const seen = new Set<string>();
   const deduped: string[][] = [];
   for (const cycle of cycles) {
     // 去掉末尾重复的起点节点后再排序作为 key
     const key = [...new Set(cycle)].sort().join('|');
     if (!seen.has(key)) {
       seen.add(key);
       deduped.push(cycle);
     }
   }
   return deduped;
   ```

   > **去重说明**：同一循环可能从不同节点启动 DFS 被多次检测到（如 `a → b → a` 与 `b → a → b`），通过 `[...new Set(cycle)].sort().join('|')` 作为 key 去重，确保同一循环节点集合仅保留一条。

6. **递归深度保护**（可选，针对超大规模图）：由于目标项目规模可达 5000 文件，DFS 递归深度可能触发栈溢出。**v1.5 采用递归实现**，若 T12 测试阶段发现栈溢出问题，再升级为迭代实现（使用显式栈）。设计文档 §5.2 的样例为递归实现，本任务与之对齐。

### 3.5 实现 `computeComponents` 函数（并查集弱连通分量）

**函数签名**：

```typescript
export function computeComponents(
  nodeIds: string[],
  edges: Array<{ from: string; to: string }>,
): { componentCount: number; componentOf: Map<string, number> }
```

**实现**（严格遵循设计文档 §5.5）：

1. **初始化并查集**：每个节点自成一个集合（parent 指向自身）：

   ```typescript
   const parent = new Map<string, string>();
   for (const id of nodeIds) {
     parent.set(id, id);
   }
   ```

2. **`find` 函数（带路径压缩）**：

   ```typescript
   function find(x: string): string {
     let root = x;
     while (parent.get(root) !== root) {
       root = parent.get(root)!;
     }
     // 路径压缩：将路径上所有节点直接指向根
     let cur = x;
     while (parent.get(cur) !== root) {
       const next = parent.get(cur)!;
       parent.set(cur, root);
       cur = next;
     }
     return root;
   }
   ```

   > **关键点**：`find` 带路径压缩，时间复杂度近似 O(α(n))，适合大规模图谱。

3. **`union` 函数**：

   ```typescript
   function union(a: string, b: string): void {
     const ra = find(a);
     const rb = find(b);
     if (ra !== rb) {
       parent.set(ra, rb);
     }
   }
   ```

4. **无向化合并**：所有边视为无向（弱连通分量），遍历 edges 调用 `union(edge.from, edge.to)`：

   ```typescript
   for (const edge of edges) {
     // 仅对图中存在的节点进行合并
     if (parent.has(edge.from) && parent.has(edge.to)) {
       union(edge.from, edge.to);
     }
   }
   ```

5. **统计根节点数量并分配 componentId**：

   ```typescript
   const rootToId = new Map<string, number>();
   const componentOf = new Map<string, number>();
   let nextId = 0;
   for (const id of nodeIds) {
     const root = find(id);
     if (!rootToId.has(root)) {
       rootToId.set(root, nextId++);
     }
     componentOf.set(id, rootToId.get(root)!);
   }
   return { componentCount: nextId, componentOf };
   ```

### 3.6 导出清单

`lib/knowledge-graph/graph.ts` 导出以下符号：

- `buildGraph`（函数）
- `detectCycles`（函数）
- `computeComponents`（函数）
- `inferFileKind`（辅助函数，不导出，模块内部使用）

---

## 4. 测试计划

### 4.1 单元测试

> 单元测试文件：`tests/knowledge-graph/graph.test.ts`（由 T12 创建，本任务需确保函数可独立测试）。

**`buildGraph` 测试用例**：

- **TC-G1 邻接表构建**：给定 `collected` 含 `a.ts`（依赖 `b.ts`）与 `b.ts`（无依赖），`buildGraph` 后 `adjacency.get('a.ts')` 为 `['b.ts']`，`adjacency.get('b.ts')` 为 `[]`。
- **TC-G2 反向邻接表同步填充**：同上场景，`reverseAdjacency.get('b.ts')` 为 `['a.ts']`，`reverseAdjacency.get('a.ts')` 为 `[]`。
- **TC-G3 节点元数据**：`nodes.get('a.ts')` 含 `id` / `relativePath` / `kind` / `inDegree` / `outDegree` / `exports` / `isEntry` / `packageName` 字段；`inDegree` 与 `outDegree` 与邻接表长度一致。
- **TC-G4 边列表**：`edges` 数组含一条 `{ from: 'a.ts', to: 'b.ts', kind: 'import', ... }` 边；未解析边（`unresolved: true`）仍纳入 edges。
- **TC-G5 未解析边处理**：`collected` 含 `a.ts` 依赖 `lodash`（纯包名，resolver 返回 null），`edges` 含该边且 `unresolved: true`，但 `adjacency.get('a.ts')` 不包含 `lodash`（目标节点不在图中）。
- **TC-G6 stats 骨架**：`stats.nodeCount` / `edgeCount` / `cycleCount` / `componentCount` / `unresolvedEdgeCount` 被正确填充；`hubCount` / `isolatedCount` / `entryCount` / `maxInDegree` / `maxOutDegree` 初始为 0（由 T6 填充）。

**`detectCycles` 测试用例**：

- **TC-C1 两节点循环**：`adjacency = { a: ['b'], b: ['a'] }`，`detectCycles` 返回长度为 1 的数组，循环链形如 `['a', 'b', 'a']`（或 `['b', 'a', 'b']`，去重后仅保留一条）。
- **TC-C2 三节点循环**：`adjacency = { a: ['b'], b: ['c'], c: ['a'] }`，`detectCycles` 返回长度为 1 的数组，循环链形如 `['a', 'b', 'c', 'a']`。
- **TC-C3 无环图**：`adjacency = { a: ['b'], b: ['c'], c: [] }`，`detectCycles` 返回 `[]`。
- **TC-C4 循环去重**：`adjacency = { a: ['b'], b: ['a'] }`，无论从 `a` 还是 `b` 启动 DFS，去重后仅保留 1 条循环。
- **TC-C5 多个独立循环**：`adjacency = { a: ['b'], b: ['a'], c: ['d'], d: ['e'], e: ['c'] }`，`detectCycles` 返回长度为 2 的数组。
- **TC-C6 自环**：`adjacency = { a: ['a'] }`，`detectCycles` 返回 `[['a', 'a']]`（或等价形式）。
- **TC-C7 空图**：`adjacency = new Map()`，`detectCycles` 返回 `[]`。

**`computeComponents` 测试用例**：

- **TC-U1 两个独立连通分量**：`nodeIds = ['a', 'b', 'c', 'd']`，`edges = [{ from: 'a', to: 'b' }, { from: 'c', to: 'd' }]`，`componentCount === 2`。
- **TC-U2 单个连通分量**：`nodeIds = ['a', 'b', 'c']`，`edges = [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }]`，`componentCount === 1`。
- **TC-U3 孤立节点**：`nodeIds = ['a', 'b', 'c']`，`edges = [{ from: 'a', to: 'b' }]`，`componentCount === 2`（`c` 自成一个分量）。
- **TC-U4 无向化**：`nodeIds = ['a', 'b']`，`edges = [{ from: 'a', to: 'b' }]`，`componentOf.get('a') === componentOf.get('b')`（弱连通，方向无关）。
- **TC-U5 路径压缩**：代码审查确认 `find` 函数含路径压缩逻辑（`while` 循环将路径节点指向根）。
- **TC-U6 边引用不存在节点**：`nodeIds = ['a']`，`edges = [{ from: 'a', to: 'b' }]`（`b` 不在 nodeIds 中），`componentCount === 1`，不抛异常。

### 4.2 集成测试 / 端到端测试

> 由 T12 在 `tests/knowledge-graph/integration.test.ts` 中覆盖，本任务不涉及。

- **cycle-project 夹具端到端**：`a → b → a` 与 `c → d → e → c` 两个循环被正确检测。
- **simple-project 夹具端到端**：邻接表与反向邻接表一致性验证。

### 4.3 回归测试

- 本任务为新增模块 `lib/knowledge-graph/graph.ts`，不修改任何既有文件，对 v1.1 ~ v1.4 无回归影响。
- T12 回归测试要求 `pnpm test` 全量通过，本任务需确保新增模块不引入编译/类型错误。

---

## 5. 风险与依赖

| 风险 / 依赖 | 影响 | 应对措施 |
|---|---|---|
| T3 的 `CollectedDependency` 未含 resolved 路径字段，`buildGraph` 需再次调用 `resolver.resolve` | 重复解析路径，性能开销 | `buildGraph` 仅对 `unresolved === false` 的依赖调用 `resolver.resolve`；解析结果不缓存（T4 的 mtime 缓存已在收集阶段覆盖） |
| DFS 递归深度在 5000 文件项目可能触发栈溢出 | 大型项目循环检测失败 | v1.5 采用递归实现与设计文档 §5.2 对齐；T12 测试阶段若发现栈溢出，升级为迭代实现（显式栈） |
| 反向邻接表同步填充逻辑与正向邻接表不一致 | hub 识别（T6）入度计算错误 | TC-G2 显式断言反向邻接表与正向邻接表一致性；T6 的 `analyzeGraph` 通过 `reverseAdjacency` 长度推导 `inDegree` |
| 并查集 `find` 路径压缩实现错误 | 连通分量数计算错误 | TC-U1 ~ TC-U5 覆盖；代码审查确认路径压缩逻辑 |
| 循环去重 key 算法对自环（`a → a`）的处理 | 自环循环可能被误去重 | TC-C6 显式覆盖自环场景；`[...new Set(['a', 'a'])].sort().join('|')` === `'a'`，自环作为独立 key 保留 |
| 未解析边是否纳入连通分量计算 | componentCount 可能偏大 | `computeComponents` 仅对 `unresolved === false` 的边计算（见 §3.2 步骤 6），未解析边不参与合并 |

---

## 6. 变更范围

- **本任务范围内**：
  - 新增 `lib/knowledge-graph/graph.ts`，实现 `buildGraph` / `detectCycles` / `computeComponents` / `inferFileKind`。
- **不在本任务范围内**：
  - `lib/knowledge-graph/types.ts` 类型定义（由 T1 负责）；
  - `lib/knowledge-graph/collector.ts` 依赖收集（由 T3 负责）；
  - `lib/knowledge-graph/resolver.ts` 路径解析器（由 T2 负责，本任务仅以鸭子类型接口消费）；
  - `GraphNode.role` / `isEntry` 填充与 `GraphStats` 完整字段计算（由 T6 `analyzeGraph` 负责）；
  - `KnowledgeGraph.isMonorepo` / `packages` 填充（由 T9 monorepo 模块负责）；
  - 测试夹具与测试用例（由 T12 负责）；
  - **不修改任何既有文件**（`lib/types.ts` 由 T1 扩展，本任务仅消费类型）。

---

## 7. 评审记录

| 轮次 | 日期 | 结论 | P0/P1 问题 | 修复方案 |
|---|---|---|---|---|
| 1 | 待评审 | 待评审 | — | — |
