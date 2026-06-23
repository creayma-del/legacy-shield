import type {
  KnowledgeGraph,
  KnowledgeGraphJson,
} from './types.js';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

/**
 * 将 KnowledgeGraph（含 Map 结构的 nodes / adjacency / reverseAdjacency）
 * 转换为可 JSON 序列化的 KnowledgeGraphJson（含数组结构的 nodes / edges）。
 *
 * 以 edges 列表替代邻接表与反向索引，消费方可从 edges 重建邻接表：
 * `edges.filter(e => !e.unresolved).forEach(e => adjacency[e.from].push(e.to))`
 */
export function toJson(graph: KnowledgeGraph): KnowledgeGraphJson {
  const meta = {
    projectRoot: graph.projectRoot,
    isMonorepo: graph.isMonorepo,
    packages: graph.packages,
    generatedAt: new Date().toISOString(),
    nodeCount: graph.stats.nodeCount,
    edgeCount: graph.stats.edgeCount,
    cycleCount: graph.stats.cycleCount,
  };

  const nodes = Array.from(graph.nodes.values()).map((node) => ({
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

  const edges = graph.edges.map((edge) => ({
    from: edge.from,
    to: edge.to,
    kind: edge.kind,
    symbols: edge.symbols,
    unresolved: edge.unresolved,
    rawSpec: edge.rawSpec,
  }));

  const cycles = graph.cycles;
  const stats = graph.stats;

  return {
    meta,
    nodes,
    edges,
    cycles,
    stats,
  };
}

/**
 * 将 toJson 结果序列化为 JSON 字符串（2 空格缩进），写入 <outputPath>/knowledge-graph.json 文件。
 * @returns 写入的文件路径
 */
export async function writeJson(
  graph: KnowledgeGraph,
  outputPath: string,
): Promise<string> {
  const json = toJson(graph);
  const jsonStr = JSON.stringify(json, null, 2);
  await mkdir(outputPath, { recursive: true });
  const filePath = join(outputPath, 'knowledge-graph.json');
  await writeFile(filePath, jsonStr, 'utf8');
  return filePath;
}
