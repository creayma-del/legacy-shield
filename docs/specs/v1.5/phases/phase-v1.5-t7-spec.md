# T7：JSON 输出器

> 版本：v1.5
> 任务编号：T7
> 对应阶段 Spec：[phase-v1.5-spec.md](phase-v1.5-spec.md)
> 对应设计文档：[design-v1.5.md](../design-v1.5.md)
> 对应执行计划：[execution-plan-v1.5.md](../execution-plan-v1.5.md)
> 依赖任务：T5（lib/knowledge-graph/graph.ts KnowledgeGraph 结构）、T6（lib/knowledge-graph/analyzer.ts analyzeGraph 填充 role / isEntry / stats 后的 KnowledgeGraph）
> 状态：已完成，已归档（冻结，不再修改）
> 评审记录：见本文档末尾（轮次 1 已通过）

---

## 1. 任务目标

在 T5（图构建器）与 T6（图谱分析器）产出的完整 `KnowledgeGraph` 基础上，实现 JSON 格式输出。具体包括：

- **toJson**：将 `KnowledgeGraph`（含 Map 结构的 nodes / adjacency / reverseAdjacency）转换为可 JSON 序列化的 `KnowledgeGraphJson`（含数组结构的 nodes / edges）；
- **以 edges 列表替代邻接表**：直接输出 `graph.edges` 数组，**不输出** `adjacency` / `reverseAdjacency`（消费方可从 edges 重建邻接表），避免 Map 序列化问题，同时使输出更紧凑、更易于流式处理；
- **writeJson**：将 `toJson` 结果序列化为 JSON 字符串（2 空格缩进），写入 `<outputPath>/knowledge-graph.json` 文件，返回写入的文件路径。

对应设计文档 §2.3（JSON 输出 Schema）、§7.1（JSON 输出格式），阶段 Spec §3.7 与交付物 D8。

---

## 2. 对应需求与验收标准

| 需求编号 | 需求描述 | 本任务验收标准 |
|---|---|---|
| REQ-1.5-8 | 输出 JSON 格式知识图谱（邻接表 + 反向索引 + 节点元数据 + 图统计指标） | `toJson` 输出 `KnowledgeGraphJson`，含 `meta` / `nodes` / `edges` / `cycles` / `stats` 五个顶层字段；以 `edges` 列表替代邻接表（数据完整等价，表达形式不同）；`nodes` 为数组，每个元素含 id / relativePath / kind / role / inDegree / outDegree / exports / isEntry / packageName 字段；`edges` 为数组，每个元素含 from / to / kind / symbols / unresolved / rawSpec 字段；JSON 文件可被 `JSON.parse` 正确解析；从 edges 列表可重建邻接表 |

---

## 3. 实现步骤

### 3.1 新增 `lib/knowledge-graph/json-output.ts`

> 本文件为 JSON 输出模块，不引入任何新的运行时依赖，仅依赖 T1 产出的 `KnowledgeGraphJson` 类型与 T5 / T6 产出的 `KnowledgeGraph` 结构。
>
> 文件顶部 import：
>
> ```typescript
> import type {
>   KnowledgeGraph,
>   KnowledgeGraphJson,
>   GraphNode,
>   GraphEdge,
> } from './types.js';
> import { join } from 'node:path';
> import { mkdir, writeFile } from 'node:fs/promises';
> ```

### 3.2 实现 `toJson` 函数

**函数签名**：

```typescript
export function toJson(graph: KnowledgeGraph): KnowledgeGraphJson
```

**实现步骤**：

1. **构造 meta 对象**：

   ```typescript
   const meta = {
     projectRoot: graph.projectRoot,
     isMonorepo: graph.isMonorepo,
     packages: graph.packages,
     generatedAt: new Date().toISOString(),
     nodeCount: graph.stats.nodeCount,
     edgeCount: graph.stats.edgeCount,
     cycleCount: graph.stats.cycleCount,
   };
   ```

   > **说明**：`generatedAt` 为 ISO 8601 格式时间字符串（如 `2026-06-22T15:30:00.000Z`），通过 `new Date().toISOString()` 生成。`meta` 不包含 `hubCount` / `isolatedCount` 等详细统计指标，这些指标在 `stats` 字段中输出。

2. **转换 nodes 为数组**：将 `Map<string, GraphNode>` 转换为数组，展开 `GraphNode` 所有字段：

   ```typescript
   const nodes: Array<{
     id: string;
     relativePath: string;
     kind: string;
     role: string;
     inDegree: number;
     outDegree: number;
     exports: string[];
     isEntry: boolean;
     packageName: string | null;
   }> = Array.from(graph.nodes.values()).map((node) => ({
     id: node.id,
     relativePath: node.relativePath,
     kind: node.kind,
     role: node.role,
     inDegree: node.inDegree,
     outDegree: node.outDegree,
     exports: node.exports,
     isEntry: node.isEntry,
     packageName: node.packageName,
   }));
   ```

   > **说明**：`nodes` 数组中每个元素的字段与 `GraphNode` 接口完全一致，按设计文档 §2.3 schema 顺序排列（id / relativePath / kind / role / inDegree / outDegree / exports / isEntry / packageName）。`exports` 为字符串数组，直接输出。`packageName` 在单包场景为 `null`，monorepo 场景为子包名（由 T9 填充）。

3. **以 edges 列表替代邻接表**：直接输出 `graph.edges` 数组，**不输出** `adjacency` / `reverseAdjacency`：

   ```typescript
   const edges: Array<{
     from: string;
     to: string;
     kind: string;
     symbols: string[];
     unresolved: boolean;
     rawSpec: string;
   }> = graph.edges.map((edge) => ({
     from: edge.from,
     to: edge.to,
     kind: edge.kind,
     symbols: edge.symbols,
     unresolved: edge.unresolved,
     rawSpec: edge.rawSpec,
   }));
   ```

   > **关键设计（设计文档 §2.3 设计说明）**：JSON 输出以 `edges` 列表替代邻接表与反向索引，消费方可从 edges 列表重建邻接表（`edges.filter(e => !e.unresolved).forEach(e => adjacency[e.from].push(e.to))`，需排除未解析边以与 `graph.adjacency` 一致）。这样设计的原因是：
   > - edges 列表更紧凑，避免了 Map 序列化问题；
   > - edges 列表更易于流式处理；
   > - 数据完整等价：邻接表与反向邻接表均可从 edges 列表重建。
   >
   > 与 REQ-1.5-8 的"邻接表 + 反向索引"要求对齐方式为：数据完整等价，表达形式不同。

4. **输出 cycles 与 stats**：

   ```typescript
   const cycles = graph.cycles;
   const stats = graph.stats;
   ```

   > **说明**：`cycles` 为 `string[][]`，直接输出。`stats` 为 `GraphStats` 对象，含 10 个字段（nodeCount / edgeCount / cycleCount / componentCount / hubCount / isolatedCount / entryCount / unresolvedEdgeCount / maxInDegree / maxOutDegree），直接输出。

5. **返回 KnowledgeGraphJson**：

   ```typescript
   return {
     meta,
     nodes,
     edges,
     cycles,
     stats,
   };
   ```

### 3.3 实现 `writeJson` 函数

**函数签名**：

```typescript
export async function writeJson(
  graph: KnowledgeGraph,
  outputPath: string,
): Promise<string>
```

**实现步骤**：

1. **调用 toJson 生成 JSON 对象**：

   ```typescript
   const json = toJson(graph);
   ```

2. **序列化为 JSON 字符串（2 空格缩进）**：

   ```typescript
   const jsonStr = JSON.stringify(json, null, 2);
   ```

   > **说明**：使用 `JSON.stringify` 的第三个参数 `2` 实现 2 空格缩进，确保输出可读性。不使用 `replacer` 函数，因为 `toJson` 已将所有 Map 转换为数组，无需额外序列化处理。

3. **确保输出目录存在**：

   ```typescript
   await mkdir(outputPath, { recursive: true });
   ```

   > **说明**：`outputPath` 为目录路径（如 `<project>/.legacy-shield/knowledge-graph/`），`mkdir` 使用 `recursive: true` 确保多级目录创建。若目录已存在，`mkdir` 不抛异常。

4. **写入文件**：

   ```typescript
   const filePath = join(outputPath, 'knowledge-graph.json');
   await writeFile(filePath, jsonStr, 'utf8');
   ```

   > **说明**：输出文件名固定为 `knowledge-graph.json`（设计文档 §7.1 与 §9.2 明确要求）。`writeFile` 使用 `utf8` 编码。

5. **返回写入的文件路径**：

   ```typescript
   return filePath;
   ```

### 3.4 导出清单

`lib/knowledge-graph/json-output.ts` 导出以下符号：

- `toJson`（函数）
- `writeJson`（函数）

---

## 4. 测试计划

### 4.1 单元测试

> 单元测试文件：`tests/knowledge-graph/json-output.test.ts`（由 T12 创建，本任务需确保函数可独立测试）。

**`toJson` 测试用例**：

- **TC-J1 顶层字段完整性**：`toJson` 返回对象含 `meta` / `nodes` / `edges` / `cycles` / `stats` 五个顶层字段，无 `adjacency` / `reverseAdjacency` 字段。
- **TC-J2 meta 字段**：`meta` 含 `projectRoot` / `isMonorepo` / `packages` / `generatedAt` / `nodeCount` / `edgeCount` / `cycleCount` 字段；`generatedAt` 为 ISO 8601 格式（正则 `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/`）。
- **TC-J3 nodes 数组**：`nodes` 为数组，长度等于 `graph.nodes.size`；每个元素含 `id` / `relativePath` / `kind` / `role` / `inDegree` / `outDegree` / `exports` / `isEntry` / `packageName` 字段。
- **TC-J4 edges 数组**：`edges` 为数组，长度等于 `graph.edges.length`；每个元素含 `from` / `to` / `kind` / `symbols` / `unresolved` / `rawSpec` 字段。
- **TC-J5 edges 列表替代邻接表**：`toJson` 返回对象中**不含** `adjacency` / `reverseAdjacency` 字段（`JSON.stringify` 后的字符串中不含这两个字段名）。
- **TC-J6 从 edges 重建邻接表**：`toJson` 返回的 `edges` 数组可通过 `edges.filter(e => !e.unresolved).forEach(e => adjacency[e.from].push(e.to))` 重建邻接表，重建结果与 `graph.adjacency` 一致（仅含已解析边）。
- **TC-J7 cycles 输出**：`cycles` 为 `string[][]`，与 `graph.cycles` 一致。
- **TC-J8 stats 输出**：`stats` 含 10 个字段（nodeCount / edgeCount / cycleCount / componentCount / hubCount / isolatedCount / entryCount / unresolvedEdgeCount / maxInDegree / maxOutDegree），与 `graph.stats` 一致。
- **TC-J9 JSON 可序列化**：`JSON.stringify(toJson(graph))` 不抛异常（无循环引用、无 Map/Set 等不可序列化对象）。
- **TC-J10 JSON 可解析**：`JSON.parse(JSON.stringify(toJson(graph)))` 返回对象与原对象深相等。
- **TC-J11 空图**：`graph.nodes` 为空 Map 时，`toJson` 返回 `nodes: []`、`edges: []`、`cycles: []`，不抛异常。
- **TC-J12 未解析边输出**：`graph.edges` 含 `unresolved: true` 的边时，`toJson` 输出该边且 `unresolved: true`。

**`writeJson` 测试用例**：

- **TC-W1 文件写入**：`writeJson` 后，`<outputPath>/knowledge-graph.json` 文件存在。
- **TC-W2 文件内容**：文件内容为 JSON 字符串，`JSON.parse` 后含 `meta` / `nodes` / `edges` / `cycles` / `stats` 五个顶层字段。
- **TC-W3 2 空格缩进**：文件内容含换行与 2 空格缩进（非单行 JSON）。
- **TC-W4 返回值**：`writeJson` 返回写入的文件路径（`<outputPath>/knowledge-graph.json`）。
- **TC-W5 目录自动创建**：`outputPath` 目录不存在时，`writeJson` 自动创建多级目录（`mkdir recursive: true`）。
- **TC-W6 目录已存在**：`outputPath` 目录已存在时，`writeJson` 不抛异常。
- **TC-W7 UTF-8 编码**：文件内容含中文（如 `relativePath` 含中文目录名）时，`JSON.parse` 正确还原中文字符（不乱码）。

### 4.2 集成测试 / 端到端测试

> 由 T12 在 `tests/knowledge-graph/integration.test.ts` 中覆盖，本任务不涉及。

- **simple-project 夹具端到端**：`shield graph --project simple-project --format json` 后，`<outputPath>/knowledge-graph.json` 文件存在且可被 `JSON.parse` 解析。
- **monorepo-project 夹具端到端**：JSON 输出的 `meta.isMonorepo === true`、`meta.packages` 含各子包路径。

### 4.3 回归测试

- 本任务为新增模块 `lib/knowledge-graph/json-output.ts`，不修改任何既有文件，对 v1.1 ~ v1.4 无回归影响。
- T12 回归测试要求 `pnpm test` 全量通过，本任务需确保新增模块不引入编译/类型错误。

---

## 5. 风险与依赖

| 风险 / 依赖 | 影响 | 应对措施 |
|---|---|---|
| `toJson` 未正确转换 Map 为数组 | `JSON.stringify` 抛异常或输出 `{}` | TC-J9 / TC-J10 显式覆盖 JSON 可序列化与可解析；`toJson` 使用 `Array.from(map.values())` 转换 Map |
| `edges` 列表与邻接表数据不一致 | 消费方重建邻接表后与原图不一致 | TC-J6 显式验证从 edges 重建邻接表的结果与 `graph.adjacency` 一致 |
| `generatedAt` 时间格式非 ISO 8601 | 消费方解析时间失败 | TC-J2 正则校验 ISO 8601 格式；使用 `new Date().toISOString()` 生成 |
| `writeJson` 目录创建失败 | 文件写入失败 | `mkdir` 使用 `recursive: true`；TC-W5 / TC-W6 覆盖目录不存在与已存在场景 |
| `writeJson` 文件编码非 UTF-8 | 中文路径乱码 | `writeFile` 显式传入 `'utf8'` 编码；TC-W7 覆盖中文场景 |
| `toJson` 在 `analyzeGraph` 之前调用 | `role` / `isEntry` / `stats` 字段未填充 | T10 编排入口保证 `toJson` / `writeJson` 在 `analyzeGraph` 之后调用；本任务文档明确依赖 T6 |

---

## 6. 变更范围

- **本任务范围内**：
  - 新增 `lib/knowledge-graph/json-output.ts`，实现 `toJson` / `writeJson`。
- **不在本任务范围内**：
  - `lib/knowledge-graph/types.ts` 类型定义（由 T1 负责）；
  - `lib/knowledge-graph/graph.ts` 图构建（由 T5 负责）；
  - `lib/knowledge-graph/analyzer.ts` 图谱分析（由 T6 负责，本任务消费 `analyzeGraph` 后的 `KnowledgeGraph`）；
  - `KnowledgeGraphJson` 类型定义（由 T1 在 `lib/knowledge-graph/types.ts` 中定义）；
  - 输出路径的 CLI 参数解析与默认值传递（由 T10 / T11 负责）；
  - 测试夹具与测试用例（由 T12 负责）；
  - **不修改任何既有文件**（本任务仅消费 T1 / T5 / T6 产出的类型与结构）。

---

## 7. 评审记录

| 轮次 | 日期 | 结论 | P0/P1 问题 | 修复方案 |
|---|---|---|---|---|
| 1 | 2026-06-23 | 修改后通过 | P2：nodes 字段顺序描述为"按字母序排列"与设计文档 §2.3 schema 顺序不一致；edges 重建邻接表公式未排除未解析边（与 `graph.adjacency` 不一致）；TC-J2 generatedAt 正则未转义小数点（`.` 匹配任意字符） | P2：修正 nodes 字段顺序描述为"按设计文档 §2.3 schema 顺序排列"并列出字段顺序；edges 重建公式改为 `edges.filter(e => !e.unresolved).forEach(...)` 并同步修正 TC-J6；generatedAt 正则转义为 `\.\d{3}Z` |
