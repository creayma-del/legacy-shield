import { describe, it, expect } from 'vitest';
import { analyzeGraph, inferLayers } from '../../lib/knowledge-graph/analyzer.js';
import type { KnowledgeGraph, GraphNode, GraphEdge } from '../../lib/knowledge-graph/types.js';

/**
 * 构建最小可测的 KnowledgeGraph，仅填充 analyzeGraph / inferLayers 依赖的字段。
 * 节点的 inDegree / outDegree 由调用方指定，role / isEntry 初始为占位值。
 */
function makeGraph(
  nodes: Array<{ id: string; inDegree: number; outDegree: number }>,
  edges: Array<GraphEdge> = [],
): KnowledgeGraph {
  const nodeMap = new Map<string, GraphNode>();
  for (const n of nodes) {
    nodeMap.set(n.id, {
      id: n.id,
      relativePath: n.id,
      kind: 'ts',
      role: 'unknown',
      inDegree: n.inDegree,
      outDegree: n.outDegree,
      exports: [],
      isEntry: false,
      packageName: null,
    });
  }
  return {
    projectRoot: '/proj',
    isMonorepo: false,
    packages: [],
    nodes: nodeMap,
    adjacency: new Map(),
    reverseAdjacency: new Map(),
    edges,
    cycles: [],
    stats: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      cycleCount: 0,
      componentCount: 0,
      hubCount: 0,
      isolatedCount: 0,
      entryCount: 0,
      unresolvedEdgeCount: 0,
      maxInDegree: 0,
      maxOutDegree: 0,
    },
  };
}

describe('analyzeGraph', () => {
  it('TC-ANA-1: hub 识别（阈值边界，默认 10）', () => {
    const graph = makeGraph([
      { id: 'hub', inDegree: 10, outDegree: 1 },
      { id: 'notHub', inDegree: 9, outDegree: 1 },
    ]);
    analyzeGraph(graph, 10);
    expect(graph.nodes.get('hub')!.role).toBe('core');
    expect(graph.nodes.get('notHub')!.role).not.toBe('core');
  });

  it('TC-ANA-2: hub 阈值可配置（hubThreshold=5）', () => {
    const graph = makeGraph([
      { id: 'hub5', inDegree: 5, outDegree: 1 },
      { id: 'notHub5', inDegree: 4, outDegree: 1 },
    ]);
    analyzeGraph(graph, 5);
    expect(graph.nodes.get('hub5')!.role).toBe('core');
    expect(graph.nodes.get('notHub5')!.role).not.toBe('core');
  });

  it('TC-ANA-3: 孤立文件识别（入度=0 且出度=0）', () => {
    const graph = makeGraph([
      { id: 'isolated', inDegree: 0, outDegree: 0 },
    ]);
    analyzeGraph(graph, 10);
    expect(graph.nodes.get('isolated')!.role).toBe('isolated');
  });

  it('TC-ANA-4: 入口文件识别（入度=0 且出度>0）', () => {
    const graph = makeGraph([
      { id: 'entry', inDegree: 0, outDegree: 2 },
    ]);
    analyzeGraph(graph, 10);
    const node = graph.nodes.get('entry')!;
    expect(node.isEntry).toBe(true);
    expect(node.role).toBe('entry');
  });

  it('TC-ANA-5: 叶子文件识别（出度=0 且入度>0）', () => {
    const graph = makeGraph([
      { id: 'leaf', inDegree: 3, outDegree: 0 },
    ]);
    analyzeGraph(graph, 10);
    expect(graph.nodes.get('leaf')!.role).toBe('leaf');
  });

  it('TC-ANA-6: isEntry 统一计算（图构建完成后统一设置）', () => {
    // 构建一个入口节点（入度=0 出度>0）和一个非入口节点
    const graph = makeGraph([
      { id: 'entry', inDegree: 0, outDegree: 1 },
      { id: 'middle', inDegree: 1, outDegree: 1 },
      { id: 'leaf', inDegree: 1, outDegree: 0 },
    ]);
    // 调用前 isEntry 全为 false（buildGraph 初始状态）
    for (const node of graph.nodes.values()) {
      expect(node.isEntry).toBe(false);
    }
    analyzeGraph(graph, 10);
    // 调用后仅 entry 节点 isEntry=true
    expect(graph.nodes.get('entry')!.isEntry).toBe(true);
    expect(graph.nodes.get('middle')!.isEntry).toBe(false);
    expect(graph.nodes.get('leaf')!.isEntry).toBe(false);
  });

  it('TC-ANA-7: 分层推断（inferLayers 返回 5 个数组）', () => {
    const graph = makeGraph([
      { id: 'entry', inDegree: 0, outDegree: 2 },
      { id: 'core', inDegree: 10, outDegree: 1 },
      { id: 'middle', inDegree: 2, outDegree: 1 },
      { id: 'leaf', inDegree: 1, outDegree: 0 },
      { id: 'isolated', inDegree: 0, outDegree: 0 },
    ]);
    const layers = inferLayers(graph, 10);
    expect(Array.isArray(layers.entry)).toBe(true);
    expect(Array.isArray(layers.core)).toBe(true);
    expect(Array.isArray(layers.middle)).toBe(true);
    expect(Array.isArray(layers.leaf)).toBe(true);
    expect(Array.isArray(layers.isolated)).toBe(true);
    // 节点总数等于图中节点数
    const total =
      layers.entry.length +
      layers.core.length +
      layers.middle.length +
      layers.leaf.length +
      layers.isolated.length;
    expect(total).toBe(graph.nodes.size);
    // 各层包含正确节点
    expect(layers.entry).toContain('entry');
    expect(layers.core).toContain('core');
    expect(layers.middle).toContain('middle');
    expect(layers.leaf).toContain('leaf');
    expect(layers.isolated).toContain('isolated');
  });

  it('TC-ANA-8: GraphStats 填充（hubCount + isolatedCount + entryCount 一致）', () => {
    const graph = makeGraph([
      { id: 'hub1', inDegree: 10, outDegree: 1 },
      { id: 'hub2', inDegree: 15, outDegree: 0 },
      { id: 'entry1', inDegree: 0, outDegree: 1 },
      { id: 'entry2', inDegree: 0, outDegree: 2 },
      { id: 'isolated1', inDegree: 0, outDegree: 0 },
      { id: 'isolated2', inDegree: 0, outDegree: 0 },
      { id: 'leaf1', inDegree: 1, outDegree: 0 },
    ]);
    analyzeGraph(graph, 10);
    expect(graph.stats.hubCount).toBe(2);
    expect(graph.stats.isolatedCount).toBe(2);
    expect(graph.stats.entryCount).toBe(2);
  });

  it('TC-ANA-9: maxInDegree / maxOutDegree（所有节点的最大入度/出度）', () => {
    const graph = makeGraph([
      { id: 'a', inDegree: 3, outDegree: 5 },
      { id: 'b', inDegree: 7, outDegree: 2 },
      { id: 'c', inDegree: 1, outDegree: 9 },
    ]);
    analyzeGraph(graph, 10);
    expect(graph.stats.maxInDegree).toBe(7);
    expect(graph.stats.maxOutDegree).toBe(9);
  });

  it('TC-ANA-10: unresolvedEdgeCount（edges 中 unresolved === true 的边数）', () => {
    const edges: GraphEdge[] = [
      { from: 'a', to: 'b', kind: 'import', symbols: [], unresolved: false, rawSpec: './b' },
      { from: 'a', to: 'c', kind: 'dynamic-import', symbols: [], unresolved: true, rawSpec: '<dynamic>' },
      { from: 'b', to: 'd', kind: 'require', symbols: [], unresolved: true, rawSpec: '<dynamic>' },
    ];
    const graph = makeGraph(
      [
        { id: 'a', inDegree: 0, outDegree: 2 },
        { id: 'b', inDegree: 1, outDegree: 1 },
        { id: 'c', inDegree: 1, outDegree: 0 },
        { id: 'd', inDegree: 1, outDegree: 0 },
      ],
      edges,
    );
    analyzeGraph(graph, 10);
    expect(graph.stats.unresolvedEdgeCount).toBe(2);
  });
});
