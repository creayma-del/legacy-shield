import type { FileKind } from './types.js';
import type { CollectedFile } from './collector.js';
import type {
  KnowledgeGraph,
  GraphNode,
  GraphEdge,
  GraphStats,
} from './types.js';
import { extname, relative, sep } from 'node:path';

export function buildGraph(
  projectRoot: string,
  collected: Map<string, CollectedFile>,
  resolver: { resolve: (spec: string, importer: string) => string | null },
): KnowledgeGraph {
  const nodes = new Map<string, GraphNode>();
  const adjacency = new Map<string, string[]>();
  const reverseAdjacency = new Map<string, string[]>();
  const edges: GraphEdge[] = [];

  // 构建节点表
  for (const filePath of collected.keys()) {
    const id = filePath;
    const relativePath = relative(projectRoot, filePath).split(sep).join('/');
    const kind = inferFileKind(filePath);
    nodes.set(id, {
      id,
      relativePath,
      kind,
      role: 'unknown',
      inDegree: 0,
      outDegree: 0,
      exports: collected.get(filePath)!.exports,
      isEntry: false,
      packageName: null,
    });
    adjacency.set(id, []);
    reverseAdjacency.set(id, []);
  }

  // 构建边列表 + 邻接表 + 反向邻接表（同步填充）
  for (const [filePath, file] of collected.entries()) {
    for (const dep of file.dependencies) {
      let targetId: string | null = null;
      if (!dep.unresolved && dep.spec !== '<dynamic>') {
        targetId = resolver.resolve(dep.spec, filePath);
      }
      const edge: GraphEdge = {
        from: filePath,
        to: targetId ?? dep.spec,
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
    }
  }

  // 填充 inDegree / outDegree
  for (const [id, node] of nodes) {
    node.outDegree = adjacency.get(id)!.length;
    node.inDegree = reverseAdjacency.get(id)!.length;
  }

  // 循环检测
  const cycles = detectCycles(adjacency);

  // 连通分量计算
  const { componentCount } = computeComponents(
    Array.from(nodes.keys()),
    edges.filter((e) => !e.unresolved),
  );

  // 初始化 stats 骨架
  const stats: GraphStats = {
    nodeCount: nodes.size,
    edgeCount: edges.length,
    cycleCount: cycles.length,
    componentCount,
    hubCount: 0,
    isolatedCount: 0,
    entryCount: 0,
    unresolvedEdgeCount: edges.filter((e) => e.unresolved).length,
    maxInDegree: 0,
    maxOutDegree: 0,
  };

  return {
    projectRoot,
    isMonorepo: false,
    packages: [],
    nodes,
    adjacency,
    reverseAdjacency,
    edges,
    cycles,
    stats,
  };
}

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

export function detectCycles(adjacency: Map<string, string[]>): string[][] {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;

  const color = new Map<string, number>();
  const cycles: string[][] = [];
  const path: string[] = []; // 当前 DFS 路径（用于循环链提取）

  for (const node of adjacency.keys()) {
    color.set(node, WHITE);
  }

  // 迭代式 DFS（避免递归导致的栈溢出，支持 5000+ 文件规模）
  // 每个栈条目：{ node, neighborIdx } — neighborIdx 记录下一个待处理的邻居索引
  const dfsStack: Array<{ node: string; neighborIdx: number }> = [];

  for (const startNode of adjacency.keys()) {
    if ((color.get(startNode) ?? WHITE) !== WHITE) continue;

    color.set(startNode, GRAY);
    path.push(startNode);
    dfsStack.push({ node: startNode, neighborIdx: 0 });

    while (dfsStack.length > 0) {
      const top = dfsStack[dfsStack.length - 1];
      const neighbors = adjacency.get(top.node) ?? [];

      if (top.neighborIdx < neighbors.length) {
        const neighbor = neighbors[top.neighborIdx];
        top.neighborIdx++;

        const neighborColor = color.get(neighbor) ?? WHITE;
        if (neighborColor === GRAY) {
          // 发现回边：从 path 中找到循环起点
          const cycleStart = path.indexOf(neighbor);
          const cycle = path.slice(cycleStart).concat(neighbor);
          cycles.push(cycle);
        } else if (neighborColor === WHITE) {
          color.set(neighbor, GRAY);
          path.push(neighbor);
          dfsStack.push({ node: neighbor, neighborIdx: 0 });
        }
      } else {
        // 所有邻居处理完毕，回溯
        color.set(top.node, BLACK);
        path.pop();
        dfsStack.pop();
      }
    }
  }

  // 去重
  const seen = new Set<string>();
  const deduped: string[][] = [];
  for (const cycle of cycles) {
    const key = [...new Set(cycle)].sort().join('|');
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(cycle);
    }
  }
  return deduped;
}

export function computeComponents(
  nodeIds: string[],
  edges: Array<{ from: string; to: string }>,
): { componentCount: number; componentOf: Map<string, number> } {
  const parent = new Map<string, string>();
  for (const id of nodeIds) {
    parent.set(id, id);
  }

  function find(x: string): string {
    let root = x;
    while (parent.get(root) !== root) {
      root = parent.get(root)!;
    }
    // 路径压缩
    let cur = x;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  function union(a: string, b: string): void {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) {
      parent.set(ra, rb);
    }
  }

  for (const edge of edges) {
    if (parent.has(edge.from) && parent.has(edge.to)) {
      union(edge.from, edge.to);
    }
  }

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
}
