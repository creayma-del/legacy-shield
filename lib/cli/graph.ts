import type { GraphOptions, GraphResult } from '../types.js';
import { runKnowledgeGraph } from '../knowledge-graph/index.js';

/**
 * CLI action handler 与编排入口（T10 runKnowledgeGraph）之间的薄层适配器。
 * 仅做参数转换与委托，不包含任何业务编排逻辑。
 */
export async function runGraph(options: GraphOptions): Promise<GraphResult> {
  return runKnowledgeGraph(options);
}
