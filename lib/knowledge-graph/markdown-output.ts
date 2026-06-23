import type { KnowledgeGraph, GraphNode, NodeRole } from './types.js';
import { inferLayers } from './analyzer.js';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

/** inferLayers 返回类型别名，供 toMarkdown / writeMarkdown 参数声明使用 */
export type Layers = ReturnType<typeof inferLayers>;

// ============================================================================
// toMarkdown：生成中文 AI 优化格式的 Markdown 架构摘要
// ============================================================================

/**
 * 生成中文 Markdown 架构摘要，严格遵循设计文档 §7.2 定义的 6 章节结构。
 *
 * @param graph 完整的 KnowledgeGraph（analyzeGraph 后）
 * @param layers inferLayers 产出的分层结构
 * @param hubThreshold hub 文件入度阈值
 * @returns 中文 Markdown 字符串
 */
export function toMarkdown(
  graph: KnowledgeGraph,
  layers: Layers,
  hubThreshold: number,
): string {
  const lines: string[] = [];

  // 文件头
  lines.push('# 项目知识图谱架构摘要');
  lines.push('');
  lines.push(`> 生成时间：${formatTimestamp(new Date())}`);
  lines.push(`> 项目路径：${graph.projectRoot}`);
  lines.push(`> 项目类型：${graph.isMonorepo ? 'monorepo 项目' : '单包项目'}`);
  lines.push(`> 节点数：${graph.stats.nodeCount} | 边数：${graph.stats.edgeCount} | 循环依赖：${graph.stats.cycleCount} | 孤立文件：${graph.stats.isolatedCount}`);
  lines.push('');

  // §1 项目架构概览
  buildSection1(lines, graph, layers, hubThreshold);

  // §2 模块依赖拓扑
  buildSection2(lines, graph, layers);

  // §3 关键节点识别
  buildSection3(lines, graph, layers, hubThreshold);

  // §4 循环依赖分析
  buildSection4(lines, graph);

  // §5 分层结构推断
  buildSection5(lines, layers, hubThreshold);

  // §6 架构健康度评估
  buildSection6(lines, graph);

  return lines.join('\n');
}

// ============================================================================
// §1 项目架构概览
// ============================================================================

function buildSection1(
  lines: string[],
  graph: KnowledgeGraph,
  layers: Layers,
  hubThreshold: number,
): void {
  lines.push('## 1. 项目架构概览');
  lines.push('');

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
}

// ============================================================================
// §2 模块依赖拓扑
// ============================================================================

function buildSection2(
  lines: string[],
  graph: KnowledgeGraph,
  layers: Layers,
): void {
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
  if (chains.length === 0) {
    lines.push('无典型依赖链。');
  } else {
    chains.slice(0, 3).forEach((chain, idx) => {
      const chainStr = chain
        .map((id) => `\`${graph.nodes.get(id)?.relativePath ?? id}\``)
        .join(' → ');
      lines.push(`${idx + 1}. ${chainStr}`);
    });
  }
  lines.push('');
}

// ============================================================================
// §3 关键节点识别
// ============================================================================

function buildSection3(
  lines: string[],
  graph: KnowledgeGraph,
  layers: Layers,
  hubThreshold: number,
): void {
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
}

// ============================================================================
// §4 循环依赖分析
// ============================================================================

function buildSection4(
  lines: string[],
  graph: KnowledgeGraph,
): void {
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
}

// ============================================================================
// §5 分层结构推断
// ============================================================================

function buildSection5(
  lines: string[],
  layers: Layers,
  hubThreshold: number,
): void {
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
}

// ============================================================================
// §6 架构健康度评估
// ============================================================================

function buildSection6(
  lines: string[],
  graph: KnowledgeGraph,
): void {
  lines.push('## 6. 架构健康度评估');
  lines.push('');
  lines.push('| 指标 | 值 | 评估 |');
  lines.push('|---|---|---|');

  const nodeCount = graph.stats.nodeCount || 1; // 防除零
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
  const maxInNode = Array.from(graph.nodes.values()).reduce(
    (max, n) => (n.inDegree > max.inDegree ? n : max),
    { inDegree: 0, relativePath: '', outDegree: 0 } as GraphNode,
  );
  lines.push(`| 最大入度 | ${graph.stats.maxInDegree}（${maxInNode.relativePath}） | ${assessMaxInDegree(graph.stats.maxInDegree)} |`);
  lines.push('');

  // 总体评估
  lines.push(`**总体评估**：${generateOverallAssessment(graph)}`);
  lines.push('');
}

// ============================================================================
// 辅助函数
// ============================================================================

/** 格式化时间为 YYYY-MM-DD HH:mm:ss（本地时间） */
function formatTimestamp(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/** 检测框架特征（Vue / TypeScript / React 等） */
function detectFramework(graph: KnowledgeGraph): string {
  if (graph.nodes.size === 0) return '未知';
  const kinds = new Set<string>();
  for (const node of graph.nodes.values()) {
    kinds.add(node.kind);
  }
  const parts: string[] = [];
  if (kinds.has('vue')) parts.push('Vue 3');
  if (kinds.has('ts') || kinds.has('tsx')) parts.push('TypeScript');
  else if (kinds.has('js') || kinds.has('jsx')) parts.push('JavaScript');
  if (kinds.has('tsx') || kinds.has('jsx')) {
    // 含 jsx/tsx 但无 vue，可能是 React
    if (!kinds.has('vue')) {
      const hasReact = Array.from(graph.nodes.values()).some(
        (n) => n.exports.includes('jsx') || n.relativePath.includes('react'),
      );
      if (hasReact) parts.push('React');
    }
  }
  return parts.length > 0 ? parts.join(' + ') : '未知';
}

/** 检测状态管理库（Pinia / Vuex） */
function detectStateManagement(graph: KnowledgeGraph): string | null {
  if (graph.nodes.size === 0) return null;
  let piniaCount = 0;
  let vuexCount = 0;
  for (const node of graph.nodes.values()) {
    const pathLower = node.relativePath.toLowerCase();
    if (node.exports.includes('defineStore') || pathLower.includes('store')) {
      piniaCount++;
    }
    if (node.exports.includes('createStore') && pathLower.includes('store')) {
      vuexCount++;
    }
  }
  if (piniaCount > 0) {
    return `Pinia（检测到 ${piniaCount} 个 store 文件）`;
  }
  if (vuexCount > 0) {
    return `Vuex（检测到 ${vuexCount} 个 store 文件）`;
  }
  return null;
}

/** 检测路由库（Vue Router 等） */
function detectRouter(graph: KnowledgeGraph): string | null {
  if (graph.nodes.size === 0) return null;
  let routerCount = 0;
  for (const node of graph.nodes.values()) {
    const pathLower = node.relativePath.toLowerCase();
    if (node.exports.includes('createRouter') || pathLower.includes('router')) {
      routerCount++;
    }
  }
  if (routerCount > 0) {
    return `Vue Router（检测到 ${routerCount} 个路由文件）`;
  }
  return null;
}

/** 检测源码目录（如 src） */
function detectSourceDir(graph: KnowledgeGraph): string {
  if (graph.nodes.size === 0) return '.';
  const topDirs = new Set<string>();
  for (const node of graph.nodes.values()) {
    const firstSlash = node.relativePath.indexOf('/');
    if (firstSlash > 0) {
      topDirs.add(node.relativePath.slice(0, firstSlash));
    }
  }
  if (topDirs.has('src')) return 'src';
  if (topDirs.size > 0) return Array.from(topDirs)[0];
  return '.';
}

/** 按顶层目录聚合节点数 */
function aggregateByDirectory(graph: KnowledgeGraph): Record<string, { count: number }> {
  const result: Record<string, { count: number }> = {};
  for (const node of graph.nodes.values()) {
    const firstSlash = node.relativePath.indexOf('/');
    const dir = firstSlash > 0 ? node.relativePath.slice(0, firstSlash) : node.relativePath;
    if (!result[dir]) result[dir] = { count: 0 };
    result[dir].count++;
  }
  return result;
}

/** 按顶层目录聚合详细统计 */
function aggregateByDirectoryDetailed(
  graph: KnowledgeGraph,
  layers: Layers,
): Record<string, { count: number; dependedCount: number; dependCount: number; dominantRole: string }> {
  const result: Record<string, {
    count: number;
    dependedCount: number;
    dependCount: number;
    dominantRole: string;
  }> = {};

  // 构建节点 id → 层级映射
  const layerOf = new Map<string, NodeRole>();
  for (const id of layers.entry) layerOf.set(id, 'entry');
  for (const id of layers.core) layerOf.set(id, 'core');
  for (const id of layers.leaf) layerOf.set(id, 'leaf');
  for (const id of layers.isolated) layerOf.set(id, 'isolated');
  // middle 层的节点 role 为 unknown
  for (const id of layers.middle) layerOf.set(id, 'unknown');

  for (const node of graph.nodes.values()) {
    const firstSlash = node.relativePath.indexOf('/');
    const dir = firstSlash > 0 ? node.relativePath.slice(0, firstSlash) : node.relativePath;
    if (!result[dir]) {
      result[dir] = { count: 0, dependedCount: 0, dependCount: 0, dominantRole: '中间层' };
    }
    result[dir].count++;
    result[dir].dependedCount += node.inDegree;
    result[dir].dependCount += node.outDegree;
  }

  // 计算每个目录的主导角色
  for (const dir of Object.keys(result)) {
    const roleCount: Record<string, number> = {};
    for (const node of graph.nodes.values()) {
      const firstSlash = node.relativePath.indexOf('/');
      const nodeDir = firstSlash > 0 ? node.relativePath.slice(0, firstSlash) : node.relativePath;
      if (nodeDir !== dir) continue;
      const role = layerOf.get(node.id) ?? 'unknown';
      const chineseRole = mapRoleToChinese(role);
      roleCount[chineseRole] = (roleCount[chineseRole] ?? 0) + 1;
    }
    // 取数量最多的角色
    const sortedRoles = Object.entries(roleCount).sort((a, b) => b[1] - a[1]);
    if (sortedRoles.length > 0) {
      result[dir].dominantRole = sortedRoles[0][0];
    }
  }

  return result;
}

/** 将 NodeRole 映射为中文名称 */
function mapRoleToChinese(role: NodeRole): string {
  switch (role) {
    case 'entry':
      return '入口层';
    case 'core':
      return '核心层';
    case 'leaf':
      return '叶子层';
    case 'isolated':
      return '孤立';
    case 'unknown':
      return '中间层';
    default:
      return '中间层';
  }
}

/** 提取核心依赖链：从入口层节点出发，沿邻接表 DFS，优先经过 core 层节点 */
function extractCoreChains(graph: KnowledgeGraph, layers: Layers): string[][] {
  const chains: string[][] = [];
  const coreSet = new Set(layers.core);
  const entryNodes = layers.entry;

  // 若无入口节点，从 inDegree 最小的节点出发
  const startNodes = entryNodes.length > 0
    ? entryNodes
    : Array.from(graph.nodes.values())
        .sort((a, b) => a.inDegree - b.inDegree)
        .slice(0, 1)
        .map((n) => n.id);

  for (const start of startNodes) {
    if (chains.length >= 3) break;
    const chain = dfsChain(start, graph, coreSet, new Set<string>(), 0);
    if (chain.length >= 2) {
      chains.push(chain);
    }
  }

  return chains;
}

/** DFS 提取依赖链，优先经过 core 层节点，链长度 3-5 */
function dfsChain(
  nodeId: string,
  graph: KnowledgeGraph,
  coreSet: Set<string>,
  visited: Set<string>,
  depth: number,
): string[] {
  if (visited.has(nodeId)) return [];
  if (depth >= 5) return [nodeId];

  visited.add(nodeId);
  const neighbors = graph.adjacency.get(nodeId) ?? [];

  // 优先选择 core 层节点
  const sortedNeighbors = neighbors.sort((a, b) => {
    const aCore = coreSet.has(a) ? 0 : 1;
    const bCore = coreSet.has(b) ? 0 : 1;
    return aCore - bCore;
  });

  for (const neighbor of sortedNeighbors) {
    if (!visited.has(neighbor)) {
      const subChain = dfsChain(neighbor, graph, coreSet, new Set(visited), depth + 1);
      if (subChain.length > 0) {
        return [nodeId, ...subChain];
      }
    }
  }

  return [nodeId];
}

/** 推断节点说明文字 */
function inferNodeDescription(node: GraphNode): string {
  const path = node.relativePath.toLowerCase();
  const name = path.split('/').pop() ?? '';

  if (name.includes('request') || name.includes('http') || name.includes('api')) {
    return node.outDegree > 0 ? 'API 服务层' : 'HTTP 请求封装';
  }
  if (name.includes('format') || name.includes('util') || name.includes('helper')) {
    return '工具函数，纯函数模块';
  }
  if (name.includes('store') || name.includes('state')) {
    return '状态管理';
  }
  if (name.includes('router') || name.includes('route')) {
    return '路由配置';
  }
  if (name.includes('component') || name.includes('widget')) {
    return '组件模块';
  }
  if (name.includes('config')) {
    return '配置文件';
  }
  if (name.includes('type') || name.includes('interface')) {
    return '类型定义';
  }
  return '业务模块';
}

/** 推断循环依赖拆解建议 */
function inferCycleSuggestion(cycle: string[], graph: KnowledgeGraph): string {
  const uniqueNodes = new Set(cycle);
  const nodeCount = uniqueNodes.size;

  // 获取循环节点的相对路径
  const paths = cycle
    .map((id) => graph.nodes.get(id)?.relativePath ?? id)
    .filter((p, idx, arr) => arr.indexOf(p) === idx); // 去重

  // 检查是否同目录
  const dirs = new Set(
    paths.map((p) => {
      const lastSlash = p.lastIndexOf('/');
      return lastSlash > 0 ? p.slice(0, lastSlash) : p;
    }),
  );

  if (nodeCount === 2) {
    if (dirs.size === 1) {
      return `提取同目录模块的共享依赖到独立模块，或将相互依赖拆分为单向依赖。`;
    }
    return `提取 ${paths[0]} 与 ${paths[1]} 的共享依赖到独立模块。`;
  }

  if (dirs.size === 1) {
    return `提取同目录模块的共享依赖到独立模块，减少直接相互引用。`;
  }

  return `将模块间的直接依赖改为通过上层中转，或提取共享接口到独立模块。`;
}

/** 循环依赖密度评估 */
function assessCycleDensity(count: number, total: number): string {
  if (count === 0) return '无循环依赖，架构良好';
  const ratio = (count / total) * 100;
  if (ratio < 5) return '中等，建议优先拆解 store 层循环';
  return '偏高，建议系统性拆解循环依赖';
}

/** Hub 文件占比评估 */
function assessHubRatio(count: number, total: number): string {
  if (count === 0) return '无 hub 文件';
  const ratio = (count / total) * 100;
  if (ratio < 10) return '正常，核心模块集中度合理';
  if (ratio <= 20) return '偏高，核心模块可能过度集中';
  return '过高，建议拆分 hub 文件';
}

/** 孤立文件占比评估 */
function assessIsolatedRatio(count: number, total: number): string {
  if (count === 0) return '无孤立文件';
  const ratio = (count / total) * 100;
  if (ratio < 5) return '低，建议清理废弃文件';
  if (ratio <= 10) return '中等，建议定期清理';
  return '偏高，存在大量废弃代码';
}

/** 平均入度/出度评估 */
function assessAvgDegree(degree: number): string {
  if (degree < 3) return '正常';
  if (degree <= 5) return '中等';
  return '偏高，依赖关系复杂';
}

/** 最大入度评估 */
function assessMaxInDegree(degree: number): string {
  if (degree === 0) return '无';
  if (degree < 20) return '正常';
  if (degree <= 50) return `偏高，该文件为关键依赖，变更影响范围大`;
  return `过高，建议拆分该文件`;
}

/** 总体评估文字 */
function generateOverallAssessment(graph: KnowledgeGraph): string {
  const risks: string[] = [];
  if (graph.stats.cycleCount > 0) {
    risks.push(`${graph.stats.cycleCount} 个循环依赖`);
  }
  if (graph.stats.hubCount > 0) {
    const maxHubNode = Array.from(graph.nodes.values())
      .filter((n) => n.inDegree >= 10)
      .sort((a, b) => b.inDegree - a.inDegree)[0];
    if (maxHubNode) {
      risks.push(`高入度 hub 文件（${maxHubNode.relativePath}）`);
    }
  }
  if (graph.stats.isolatedCount > 0) {
    risks.push(`${graph.stats.isolatedCount} 个孤立文件`);
  }

  if (risks.length === 0) {
    return '项目架构健康度良好，未检测到明显风险点。';
  }

  return `项目架构健康度良好，主要风险点为 ${risks.join('与')}。`;
}

// ============================================================================
// writeMarkdown：写入 Markdown 文件
// ============================================================================

/**
 * 将 toMarkdown 结果写入 <outputPath>/architecture-summary.md 文件。
 * @returns 写入的文件路径
 */
export async function writeMarkdown(
  graph: KnowledgeGraph,
  layers: Layers,
  outputPath: string,
  hubThreshold: number,
): Promise<string> {
  const markdown = toMarkdown(graph, layers, hubThreshold);
  await mkdir(outputPath, { recursive: true });
  const filePath = join(outputPath, 'architecture-summary.md');
  await writeFile(filePath, markdown, 'utf8');
  return filePath;
}
