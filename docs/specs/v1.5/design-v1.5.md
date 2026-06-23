# legacy-shield v1.5 设计文档：项目知识图谱生成

> 版本：v1.5
> 对应需求文档：[meetings/requirements-alignment-v1.5-20260622.md](meetings/requirements-alignment-v1.5-20260622.md)
> 对应需求分解文档：[requirements-decomposition-v1.5.md](requirements-decomposition-v1.5.md)
> 状态：已完成，已归档（冻结，不再修改）
> 编制日期：2026-06-22
> 评审记录：见文档末尾

---

## 1. 总体架构

v1.5 新增独立的 `graph` 子命令，在 `lib/knowledge-graph/` 下构建完整的知识图谱生成模块。模块复用现有 Babel AST 工具链（`@babel/parser`、`@babel/traverse`、`@vue/compiler-sfc`），不引入任何新的运行时依赖。

### 1.1 模块关系

```
shield graph --project <path>
  └── lib/cli/graph.ts                    # 新增：CLI action handler
        └── lib/knowledge-graph/index.ts   # 新增：编排入口
              ├── scanner.ts               # 新增：并发文件扫描 + mtime 缓存
              ├── resolver.ts              # 新增：模块路径解析器
              ├── collector.ts             # 新增：依赖关系收集 visitor
              ├── graph.ts                 # 新增：图构建 + 循环检测
              ├── analyzer.ts              # 新增：图谱分析（hub/孤立/分层）
              ├── monorepo.ts              # 新增：monorepo 子包识别 + 聚合
              ├── json-output.ts           # 新增：JSON 格式输出
              └── markdown-output.ts       # 新增：Markdown 摘要输出
```

### 1.2 新增 / 调整文件清单

```
lib/
├── knowledge-graph/                  # 新增模块
│   ├── index.ts                      # 编排入口：runKnowledgeGraph
│   ├── scanner.ts                    # 并发文件扫描 + mtime 缓存
│   ├── resolver.ts                   # 模块路径解析器
│   ├── collector.ts                  # 依赖关系收集 visitor
│   ├── graph.ts                      # 图构建 + 循环检测
│   ├── analyzer.ts                   # 图谱分析（hub/孤立/分层）
│   ├── monorepo.ts                   # monorepo 子包识别 + 聚合
│   ├── json-output.ts                # JSON 格式输出
│   ├── markdown-output.ts            # Markdown 摘要输出
│   └── types.ts                      # 模块内部类型（图谱节点/边/统计）
├── cli/
│   └── graph.ts                      # 新增：graph 子命令 action handler
├── types.ts                          # 扩展：新增 KnowledgeGraph 相关导出类型（GraphOptions / GraphResult）
└── utils.ts                          # 复用：assertLegacyProject 已有的 allowNoSrc 能力（monorepo 根目录可能无 src）

cli.ts                                # 扩展：新增 graph 子命令定义
docs/
├── api.md                            # 扩展：graph 子命令说明
└── README.md                         # 扩展：能力清单新增知识图谱

tests/
├── knowledge-graph/                  # 新增测试目录
│   ├── fixtures/
│   │   ├── simple-project/           # 单包项目夹具
│   │   ├── monorepo-project/         # monorepo 项目夹具
│   │   └── alias-project/            # alias 配置项目夹具
│   ├── resolver.test.ts              # 路径解析器单测
│   ├── collector.test.ts             # 依赖收集单测
│   ├── graph.test.ts                 # 图构建与循环检测单测
│   ├── analyzer.test.ts              # 图谱分析单测
│   ├── monorepo.test.ts              # monorepo 支持单测
│   ├── scanner.test.ts               # 并发扫描与缓存单测
│   └── integration.test.ts           # 集成测试（端到端）
```

### 1.3 不在范围内

- 函数/类级符号图（v1.6+）；
- MCP 接口暴露（v1.6+）；
- Worker 线程（v1.6+）；
- 影响范围分析（v1.6+）；
- 架构规则验证（v1.6+）；
- watch 模式 / 实时更新（v1.6+）；
- webpack resolve.alias / vite resolve.alias 解析（v1.5 仅支持 tsconfig/jsconfig paths）；
- 动态 import() 路径解析（标记为"未解析"边）；
- 变量 require() 路径解析（标记为"未解析"边）。

---

## 2. 数据结构

### 2.1 图谱节点类型

```typescript
// lib/knowledge-graph/types.ts

/** 文件类型 */
export type FileKind = 'js' | 'jsx' | 'ts' | 'tsx' | 'vue' | 'unknown';

/** 节点角色（基于路径与入度/出度推断） */
export type NodeRole = 'entry' | 'core' | 'leaf' | 'isolated' | 'unknown';

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

/** 图谱边类型 */
export type EdgeKind = 'import' | 're-export' | 'require' | 'dynamic-import';

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
```

### 2.2 图数据结构

```typescript
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
```

### 2.3 JSON 输出 Schema

```typescript
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
  /** 边列表 */
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

> **设计说明**：JSON 输出以 `edges` 列表替代邻接表与反向索引，消费方可从 edges 列表重建邻接表（`edges.forEach(e => adjacency[e.from].push(e.to))`）。这样设计的原因是 edges 列表更紧凑、更易于流式处理，且避免了 Map 序列化问题。与 REQ-1.5-8 的"邻接表 + 反向索引"要求对齐方式为：数据完整等价，表达形式不同。

### 2.4 类型定义扩展（lib/types.ts）

```typescript
// 在 lib/types.ts 中新增导出

export interface GraphOptions {
  project: string;
  out?: string;
  concurrency?: number;
  fresh?: boolean;
  format?: 'json' | 'md' | 'both';
  /** hub 文件入度阈值（默认 10） */
  hubThreshold?: number;
}

export type GraphResult = {
  projectRoot: string;
  isMonorepo: boolean;
  packages: string[];
  outputPath: string;
  nodeCount: number;
  edgeCount: number;
  cycleCount: number;
  durationMs: number;
};
```

---

## 3. 模块路径解析器设计

### 3.1 Alias 识别策略

**遗留问题解决**：v1.5 优先支持 tsconfig/jsconfig paths，不支持 webpack/vite resolve.alias。

**解析优先级**：
1. 读取目标项目根目录的 `tsconfig.json`，若不存在则读取 `jsconfig.json`
2. 解析 `compilerOptions.baseUrl` 与 `compilerOptions.paths`
3. 若无 tsconfig/jsconfig，仅支持相对路径与 node_modules 解析

**Alias 解析规则**：
- `@/*` → `<baseUrl>/src/*`（最常见）
- `~/*` → `<baseUrl>/src/*`（webpack 约定，v1.5 按 tsconfig paths 处理）
- 自定义 paths 按映射规则解析

**不支持的场景**（文档中明确说明）：
- webpack `resolve.alias` 配置（需读取 `webpack.config.js`，引入复杂度高）
- vite `resolve.alias` 配置（需读取 `vite.config.ts`，引入复杂度高）
- runtime 动态计算的路径

### 3.2 路径解析算法

```typescript
// lib/knowledge-graph/resolver.ts

export interface ResolverOptions {
  projectRoot: string;
  baseUrl?: string;
  paths?: Record<string, string[]>;
}

export class ModuleResolver {
  constructor(private opts: ResolverOptions) {}

  /**
   * 将 import spec 解析为目标文件绝对路径
   * @param spec import 路径（如 './foo', '@/utils/bar', 'lodash')
   * @param importer 导入文件的绝对路径
   * @returns 解析后的文件绝对路径，或 null（无法解析）
   */
  resolve(spec: string, importer: string): string | null {
    // 1. 相对路径（./ 或 ../）
    if (spec.startsWith('.')) {
      return this.resolveRelative(spec, importer);
    }

    // 2. alias 路径（@/ ~/ 等）
    const aliasResolved = this.resolveAlias(spec);
    if (aliasResolved) {
      return this.resolveRelative(aliasResolved, this.opts.baseUrl ?? this.opts.projectRoot);
    }

    // 3. node_modules 包路径
    return this.resolveNodeModules(spec, importer);
  }

  private resolveRelative(spec: string, baseDir: string): string | null {
    const basePath = resolve(baseDir, spec);
    return this.tryExtensions(basePath);
  }

  private resolveAlias(spec: string): string | null {
    if (!this.opts.paths) return null;
    for (const [pattern, targets] of Object.entries(this.opts.paths)) {
      // 先转义正则元字符，再替换 * 为捕获组
      const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace('*', '(.*)');
      const regex = new RegExp('^' + escaped + '$');
      const match = spec.match(regex);
      if (match) {
        return targets[0].replace('*', match[1]);
      }
    }
    return null;
  }

  private resolveNodeModules(spec: string, importer: string): string | null {
    if (!spec.includes('/')) return null;
    const parts = spec.split('/');
    // scoped 包名含斜杠（如 @vue/compiler-sfc/foo）
    const packageName = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
    const subPath = (spec.startsWith('@') ? parts.slice(2) : parts.slice(1)).join('/');
    if (!subPath) return null;
    let dir = dirname(importer);
    while (true) {
      const candidate = join(dir, 'node_modules', packageName, subPath);
      const resolved = this.tryExtensions(candidate);
      if (resolved) return resolved;
      const parent = dirname(dir);
      if (parent === dir) break; // 已到根目录
      dir = parent;
    }
    return null;
  }

  private tryExtensions(basePath: string): string | null {
    const extensions = ['.ts', '.tsx', '.js', '.jsx', '.vue'];
    // 1. 直接匹配
    if (existsSync(basePath) && statSync(basePath).isFile()) return basePath;
    // 2. 补全扩展名
    for (const ext of extensions) {
      if (existsSync(basePath + ext)) return basePath + ext;
    }
    // 3. index 文件
    for (const ext of extensions) {
      const indexFile = join(basePath, 'index' + ext);
      if (existsSync(indexFile)) return indexFile;
    }
    return null;
  }
}
```

### 3.3 边界情况处理

| 场景 | 处理方式 |
|---|---|
| 动态 `import()` | 标记为 `unresolved: true`，`kind: 'dynamic-import'` |
| 变量 `require(varName)` | 标记为 `unresolved: true`，`kind: 'require'` |
| 字符串拼接路径 | 不解析，标记为 `unresolved: true` |
| CSS/图片等非 JS 资源 | 不纳入图谱，跳过 |
| node_modules 纯包名 | 不解析为文件，跳过（仅解析包内子路径） |
| 解析失败 | 标记为 `unresolved: true`，保留 `rawSpec` 用于调试 |

---

## 4. 依赖关系收集设计

### 4.1 Babel Visitor 设计

```typescript
// lib/knowledge-graph/collector.ts

import { parse as babelParse } from '@babel/parser';
import babelTraverseModule from '@babel/traverse';
import { parse as parseSFC } from '@vue/compiler-sfc';
import { ModuleResolver } from './resolver.js';

const traverse = ((babelTraverseModule as any).default ?? babelTraverseModule) as any;

export interface CollectedDependency {
  spec: string;
  kind: 'import' | 're-export' | 'require' | 'dynamic-import';
  symbols: string[];
  unresolved: boolean;
  line: number;
}

/** 文件收集结果：依赖列表 + 导出符号列表 */
export interface CollectedFile {
  /** 依赖列表 */
  dependencies: CollectedDependency[];
  /** 本文件导出的符号列表（本地导出，含默认导出 'default'） */
  exports: string[];
}

/** 解析文件为 AST，返回 AST 与是否为 TypeScript */
function parseFile(filePath: string, code: string): { ast: File; isTs: boolean } {
  // 参考 ast-skeleton.ts 的 pluginsFor 实现思路，根据后缀选择 Babel 插件
  // 启用 errorRecovery: true，确保大规模扫描容错性
  // .vue 文件先用 @vue/compiler-sfc 提取 script 内容再解析
}

export function collectDependencies(
  filePath: string,
  code: string,
  resolver: ModuleResolver,
): CollectedFile {
  const deps: CollectedDependency[] = [];
  const exports: string[] = [];
  const { ast } = parseFile(filePath, code);

  traverse(ast, {
    // import { foo } from './bar'
    ImportDeclaration(path: any) {
      const spec = path.node.source.value;
      const symbols = path.node.specifiers.map((s: any) => s.local?.name).filter(Boolean);
      deps.push({ spec, kind: 'import', symbols, unresolved: false, line: path.node.loc?.start.line ?? 0 });
    },

    // export { foo } from './bar'  (re-export，有 source)
    // export { foo }               (本地导出，无 source)
    ExportNamedDeclaration(path: any) {
      if (path.node.source) {
        // re-export：记录依赖
        const spec = path.node.source.value;
        const symbols = path.node.specifiers.map((s: any) => s.exported?.name).filter(Boolean);
        deps.push({ spec, kind: 're-export', symbols, unresolved: false, line: path.node.loc?.start.line ?? 0 });
      } else {
        // 本地导出：收集导出符号
        for (const specifier of path.node.specifiers) {
          const name = specifier?.exported?.name;
          if (name) exports.push(name);
        }
        // export const foo = ... / export function foo() ... 等声明形式
        const declaration = path.node.declaration;
        if (declaration) {
          if (declaration.type === 'VariableDeclaration') {
            for (const decl of declaration.declarations) {
              if (decl.id?.type === 'Identifier' && decl.id.name) exports.push(decl.id.name);
            }
          } else if (declaration.type === 'FunctionDeclaration' || declaration.type === 'ClassDeclaration') {
            if (declaration.id?.name) exports.push(declaration.id.name);
          }
        }
      }
    },

    // export * from './bar'
    ExportAllDeclaration(path: any) {
      const spec = path.node.source.value;
      deps.push({ spec, kind: 're-export', symbols: ['*'], unresolved: false, line: path.node.loc?.start.line ?? 0 });
    },

    // export default ... / export default function foo() {}
    ExportDefaultDeclaration(path: any) {
      exports.push('default');
    },

    // require('./bar')
    CallExpression(path: any) {
      const callee = path.node.callee;
      if (callee.type === 'Identifier' && callee.name === 'require') {
        const arg = path.node.arguments[0];
        if (arg.type === 'StringLiteral') {
          deps.push({ spec: arg.value, kind: 'require', symbols: [], unresolved: false, line: path.node.loc?.start.line ?? 0 });
        } else {
          // 变量 require
          deps.push({ spec: '<dynamic>', kind: 'require', symbols: [], unresolved: true, line: path.node.loc?.start.line ?? 0 });
        }
      }
    },

    // import('./bar')
    ImportExpression(path: any) {
      const arg = path.node.source;
      if (arg.type === 'StringLiteral') {
        deps.push({ spec: arg.value, kind: 'dynamic-import', symbols: [], unresolved: false, line: path.node.loc?.start.line ?? 0 });
      } else {
        deps.push({ spec: '<dynamic>', kind: 'dynamic-import', symbols: [], unresolved: true, line: path.node.loc?.start.line ?? 0 });
      }
    },
  });

  // 解析路径
  const resolvedDeps = deps.map((dep) => {
    if (dep.unresolved || dep.spec === '<dynamic>') return dep;
    const resolved = resolver.resolve(dep.spec, filePath);
    return { ...dep, unresolved: resolved === null };
  });

  return { dependencies: resolvedDeps, exports };
}
```

> **说明**：`collectDependencies` 同时收集依赖与本地导出。`exports` 字段包含：
> - `ExportNamedDeclaration`（无 source）中的具名导出（含 `export const/function/class` 声明形式）
> - `ExportDefaultDeclaration` 中的 `'default'`
>
> re-export（`export { x } from './y'`）不计入本文件 `exports`，仅作为依赖边记录。

### 4.2 Vue SFC 处理

参考 [scanner.ts](file:///Users/creayma/personal/legacy-shield/lib/custom-rules/scanner.ts#L94-L112) 的 `parseCode` 实现思路，在 collector.ts 中独立实现 Vue SFC 解析：
1. 使用 `@vue/compiler-sfc` 的 `parse` 提取 `<script>` 或 `<script setup>` 内容
2. 根据 `lang` 属性决定是否启用 TypeScript 插件
3. 对提取的 script 内容执行 Babel 解析与依赖收集

### 4.3 复用现有 AST 解析配置

参考 [ast-skeleton.ts](file:///Users/creayma/personal/legacy-shield/lib/code-quality/lib/ast-skeleton.ts#L53-L60) 的 `pluginsFor` 实现思路，在 collector.ts 中独立实现 Babel 插件配置：
- `.js` / `.jsx` → `['jsx', 'importAssertions', 'topLevelAwait']`
- `.ts` → `['typescript', 'importAssertions', 'topLevelAwait']`
- `.tsx` → `['typescript', 'jsx', 'importAssertions', 'topLevelAwait']`
- 启用 `errorRecovery: true`，确保大规模扫描容错性

---

## 5. 图构建与分析设计

### 5.1 邻接表数据结构

使用 `Map<string, string[]>` 存储邻接表与反向邻接表，节点元数据使用 `Map<string, GraphNode>` 存储。

**反向邻接表构建**：反向邻接表在图构建时同步填充：遍历每条边 (from, to) 时，在 `adjacency[from]` 中添加 to，同时在 `reverseAdjacency[to]` 中添加 from。这样保证后续 hub 识别、入口识别等分析无需重复遍历边集。

### 5.2 循环依赖检测算法

采用 DFS 三色标记法（白色=未访问、灰色=访问中、黑色=已完成），检测回边时记录循环链。

```typescript
// lib/knowledge-graph/graph.ts

export function detectCycles(adjacency: Map<string, string[]>): string[][] {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const cycles: string[][] = [];
  const stack: string[] = [];

  function dfs(node: string): void {
    color.set(node, GRAY);
    stack.push(node);
    const neighbors = adjacency.get(node) ?? [];
    for (const neighbor of neighbors) {
      const neighborColor = color.get(neighbor) ?? WHITE;
      if (neighborColor === GRAY) {
        // 发现循环：从 stack 中找到循环起点
        const cycleStart = stack.indexOf(neighbor);
        const cycle = stack.slice(cycleStart).concat(neighbor);
        cycles.push(cycle);
      } else if (neighborColor === WHITE) {
        dfs(neighbor);
      }
    }
    stack.pop();
    color.set(node, BLACK);
  }

  for (const node of adjacency.keys()) {
    if ((color.get(node) ?? WHITE) === WHITE) {
      dfs(node);
    }
  }

  // 对检测到的循环做规范化去重：将每个循环节点集合排序后作为 key，
  // 相同 key 的循环仅保留一条。
  const seen = new Set<string>();
  const deduped: string[][] = [];
  for (const cycle of cycles) {
    // 去掉末尾重复的起点节点后再排序作为 key
    const key = [...new Set(cycle)].sort().join('|');
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(cycle);
    }
  }
  return deduped;
}
```

### 5.3 Hub / 孤立文件识别

- **Hub 文件**：入度 >= 阈值（默认 10，可通过参数配置）
- **孤立文件**：入度 = 0 且出度 = 0
- **入口文件**：入度 = 0 且出度 > 0

> **isEntry 计算时机**：图构建完成后，遍历所有节点根据 inDegree/outDegree 统一计算 isEntry。这样可避免在边插入过程中因部分边未建立而出现误判。

### 5.4 分层结构推断

基于拓扑排序与入度/出度分析：
1. **入口层**：入度 = 0 且出度 > 0 的文件
2. **核心层**：入度 >= 阈值（hub 文件）
3. **叶子层**：出度 = 0 且入度 > 0 的文件
4. **中间层**：其余文件

### 5.5 连通分量计算

**算法选择**：采用弱连通分量（Weakly Connected Components, WCC），基于无向化后的并查集（Union-Find）算法。

**选择理由**：
- 弱连通分量更能反映模块间的逻辑分组（只要存在任意方向的依赖路径，即视为同一组）
- 强连通分量（SCC）与循环检测（§5.2）重叠度高，SCC 主要价值在于循环识别，已由 DFS 三色标记法覆盖
- 并查集算法实现简单，时间复杂度近似 O(n α(n))，适合大规模图谱

**算法步骤**：
1. 初始化并查集：每个节点自成一个集合
2. 将所有边视为无向：遍历 `edges`，对每条边 (from, to)，调用 `union(from, to)`
3. 统计根节点数量：遍历所有节点，`find(node)` 结果去重后的数量即为 `componentCount`
4. 同步填充每个节点的 `componentId`（可选，用于后续分析）

```typescript
// lib/knowledge-graph/graph.ts

export function computeComponents(
  nodeIds: string[],
  edges: Array<{ from: string; to: string }>,
): { componentCount: number; componentOf: Map<string, number> } {
  const parent = new Map<string, string>();
  for (const id of nodeIds) parent.set(id, id);

  function find(x: string): string {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
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
    if (ra !== rb) parent.set(ra, rb);
  }

  // 无向化：所有边视为无向
  for (const edge of edges) {
    union(edge.from, edge.to);
  }

  // 统计根节点数量并分配 componentId
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
```

---

## 6. monorepo 支持设计

### 6.1 子包识别策略

**遗留问题解决**：monorepo 子包识别优先级。

**识别优先级**（按顺序尝试）：
1. `package.json` 的 `workspaces` 字段（npm/yarn workspaces，JSON 原生可解析）
2. `lerna.json` 的 `packages` 字段（JSON 原生可解析）
3. `pnpm-workspace.yaml` 的 `packages` 字段：**简化解析**（仅识别 `packages:` 顶层数组字面量，不支持 YAML 锚点/合并键等高级特性），解析失败时降级为无 workspace 模式。不引入 `js-yaml` 依赖，避免违反 OUT-6 约束。
4. `packages/*` 目录约定：若存在 `packages/` 目录且其下每个子目录都有 `package.json`，视为 monorepo

> **设计说明**：`pnpm-workspace.yaml` 降级为简化解析，因为项目约束（OUT-6）禁止引入新的运行时依赖。pnpm monorepo 场景下，`pnpm-workspace.yaml` 通常仅含 `packages: ['packages/*']` 等简单数组，简化解析可覆盖绝大多数场景。若解析失败，降级为 `packages/*` 目录约定识别。

**不支持的场景**：
- 自定义 workspace 布局（如 `apps/*` + `libs/*`）需通过 `--workspace-glob` 参数手动指定（v1.5 不实现，留待 v1.6+）

### 6.2 独立图谱生成

对每个子包：
1. 以子包根目录为 `projectRoot`
2. 读取子包的 `tsconfig.json` / `jsconfig.json` 获取 alias 配置
3. 扫描子包 `src/` 目录
4. 生成子包独立图谱

### 6.3 聚合图谱生成

1. 合并所有子包的节点与边
2. 解析跨包依赖：
   - `workspace:*` 协议：解析为对应子包的入口
   - `link:./packages/foo` 协议：解析为对应子包
   - `file:./packages/foo` 协议：解析为对应子包
   - node_modules 软链接（pnpm 风格）：解析为对应子包
3. 重新计算聚合图的统计指标

---

## 7. 输出格式设计

### 7.1 JSON 输出格式

见 §2.3 的 `KnowledgeGraphJson` schema。输出文件：`knowledge-graph.json`

### 7.2 Markdown 摘要章节结构与样例

**遗留问题解决**：Markdown 摘要的具体章节结构与样例。

**章节结构**：
1. 项目架构概览
2. 模块依赖拓扑
3. 关键节点识别
4. 循环依赖分析
5. 分层结构推断
6. 架构健康度评估

**样例**（以简单项目为例）：

```markdown
# 项目知识图谱架构摘要

> 生成时间：2026-06-22 15:30:00
> 项目路径：/path/to/project
> 项目类型：单包项目
> 节点数：120 | 边数：285 | 循环依赖：3 | 孤立文件：2

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

### 4.3 循环 3（2 个文件）

```
src/utils/validate.ts → src/utils/format.ts → src/utils/validate.ts
```

**建议**：将 `validate.ts` 与 `format.ts` 的相互依赖拆分为单向依赖。

## 5. 分层结构推断

基于拓扑排序与入度/出度分析，项目可分为 4 层：

| 层级 | 文件数 | 说明 |
|---|---|---|
| 入口层 | 1 | `src/main.ts`（入度=0，出度>0） |
| 核心层 | 5 | Hub 文件（入度≥10），提供服务与工具 |
| 中间层 | 84 | 常规业务文件 |
| 叶子层 | 28 | 组件与视图文件（出度=0，入度>0） |
| 孤立 | 2 | 未被引用的文件 |

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

---

## 8. 性能设计

### 8.1 并发扫描策略

**遗留问题解决**：5000 文件规模项目的性能基线指标。

**并发模型**：
- 使用 `Promise.all` + 简单限流（并发数默认 8，可通过 `--concurrency` 配置）
- 每个文件独立解析，无共享状态
- 文件读取使用 `fs/promises` 异步 API

```typescript
// lib/knowledge-graph/scanner.ts

async function scanFilesConcurrent(
  filePaths: string[],
  resolver: ModuleResolver,
  concurrency: number,
): Promise<Map<string, CollectedFile>> {
  const results = new Map<string, CollectedFile>();
  let cursor = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (cursor < filePaths.length) {
      const filePath = filePaths[cursor++];
      if (!filePath) break;
      try {
        const code = await readFile(filePath, 'utf8');
        const deps = collectDependencies(filePath, code, resolver);
        results.set(filePath, deps);
      } catch (err) {
        console.warn(`[scanner] 处理文件失败: ${filePath}`, err instanceof Error ? err.message : String(err));
        results.set(filePath, { dependencies: [], exports: [] });
      }
    }
  });
  await Promise.all(workers);
  return results;
}
```

> **说明**：使用索引游标 `cursor` 替代 `queue.shift()`，避免 O(n) 的数组移位开销；同时用 `try-catch` 包裹 `readFile` 与 `collectDependencies`，单文件失败不影响整体扫描，仅记录告警并写入空依赖。

### 8.2 mtime 缓存设计

**遗留问题解决**：mtime 缓存的存储位置与失效策略。

**存储位置**：`<project>/.legacy-shield/knowledge-graph/.cache.json`

**缓存结构**：
```typescript
interface CacheEntry {
  /** 文件路径 */
  path: string;
  /** 文件 mtime（毫秒时间戳） */
  mtime: number;
  /** alias 配置 hash（用于检测 alias 变更） */
  aliasHash: string;
  /** 解析结果（依赖列表） */
  dependencies: CollectedDependency[];
  /** 导出符号列表 */
  exports: string[];
}

interface CacheFile {
  /** 缓存版本 */
  version: string;
  /** 生成时间 */
  generatedAt: string;
  /** alias 配置 hash */
  aliasHash: string;
  /** 缓存条目 */
  entries: Record<string, CacheEntry>;
}
```

**失效策略**：
- 文件 mtime 变更 → 该文件缓存失效
- alias 配置 hash 变更 → 全部缓存失效
- `--fresh` 参数 → 忽略缓存，全量重建
- 缓存文件不存在 → 全量重建

**alias 配置 hash 计算**：
```typescript
function computeAliasHash(tsconfig: object | null): string {
  if (!tsconfig) return 'none';
  const paths = (tsconfig as any).compilerOptions?.paths ?? {};
  const baseUrl = (tsconfig as any).compilerOptions?.baseUrl ?? '';
  return createHash('md5').update(JSON.stringify({ paths, baseUrl })).digest('hex');
}
```

### 8.3 性能基线指标

| 场景 | 目标 | 说明 |
|---|---|---|
| 5000 文件全量扫描 | < 30 秒 | 并发数=8，SSD 存储 |
| 5000 文件增量扫描 | < 5 秒 | 90% 文件命中缓存 |
| 1000 文件全量扫描 | < 8 秒 | 并发数=8 |
| 500 文件全量扫描 | < 3 秒 | 并发数=8 |
| 内存占用 | < 500MB | 5000 文件场景 |

**性能验证**：在设计文档评审通过后，T11 测试阶段使用真实项目验证，若不达标则调整并发数或引入 Worker 线程（升级为 v1.6 范围）。

---

## 9. CLI 子命令设计

### 9.1 参数定义

```typescript
// cli.ts 新增
// runGraph 在文件顶部静态 import，与其他子命令一致
import { runGraph } from './lib/cli/graph.js';

program
  .command('graph')
  .description('生成项目知识图谱')
  .requiredOption('--project <path>', '目标项目根路径')
  .option('--out <path>', '输出目录', '')
  .option('--concurrency <n>', '并发扫描数', '8')
  .option('--fresh', '强制全量重建，忽略缓存')
  .option('--format <format>', '输出格式（json/md/both）', 'both')
  .option('--hub-threshold <n>', 'hub 文件入度阈值', '10')
  .action(async (opts) => {
    // 选项校验：commander 传入的数值参数为字符串，需先 Number() 转换再校验
    const concurrency = Number(opts.concurrency);
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new Error(`非法并发数: ${opts.concurrency}，必须是 >= 1 的整数`);
    }
    if (!['json', 'md', 'both'].includes(opts.format)) {
      throw new Error(`非法输出格式: ${opts.format}，仅支持 json/md/both`);
    }
    const hubThreshold = Number(opts.hubThreshold);
    if (!Number.isInteger(hubThreshold) || hubThreshold < 0) {
      throw new Error(`非法 hub 阈值: ${opts.hubThreshold}，必须是 >= 0 的整数`);
    }
    const result = await runGraph({
      project: opts.project,
      out: opts.out || undefined,
      concurrency,
      fresh: opts.fresh ?? false,
      format: opts.format,
      hubThreshold,
    });
    console.log(`知识图谱生成完成：${result.nodeCount} 节点、${result.edgeCount} 边、${result.cycleCount} 循环依赖`);
    console.log(`输出路径：${result.outputPath}`);
    console.log(`耗时：${result.durationMs}ms`);
  });
```

### 9.2 输出路径

- 默认：`<project>/.legacy-shield/knowledge-graph/`
- 自定义：通过 `--out <path>` 指定
- 输出文件：
  - `knowledge-graph.json`（JSON 格式）
  - `architecture-summary.md`（Markdown 摘要）
  - `.cache.json`（mtime 缓存，隐藏文件）

### 9.3 与 quality 子命令的关系

完全独立，不自动集成。用户需手动运行 `shield graph` 生成知识图谱。

---

## 10. 测试计划

### 10.1 单元测试

| 模块 | 测试文件 | 覆盖场景 |
|---|---|---|
| resolver.ts | resolver.test.ts | 相对路径、alias、node_modules、扩展名补全、index 解析、动态 import 标记 |
| collector.ts | collector.test.ts | import/export/require/dynamic-import 收集、Vue SFC 解析、Babel 解析容错 |
| graph.ts | graph.test.ts | 邻接表构建、循环检测、连通分量、入度/出度计算 |
| analyzer.ts | analyzer.test.ts | hub 识别、孤立文件识别、分层推断 |
| monorepo.ts | monorepo.test.ts | pnpm-workspace.yaml/lerna.json/packages/* 识别、聚合图谱 |
| scanner.ts | scanner.test.ts | 并发扫描、mtime 缓存命中/失效、--fresh 强制重建 |

### 10.2 集成测试

| 场景 | 测试文件 | 覆盖点 |
|---|---|---|
| 单包项目端到端 | integration.test.ts | 从 CLI 调用到 JSON + Markdown 输出 |
| monorepo 项目端到端 | integration.test.ts | 子包识别 + 独立图谱 + 聚合图谱 |
| alias 项目端到端 | integration.test.ts | tsconfig paths 解析 |
| 增量更新 | integration.test.ts | 首次全量 → 修改文件 → 增量扫描 |
| 循环依赖检测 | integration.test.ts | 真实循环依赖场景 |

### 10.3 测试夹具

```
tests/knowledge-graph/fixtures/
├── simple-project/              # 单包项目
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── main.ts
│       ├── utils/
│       │   ├── format.ts
│       │   └── request.ts
│       └── components/
│           └── Header.vue
├── monorepo-project/            # monorepo 项目
│   ├── package.json
│   ├── pnpm-workspace.yaml
│   └── packages/
│       ├── shared/
│       │   ├── package.json
│       │   └── src/index.ts
│       └── app/
│           ├── package.json
│           └── src/main.ts
├── alias-project/               # alias 配置项目
│   ├── package.json
│   ├── tsconfig.json            # paths: { "@/*": ["src/*"] }
│   └── src/
│       ├── main.ts
│       └── utils/
│           └── helper.ts
└── cycle-project/               # 循环依赖项目
    ├── package.json
    └── src/
        ├── a.ts                 # a → b → a
        ├── b.ts
        ├── c.ts                 # c → d → e → c
        ├── d.ts
        └── e.ts
```

### 10.4 回归测试

| 测试范围 | 测试文件 | 说明 |
|---|---|---|
| v1.1 运行时监控 | tests/vue3-monitor.test.ts, tests/shield-cli.test.ts | 确保运行时采集无回归 |
| v1.2 code-quality | tests/quality.test.ts | 确保 ESLint/tsc/单测能力无回归 |
| v1.3 结构化日志 | tests/structured-logger.test.ts | 确保 NDJSON 日志无回归 |
| v1.4 Pinia/Vuex | tests/pinia-monitor.test.ts, tests/vuex-monitor.test.ts | 确保 store 错误采集无回归 |
| custom-rules | tests/custom-rules.test.ts | 确保自定义规则扫描无回归 |
| analyzer | tests/analyzer.test.ts | 确保日志聚合分析无回归 |

> 回归测试要求：`pnpm test` 全量通过，无新增失败用例。

---

## 11. 交付物 Checklist

参照 v1.4 格式，v1.5 交付物清单如下：

### 11.1 代码文件

| 文件路径 | 类型 | 说明 |
|---|---|---|
| lib/knowledge-graph/index.ts | 新增 | 编排入口 runKnowledgeGraph |
| lib/knowledge-graph/scanner.ts | 新增 | 并发文件扫描 + mtime 缓存 |
| lib/knowledge-graph/resolver.ts | 新增 | 模块路径解析器 |
| lib/knowledge-graph/collector.ts | 新增 | 依赖关系收集 visitor |
| lib/knowledge-graph/graph.ts | 新增 | 图构建 + 循环检测 + 连通分量 |
| lib/knowledge-graph/analyzer.ts | 新增 | 图谱分析（hub/孤立/分层） |
| lib/knowledge-graph/monorepo.ts | 新增 | monorepo 子包识别 + 聚合 |
| lib/knowledge-graph/json-output.ts | 新增 | JSON 格式输出 |
| lib/knowledge-graph/markdown-output.ts | 新增 | Markdown 摘要输出 |
| lib/knowledge-graph/types.ts | 新增 | 模块内部类型 |
| lib/cli/graph.ts | 新增 | graph 子命令 action handler |
| lib/types.ts | 扩展 | 新增 GraphOptions / GraphResult |
| cli.ts | 扩展 | 新增 graph 子命令定义 |
| lib/utils.ts | 复用 | assertLegacyProject 的 allowNoSrc 能力 |

### 11.2 测试文件

| 文件路径 | 类型 | 说明 |
|---|---|---|
| tests/knowledge-graph/resolver.test.ts | 新增 | 路径解析器单测 |
| tests/knowledge-graph/collector.test.ts | 新增 | 依赖收集单测 |
| tests/knowledge-graph/graph.test.ts | 新增 | 图构建与循环检测单测 |
| tests/knowledge-graph/analyzer.test.ts | 新增 | 图谱分析单测 |
| tests/knowledge-graph/monorepo.test.ts | 新增 | monorepo 支持单测 |
| tests/knowledge-graph/scanner.test.ts | 新增 | 并发扫描与缓存单测 |
| tests/knowledge-graph/integration.test.ts | 新增 | 集成测试（端到端） |
| tests/knowledge-graph/fixtures/* | 新增 | 测试夹具目录 |

### 11.3 文档文件

| 文件路径 | 类型 | 说明 |
|---|---|---|
| docs/specs/v1.5/design-v1.5.md | 新增 | 本设计文档 |
| docs/api.md | 扩展 | graph 子命令说明 |
| docs/README.md | 扩展 | 能力清单新增知识图谱 |

---

## 12. 验收标准

1. `shield graph --project <path>` 可在目标项目上生成 `knowledge-graph.json` 与 `architecture-summary.md`。
2. JSON 格式知识图谱结构完整，包含 nodes、edges、cycles、stats 四个部分。
3. Markdown 架构摘要为中文，包含 §7.2 定义的 6 个章节。
4. 知识图谱正确反映文件间 import / export / require 依赖关系。
5. 路径解析覆盖相对路径、`@/` alias、node_modules 包、扩展名补全。
6. 循环依赖被正确检测并输出循环链。
7. monorepo 项目可生成每个子包的独立图谱 + 全局聚合图谱。
8. 增量更新模式下，未变更文件跳过重新解析，性能显著优于全量重建。
9. 5000 文件规模项目全量扫描在 30 秒内完成（SSD 存储，并发数=8）。
10. `pnpm typecheck`、`pnpm build`、`pnpm test` 全量通过。
11. README、api.md 文档与代码行为一致。
12. v1.1 ~ v1.4 已有能力无回归。

---

## 13. 风险与缓解

| 风险 | 等级 | 缓解措施 |
|---|---|---|
| 模块路径解析边界情况多 | 中 | v1.5 只处理静态 import/require，动态 import() 标记为"未解析"边；文档中明确说明不支持的场景 |
| 大型项目性能不达标 | 中 | 并发扫描 + mtime 缓存 + 增量更新；T11 测试阶段验证，若不达标则升级为 v1.6 引入 Worker 线程 |
| monorepo 包间依赖解析不完整 | 中 | 支持 pnpm-workspace.yaml / lerna.json / package.json workspaces / packages/* 四种识别方式；workspace 协议解析覆盖 workspace:* / link: / file: |
| 图谱 schema 设计不当导致 AI 难消费 | 中 | Markdown 摘要已在 §7.2 给出样例，T11 测试阶段在真实 LLM 上验证效果 |
| alias 配置多样性 | 中 | v1.5 仅支持 tsconfig/jsconfig paths，不支持 webpack/vite resolve.alias；文档中明确说明 |
| mtime 缓存失效策略不当 | 低 | 缓存 key 包含文件路径 + mtime + alias 配置 hash；alias 变更时全部失效 |
| 与现有 custom-rules scanner 职责重叠 | 低 | graph 模块独立实现扫描器，不复用 custom-rules 的串行扫描；后续可考虑抽取公共能力 |

---

## 14. 评审记录

| 轮次 | 评审时间 | 评审结论 | 评审意见摘要 |
|---|---|---|---|
| 1 | 2026-06-22 | 不通过 | 3 个 P0 + 10 个 P1 问题，已修订 |
| 2 | 2026-06-22 | 不通过 | 3 个 P0 + 1 个 P1 未修复或新引入，已修订 |
| 3 | 2026-06-22 | 通过 | P0/P1 问题已全部修复，TypeScript 类型一致性与 CLI 校验逻辑验证通过 |
