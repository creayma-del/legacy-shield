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
