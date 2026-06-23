import { describe, it, expect } from 'vitest';
import { buildGraph, detectCycles, computeComponents } from '../../lib/knowledge-graph/graph.js';
import type { CollectedFile } from '../../lib/knowledge-graph/collector.js';
import { ModuleResolver } from '../../lib/knowledge-graph/resolver.js';

function makeCollected(
  entries: Record<string, CollectedFile>,
): Map<string, CollectedFile> {
  const map = new Map<string, CollectedFile>();
  for (const [k, v] of Object.entries(entries)) {
    map.set(k, v);
  }
  return map;
}

const noopResolver = new ModuleResolver({ projectRoot: '/proj' });

describe('buildGraph', () => {
  it('TC-GRAPH-1: 邻接表构建', () => {
    const collected = makeCollected({
      '/proj/src/a.ts': { dependencies: [{ spec: './b', kind: 'import', symbols: [], unresolved: false, line: 1 }], exports: [] },
      '/proj/src/b.ts': { dependencies: [], exports: [] },
    });
    const graph = buildGraph('/proj', collected, noopResolver);
    expect(graph.nodes.size).toBe(2);
    expect(graph.adjacency).toBeDefined();
    expect(graph.reverseAdjacency).toBeDefined();
    expect(graph.edges).toBeDefined();
  });

  it('TC-GRAPH-2: 反向邻接表同步填充', () => {
    const collected = makeCollected({
      '/proj/src/a.ts': { dependencies: [{ spec: './b', kind: 'import', symbols: [], unresolved: false, line: 1 }], exports: [] },
      '/proj/src/b.ts': { dependencies: [], exports: [] },
    });
    // 使用能解析 ./b 到 /proj/src/b.ts 的 resolver
    const resolver = {
      resolve: (spec: string, importer: string) => {
        if (spec === './b' && importer === '/proj/src/a.ts') return '/proj/src/b.ts';
        return null;
      },
    };
    const graph = buildGraph('/proj', collected, resolver);
    // 正向邻接表
    expect(graph.adjacency.get('/proj/src/a.ts')).toContain('/proj/src/b.ts');
    // 反向邻接表
    expect(graph.reverseAdjacency.get('/proj/src/b.ts')).toContain('/proj/src/a.ts');
  });

  it('TC-GRAPH-10: 边列表构建', () => {
    const collected = makeCollected({
      '/proj/src/a.ts': { dependencies: [{ spec: './b', kind: 'import', symbols: ['foo'], unresolved: false, line: 1 }], exports: [] },
      '/proj/src/b.ts': { dependencies: [], exports: [] },
    });
    const resolver = {
      resolve: () => '/proj/src/b.ts',
    };
    const graph = buildGraph('/proj', collected, resolver);
    expect(graph.edges.length).toBe(1);
    const edge = graph.edges[0];
    expect(edge.from).toBe('/proj/src/a.ts');
    expect(edge.to).toBe('/proj/src/b.ts');
    expect(edge.kind).toBe('import');
    expect(edge.symbols).toEqual(['foo']);
    expect(edge.unresolved).toBe(false);
    expect(edge.rawSpec).toBe('./b');
  });
});

describe('detectCycles', () => {
  it('TC-GRAPH-3: 2 节点循环检测', () => {
    const adjacency = new Map<string, string[]>([
      ['a', ['b']],
      ['b', ['a']],
    ]);
    const cycles = detectCycles(adjacency);
    expect(cycles.length).toBe(1);
    // 循环链应包含 a 和 b
    const cycle = cycles[0];
    expect(cycle).toContain('a');
    expect(cycle).toContain('b');
  });

  it('TC-GRAPH-4: 3 节点循环检测', () => {
    const adjacency = new Map<string, string[]>([
      ['a', ['b']],
      ['b', ['c']],
      ['c', ['a']],
    ]);
    const cycles = detectCycles(adjacency);
    expect(cycles.length).toBe(1);
    const cycle = cycles[0];
    expect(cycle).toContain('a');
    expect(cycle).toContain('b');
    expect(cycle).toContain('c');
  });

  it('TC-GRAPH-5: 无环图', () => {
    const adjacency = new Map<string, string[]>([
      ['a', ['b']],
      ['b', ['c']],
      ['c', []],
    ]);
    const cycles = detectCycles(adjacency);
    expect(cycles).toEqual([]);
  });

  it('TC-GRAPH-6: 循环去重', () => {
    const adjacency = new Map<string, string[]>([
      ['a', ['b']],
      ['b', ['a']],
    ]);
    const cycles = detectCycles(adjacency);
    // 无论从 a 还是 b 开始 DFS，去重后仅保留 1 条
    expect(cycles.length).toBe(1);
  });
});

describe('computeComponents', () => {
  it('TC-GRAPH-7: 连通分量计算', () => {
    const nodeIds = ['a', 'b', 'c', 'd'];
    const edges = [
      { from: 'a', to: 'b' },
      { from: 'c', to: 'd' },
    ];
    const { componentCount } = computeComponents(nodeIds, edges);
    expect(componentCount).toBe(2);
  });

  it('TC-GRAPH-8: 路径压缩（find 带路径压缩）', () => {
    // 验证路径压缩后，查找效率提升（间接验证：多次 find 结果一致）
    const nodeIds = ['a', 'b', 'c', 'd', 'e'];
    const edges = [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
      { from: 'c', to: 'd' },
      { from: 'd', to: 'e' },
    ];
    const { componentCount, componentOf } = computeComponents(nodeIds, edges);
    expect(componentCount).toBe(1);
    // 所有节点应在同一分量
    const comp = componentOf.get('a');
    for (const id of nodeIds) {
      expect(componentOf.get(id)).toBe(comp);
    }
  });

  it('TC-GRAPH-9: 三色标记法（DFS 使用 WHITE/GRAY/BLACK）', () => {
    // 通过 detectCycles 间接验证三色标记法
    // 自环
    const adjacency = new Map<string, string[]>([
      ['a', ['a']],
    ]);
    const cycles = detectCycles(adjacency);
    expect(cycles.length).toBe(1);
  });
});
