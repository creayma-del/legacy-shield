# T1：类型定义与图谱 schema（lib/types.ts 扩展 + lib/knowledge-graph/types.ts）

> 版本：v1.5
> 任务编号：T1
> 对应阶段 Spec：[phase-v1.5-spec.md](phase-v1.5-spec.md)
> 对应设计文档：[design-v1.5.md](../design-v1.5.md)
> 对应执行计划：[execution-plan-v1.5.md](../execution-plan-v1.5.md)
> 依赖任务：无
> 状态：已完成，已归档（冻结，不再修改）
> 评审记录：见本文档末尾（轮次 1 已通过）

---

## 1. 任务目标

为 v1.5 知识图谱生成模块提供完整的类型定义基础，作为 T2-T13 所有后续任务的类型契约。具体包括：
- 在 `lib/types.ts` 中扩展 `GraphOptions` / `GraphResult` 导出类型，供 CLI 层（T11）与编排入口（T10）使用；
- 新增 `lib/knowledge-graph/types.ts`，定义图谱节点、边、图数据结构、统计指标、JSON 输出 schema 等模块内部类型，供 T2-T9 各模块通过相对路径导入。

对应阶段 Spec §3.2（类型定义与图谱 schema）与交付物 D1 / D2。

---

## 2. 对应需求与验收标准

| 需求编号 | 需求描述 | 本任务验收标准 |
|---|---|---|
| REQ-1.5-1 | 扫描目标项目 src 下的 JS/JSX/TS/TSX/Vue 文件，构建文件级依赖图 | `lib/knowledge-graph/types.ts` 定义 `GraphNode` / `GraphEdge` / `KnowledgeGraph` 接口，字段覆盖文件级依赖图所需的节点元数据与边关系 |
| REQ-1.5-8 | 输出 JSON 格式知识图谱（邻接表 + 反向索引 + 节点元数据 + 图统计指标） | `KnowledgeGraphJson` 接口定义完整，含 `meta` / `nodes` / `edges` / `cycles` / `stats` 五个顶层字段；`edges` 为数组类型（非 Map），与设计 §2.3 说明一致 |
| REQ-1.5-10 | 新增独立 graph 子命令，与 quality/report/api 并列 | `lib/types.ts` 新增 `GraphOptions`（含 `hubThreshold?: number`）与 `GraphResult`（8 字段）导出类型，供 CLI 层与编排入口使用 |

---

## 3. 实现步骤

### 3.1 扩展 `lib/types.ts`

- **锚点位置**：在 [lib/types.ts](file:///Users/creayma/personal/legacy-shield/lib/types.ts) 现有 `ApiCommandOptions` 接口（约 L411-L415）**之后**、`ShieldEmitEvent` 接口（约 L417）**之前**，新增 `GraphOptions` 与 `GraphResult` 导出类型。也可追加到文件末尾 `ERROR_RUNTIME_SUB_TYPES` 常量之前，保持与现有导出风格一致。

- **新增 `GraphOptions` 接口**：

  ```typescript
  export interface GraphOptions {
    /** 目标项目根路径（必填） */
    project: string;
    /** 输出目录（未传时默认 <project>/.legacy-shield/knowledge-graph/） */
    out?: string;
    /** 并发扫描数（默认 8） */
    concurrency?: number;
    /** 强制全量重建，忽略缓存 */
    fresh?: boolean;
    /** 输出格式（默认 'both'） */
    format?: 'json' | 'md' | 'both';
    /** hub 文件入度阈值（默认 10） */
    hubThreshold?: number;
  }
  ```

- **新增 `GraphResult` 类型**：

  ```typescript
  export type GraphResult = {
    /** 项目根目录 */
    projectRoot: string;
    /** 是否为 monorepo */
    isMonorepo: boolean;
    /** 子包列表（monorepo 场景，单包为空数组） */
    packages: string[];
    /** 输出目录绝对路径 */
    outputPath: string;
    /** 节点总数 */
    nodeCount: number;
    /** 边总数 */
    edgeCount: number;
    /** 循环依赖数量 */
    cycleCount: number;
    /** 执行耗时（毫秒） */
    durationMs: number;
  };
  ```

- **字段对齐说明**：`GraphResult` 的 8 个字段与执行计划 T1 验收标准一致：`projectRoot` / `isMonorepo` / `packages` / `outputPath` / `nodeCount` / `edgeCount` / `cycleCount` / `durationMs`。

### 3.2 新增 `lib/knowledge-graph/types.ts`

- **文件位置**：`lib/knowledge-graph/types.ts`（新增文件，目录 `lib/knowledge-graph/` 由本任务首次创建）。

- **类型定义清单**（严格按设计文档 [design-v1.5.md §2.1 / §2.2 / §2.3](../design-v1.5.md#21-图谱节点类型) 定义）：

  ```typescript
  /** 文件类型 */
  export type FileKind = 'js' | 'jsx' | 'ts' | 'tsx' | 'vue' | 'unknown';

  /** 节点角色（基于路径与入度/出度推断） */
  export type NodeRole = 'entry' | 'core' | 'leaf' | 'isolated' | 'unknown';

  /** 图谱边类型 */
  export type EdgeKind = 'import' | 're-export' | 'require' | 'dynamic-import';

  /** 图谱节点 */
  export interface GraphNode {
    /** 文件绝对路径（规范化后，不含后缀的模块标识） */
    id: string;
    /** 相对于项目根目录的路径（用于输出） */
    relativePath: string;
    /** 文件类型 */
    kind: FileKind;
    /** 节点角色 */
    role: NodeRole;
    /** 入度（被多少文件依赖） */
    inDegree: number;
    /** 出度（依赖多少文件） */
    outDegree: number;
    /** 导出符号列表 */
    exports: string[];
    /** 是否为入口文件（被 0 个文件依赖且 outDegree > 0） */
    isEntry: boolean;
    /** 所属子包名（monorepo 场景，单包为 null） */
    packageName: string | null;
  }

  /** 图谱边 */
  export interface GraphEdge {
    /** 源文件 id */
    from: string;
    /** 目标文件 id */
    to: string;
    /** 边类型 */
    kind: EdgeKind;
    /** import 的符号列表（仅 import/require 边有值） */
    symbols: string[];
    /** 是否为未解析的边（动态 import、变量 require） */
    unresolved: boolean;
    /** 原始 import 路径（用于调试） */
    rawSpec: string;
  }

  /** 图统计指标 */
  export interface GraphStats {
    /** 节点总数 */
    nodeCount: number;
    /** 边总数 */
    edgeCount: number;
    /** 循环依赖数量 */
    cycleCount: number;
    /** 连通分量数量 */
    componentCount: number;
    /** hub 文件数量（入度 >= 阈值，默认 10） */
    hubCount: number;
    /** 孤立文件数量 */
    isolatedCount: number;
    /** 入口文件数量 */
    entryCount: number;
    /** 未解析边数量 */
    unresolvedEdgeCount: number;
    /** 最大入度 */
    maxInDegree: number;
    /** 最大出度 */
    maxOutDegree: number;
  }

  /** 知识图谱 */
  export interface KnowledgeGraph {
    /** 项目根目录 */
    projectRoot: string;
    /** 是否为 monorepo */
    isMonorepo: boolean;
    /** 子包列表（monorepo 场景） */
    packages: string[];
    /** 节点 Map（id -> GraphNode） */
    nodes: Map<string, GraphNode>;
    /** 邻接表（id -> 依赖的文件 id 列表） */
    adjacency: Map<string, string[]>;
    /** 反向邻接表（id -> 被哪些文件依赖） */
    reverseAdjacency: Map<string, string[]>;
    /** 边列表 */
    edges: GraphEdge[];
    /** 循环依赖链列表 */
    cycles: string[][];
    /** 图统计指标 */
    stats: GraphStats;
  }

  /** JSON 输出格式（机器消费） */
  export interface KnowledgeGraphJson {
    /** 元数据 */
    meta: {
      projectRoot: string;
      isMonorepo: boolean;
      packages: string[];
      generatedAt: string;
      nodeCount: number;
      edgeCount: number;
      cycleCount: number;
    };
    /** 节点列表 */
    nodes: Array<{
      id: string;
      relativePath: string;
      kind: FileKind;
      role: NodeRole;
      inDegree: number;
      outDegree: number;
      exports: string[];
      isEntry: boolean;
      packageName: string | null;
    }>;
    /** 边列表（以 edges 列表替代邻接表，消费方可从 edges 重建邻接表） */
    edges: Array<{
      from: string;
      to: string;
      kind: EdgeKind;
      symbols: string[];
      unresolved: boolean;
      rawSpec: string;
    }>;
    /** 循环依赖链 */
    cycles: string[][];
    /** 统计指标 */
    stats: GraphStats;
  }
  ```

- **设计说明对齐**：`KnowledgeGraphJson.edges` 为数组类型（非 Map），与设计 §2.3 说明一致——"JSON 输出以 edges 列表替代邻接表与反向索引，消费方可从 edges 列表重建邻接表"。

### 3.3 类型可导入性验证

- `lib/knowledge-graph/types.ts` 中所有类型可被 `lib/types.ts` 通过相对路径 `./knowledge-graph/types.js` 导入（若需要）。
- 后续 T2-T9 各模块通过 `import type { GraphNode, GraphEdge, ... } from './types.js'` 导入本文件定义的类型。
- 本任务不引入任何运行时依赖，仅定义类型（`export type` / `export interface`），无运行时代码。

---

## 4. 测试计划

### 4.1 单元测试

> T1 为纯类型定义任务，无运行时逻辑，单元测试主要通过类型检查与构建验证。

- **类型测试**：`pnpm typecheck` 零错误，确认所有类型定义无语法错误、无类型逃逸。
- **构建测试**：`pnpm build` 通过，确认 TypeScript 编译成功生成声明文件。
- **导入测试**（在 T12 单测中覆盖）：
  - `import type { GraphOptions, GraphResult } from './types.js'`（从 `lib/types.ts`）可正常导入；
  - `import type { GraphNode, GraphEdge, KnowledgeGraph, GraphStats, KnowledgeGraphJson, FileKind, NodeRole, EdgeKind } from './types.js'`（从 `lib/knowledge-graph/types.ts`）可正常导入。
- **字段完整性测试**（在 T12 单测中覆盖）：
  - `GraphOptions` 含 `hubThreshold?: number` 字段，类型为可选 number；
  - `GraphResult` 含 8 个字段（projectRoot / isMonorepo / packages / outputPath / nodeCount / edgeCount / cycleCount / durationMs）；
  - `KnowledgeGraphJson` 含 5 个顶层字段（meta / nodes / edges / cycles / stats）；
  - `KnowledgeGraphJson.edges` 为数组类型（非 Map）；
  - `GraphStats` 含 10 个字段（nodeCount / edgeCount / cycleCount / componentCount / hubCount / isolatedCount / entryCount / unresolvedEdgeCount / maxInDegree / maxOutDegree）。

### 4.2 集成测试 / 端到端测试

- 不涉及，由 T12 在端到端测试中验证类型在实际流程中的正确使用。

### 4.3 回归测试

- 既有 `tests/utils.test.ts`、`tests/vue3-monitor.test.ts`、`tests/quality.test.ts` 等全绿（本任务仅新增类型定义，不修改现有代码逻辑，回归风险极低）；
- `pnpm typecheck` 对现有代码无新增类型错误。

---

## 5. 风险与依赖

| 风险 / 依赖 | 影响 | 应对措施 |
|---|---|---|
| 类型定义与设计文档 §2 不一致 | 后续 T2-T9 模块类型契约偏差 | 严格按设计文档 §2.1 / §2.2 / §2.3 定义，字段名、可选性、类型均与设计文档代码块一致 |
| `GraphOptions.hubThreshold` 默认值未在类型层体现 | CLI 层（T11）与编排入口（T10）默认值不一致 | 类型层仅声明可选 `?: number`，默认值 10 由 T10 编排入口在运行时填充，类型层不设默认值 |
| `KnowledgeGraph` 使用 `Map` 类型无法直接 JSON 序列化 | JSON 输出（T7）需手动转换 | 设计 §2.3 已明确 `KnowledgeGraphJson` 为独立接口，`nodes` / `edges` 均为数组类型，T7 的 `toJson` 函数负责 Map → Array 转换 |
| 本任务无依赖，但被 T3 / T5 / T6 / T7 / T8 / T9 / T10 依赖 | 类型定义延迟将阻塞后续所有任务 | T1 与 T2 可完全并行启动，T1 工作量低（1-2 人时），优先完成 |

---

## 6. 变更范围

- **本任务范围内**：
  - `lib/types.ts` 扩展：新增 `GraphOptions` / `GraphResult` 导出类型；
  - `lib/knowledge-graph/types.ts` 新增：`FileKind` / `NodeRole` / `EdgeKind` / `GraphNode` / `GraphEdge` / `GraphStats` / `KnowledgeGraph` / `KnowledgeGraphJson` 类型定义；
  - 创建 `lib/knowledge-graph/` 目录（本任务首次创建该目录）。
- **不在本任务范围内**：
  - `ModuleResolver` 类实现（由 T2 负责）；
  - `CollectedDependency` / `CollectedFile` 接口定义（由 T3 在 `collector.ts` 中定义）；
  - `CacheEntry` / `CacheFile` 接口定义（由 T4 在 `scanner.ts` 中定义）；
  - `ResolverOptions` 接口定义（由 T2 在 `resolver.ts` 中定义）；
  - 任何运行时逻辑实现（本任务仅定义类型，无 `function` / `class` 实现）；
  - CLI 子命令注册（由 T11 负责）；
  - 不修改 `lib/types.ts` 中任何现有类型定义（仅新增，不修改）。

---

## 7. 评审记录

| 轮次 | 日期 | 结论 | P0/P1 问题 | 修复方案 |
|---|---|---|---|---|
| 1 | 2026-06-23 | 通过 | 无 | — |
