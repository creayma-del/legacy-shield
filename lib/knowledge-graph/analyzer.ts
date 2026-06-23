import type {
  KnowledgeGraph,
  GraphNode,
  NodeRole,
} from './types.js';

export function analyzeGraph(
  graph: KnowledgeGraph,
  hubThreshold: number,
): KnowledgeGraph {
  // 统一计算 isEntry
  for (const node of graph.nodes.values()) {
    node.isEntry = node.inDegree === 0 && node.outDegree > 0;
  }

  // 计算 role 分类
  for (const node of graph.nodes.values()) {
    node.role = inferRole(node, hubThreshold);
  }

  // 填充 GraphStats 完整字段
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

  return graph;
}

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
