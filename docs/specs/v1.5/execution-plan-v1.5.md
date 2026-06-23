# legacy-shield v1.5 执行计划

> 版本：v1.5
> 对应设计文档：[design-v1.5.md](design-v1.5.md)
> 对应阶段 Spec：phases/phase-v1.5-spec.md（已通过，2026-06-22 第 2 轮评审通过）
> 状态：已完成，已归档（冻结，不再修改）
> 编制日期：2026-06-22
> 评审记录：见文档末尾 §6（轮次 1 修改后通过、轮次 2 修改后通过、轮次 3 通过）

---

## 1. 任务总览

| 任务编号 | 任务名称 | 工作量 | 依赖 | 可并行 |
|---|---|---|---|---|
| T1 | 类型定义与图谱 schema（lib/types.ts 扩展 + lib/knowledge-graph/types.ts） | 低 | 无 | T2 |
| T2 | 模块路径解析器（alias/node_modules/扩展名补全） | 高 | 无 | T1 |
| T3 | 依赖关系收集 visitor（import/export/require + exports 收集） | 中 | T1、T2 | — |
| T4 | 文件扫描器改造（并发 + mtime 缓存 + 异常处理） | 中 | T2、T3 | — |
| T5 | 图构建器（邻接表 + 反向索引 + 循环检测 + 连通分量） | 中 | T1、T3 | — |
| T6 | 图谱分析器（hub/孤立/分层推断 + isEntry 计算） | 中 | T5 | — |
| T7 | JSON 输出器 | 低 | T5、T6 | T8 |
| T8 | Markdown 摘要生成器（中文 AI 优化格式） | 高 | T6 | T7 |
| T9 | monorepo 支持（子包识别 + 独立图谱 + 聚合图谱） | 高 | T2、T4、T5、T6 | — |
| T10 | 编排入口（lib/knowledge-graph/index.ts runKnowledgeGraph） | 低 | T7、T8、T9 | — |
| T11 | CLI 子命令集成（lib/cli/graph.ts runGraph 参数转换 + cli.ts 扩展） | 低 | T10 | — |
| T12 | 测试夹具、单测、集成测试、回归测试 | 中 | T11 | — |
| T13 | 文档更新与验收报告 | 低 | T12 | — |

> **并行性说明**：
> - T1 / T2 两者互不依赖，可完全并行启动（T1 仅定义类型，T2 自建 resolver，文件无交叉）。
> - T3 依赖 T1（CollectedFile / CollectedDependency 类型）与 T2（ModuleResolver 实例），必须在 T1、T2 完成后启动。
> - T4 依赖 T2（ModuleResolver 实例传入 scanFilesConcurrent）与 T3（CollectedFile 类型 + collectDependencies 调用），必须在 T2、T3 完成后启动。
> - T7 与 T8 互不依赖（分别消费 KnowledgeGraph 的不同字段），可在 T5、T6 完成后并行。
> - T9 依赖 T2（ModuleResolver）、T4（并发扫描能力）、T5（图构建能力）、T6（analyzeGraph 用于聚合图重新计算），与 T7 / T8 在时间上可重叠，但其验收需 T6 完成。
> - T10 为编排入口，必须在 T7、T8、T9 全部完成后进行（runKnowledgeGraph 编排 scanner → collector → graph → analyzer → monorepo → json-output / markdown-output 完整流程）。
> - T11 依赖 T10（runKnowledgeGraph 由 runGraph 调用），仅做 CLI 参数转换与 commander 注册。

---

## 2. 各任务详细计划

### T1：类型定义与图谱 schema（lib/types.ts 扩展 + lib/knowledge-graph/types.ts）

**输入**：
- [design-v1.5.md §2.1](design-v1.5.md#21-图谱节点类型)（GraphNode / GraphEdge / FileKind / NodeRole / EdgeKind）
- [design-v1.5.md §2.2](design-v1.5.md#22-图数据结构)（KnowledgeGraph / GraphStats）
- [design-v1.5.md §2.3](design-v1.5.md#23-json-输出-schema)（KnowledgeGraphJson）
- [design-v1.5.md §2.4](design-v1.5.md#24-类型定义扩展libtypests)（GraphOptions / GraphResult）

**输出**：
- `lib/types.ts`（扩展）：
  - 新增导出 `GraphOptions` 接口，字段含 `project: string`、`out?: string`、`concurrency?: number`、`fresh?: boolean`、`format?: 'json' | 'md' | 'both'`、`hubThreshold?: number`（hub 文件入度阈值，默认 10）
  - 新增导出 `GraphResult` 类型，字段含 `projectRoot`、`isMonorepo`、`packages`、`outputPath`、`nodeCount`、`edgeCount`、`cycleCount`、`durationMs`
- `lib/knowledge-graph/types.ts`（新增）：
  - `FileKind = 'js' | 'jsx' | 'ts' | 'tsx' | 'vue' | 'unknown'`
  - `NodeRole = 'entry' | 'core' | 'leaf' | 'isolated' | 'unknown'`
  - `EdgeKind = 'import' | 're-export' | 'require' | 'dynamic-import'`
  - `GraphNode` 接口（id / relativePath / kind / role / inDegree / outDegree / exports / isEntry / packageName）
  - `GraphEdge` 接口（from / to / kind / symbols / unresolved / rawSpec）
  - `KnowledgeGraph` 接口（projectRoot / isMonorepo / packages / nodes / adjacency / reverseAdjacency / edges / cycles / stats）
  - `GraphStats` 接口（nodeCount / edgeCount / cycleCount / componentCount / hubCount / isolatedCount / entryCount / unresolvedEdgeCount / maxInDegree / maxOutDegree）
  - `KnowledgeGraphJson` 接口（meta / nodes / edges / cycles / stats，对应 §2.3 schema）

**验收标准**：
- `pnpm typecheck` 零错误，`pnpm build` 通过
- `GraphOptions` 含 `hubThreshold?: number` 字段，类型为可选 number
- `GraphResult` 类型定义完整，8 个字段齐全
- `lib/knowledge-graph/types.ts` 中所有类型可被 `lib/types.ts` 通过相对路径导入
- `KnowledgeGraphJson.edges` 为数组类型（非 Map），与 §2.3 设计说明一致
- 类型定义不引入任何新的运行时依赖

---

### T2：模块路径解析器（alias/node_modules/扩展名补全）

**输入**：
- [design-v1.5.md §3.1](design-v1.5.md#31-alias-识别策略)（Alias 识别策略与优先级）
- [design-v1.5.md §3.2](design-v1.5.md#32-路径解析算法)（ModuleResolver 类与 resolve / resolveRelative / resolveAlias / resolveNodeModules / tryExtensions 方法）
- [design-v1.5.md §3.3](design-v1.5.md#33-边界情况处理)（动态 import / 变量 require / 非 JS 资源等边界）

**输出**：
- `lib/knowledge-graph/resolver.ts`（新增）：
  - `ResolverOptions` 接口（projectRoot / baseUrl? / paths?）
  - `ModuleResolver` 类，构造函数接收 `ResolverOptions`
  - `resolve(spec, importer): string | null` 公开方法，按优先级依次尝试：相对路径 → alias 路径 → node_modules 包路径
  - `resolveRelative(spec, baseDir)`：基于 `path.resolve` 拼接后调用 `tryExtensions`
  - `resolveAlias(spec)`：遍历 `paths` 映射，正则匹配 `*` 通配符（先转义正则元字符再替换 `*` 为捕获组），命中后用捕获组替换 target 中的 `*`
  - `resolveNodeModules(spec, importer)`：支持 scoped 包名（`@scope/pkg` 含斜杠，取前两段为包名）；从 importer 目录逐级向上查找 `node_modules/<pkg>/<subPath>`；**根目录检查**：当 `dirname(dir) === dir` 时终止向上查找
  - `tryExtensions(basePath)`：依次尝试直接匹配 → 补全扩展名（`.ts` / `.tsx` / `.js` / `.jsx` / `.vue`）→ index 文件
  - 读取目标项目根目录的 `tsconfig.json`，若不存在则读取 `jsconfig.json`，解析 `compilerOptions.baseUrl` 与 `compilerOptions.paths`
- 不引入 `enhanced-resolve` 依赖（自建轻量 resolver）

**验收标准**：
- `pnpm typecheck` 零错误，`pnpm build` 通过
- `package.json` 中无 `enhanced-resolve` 新增依赖
- `resolve('./foo', '/proj/src/main.ts')` 能正确解析到 `/proj/src/foo.ts`（扩展名补全）
- `resolve('@/utils/bar', '/proj/src/main.ts')` 在 tsconfig paths 配置 `{"@/*": ["src/*"]}` 时解析到 `/proj/src/utils/bar.ts`
- `resolve('@vue/compiler-sfc/foo', '/proj/src/main.ts')` 能解析到 `node_modules/@vue/compiler-sfc/foo.ts`（scoped 包）
- `resolve('lodash', importer)` 返回 `null`（纯包名无子路径，跳过）
- 无 tsconfig/jsconfig 的纯 JS 项目，相对路径与 node_modules 解析仍正常工作
- `tryExtensions` 对 `index.ts` / `index.js` 等 index 文件能正确解析
- 向上查找 node_modules 时，到达根目录（`dirname(dir) === dir`）能正确终止，不无限循环

---

### T3：依赖关系收集 visitor（import/export/require + exports 收集）

**输入**：
- [design-v1.5.md §4.1](design-v1.5.md#41-babel-visitor-设计)（CollectedDependency / CollectedFile 接口、collectDependencies 函数、Babel visitor 实现）
- [design-v1.5.md §4.2](design-v1.5.md#42-vue-sfc-处理)（Vue SFC 解析流程）
- [design-v1.5.md §4.3](design-v1.5.md#43-复用现有-ast-解析配置)（Babel 插件配置，参考 ast-skeleton.ts 的 pluginsFor）
- 现有文件参考：[lib/code-quality/lib/ast-skeleton.ts](file:///Users/creayma/personal/legacy-shield/lib/code-quality/lib/ast-skeleton.ts) 的 `pluginsFor` 实现思路、[lib/custom-rules/scanner.ts](file:///Users/creayma/personal/legacy-shield/lib/custom-rules/scanner.ts) 的 `parseCode` 实现思路

**输出**：
- `lib/knowledge-graph/collector.ts`（新增）：
  - `CollectedDependency` 接口（spec / kind / symbols / unresolved / line）
  - `CollectedFile` 接口（dependencies: CollectedDependency[] + exports: string[]）
  - `parseFile(filePath, code): { ast: File; isTs: boolean }` 函数：
    - 参考 `ast-skeleton.ts` 的 `pluginsFor` 实现思路，根据后缀选择 Babel 插件（`.js`/`.jsx` → `['jsx', 'importAssertions', 'topLevelAwait']`；`.ts` → `['typescript', 'importAssertions', 'topLevelAwait']`；`.tsx` → `['typescript', 'jsx', 'importAssertions', 'topLevelAwait']`）
    - 启用 `errorRecovery: true`，确保大规模扫描容错性
    - `.vue` 文件先用 `@vue/compiler-sfc` 的 `parse` 提取 `<script>` 或 `<script setup>` 内容，再根据 `lang` 属性决定是否启用 TypeScript 插件
    - 参考 `scanner.ts` 的 `parseCode` 实现思路独立实现 Vue SFC 解析
  - `collectDependencies(filePath, code, resolver): CollectedFile` 函数：
    - Babel visitor 覆盖 `ImportDeclaration`（收集 import 依赖 + symbols）、`ExportNamedDeclaration`（有 source 时记录 re-export 依赖；无 source 时收集本地导出符号，含 `export const/function/class` 声明形式）、`ExportAllDeclaration`（`export *` 记录为 re-export）、`ExportDefaultDeclaration`（exports 推入 `'default'`）、`CallExpression`（`require()` 字符串字面量记录为 require 依赖，变量 require 标记 `unresolved: true`）、`ImportExpression`（`import()` 字符串字面量记录为 dynamic-import，非字面量标记 `unresolved: true`）
    - 解析阶段：对每个 dep 调用 `resolver.resolve(dep.spec, filePath)`，解析失败则标记 `unresolved: true`
    - 返回 `{ dependencies: resolvedDeps, exports }`

**验收标准**：
- `pnpm typecheck` 零错误，`pnpm build` 通过
- `collectDependencies` 返回 `CollectedFile` 类型，含 `dependencies` 与 `exports` 两个字段
- `parseFile` 函数签名为 `{ ast: File; isTs: boolean }`，`isTs` 对 `.ts`/`.tsx`/`lang=ts` 的 Vue 文件返回 `true`
- 对 `import { foo } from './bar'` 能正确收集 spec=`'./bar'`、kind=`'import'`、symbols=`['foo']`
- 对 `export { foo }` 能正确收集 exports=`['foo']`；对 `export const bar = 1` 能收集 exports=`['bar']`
- 对 `export { foo } from './bar'` 记录为 re-export 依赖（不计入本文件 exports）
- 对 `export default function(){}` 收集 exports=`['default']`
- 对 `require('./bar')` 收集 kind=`'require'`；对 `require(varName)` 标记 `unresolved: true`
- 对 `import('./bar')` 收集 kind=`'dynamic-import'`；对 `import(varName)` 标记 `unresolved: true`
- `.vue` 文件能正确提取 `<script setup>` 内容并解析依赖
- Babel 解析启用 `errorRecovery: true`，语法错误文件不抛异常（返回空依赖）
- 不引入新的运行时依赖（复用现有 `@babel/parser`、`@babel/traverse`、`@vue/compiler-sfc`）

---

### T4：文件扫描器改造（并发 + mtime 缓存 + 异常处理）

**输入**：
- [design-v1.5.md §8.1](design-v1.5.md#81-并发扫描策略)（并发模型、scanFilesConcurrent 实现）
- [design-v1.5.md §8.2](design-v1.5.md#82-mtime-缓存设计)（缓存存储位置、CacheEntry / CacheFile 结构、失效策略、aliasHash 计算）

**输出**：
- `lib/knowledge-graph/scanner.ts`（新增）：
  - `CacheEntry` 接口（path / mtime / aliasHash / dependencies / exports）
  - `CacheFile` 接口（version / generatedAt / aliasHash / entries: `Record<string, CacheEntry>`）
  - `scanFilesConcurrent(filePaths, resolver, concurrency): Promise<Map<string, CollectedFile>>` 函数：
    - 使用索引游标 `cursor` 替代 `queue.shift()`，避免 O(n) 数组移位开销
    - 创建 `concurrency` 个 worker，每个 worker 通过 `while (cursor < filePaths.length)` 循环取任务
    - 每个 worker 内用 `try-catch` 包裹 `readFile` 与 `collectDependencies`，单文件失败仅 `console.warn` 告警并写入空依赖 `{ dependencies: [], exports: [] }`，不影响整体扫描
    - 返回 `Map<string, CollectedFile>`
  - mtime 缓存读写函数：
    - `loadCache(projectRoot): CacheFile | null`：读取 `<project>/.legacy-shield/knowledge-graph/.cache.json`
    - `saveCache(projectRoot, cache: CacheFile): Promise<void>`：写入缓存文件
    - `computeAliasHash(tsconfig): string`：基于 `compilerOptions.paths` 与 `compilerOptions.baseUrl` 的 MD5 hash，无 tsconfig 时返回 `'none'`
  - 缓存失效策略实现：
    - 文件 mtime 变更 → 该文件缓存失效
    - alias 配置 hash 变更 → 全部缓存失效
    - `--fresh` 参数 → 忽略缓存，全量重建
    - 缓存文件不存在 → 全量重建

**验收标准**：
- `pnpm typecheck` 零错误，`pnpm build` 通过
- `scanFilesConcurrent` 返回 `Map<string, CollectedFile>`，key 为文件绝对路径
- 使用索引游标 `cursor` 而非 `queue.shift()`（代码中无 `shift()` 调用）
- 单文件解析抛错时，该文件在返回 Map 中对应 `{ dependencies: [], exports: [] }`，整体扫描不中断
- mtime 缓存结构为 `Record<string, CacheEntry>`（CacheFile.entries 字段）
- 首次扫描后 `.cache.json` 文件生成于 `<project>/.legacy-shield/knowledge-graph/.cache.json`
- 第二次扫描（无文件变更）命中缓存，跳过 `collectDependencies` 调用
- 修改某文件后第二次扫描，仅该文件重新解析，其余命中缓存
- alias 配置变更（tsconfig.paths 修改）后，全部缓存失效，全量重建
- `--fresh` 参数为 true 时，忽略缓存全量重建
- 并发数可通过参数配置，默认 8

---

### T5：图构建器（邻接表 + 反向索引 + 循环检测 + 连通分量）

**输入**：
- [design-v1.5.md §5.1](design-v1.5.md#51-邻接表数据结构)（邻接表与反向邻接表构建方式）
- [design-v1.5.md §5.2](design-v1.5.md#52-循环依赖检测算法)（DFS 三色标记法 + 去重逻辑）
- [design-v1.5.md §5.5](design-v1.5.md#55-连通分量计算)（并查集弱连通分量算法）

**输出**：
- `lib/knowledge-graph/graph.ts`（新增）：
  - `buildGraph(projectRoot, collected: Map<string, CollectedFile>, resolver): KnowledgeGraph` 函数：
    - 构建 `nodes: Map<string, GraphNode>`，每个文件对应一个 GraphNode
    - 构建 `adjacency: Map<string, string[]>`（正向邻接表）
    - 构建 `reverseAdjacency: Map<string, string[]>`（反向邻接表）：遍历每条边 (from, to) 时，在 `adjacency[from]` 添加 to 的**同时**在 `reverseAdjacency[to]` 添加 from（同步填充，避免二次遍历）
    - 构建 `edges: GraphEdge[]`，对每个 CollectedFile 的 dependencies 转换为 GraphEdge
    - 初始化 `cycles: string[][]` 与 `stats: GraphStats`（stats 字段在 T6 中填充完整）
  - `detectCycles(adjacency: Map<string, string[]>): string[][]` 函数：
    - DFS 三色标记法（WHITE=0 未访问、GRAY=1 访问中、BLACK=2 已完成）
    - 发现 GRAY 邻居时，从 stack 中找到循环起点，截取循环链并拼接起点节点
    - 去重：对每个循环节点集合 `[...new Set(cycle)].sort().join('|')` 作为 key，相同 key 仅保留一条
  - `computeComponents(nodeIds, edges): { componentCount: number; componentOf: Map<string, number> }` 函数：
    - 并查集（Union-Find）算法，`find` 带路径压缩，`union` 合并集合
    - 所有边视为无向（弱连通分量），遍历 edges 调用 `union(edge.from, edge.to)`
    - 统计根节点数量为 `componentCount`，为每个节点分配 `componentId`

**验收标准**：
- `pnpm typecheck` 零错误，`pnpm build` 通过
- `buildGraph` 返回 `KnowledgeGraph` 类型，含 `nodes`、`adjacency`、`reverseAdjacency`、`edges`、`cycles` 字段
- 反向邻接表与正向邻接表一致：对任意边 (from, to)，`reverseAdjacency[to]` 包含 from
- `detectCycles` 对 `a → b → a` 循环能检测出，返回 `[['a', 'b', 'a']]`（或等价形式）
- `detectCycles` 对 `a → b → c → a` 三节点循环能正确检测
- `detectCycles` 对无环图返回空数组
- `detectCycles` 对同一循环的不同入口（如从 a 或从 b 开始 DFS）去重为 1 条
- `computeComponents` 对 `a → b`、`c → d` 两个独立连通分量返回 `componentCount: 2`
- `computeComponents` 的 `find` 函数带路径压缩（代码中可见路径压缩逻辑）
- DFS 三色标记法使用 WHITE/GRAY/BLACK 三种状态（代码中可见三色常量）

---

### T6：图谱分析器（hub/孤立/分层推断 + isEntry 计算）

**输入**：
- [design-v1.5.md §5.3](design-v1.5.md#53-hub--孤立文件识别)（Hub / 孤立 / 入口文件定义与 isEntry 计算时机）
- [design-v1.5.md §5.4](design-v1.5.md#54-分层结构推断)（分层结构与拓扑排序）

**输出**：
- `lib/knowledge-graph/analyzer.ts`（新增）：
  - `analyzeGraph(graph: KnowledgeGraph, hubThreshold: number): KnowledgeGraph` 函数：
    - **图构建完成后统一计算 isEntry**：遍历所有节点，`isEntry = inDegree === 0 && outDegree > 0`（避免边插入过程中部分边未建立导致误判）
    - 计算 `GraphNode.role`：
      - `'entry'`：isEntry 为 true
      - `'isolated'`：inDegree === 0 且 outDegree === 0
      - `'core'`：inDegree >= hubThreshold（hub 文件）
      - `'leaf'`：outDegree === 0 且 inDegree > 0
      - `'unknown'`：其余
    - 填充 `GraphStats`：
      - `hubCount`：inDegree >= hubThreshold 的节点数
      - `isolatedCount`：入度=0 且出度=0 的节点数
      - `entryCount`：isEntry 为 true 的节点数
      - `maxInDegree` / `maxOutDegree`：所有节点的最大入度/出度
      - `unresolvedEdgeCount`：edges 中 `unresolved === true` 的边数
      - `componentCount`：调用 `computeComponents` 获取
  - `inferLayers(graph: KnowledgeGraph, hubThreshold: number): { entry: string[]; core: string[]; middle: string[]; leaf: string[]; isolated: string[] }` 函数：
    - 入口层：入度=0 且出度>0
    - 核心层：入度 >= hubThreshold（hub 文件）
    - 叶子层：出度=0 且入度>0
    - 中间层：其余文件
    - 孤立：入度=0 且出度=0

**验收标准**：
- `pnpm typecheck` 零错误，`pnpm build` 通过
- isEntry 在图构建完成后统一计算（不在 buildGraph 边插入过程中计算）
- hub 阈值默认 10，可通过 `hubThreshold` 参数配置
- `analyzeGraph` 后，`GraphNode.role` 字段被正确赋值（entry/core/leaf/isolated/unknown）
- 入度=0 且出度>0 的节点 `isEntry === true`、`role === 'entry'`
- 入度>=10 的节点 `role === 'core'`（hub 文件）
- 入度=0 且出度=0 的节点 `role === 'isolated'`
- 出度=0 且入度>0 的节点 `role === 'leaf'`
- `GraphStats` 所有字段被填充，`hubCount` + `isolatedCount` + `entryCount` 与节点实际状态一致
- `inferLayers` 返回 5 个数组，节点总数等于图中节点数

---

### T7：JSON 输出器

**输入**：
- [design-v1.5.md §2.3](design-v1.5.md#23-json-输出-schema)（KnowledgeGraphJson schema）
- [design-v1.5.md §7.1](design-v1.5.md#71-json-输出格式)（输出文件名 knowledge-graph.json）
- [design-v1.5.md §2.3 设计说明](design-v1.5.md#23-json-输出-schema)（edges 列表替代邻接表的设计说明）

**输出**：
- `lib/knowledge-graph/json-output.ts`（新增）：
  - `toJson(graph: KnowledgeGraph): KnowledgeGraphJson` 函数：
    - 构造 `meta` 对象（projectRoot / isMonorepo / packages / generatedAt / nodeCount / edgeCount / cycleCount）
    - 将 `nodes: Map<string, GraphNode>` 转换为 `nodes: Array<...>`（展开 GraphNode 所有字段）
    - **以 edges 列表替代邻接表**：直接输出 `graph.edges` 数组，不输出 adjacency / reverseAdjacency（消费方可从 edges 重建邻接表）
    - 输出 `cycles: string[][]` 与 `stats: GraphStats`
  - `writeJson(graph: KnowledgeGraph, outputPath: string): Promise<string>` 函数：
    - 调用 `toJson` 生成 JSON 对象
    - `JSON.stringify` 序列化（2 空格缩进）
    - 写入 `<outputPath>/knowledge-graph.json`
    - 返回写入的文件路径

**验收标准**：
- `pnpm typecheck` 零错误，`pnpm build` 通过
- JSON 输出以 `edges` 列表形式输出（非邻接表 Map），与 §2.3 设计说明一致
- 输出文件名为 `knowledge-graph.json`
- JSON 结构包含 `meta`、`nodes`、`edges`、`cycles`、`stats` 五个顶层字段
- `meta.generatedAt` 为 ISO 8601 格式时间字符串
- `nodes` 为数组，每个元素含 id / relativePath / kind / role / inDegree / outDegree / exports / isEntry / packageName 字段
- `edges` 为数组，每个元素含 from / to / kind / symbols / unresolved / rawSpec 字段
- JSON 文件可被 `JSON.parse` 正确解析
- 从 edges 列表可重建邻接表：`edges.forEach(e => adjacency[e.from].push(e.to))`

---

### T8：Markdown 摘要生成器（中文 AI 优化格式）

**输入**：
- [design-v1.5.md §7.2](design-v1.5.md#72-markdown-摘要章节结构与样例)（6 章节结构与完整样例）

**输出**：
- `lib/knowledge-graph/markdown-output.ts`（新增）：
  - `toMarkdown(graph: KnowledgeGraph, layers: ReturnType<typeof inferLayers>): string` 函数，生成中文 Markdown，6 章节结构：
    1. **项目架构概览**：项目类型（单包/monorepo）、源码目录、节点总数、框架特征（Vue/TS 检测）、入口文件数、hub 文件数、孤立文件数
    2. **模块依赖拓扑**：顶层目录依赖关系表（目录 / 文件数 / 被依赖次数 / 依赖外部次数 / 角色）、核心依赖链（2-3 条典型链路）
    3. **关键节点识别**：Hub 文件表（文件路径 / 入度 / 出度 / 导出符号数 / 说明）、孤立文件表（文件路径 / 说明）
    4. **循环依赖分析**：每个循环列出完整链路 + 拆解建议
    5. **分层结构推断**：分层表（层级 / 文件数 / 说明），含入口层 / 核心层 / 中间层 / 叶子层 / 孤立
    6. **架构健康度评估**：指标表（循环依赖密度 / Hub 文件占比 / 孤立文件占比 / 平均入度 / 平均出度 / 最大入度）+ 总体评估文字
  - `writeMarkdown(graph: KnowledgeGraph, layers, outputPath: string): Promise<string>` 函数：
    - 调用 `toMarkdown` 生成内容
    - 写入 `<outputPath>/architecture-summary.md`
    - 返回写入的文件路径
  - 文件头含生成时间、项目路径、项目类型、节点数 / 边数 / 循环依赖数 / 孤立文件数摘要

**验收标准**：
- `pnpm typecheck` 零错误，`pnpm build` 通过
- Markdown 输出为**中文**（非英文，非 JSON 简单转译）
- 输出文件名为 `architecture-summary.md`
- 包含 §7.2 定义的 6 个章节，章节标题与样例一致
- 文件头含生成时间、项目路径、项目类型、节点/边/循环/孤立摘要
- Hub 文件表含入度、出度、导出符号数、说明列
- 循环依赖分析对每个循环给出完整链路（如 `a.ts → b.ts → a.ts`）+ 拆解建议
- 分层结构推断表含 5 层（入口层 / 核心层 / 中间层 / 叶子层 / 孤立）
- 健康度评估含 6 项指标（循环依赖密度 / Hub 占比 / 孤立占比 / 平均入度 / 平均出度 / 最大入度）+ 总体评估文字
- Markdown 内容为 AI 优化格式（结构化表格 + 判断性文字，非纯数据堆砌）

---

### T9：monorepo 支持（子包识别 + 独立图谱 + 聚合图谱）

**输入**：
- [design-v1.5.md §6.1](design-v1.5.md#61-子包识别策略)（4 级优先级识别策略）
- [design-v1.5.md §6.2](design-v1.5.md#62-独立图谱生成)（子包独立图谱生成流程）
- [design-v1.5.md §6.3](design-v1.5.md#63-聚合图谱生成)（聚合图谱与跨包依赖解析）

**输出**：
- `lib/knowledge-graph/monorepo.ts`（新增）：
  - `detectMonorepo(projectRoot: string): { isMonorepo: boolean; packages: string[] }` 函数，按 4 级优先级识别：
    1. `package.json` 的 `workspaces` 字段（npm/yarn workspaces，JSON 原生解析）
    2. `lerna.json` 的 `packages` 字段（JSON 原生解析）
    3. `pnpm-workspace.yaml` 的 `packages` 字段：**简化解析**（仅识别 `packages:` 顶层数组字面量，不支持 YAML 锚点/合并键），解析失败降级为无 workspace 模式；不引入 `js-yaml` 依赖
    4. `packages/*` 目录约定：若存在 `packages/` 目录且其下每个子目录都有 `package.json`，视为 monorepo
  - `generatePackageGraph(packageRoot: string, options: GraphOptions): KnowledgeGraph` 函数：
    - 以子包根目录为 `projectRoot`
    - 读取子包的 `tsconfig.json` / `jsconfig.json` 获取 alias 配置
    - 扫描子包 `src/` 目录
    - 生成子包独立图谱
  - `generateAggregateGraph(packageGraphs: KnowledgeGraph[], projectRoot: string): KnowledgeGraph` 函数：
    - 合并所有子包的节点与边
    - 解析跨包依赖：
      - `workspace:*` 协议：解析为对应子包的入口
      - `link:./packages/foo` 协议：解析为对应子包
      - `file:./packages/foo` 协议：解析为对应子包
      - node_modules 软链接（pnpm 风格）：解析为对应子包
    - 重新计算聚合图的统计指标（调用 T5/T6 的分析函数）

**验收标准**：
- `pnpm typecheck` 零错误，`pnpm build` 通过
- `package.json` 中无 `js-yaml` 新增依赖
- `detectMonorepo` 对 `package.json` 含 `workspaces` 字段的项目识别为 monorepo（优先级 1）
- `detectMonorepo` 对 `lerna.json` 含 `packages` 字段的项目识别为 monorepo（优先级 2）
- `detectMonorepo` 对 `pnpm-workspace.yaml` 含 `packages: ['packages/*']` 的项目识别为 monorepo（优先级 3，简化解析）
- `detectMonorepo` 对 `pnpm-workspace.yaml` 含 YAML 锚点等高级特性的解析失败时降级为优先级 4
- `detectMonorepo` 对 `packages/` 目录下每个子目录都有 `package.json` 的项目识别为 monorepo（优先级 4）
- `detectMonorepo` 对单包项目返回 `{ isMonorepo: false, packages: [] }`
- `generatePackageGraph` 为每个子包生成独立图谱，节点 `packageName` 字段为子包名
- `generateAggregateGraph` 合并所有子包图谱，`workspace:*` / `link:` / `file:` 协议的跨包依赖被正确解析为子包入口
- 聚合图谱的 `stats` 被重新计算（非简单累加）

---

### T10：编排入口（lib/knowledge-graph/index.ts runKnowledgeGraph）

**输入**：
- [design-v1.5.md §11.1](design-v1.5.md#111-代码文件)（lib/knowledge-graph/index.ts 编排入口职责）
- [design-v1.5.md §9.1](design-v1.5.md#91-参数定义)（GraphOptions 字段定义）
- T2（ModuleResolver）、T4（scanFilesConcurrent）、T5（buildGraph）、T6（analyzeGraph / inferLayers）、T7（writeJson）、T8（writeMarkdown）、T9（detectMonorepo / generatePackageGraph / generateAggregateGraph）

**输出**：
- `lib/knowledge-graph/index.ts`（新增）：
  - `runKnowledgeGraph(options: GraphOptions): Promise<GraphResult>` 函数，编排完整流程：
    1. 读取目标项目根目录的 `tsconfig.json` / `jsconfig.json`，构造 `ModuleResolver`（T2）
    2. 调用 `detectMonorepo`（T9）判断是否为 monorepo
    3. **单包流程**：
       - 调用 `scanFilesConcurrent`（T4）扫描 `src/` 目录，返回 `Map<string, CollectedFile>`
       - 调用 `buildGraph`（T5）构建 `KnowledgeGraph`
       - 调用 `analyzeGraph`（T6）填充 role / isEntry / stats
       - 调用 `inferLayers`（T6）生成分层结构
    4. **monorepo 流程**：
       - 对每个子包调用 `generatePackageGraph`（T9）生成独立图谱
       - 调用 `generateAggregateGraph`（T9）合并为聚合图谱
       - 对聚合图谱调用 `analyzeGraph`（T6）重新计算统计指标
       - 调用 `inferLayers`（T6）对聚合图谱生成分层结构（供 T8 writeMarkdown 使用）
    5. 根据 `options.format` 调用 `writeJson`（T7）和/或 `writeMarkdown`（T8）输出到 `options.out || <project>/.legacy-shield/knowledge-graph/`
    6. 返回 `GraphResult`（含 projectRoot / isMonorepo / packages / outputPath / nodeCount / edgeCount / cycleCount / durationMs）
  - 记录 `startTime`，在 finally 块中计算 `durationMs = Date.now() - startTime`

**验收标准**：
- `pnpm typecheck` 零错误，`pnpm build` 通过
- `lib/knowledge-graph/index.ts` 存在并导出 `runKnowledgeGraph` 函数
- `runKnowledgeGraph` 编排 scanner → graph → analyzer → monorepo → output 完整流程，不跳过任何环节
- 单包项目调用后返回 `GraphResult`，`isMonorepo === false`、`packages === []`
- monorepo 项目调用后返回 `GraphResult`，`isMonorepo === true`、`packages` 含各子包路径
- `options.format === 'json'` 仅生成 `knowledge-graph.json`；`'md'` 仅生成 `architecture-summary.md`；`'both'` 两者均生成
- `options.fresh === true` 时，`scanFilesConcurrent` 忽略缓存全量重建
- `options.out` 未传时，输出到 `<project>/.legacy-shield/knowledge-graph/`；传入时输出到指定目录
- `durationMs` 为非负整数，反映实际耗时
- `runKnowledgeGraph` 不直接依赖 commander，可被 CLI 与测试独立调用

---

### T11：CLI 子命令集成（lib/cli/graph.ts runGraph 参数转换 + cli.ts 扩展）

**输入**：
- [design-v1.5.md §9.1](design-v1.5.md#91-参数定义)（commander 参数定义与选项校验逻辑）
- [design-v1.5.md §9.2](design-v1.5.md#92-输出路径)（默认输出路径与自定义）
- [design-v1.5.md §9.3](design-v1.5.md#93-与-quality-子命令的关系)（与 quality 完全独立）
- T10（runKnowledgeGraph 编排入口）

**输出**：
- `lib/cli/graph.ts`（新增）：
  - `runGraph(options: GraphOptions): Promise<GraphResult>` 函数：
    - **仅做参数转换与委托**：直接调用 `runKnowledgeGraph(options)` 并返回结果
    - 不包含任何业务编排逻辑（编排职责归属 T10 的 `lib/knowledge-graph/index.ts`）
    - 作为 CLI action handler 与编排入口之间的薄层适配器，便于 CLI 层注入日志、错误格式化等横切关注点
- `cli.ts`（扩展）：
  - 文件顶部**静态 import** `runGraph`（与其他子命令一致，不使用动态 import）：`import { runGraph } from './lib/cli/graph.js';`
  - 新增 `program.command('graph')` 子命令定义
  - `.requiredOption('--project <path>', '目标项目根路径')`
  - `.option('--out <path>', '输出目录', '')`
  - `.option('--concurrency <n>', '并发扫描数', '8')`
  - `.option('--fresh', '强制全量重建，忽略缓存')`
  - `.option('--format <format>', '输出格式（json/md/both）', 'both')`
  - `.option('--hub-threshold <n>', 'hub 文件入度阈值', '10')`
  - `.action` 内选项校验：
    - `concurrency = Number(opts.concurrency)`，校验 `Number.isInteger(concurrency) && concurrency >= 1`，否则抛错
    - `format` 校验 `['json', 'md', 'both'].includes(opts.format)`，否则抛错
    - `hubThreshold = Number(opts.hubThreshold)`，校验 `Number.isInteger(hubThreshold) && hubThreshold >= 0`，否则抛错
  - 调用 `runGraph` 并输出结果摘要（节点数、边数、循环依赖数、输出路径、耗时）

**验收标准**：
- `pnpm typecheck` 零错误，`pnpm build` 通过
- `lib/cli/graph.ts` 中 `runGraph` 仅委托 `runKnowledgeGraph`，不包含 scanner / graph / analyzer 等编排逻辑
- `cli.ts` 中 `runGraph` 为静态 import（文件顶部，非 action 内动态 import）
- `shield graph --project <path>` 命令可用，与 quality / report / api 子命令并列
- commander 传入的数值参数（concurrency / hubThreshold）先 `Number()` 转换再校验
- `concurrency` 非整数或 < 1 时抛错（如 `--concurrency 0` / `--concurrency abc`）
- `format` 非 `json` / `md` / `both` 时抛错（如 `--format xml`）
- `hubThreshold` 非整数或 < 0 时抛错（如 `--hub-threshold -1`）
- 默认输出路径为 `<project>/.legacy-shield/knowledge-graph/`
- `--out <path>` 可自定义输出目录
- `--format json` 仅输出 `knowledge-graph.json`；`--format md` 仅输出 `architecture-summary.md`；`--format both` 输出两者
- graph 子命令与 quality 子命令完全独立，运行 `shield graph` 不触发 quality 流程

---

### T12：测试夹具、单测、集成测试、回归测试

**输入**：
- [design-v1.5.md §10.1](design-v1.5.md#101-单元测试)（单元测试矩阵）
- [design-v1.5.md §10.2](design-v1.5.md#102-集成测试)（集成测试场景）
- [design-v1.5.md §10.3](design-v1.5.md#103-测试夹具)（4 套测试夹具结构）
- [design-v1.5.md §10.4](design-v1.5.md#104-回归测试)（回归测试范围）
- T1-T11 输出

**输出**：
- 测试夹具（4 套，不引入运行时依赖）：
  - `tests/knowledge-graph/fixtures/simple-project/`：单包项目（package.json / tsconfig.json / src/main.ts / src/utils/format.ts / src/utils/request.ts / src/components/Header.vue）
  - `tests/knowledge-graph/fixtures/monorepo-project/`：monorepo 项目（package.json / pnpm-workspace.yaml / packages/shared/{package.json,src/index.ts} / packages/app/{package.json,src/main.ts}）
  - `tests/knowledge-graph/fixtures/alias-project/`：alias 配置项目（package.json / tsconfig.json with `paths: {"@/*": ["src/*"]}` / src/main.ts / src/utils/helper.ts）
  - `tests/knowledge-graph/fixtures/cycle-project/`：循环依赖项目（package.json / src/a.ts / src/b.ts（a→b→a）/ src/c.ts / src/d.ts / src/e.ts（c→d→e→c））
- 单元测试：
  - `tests/knowledge-graph/resolver.test.ts`：相对路径、alias、node_modules、扩展名补全、index 解析、动态 import 标记、scoped 包解析、根目录终止
  - `tests/knowledge-graph/collector.test.ts`：import/export/require/dynamic-import 收集、Vue SFC 解析、Babel 解析容错、exports 收集（含默认导出与声明形式）
  - `tests/knowledge-graph/graph.test.ts`：邻接表构建、反向邻接表同步填充、循环检测（2 节点 / 3 节点 / 无环）、循环去重、连通分量计算
  - `tests/knowledge-graph/analyzer.test.ts`：hub 识别（阈值边界）、孤立文件识别、入口文件识别、分层推断、isEntry 统一计算
  - `tests/knowledge-graph/monorepo.test.ts`：4 级优先级识别、pnpm-workspace.yaml 简化解析、聚合图谱、workspace:* / link: / file: 协议解析
  - `tests/knowledge-graph/scanner.test.ts`：并发扫描、mtime 缓存命中/失效、--fresh 强制重建、单文件异常不影响整体、aliasHash 变更全量失效
- 集成测试：
  - `tests/knowledge-graph/integration.test.ts`：
    - 单包项目端到端（simple-project）：CLI 调用 → JSON + Markdown 输出
    - monorepo 项目端到端（monorepo-project）：子包识别 + 独立图谱 + 聚合图谱
    - alias 项目端到端（alias-project）：tsconfig paths 解析
    - 循环依赖检测端到端（cycle-project）：真实循环依赖场景
    - 增量更新：首次全量 → 修改文件 → 增量扫描
- 回归测试（覆盖 v1.1~v1.4）：
  - `tests/vue3-monitor.test.ts`、`tests/shield-cli.test.ts`（v1.1 运行时监控）
  - `tests/quality.test.ts`（v1.2 code-quality）
  - `tests/structured-logger.test.ts`（v1.3 结构化日志）
  - `tests/pinia-monitor.test.ts`、`tests/vuex-monitor.test.ts`（v1.4 Pinia/Vuex）
  - `tests/custom-rules.test.ts`（custom-rules 扫描）
  - `tests/analyzer.test.ts`（日志聚合分析）

**验收标准**：
- `pnpm typecheck`、`pnpm build`、`pnpm test` 全量通过
- 4 套测试夹具目录结构完整（simple-project / monorepo-project / alias-project / cycle-project）
- 单元测试覆盖各模块核心场景（resolver / collector / graph / analyzer / monorepo / scanner）
- 集成测试覆盖 5 个端到端场景（单包 / monorepo / alias / 循环 / 增量更新）
- 回归测试覆盖 v1.1~v1.4 全部既有测试，零回归（无新增失败用例）
- cycle-project 夹具的循环依赖被正确检测（a→b→a 与 c→d→e→c）
- monorepo-project 夹具的子包被正确识别，聚合图谱包含跨包依赖
- alias-project 夹具的 `@/utils/helper` 被正确解析
- simple-project 夹具的 Vue SFC 文件（Header.vue）依赖被正确收集

---

### T13：文档更新与验收报告

**输入**：
- [design-v1.5.md §11](design-v1.5.md#11-交付物-checklist)（交付物清单）
- [design-v1.5.md §12](design-v1.5.md#12-验收标准)（验收标准 12 条）
- T1-T12 输出与测试结果

**输出**：
- `docs/specs/v1.5/acceptance-report-v1.5.md`（新增）：依据 §12 验收标准 12 条逐条填写测试结果与结论
- `README.md`（扩展）：能力清单新增「知识图谱生成」章节，说明 `shield graph` 子命令用法
- `docs/api.md`（扩展）：新增 graph 子命令说明（参数定义、输出路径、与 quality 的关系、示例命令）
- 文档内容与代码行为一致

**验收标准**：
- `docs/specs/v1.5/acceptance-report-v1.5.md` 存在，含 12 条验收标准的逐条结论
- `README.md` 含「知识图谱生成」能力说明与 `shield graph` 用法
- `docs/api.md` 含 graph 子命令的参数定义、输出路径、示例
- 文档内容与实际代码行为一致（参数名、默认值、输出文件名均与代码一致）
- `pnpm typecheck`、`pnpm build`、`pnpm test` 全量通过

---

## 3. 工作量估算与里程碑

> 由于本项目为单人开发，里程碑日期为 SOLO Coder 自评的预估窗口，实际可滑动。

| 里程碑 | 工作量（人时） | 预计完成 | 触发条件 |
|---|---|---|---|
| 设计文档评审通过 | — | 已完成（2026-06-22，3 轮评审后通过） | 评审专家结论为「通过」，文件头状态改为「已通过」 |
| 执行计划评审通过 | — | 已完成（2026-06-22，3 轮评审后通过） | 评审专家结论为「通过」，文件头状态改为「已通过」 |
| 阶段 Spec / 任务 Spec 评审通过 | — | 待定 | 全部 13 个任务 Spec 状态为「已通过」 |
| T1 完成 | 1-2 | 阶段 Spec 通过后 +1 工作日 | `pnpm typecheck` 通过且 T1 验收标准全绿 |
| T2 完成 | 4-6 | T1 同步启动，+2 工作日 | T2 验收标准全绿（高复杂度：alias / node_modules / 扩展名补全） |
| T3 完成 | 3-4 | T1、T2 +1 工作日 | T3 验收标准全绿 |
| T4 完成 | 2-3 | T2、T3 +1 工作日 | T4 验收标准全绿 |
| T5 完成 | 3-4 | T1、T3 +1 工作日 | T5 验收标准全绿 |
| T6 完成 | 2-3 | T5 +1 工作日 | T6 验收标准全绿 |
| T7 完成 | 1-2 | T5、T6 当日 | T7 验收标准全绿 |
| T8 完成 | 4-6 | T6 +1 工作日 | T8 验收标准全绿（高复杂度：中文 6 章节 Markdown） |
| T9 完成 | 4-6 | T2、T4、T5、T6 +2 工作日 | T9 验收标准全绿（高复杂度：monorepo 4 级识别 + 聚合） |
| T10 完成 | 1-2 | T7、T8、T9 +1 工作日 | T10 验收标准全绿 |
| T11 完成 | 1-2 | T10 当日 | T11 验收标准全绿 |
| T12 完成 | 4-6 | T11 +2 工作日 | 单测 / 集成 / 回归全绿 |
| T13 完成 | 1-2 | T12 +1 工作日 | 文档与代码一致，三套 CI 全绿 |
| 验收通过 | — | T13 当日 | 用户 / 产品负责人在 acceptance-report 上签字「通过」 |
| 归档关闭 | — | 验收通过 +1 工作日 | 全套文档状态改为「已完成，已归档」并 PR 合并 |

> 总工作量预估：约 **31 ~ 48 人时**（不含评审等待时间），单人连续投入约 5 ~ 8 个工作日。
>
> **关键路径**：T2 → T3 → T5 → T6 → T8/T9 → T10 → T11 → T12 → T13（T8 与 T9 并行收敛于 T10，均为关键路径任务；T2、T8、T9 为高复杂度任务，是关键路径上的主要风险点；T4 有 4 小时松弛，不在关键路径上）。

---

## 4. 风险与缓解

见 [design-v1.5.md §13](design-v1.5.md#13-风险与缓解) 与 [requirements-decomposition-v1.5.md §5](requirements-decomposition-v1.5.md#5-风险与假设)。

执行计划层面新增风险：

| 风险 | 等级 | 缓解措施 |
|---|---|---|
| T2（路径解析）、T8（Markdown 摘要）与 T9（monorepo）为高复杂度任务，均位于关键路径上，是主要风险点 | 中 | T1 可与 T2 并行启动，T2 完成后立即启动 T3；T8 与 T9 在 T6 完成后并行推进，收敛于 T10；T9 依赖 T2 / T4 / T5 / T6，可在 T7 期间重叠 |
| T3 依赖 T1 与 T2，若 T2 延迟将级联影响 T3 / T4 / T5 / T6 / T7 / T8 / T9 / T10 / T11 | 中 | T2 优先启动并尽早暴露边界问题；T1 完成后可先基于类型定义编写 T3 的 visitor 骨架（用 mock resolver） |
| T12 测试夹具（4 套）工作量集中，可能延迟验收 | 低 | T12 依赖 T11，但夹具文件（simple-project / monorepo-project / alias-project / cycle-project）不涉及生产代码，可在 T7 / T8 / T9 期间提前准备 |
| pnpm-workspace.yaml 简化解析可能漏覆盖部分 monorepo 配置 | 中 | 降级为优先级 4（packages/* 目录约定），确保常见 pnpm monorepo 可识别；文档中明确说明不支持 YAML 高级特性 |
| 5000 文件性能基线在 T12 才验证，若不达标需返工 | 中 | T4 完成后可用真实项目提前验证并发扫描性能；若不达标在设计文档已预留升级为 v1.6 引入 Worker 线程的方案 |
| 回归测试覆盖 v1.1~v1.4 全套既有测试，任一回归将阻塞交付 | 低 | T12 回归测试要求 `pnpm test` 全量通过；v1.5 模块独立于 `lib/knowledge-graph/`，与运行时监控 / code-quality / 结构化日志 / store 错误采集代码无交叉，回归风险低 |

---

## 5. 批准记录

- 项目负责人：creayma，2026-06-22，已批准（依据第 3 轮评审「通过」结论）

---

## 6. 评审记录

| 轮次 | 日期 | 结论 | P0/P1 问题 | 修复方案 |
|---|---|---|---|---|
| 1 | 2026-06-22 | 修改后通过 | P1-1 T4 依赖关系标注错误（标"无"，实际依赖 T2、T3）；P1-2 T9 依赖关系不完整（缺 T2、T6）；P1-3 `lib/knowledge-graph/index.ts` 无对应任务；P1-4 缺少「工作量估算与里程碑」章节；P1-5 缺少「批准记录」章节 | 已全部修订完成（详见修订总览 R1→R2） |
| 2 | 2026-06-22 | 修改后通过 | P1-1 关键路径计算错误（经 T4，应经 T5/T6/T8/T9）；P1-2 T10 monorepo 流程缺失 inferLayers 步骤；P2-1 风险表级联清单遗漏 T9；P2-2 修订总览里程碑数量错误（16→18）；P2-3 总工作量上限计算错误（49→48） | 已全部修订完成（详见修订总览 R2→R3） |
| 3 | 2026-06-22 | 通过 | 无 P0/P1 问题；P2 里程碑表文案同步（第 541 行"第 2 轮复评"→"第 3 轮复评"，已同步修复并更新为「已完成」） | 进入阶段 Spec 编制（phases/phase-v1.5-spec.md）与各任务 Spec 编制 |

> **修订总览（轮次 1 → 轮次 2 变更，R1→R2）**：
> - **P1-1 修复**：T4 依赖由「无」改为「T2、T3」，可并行栏由「T1、T2」改为「—」；并行性说明补充 T4 依赖 T2（ModuleResolver）与 T3（CollectedFile + collectDependencies）
> - **P1-2 修复**：T9 依赖由「T4、T5」改为「T2、T4、T5、T6」；并行性说明补充 T9 依赖 T2（ModuleResolver）与 T6（analyzeGraph 用于聚合图重新计算）
> - **P1-3 修复**：T10 拆分为 T10（`lib/knowledge-graph/index.ts` 编排入口 `runKnowledgeGraph`）与 T11（`lib/cli/graph.ts` 参数转换 `runGraph` + `cli.ts` 扩展）；原 T11（测试）重编号为 T12，原 T12（文档）重编号为 T13；T12 输入引用由「T1-T10」改为「T1-T11」，T13 输入引用由「T1-T11」改为「T1-T12」
> - **P1-4 修复**：新增 §3「工作量估算与里程碑」章节，含 18 个里程碑、人时估算、触发条件、关键路径说明；原 §3 风险与缓解顺延为 §4
> - **P1-5 修复**：新增 §5「批准记录」章节；原 §4 评审记录顺延为 §6
> - **配套修订**：文件头状态由「草稿」改为「评审中（修订后，待第 2 轮评审）」；评审记录引用由 §4 改为 §6；§4 风险表中 T11 / T10 等任务编号同步更新为 T12 / T11

> **修订总览（轮次 2 → 轮次 3 变更，R2→R3）**：
> - **P1-1 修复**：§3 关键路径由「T2 → T3 → T4 → T9 → T10 → T11 → T12 → T13」更正为「T2 → T3 → T5 → T6 → T8/T9 → T10 → T11 → T12 → T13」（T4 有 4 小时松弛不在关键路径上；T8 与 T9 并行收敛于 T10）；§4 风险表第一行补充 T8 为关键路径高复杂度任务
> - **P1-2 修复**：T10 monorepo 流程第 4 步补充 `inferLayers`（T6）调用，对聚合图谱生成分层结构，供 T8 writeMarkdown 使用
> - **P2-1 修复**：§4 风险表第二行级联影响清单补充 T9（「T3 / T4 / T5 / T6 / T7 / T8 / T10 / T11」→「T3 / T4 / T5 / T6 / T7 / T8 / T9 / T10 / T11」）
> - **P2-2 修复**：R1→R2 修订总览中里程碑数量由「16」更正为「18」（3 评审 + 13 任务 + 验收 + 归档）
> - **P2-3 修复**：§3 总工作量上限由「49 人时」更正为「48 人时」（按各任务 max 累加：2+6+4+3+4+3+2+6+6+2+2+6+2=48）
> - **配套修订**：文件头状态由「评审中（修订后，待第 2 轮评审）」改为「评审中（R3 修订后，待第 3 轮评审）」；评审记录引用更新

> **说明**：本执行计划已于 2026-06-22 经第 3 轮评审通过，文件头状态为「已通过」，§5 批准记录已签字。下一步据此生成阶段 Spec（phases/phase-v1.5-spec.md）与各任务 Spec。
