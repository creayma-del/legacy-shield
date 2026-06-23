# T8：Markdown 摘要生成器（中文 AI 优化格式）

> 版本：v1.5
> 任务编号：T8
> 对应阶段 Spec：[phase-v1.5-spec.md](phase-v1.5-spec.md)
> 对应设计文档：[design-v1.5.md](../design-v1.5.md)
> 对应执行计划：[execution-plan-v1.5.md](../execution-plan-v1.5.md)
> 依赖任务：T6（lib/knowledge-graph/analyzer.ts analyzeGraph 填充 role / isEntry / stats 后的 KnowledgeGraph + inferLayers 产出的分层结构）
> 状态：已完成，已归档（冻结，不再修改）
> 评审记录：见本文档末尾（轮次 1 已通过）

---

## 1. 任务目标

在 T6（图谱分析器）产出的完整 `KnowledgeGraph` 与 `inferLayers` 分层结构基础上，实现**中文 AI 优化格式**的 Markdown 架构摘要生成。具体包括：

- **toMarkdown**：生成中文 Markdown，严格遵循设计文档 §7.2 定义的 **6 章节结构**（项目架构概览 / 模块依赖拓扑 / 关键节点识别 / 循环依赖分析 / 分层结构推断 / 架构健康度评估）；
- **AI 优化格式**：结构化表格 + 判断性文字（非纯数据堆砌，非 JSON 简单转译），让 AI 智能体可直接作为上下文注入消费；
- **writeMarkdown**：将 `toMarkdown` 结果写入 `<outputPath>/architecture-summary.md` 文件，返回写入的文件路径；
- **文件头**：含生成时间、项目路径、项目类型、节点数 / 边数 / 循环依赖数 / 孤立文件数摘要。

对应设计文档 §7.2（Markdown 摘要章节结构与样例），阶段 Spec §3.7 与交付物 D9。

---

## 2. 对应需求与验收标准

| 需求编号 | 需求描述 | 本任务验收标准 |
|---|---|---|
| REQ-1.5-9 | 输出中文 Markdown 格式架构摘要（AI 优化格式，含架构概览/依赖拓扑/关键节点/循环依赖） | `toMarkdown` 输出为**中文**（非英文，非 JSON 简单转译）；包含 §7.2 定义的 6 个章节，章节标题与样例一致；文件头含生成时间、项目路径、项目类型、节点/边/循环/孤立摘要；Hub 文件表含入度、出度、导出符号数、说明列；循环依赖分析对每个循环给出完整链路 + 拆解建议；分层结构推断表含 5 层（入口层 / 核心层 / 中间层 / 叶子层 / 孤立）；健康度评估含 6 项指标 + 总体评估文字；Markdown 内容为 AI 优化格式（结构化表格 + 判断性文字） |

---

## 3. 实现步骤

### 3.1 新增 `lib/knowledge-graph/markdown-output.ts`

> 本文件为 Markdown 输出模块，不引入任何新的运行时依赖，仅依赖 T6 产出的 `KnowledgeGraph` 结构与 `inferLayers` 返回类型。
>
> 文件顶部 import：
>
> ```typescript
> import type { KnowledgeGraph, GraphNode, NodeRole } from './types.js';
> import { inferLayers } from './analyzer.js';
> import { join, dirname, relative, sep } from 'node:path';
> import { mkdir, writeFile } from 'node:fs/promises';
> ```

### 3.2 定义 `Layers` 类型

> `inferLayers` 的返回类型，用于 `toMarkdown` 与 `writeMarkdown` 的参数声明。

```typescript
export type Layers = ReturnType<typeof inferLayers>;
```

> **说明**：`Layers` 类型为 `{ entry: string[]; core: string[]; middle: string[]; leaf: string[]; isolated: string[] }`。`toMarkdown` 与 `writeMarkdown` 接收 `Layers` 参数，由 T10 编排入口在调用 `inferLayers` 后传入。

### 3.3 实现 `toMarkdown` 函数

**函数签名**：

```typescript
export function toMarkdown(
  graph: KnowledgeGraph,
  layers: Layers,
  hubThreshold: number,
): string
```

> **P1 修复说明（函数签名对齐）**：§3.3 的函数签名原为 `toMarkdown(graph, layers)`，缺少 `hubThreshold` 参数，与 §3.4 采用的方案 A（增加 `hubThreshold: number` 参数）不一致。已统一为含 `hubThreshold` 参数的签名，与执行计划 T10 调用方传入一致。

**实现步骤**（严格遵循设计文档 §7.2 的 6 章节结构与样例）：

#### 3.3.1 文件头

```markdown
# 项目知识图谱架构摘要

> 生成时间：2026-06-22 15:30:00
> 项目路径：/path/to/project
> 项目类型：单包项目
> 节点数：120 | 边数：285 | 循环依赖：3 | 孤立文件：2
```

实现：

```typescript
const lines: string[] = [];
lines.push('# 项目知识图谱架构摘要');
lines.push('');
lines.push(`> 生成时间：${formatTimestamp(new Date())}`);
lines.push(`> 项目路径：${graph.projectRoot}`);
lines.push(`> 项目类型：${graph.isMonorepo ? 'monorepo 项目' : '单包项目'}`);
lines.push(`> 节点数：${graph.stats.nodeCount} | 边数：${graph.stats.edgeCount} | 循环依赖：${graph.stats.cycleCount} | 孤立文件：${graph.stats.isolatedCount}`);
lines.push('');
```

> **说明**：`formatTimestamp` 将 `Date` 格式化为 `YYYY-MM-DD HH:mm:ss`（本地时间，非 ISO 8601，便于中文阅读）。文件头含 4 行引用块（`>`），与设计文档 §7.2 样例一致。

#### 3.3.2 §1 项目架构概览

```markdown
## 1. 项目架构概览

本项目为 Vue 3 + TypeScript 单包项目，源码位于 `src/` 目录，共 120 个文件。
项目采用典型的分层架构，入口文件为 `src/main.ts`，通过 `src/App.vue` 挂载根组件。
核心模块集中在 `src/services/`（15 个文件）与 `src/stores/`（8 个文件）。

**架构特征**：
- 框架：Vue 3 + TypeScript
- 状态管理：Pinia（检测到 8 个 store 文件）
- 路由：Vue Router（检测到 12 个路由文件）
- 入口文件：1 个（`src/main.ts`）
- Hub 文件：5 个（被 ≥10 个文件依赖）
- 孤立文件：2 个（未被任何文件引用）
```

实现：

```typescript
lines.push('## 1. 项目架构概览');
lines.push('');

// 概览段落
const framework = detectFramework(graph);
const sourceDir = detectSourceDir(graph);
lines.push(`本项目为${framework}项目，源码位于 \`${sourceDir}/\` 目录，共 ${graph.stats.nodeCount} 个文件。`);

// 入口文件描述
const entryNodes = layers.entry
  .map((id) => graph.nodes.get(id))
  .filter((n): n is GraphNode => !!n);
if (entryNodes.length > 0) {
  const entryPaths = entryNodes.map((n) => `\`${n.relativePath}\``).join('、');
  lines.push(`入口文件为 ${entryPaths}。`);
}

// 核心模块描述（按目录聚合）
const dirStats = aggregateByDirectory(graph);
const topDirs = Object.entries(dirStats)
  .sort((a, b) => b[1].count - a[1].count)
  .slice(0, 3);
if (topDirs.length > 0) {
  const dirDesc = topDirs
    .map(([dir, stat]) => `\`${dir}/\`（${stat.count} 个文件）`)
    .join('与');
  lines.push(`核心模块集中在 ${dirDesc}。`);
}
lines.push('');

// 架构特征列表
lines.push('**架构特征**：');
lines.push(`- 框架：${framework}`);
const stateMgmt = detectStateManagement(graph);
if (stateMgmt) {
  lines.push(`- 状态管理：${stateMgmt}`);
}
const router = detectRouter(graph);
if (router) {
  lines.push(`- 路由：${router}`);
}
lines.push(`- 入口文件：${graph.stats.entryCount} 个`);
lines.push(`- Hub 文件：${graph.stats.hubCount} 个（被 ≥${hubThreshold} 个文件依赖）`);
lines.push(`- 孤立文件：${graph.stats.isolatedCount} 个（未被任何文件引用）`);
lines.push('');
```

> **说明**：
> - `detectFramework(graph)`：通过节点 `kind` 字段检测框架特征。若存在 `.vue` 文件，检测为 "Vue 3"；若存在 `.ts` / `.tsx` 文件，检测为 "TypeScript"；组合为 "Vue 3 + TypeScript" 等。
> - `detectStateManagement(graph)`：检测状态管理库。通过节点 `exports` 或 `relativePath` 关键词检测（如 `defineStore` → Pinia，`createStore` → Vuex），返回格式如 `"Pinia（检测到 8 个 store 文件）"`；未检测到时返回 `null`。
> - `detectRouter(graph)`：检测路由库。通过节点 `exports` 或 `relativePath` 关键词检测（如 `createRouter` → Vue Router，`new Router` → Express Router），返回格式如 `"Vue Router（检测到 12 个路由文件）"`；未检测到时返回 `null`。
> - `detectSourceDir(graph)`：从节点的 `relativePath` 中提取公共顶层目录（如 `src`）。
> - `aggregateByDirectory(graph)`：按顶层目录聚合节点数与被依赖次数，用于核心模块描述。
> - `hubThreshold` 参数由 `toMarkdown` 的调用方传入（或从 `graph` 上下文推导，见 §3.3.7）。

#### 3.3.3 §2 模块依赖拓扑

```markdown
## 2. 模块依赖拓扑

### 2.1 顶层目录依赖关系

| 目录 | 文件数 | 被依赖次数 | 依赖外部次数 | 角色 |
|---|---|---|---|---|
| src/components/ | 45 | 89 | 12 | 中间层 |
| src/services/ | 15 | 67 | 28 | 核心层 |
| src/stores/ | 8 | 23 | 15 | 核心层 |
| src/utils/ | 22 | 78 | 5 | 核心层 |
| src/views/ | 28 | 12 | 45 | 中间层 |

### 2.2 核心依赖链

1. `src/main.ts` → `src/router/index.ts` → `src/views/Home.vue` → `src/components/Header.vue`
2. `src/main.ts` → `src/stores/user.ts` → `src/services/api.ts` → `src/utils/request.ts`
```

实现：

```typescript
lines.push('## 2. 模块依赖拓扑');
lines.push('');

// 2.1 顶层目录依赖关系表
lines.push('### 2.1 顶层目录依赖关系');
lines.push('');
lines.push('| 目录 | 文件数 | 被依赖次数 | 依赖外部次数 | 角色 |');
lines.push('|---|---|---|---|---|');

const dirAgg = aggregateByDirectoryDetailed(graph, layers);
for (const [dir, stat] of Object.entries(dirAgg).sort((a, b) => b[1].dependedCount - a[1].dependedCount)) {
  lines.push(`| ${dir}/ | ${stat.count} | ${stat.dependedCount} | ${stat.dependCount} | ${stat.dominantRole} |`);
}
lines.push('');

// 2.2 核心依赖链
lines.push('### 2.2 核心依赖链');
lines.push('');
const chains = extractCoreChains(graph, layers);
chains.slice(0, 3).forEach((chain, idx) => {
  const chainStr = chain.map((id) => `\`${graph.nodes.get(id)?.relativePath ?? id}\``).join(' → ');
  lines.push(`${idx + 1}. ${chainStr}`);
});
lines.push('');
```

> **说明**：
> - `aggregateByDirectoryDetailed(graph, layers)`：按顶层目录聚合，统计每个目录的文件数、被依赖次数（该目录所有节点的 inDegree 之和）、依赖外部次数（该目录所有节点的 outDegree 之和）、主导角色（该目录中数量最多的 role，通过 `mapRoleToChinese` 转换为中文名称）。
> - `extractCoreChains(graph, layers)`：从入口层节点出发，沿邻接表深度优先遍历，提取 2-3 条典型依赖链（优先经过 core 层节点），每条链长度 3-5 个节点。

#### 3.3.4 §3 关键节点识别

```markdown
## 3. 关键节点识别

### 3.1 Hub 文件（高入度，被 ≥10 个文件依赖）

| 文件路径 | 入度 | 出度 | 导出符号数 | 说明 |
|---|---|---|---|---|
| src/utils/request.ts | 34 | 3 | 5 | HTTP 请求封装，被 34 个文件依赖 |
| src/utils/format.ts | 28 | 0 | 12 | 格式化工具，纯函数模块 |
| src/stores/user.ts | 18 | 6 | 3 | 用户状态管理 |
| src/services/api.ts | 15 | 8 | 10 | API 服务层 |
| src/router/index.ts | 12 | 15 | 1 | 路由配置 |

### 3.2 孤立文件（未被任何文件引用）

| 文件路径 | 说明 |
|---|---|
| src/utils/legacy-format.ts | 疑似废弃文件，无任何引用 |
| src/components/OldHeader.vue | 疑似废弃组件，无任何引用 |
```

实现：

```typescript
lines.push('## 3. 关键节点识别');
lines.push('');

// 3.1 Hub 文件表
lines.push(`### 3.1 Hub 文件（高入度，被 ≥${hubThreshold} 个文件依赖）`);
lines.push('');
lines.push('| 文件路径 | 入度 | 出度 | 导出符号数 | 说明 |');
lines.push('|---|---|---|---|---|');

const hubNodes = Array.from(graph.nodes.values())
  .filter((n) => n.inDegree >= hubThreshold)
  .sort((a, b) => b.inDegree - a.inDegree);

for (const node of hubNodes) {
  const desc = inferNodeDescription(node);
  lines.push(`| ${node.relativePath} | ${node.inDegree} | ${node.outDegree} | ${node.exports.length} | ${desc} |`);
}
lines.push('');

// 3.2 孤立文件表
lines.push('### 3.2 孤立文件（未被任何文件引用）');
lines.push('');
lines.push('| 文件路径 | 说明 |');
lines.push('|---|---|');

const isolatedNodes = layers.isolated
  .map((id) => graph.nodes.get(id))
  .filter((n): n is GraphNode => !!n);

for (const node of isolatedNodes) {
  lines.push(`| ${node.relativePath} | 疑似废弃文件，无任何引用 |`);
}
lines.push('');
```

> **说明**：
> - `inferNodeDescription(node)`：根据节点 `kind` / `role` / `exports` / `relativePath` 推断说明文字。如 `request.ts` → "HTTP 请求封装"，`format.ts` → "格式化工具，纯函数模块"，`user.ts` → "用户状态管理" 等。简化实现：基于文件名与路径关键词推断（如 `request` → HTTP 请求，`format` → 格式化工具，`store` → 状态管理，`api` → API 服务层，`router` → 路由配置）。
> - Hub 文件按 `inDegree` 降序排列。
> - 孤立文件说明统一为"疑似废弃文件，无任何引用"。

#### 3.3.5 §4 循环依赖分析

```markdown
## 4. 循环依赖分析

检测到 3 个循环依赖：

### 4.1 循环 1（2 个文件）

```
src/services/user.ts → src/services/auth.ts → src/services/user.ts
```

**建议**：提取 `src/services/user.ts` 与 `src/services/auth.ts` 的共享依赖到独立模块。

### 4.2 循环 2（3 个文件）

```
src/stores/cart.ts → src/stores/product.ts → src/stores/order.ts → src/stores/cart.ts
```

**建议**：将 store 间的直接依赖改为通过组件层中转，或提取共享接口。
```

实现：

```typescript
lines.push('## 4. 循环依赖分析');
lines.push('');

if (graph.cycles.length === 0) {
  lines.push('未检测到循环依赖。');
  lines.push('');
} else {
  lines.push(`检测到 ${graph.cycles.length} 个循环依赖：`);
  lines.push('');

  graph.cycles.forEach((cycle, idx) => {
    const uniqueNodes = new Set(cycle);
    lines.push(`### 4.${idx + 1} 循环 ${idx + 1}（${uniqueNodes.size} 个文件）`);
    lines.push('');
    lines.push('```');
    const chainStr = cycle
      .map((id) => graph.nodes.get(id)?.relativePath ?? id)
      .join(' → ');
    lines.push(chainStr);
    lines.push('```');
    lines.push('');
    lines.push(`**建议**：${inferCycleSuggestion(cycle, graph)}`);
    lines.push('');
  });
}
```

> **说明**：
> - 循环链中的节点 id 转换为 `relativePath` 输出，用 ` → ` 连接，首尾相同形成闭合链。
> - `inferCycleSuggestion(cycle, graph)`：根据循环链的节点数与节点路径推断拆解建议。简化实现：
>   - 2 节点循环：建议"提取 `{fileA}` 与 `{fileB}` 的共享依赖到独立模块"或"将相互依赖拆分为单向依赖"。
>   - 3+ 节点循环：建议"将 store 间的直接依赖改为通过组件层中转，或提取共享接口"。
>   - 同目录循环：建议"提取同目录模块的共享依赖到独立模块"。
> - 无循环时输出"未检测到循环依赖"。

#### 3.3.6 §5 分层结构推断

```markdown
## 5. 分层结构推断

基于拓扑排序与入度/出度分析，项目可分为 5 层：

| 层级 | 文件数 | 说明 |
|---|---|---|
| 入口层 | 1 | `src/main.ts`（入度=0，出度>0） |
| 核心层 | 5 | Hub 文件（入度≥10），提供服务与工具 |
| 中间层 | 84 | 常规业务文件 |
| 叶子层 | 28 | 组件与视图文件（出度=0，入度>0） |
| 孤立 | 2 | 未被引用的文件 |
```

实现：

```typescript
lines.push('## 5. 分层结构推断');
lines.push('');
lines.push('基于拓扑排序与入度/出度分析，项目可分为 5 层：');
lines.push('');
lines.push('| 层级 | 文件数 | 说明 |');
lines.push('|---|---|---|');
lines.push(`| 入口层 | ${layers.entry.length} | 入度=0，出度>0 的文件 |`);
lines.push(`| 核心层 | ${layers.core.length} | Hub 文件（入度≥${hubThreshold}），提供服务与工具 |`);
lines.push(`| 中间层 | ${layers.middle.length} | 常规业务文件 |`);
lines.push(`| 叶子层 | ${layers.leaf.length} | 组件与视图文件（出度=0，入度>0） |`);
lines.push(`| 孤立 | ${layers.isolated.length} | 未被引用的文件 |`);
lines.push('');
```

> **说明**：分层表含 5 行（入口层 / 核心层 / 中间层 / 叶子层 / 孤立），与设计文档 §7.2 样例一致。文件数总和等于图中节点数。说明列简要描述各层特征。

#### 3.3.7 §6 架构健康度评估

```markdown
## 6. 架构健康度评估

| 指标 | 值 | 评估 |
|---|---|---|
| 循环依赖密度 | 2.5%（3/120） | 中等，建议优先拆解 store 层循环 |
| Hub 文件占比 | 4.2%（5/120） | 正常，核心模块集中度合理 |
| 孤立文件占比 | 1.7%（2/120） | 低，建议清理废弃文件 |
| 平均入度 | 2.4 | 正常 |
| 平均出度 | 2.4 | 正常 |
| 最大入度 | 34（request.ts） | 偏高，该文件为关键依赖，变更影响范围大 |

**总体评估**：项目架构健康度良好，主要风险点为 3 个循环依赖与 1 个高入度 hub 文件（request.ts）。
```

实现：

```typescript
lines.push('## 6. 架构健康度评估');
lines.push('');
lines.push('| 指标 | 值 | 评估 |');
lines.push('|---|---|---|');

const nodeCount = graph.stats.nodeCount || 1;  // 防除零
const cycleDensity = ((graph.stats.cycleCount / nodeCount) * 100).toFixed(1);
const hubRatio = ((graph.stats.hubCount / nodeCount) * 100).toFixed(1);
const isolatedRatio = ((graph.stats.isolatedCount / nodeCount) * 100).toFixed(1);
const avgInDegree = (graph.stats.edgeCount / nodeCount).toFixed(1);
const avgOutDegree = (graph.stats.edgeCount / nodeCount).toFixed(1);

lines.push(`| 循环依赖密度 | ${cycleDensity}%（${graph.stats.cycleCount}/${graph.stats.nodeCount}） | ${assessCycleDensity(graph.stats.cycleCount, nodeCount)} |`);
lines.push(`| Hub 文件占比 | ${hubRatio}%（${graph.stats.hubCount}/${graph.stats.nodeCount}） | ${assessHubRatio(graph.stats.hubCount, nodeCount)} |`);
lines.push(`| 孤立文件占比 | ${isolatedRatio}%（${graph.stats.isolatedCount}/${graph.stats.nodeCount}） | ${assessIsolatedRatio(graph.stats.isolatedCount, nodeCount)} |`);
lines.push(`| 平均入度 | ${avgInDegree} | ${assessAvgDegree(Number(avgInDegree))} |`);
lines.push(`| 平均出度 | ${avgOutDegree} | ${assessAvgDegree(Number(avgOutDegree))} |`);

// 最大入度节点
const maxInNode = Array.from(graph.nodes.values())
  .reduce((max, n) => (n.inDegree > max.inDegree ? n : max), { inDegree: 0, relativePath: '', outDegree: 0 } as GraphNode);
lines.push(`| 最大入度 | ${graph.stats.maxInDegree}（${maxInNode.relativePath}） | ${assessMaxInDegree(graph.stats.maxInDegree, maxInNode.relativePath)} |`);
lines.push('');

// 总体评估
lines.push(`**总体评估**：${generateOverallAssessment(graph)}`);
lines.push('');
```

> **说明**：
> - `assessCycleDensity(count, total)`：循环依赖密度评估。0% → "无循环依赖，架构良好"；<5% → "中等，建议优先拆解 store 层循环"；≥5% → "偏高，建议系统性拆解循环依赖"。
> - `assessHubRatio(count, total)`：Hub 文件占比评估。<10% → "正常，核心模块集中度合理"；10%-20% → "偏高，核心模块可能过度集中"；≥20% → "过高，建议拆分 hub 文件"。
> - `assessIsolatedRatio(count, total)`：孤立文件占比评估。<5% → "低，建议清理废弃文件"；5%-10% → "中等，建议定期清理"；≥10% → "偏高，存在大量废弃代码"。
> - `assessAvgDegree(degree)`：平均入度/出度评估。<3 → "正常"；3-5 → "中等"；>5 → "偏高，依赖关系复杂"。
> - `assessMaxInDegree(degree, path)`：最大入度评估。<20 → "正常"；20-50 → "偏高，该文件为关键依赖，变更影响范围大"；≥50 → "过高，建议拆分该文件"。
> - `generateOverallAssessment(graph)`：综合评估文字，总结主要风险点（循环依赖数、高入度 hub 文件）。

#### 3.3.8 拼接返回

```typescript
return lines.join('\n');
```

### 3.4 `hubThreshold` 参数传递

> `toMarkdown` 与 `writeMarkdown` 需要 `hubThreshold` 参数用于 Hub 文件表标题与分层说明。由于 `Layers` 类型不含 `hubThreshold`，本任务采用以下方案之一：
>
> **方案 A（推荐）**：`toMarkdown` 与 `writeMarkdown` 增加第三个参数 `hubThreshold: number`，由 T10 编排入口传入。
>
> **方案 B**：从 `graph.stats` 反推 `hubThreshold`（不推荐，因为 `stats` 不直接存储 `hubThreshold`）。
>
> 本任务采用**方案 A**，函数签名调整为：
>
> ```typescript
> export function toMarkdown(
>   graph: KnowledgeGraph,
>   layers: Layers,
>   hubThreshold: number,
> ): string
>
> export async function writeMarkdown(
>   graph: KnowledgeGraph,
>   layers: Layers,
>   outputPath: string,
>   hubThreshold: number,
> ): Promise<string>
> ```
>
> > **说明**：执行计划 T8 部分的函数签名未含 `hubThreshold` 参数，本任务根据实现需要补充该参数。T10 编排入口调用时传入 `GraphOptions.hubThreshold ?? 10`。

### 3.5 辅助函数清单

`lib/knowledge-graph/markdown-output.ts` 内部辅助函数（不导出）：

- `formatTimestamp(date: Date): string`：格式化为 `YYYY-MM-DD HH:mm:ss`。
- `detectFramework(graph: KnowledgeGraph): string`：检测框架特征（Vue / TS / React 等）。
- `detectStateManagement(graph: KnowledgeGraph): string | null`：检测状态管理库（Pinia / Vuex），返回格式如 `"Pinia（检测到 N 个 store 文件）"`；未检测到返回 `null`。
- `detectRouter(graph: KnowledgeGraph): string | null`：检测路由库（Vue Router 等），返回格式如 `"Vue Router（检测到 N 个路由文件）"`；未检测到返回 `null`。
- `detectSourceDir(graph: KnowledgeGraph): string`：检测源码目录（如 `src`）。
- `aggregateByDirectory(graph: KnowledgeGraph): Record<string, { count: number }>`：按顶层目录聚合节点数。
- `aggregateByDirectoryDetailed(graph: KnowledgeGraph, layers: Layers): Record<string, { count: number; dependedCount: number; dependCount: number; dominantRole: string }>`：按顶层目录聚合详细统计。
- `mapRoleToChinese(role: NodeRole): string`：将 `NodeRole` 映射为中文名称（`entry` → `入口层`，`core` → `核心层`，`leaf` → `叶子层`，`isolated` → `孤立`，`unknown` → `中间层`），供 `aggregateByDirectoryDetailed` 的 `dominantRole` 字段使用。
- `extractCoreChains(graph: KnowledgeGraph, layers: Layers): string[][]`：提取核心依赖链。
- `inferNodeDescription(node: GraphNode): string`：推断节点说明文字。
- `inferCycleSuggestion(cycle: string[], graph: KnowledgeGraph): string`：推断循环依赖拆解建议。
- `assessCycleDensity(count: number, total: number): string`：循环依赖密度评估。
- `assessHubRatio(count: number, total: number): string`：Hub 文件占比评估。
- `assessIsolatedRatio(count: number, total: number): string`：孤立文件占比评估。
- `assessAvgDegree(degree: number): string`：平均入度/出度评估。
- `assessMaxInDegree(degree: number, path: string): string`：最大入度评估。
- `generateOverallAssessment(graph: KnowledgeGraph): string`：总体评估文字。

### 3.6 实现 `writeMarkdown` 函数

**函数签名**：

```typescript
export async function writeMarkdown(
  graph: KnowledgeGraph,
  layers: Layers,
  outputPath: string,
  hubThreshold: number,
): Promise<string>
```

**实现步骤**：

1. **调用 toMarkdown 生成内容**：

   ```typescript
   const markdown = toMarkdown(graph, layers, hubThreshold);
   ```

2. **确保输出目录存在**：

   ```typescript
   await mkdir(outputPath, { recursive: true });
   ```

3. **写入文件**：

   ```typescript
   const filePath = join(outputPath, 'architecture-summary.md');
   await writeFile(filePath, markdown, 'utf8');
   ```

   > **说明**：输出文件名固定为 `architecture-summary.md`（设计文档 §7.2 与 §9.2 明确要求）。`writeFile` 使用 `utf8` 编码，确保中文字符正确写入。

4. **返回写入的文件路径**：

   ```typescript
   return filePath;
   ```

### 3.7 导出清单

`lib/knowledge-graph/markdown-output.ts` 导出以下符号：

- `toMarkdown`（函数）
- `writeMarkdown`（函数）
- `Layers`（类型，`ReturnType<typeof inferLayers>` 的别名）

---

## 4. 测试计划

### 4.1 单元测试

> 单元测试文件：`tests/knowledge-graph/markdown-output.test.ts`（由 T12 创建，本任务需确保函数可独立测试）。

**`toMarkdown` 测试用例**：

- **TC-M1 中文输出**：`toMarkdown` 返回的字符串为中文（非英文，非 JSON 简单转译），含中文章节标题（如"项目架构概览"、"模块依赖拓扑"等）。
- **TC-M2 6 章节结构**：返回字符串含 6 个 `## ` 开头的章节标题，顺序为：项目架构概览 / 模块依赖拓扑 / 关键节点识别 / 循环依赖分析 / 分层结构推断 / 架构健康度评估。
- **TC-M3 文件头**：返回字符串以 `# 项目知识图谱架构摘要` 开头，含 4 行 `>` 引用块（生成时间、项目路径、项目类型、节点/边/循环/孤立摘要）。
- **TC-M4 §1 项目架构概览**：含框架特征、入口文件数、Hub 文件数、孤立文件数；框架检测正确（含 `.vue` 文件时检测为 Vue）。
- **TC-M5 §2 模块依赖拓扑**：含顶层目录依赖关系表（5 列：目录 / 文件数 / 被依赖次数 / 依赖外部次数 / 角色）与核心依赖链（1-3 条）。
- **TC-M6 §3 关键节点识别**：含 Hub 文件表（5 列：文件路径 / 入度 / 出度 / 导出符号数 / 说明）与孤立文件表（2 列：文件路径 / 说明）。
- **TC-M7 §4 循环依赖分析**：无循环时输出"未检测到循环依赖"；有循环时每个循环含完整链路（` → ` 连接，首尾相同）+ 拆解建议。
- **TC-M8 §5 分层结构推断**：含分层表（3 列：层级 / 文件数 / 说明），5 行（入口层 / 核心层 / 中间层 / 叶子层 / 孤立），文件数总和等于节点数。
- **TC-M9 §6 架构健康度评估**：含指标表（3 列：指标 / 值 / 评估），6 行（循环依赖密度 / Hub 占比 / 孤立占比 / 平均入度 / 平均出度 / 最大入度）+ 总体评估文字。
- **TC-M10 AI 优化格式**：返回字符串为结构化表格 + 判断性文字（非纯数据堆砌），含 Markdown 表格语法（`|---|`）与加粗（`**`）。
- **TC-M11 空图**：`graph.nodes` 为空 Map、`layers` 各数组均为空时，`toMarkdown` 不抛异常；文件头节点数/边数/循环/孤立均为 `0`；§1 架构概览含"共 0 个文件"、架构特征列表各计数为 `0`、框架检测为"未知"；§2 顶层目录表与核心依赖链为空；§3 Hub 文件表与孤立文件表为空（仅表头）；§4 输出"未检测到循环依赖"；§5 分层表各层文件数为 `0`；§6 健康度评估各指标为 `0`或"无"。

> **空图防御性处理说明**：`detectFramework` 在无节点时返回 `'未知'`；`detectSourceDir` 在无节点时返回 `'.'`；`detectStateManagement` / `detectRouter` 在无节点时返回 `null`（不输出对应行）；`aggregateByDirectory` / `aggregateByDirectoryDetailed` 在无节点时返回空对象（表格仅输出表头）；`extractCoreChains` 在无入口节点时返回空数组（核心依赖链部分输出"无典型依赖链"）；`Array.from(graph.nodes.values()).reduce(...)` 已提供初始值 `{ inDegree: 0, relativePath: '', outDegree: 0 }`，空图时不抛异常。
- **TC-M12 hubThreshold 传入**：`toMarkdown(graph, layers, 5)` 后，Hub 文件表标题含"≥5"，分层表核心层说明含"入度≥5"。

**`writeMarkdown` 测试用例**：

- **TC-WM1 文件写入**：`writeMarkdown` 后，`<outputPath>/architecture-summary.md` 文件存在。
- **TC-WM2 文件内容**：文件内容为中文 Markdown，含 6 个章节标题。
- **TC-WM3 返回值**：`writeMarkdown` 返回写入的文件路径（`<outputPath>/architecture-summary.md`）。
- **TC-WM4 目录自动创建**：`outputPath` 目录不存在时，`writeMarkdown` 自动创建多级目录。
- **TC-WM5 UTF-8 编码**：文件内容含中文，读取后不乱码。
- **TC-WM6 hubThreshold 传入**：`writeMarkdown(graph, layers, outputPath, 5)` 不抛异常，文件内容含"≥5"。

### 4.2 集成测试 / 端到端测试

> 由 T12 在 `tests/knowledge-graph/integration.test.ts` 中覆盖，本任务不涉及。

- **simple-project 夹具端到端**：`shield graph --project simple-project --format md` 后，`<outputPath>/architecture-summary.md` 文件存在且为中文 Markdown，含 6 个章节。
- **cycle-project 夹具端到端**：Markdown 的 §4 循环依赖分析含 `a → b → a` 与 `c → d → e → c` 两个循环链。
- **monorepo-project 夹具端到端**：Markdown 的文件头含"项目类型：monorepo 项目"。

### 4.3 回归测试

- 本任务为新增模块 `lib/knowledge-graph/markdown-output.ts`，不修改任何既有文件，对 v1.1 ~ v1.4 无回归影响。
- T12 回归测试要求 `pnpm test` 全量通过，本任务需确保新增模块不引入编译/类型错误。

---

## 5. 风险与依赖

| 风险 / 依赖 | 影响 | 应对措施 |
|---|---|---|
| Markdown 章节结构与设计文档 §7.2 样例不一致 | AI 消费效果不佳 | TC-M2 显式校验 6 章节标题与顺序；严格遵循设计文档 §7.2 样例 |
| 中文输出含英文或 JSON 转译 | 不符合 REQ-1.5-9 | TC-M1 显式校验中文输出；所有章节标题、表头、说明文字均使用中文 |
| `detectFramework` 检测不准确 | §1 架构概览描述错误 | 基于节点 `kind` 字段检测（`.vue` → Vue，`.ts`/`.tsx` → TypeScript）；简化实现，不依赖 package.json |
| `extractCoreChains` 依赖链提取失败 | §2 核心依赖链为空 | 从入口层节点出发沿邻接表 DFS，优先经过 core 层节点；若无入口节点，从 inDegree 最小的节点出发 |
| `inferNodeDescription` / `inferCycleSuggestion` 推断文字生硬 | AI 消费效果不佳 | 基于文件名与路径关键词推断，覆盖常见命名（request / format / store / api / router 等）；T12 测试阶段在真实 LLM 上验证效果 |
| `hubThreshold` 参数未传入 | Hub 文件表标题与分层说明缺失 | 函数签名显式要求 `hubThreshold` 参数；T10 编排入口保证传入（默认 10） |
| `writeMarkdown` 目录创建失败 | 文件写入失败 | `mkdir` 使用 `recursive: true`；TC-WM4 覆盖目录不存在场景 |
| `writeMarkdown` 文件编码非 UTF-8 | 中文乱码 | `writeFile` 显式传入 `'utf8'` 编码；TC-WM5 覆盖中文场景 |
| 大规模图（5000 文件）Markdown 生成性能 | 生成耗时长 | 辅助函数均为 O(n) 或 O(n log n) 复杂度；表格行数限制（如 Hub 文件表仅展示 top 20）；T12 性能基线测试验证 |

---

## 6. 变更范围

- **本任务范围内**：
  - 新增 `lib/knowledge-graph/markdown-output.ts`，实现 `toMarkdown` / `writeMarkdown` / `Layers` 类型及辅助函数。
- **不在本任务范围内**：
  - `lib/knowledge-graph/types.ts` 类型定义（由 T1 负责）；
  - `lib/knowledge-graph/analyzer.ts` 图谱分析（由 T6 负责，本任务消费 `analyzeGraph` 后的 `KnowledgeGraph` 与 `inferLayers` 产出的分层结构）；
  - `inferLayers` 函数实现（由 T6 负责，本任务仅消费其返回类型）；
  - 输出路径的 CLI 参数解析与默认值传递（由 T10 / T11 负责）；
  - 测试夹具与测试用例（由 T12 负责）；
  - **不修改任何既有文件**（本任务仅消费 T1 / T6 产出的类型与结构）。

---

## 7. 评审记录

| 轮次 | 日期 | 结论 | P0/P1 问题 | 修复方案 |
|---|---|---|---|---|
| 1 | 2026-06-23 | 修改后通过 | P1：§3.3 函数签名 `toMarkdown(graph, layers)` 缺少 `hubThreshold` 参数，与 §3.4 方案 A 不一致；P2：§3.3.6 样例与实现均写"4 层"但表格含 5 行（含孤立）；§1 架构特征列表缺少状态管理/路由检测行（与样例不一致）；`aggregateByDirectoryDetailed` 的 `dominantRole` 缺少 `NodeRole` → 中文名称映射函数；TC-M11 空图测试缺少具体断言与防御性处理说明 | P1：§3.3 函数签名统一为 `toMarkdown(graph, layers, hubThreshold)` 并补充修复说明；P2：样例与实现文案改为"5 层"；架构特征列表增加 `detectStateManagement` / `detectRouter` 调用与说明；辅助函数清单增加 `mapRoleToChinese` 函数并补充 `NodeRole` import；TC-M11 补充各章节空图断言与防御性处理说明 |
