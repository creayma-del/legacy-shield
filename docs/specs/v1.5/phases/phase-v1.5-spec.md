# legacy-shield v1.5 Spec：项目知识图谱生成

> 版本：v1.5
> 对应需求文档：[meetings/requirements-alignment-v1.5-20260622.md](../meetings/requirements-alignment-v1.5-20260622.md)
> 对应需求分解文档：[requirements-decomposition-v1.5.md](../requirements-decomposition-v1.5.md)
> 对应设计文档：[design-v1.5.md](../design-v1.5.md)
> 对应执行计划：[execution-plan-v1.5.md](../execution-plan-v1.5.md)
> 状态：已完成，已归档（冻结，不再修改）
> 编制日期：2026-06-22
> 评审记录：见本文档末尾 §7（轮次 1 修改后通过、轮次 2 通过）

---

## 1. 目标

在 legacy-shield 现有 `shield` / `quality` / `report` / `api` 四个子命令基础上，新增独立的 `graph` 子命令，为目标项目生成 **AI 可读的项目知识图谱**，让 AI 智能体无需人工描述即可理解项目目录结构、模块依赖关系、循环依赖、hub 文件、分层架构等关键信息，从而更精准地分析正在护航的业务系统。

具体落点：
- **独立 graph 子命令**：`shield graph --project <path>`，与 quality 完全独立，不自动集成。
- **AST 派生确定性图谱**：基于 Babel AST 工具链（@babel/parser、@babel/traverse、@vue/compiler-sfc）静态分析 import / export / require / dynamic-import，不使用 LLM 提取图谱，确保结果确定可复现。
- **双格式输出**：`knowledge-graph.json`（机器可读）+ `architecture-summary.md`（中文 AI 优化格式，6 章节结构）。
- **路径解析**：自建轻量 resolver，覆盖相对路径、tsconfig/jsconfig paths alias、node_modules 包（含 scoped 包）、扩展名补全，不引入 enhanced-resolve。
- **图算法**：邻接表 + 反向邻接表同步填充、DFS 三色标记法循环检测（含去重）、并查集弱连通分量。
- **monorepo 支持**：4 级优先级识别（package.json workspaces → lerna.json → pnpm-workspace.yaml 简化解析 → packages/* 目录约定），独立图谱 + 聚合图谱双输出，不引入 js-yaml。
- **性能保障**：并发扫描（索引游标替代 queue.shift()）+ mtime 缓存 + 增量更新 + aliasHash 全量失效策略，5000 文件规模 30 秒内完成。
- **零回归**：v1.1 ~ v1.4 已有运行时监控 / code-quality / 结构化日志 / store 错误采集行为保持不变。

**明确不在范围内**：
- 函数 / 类级符号图（OUT-1，v1.6+）；
- MCP 接口暴露（OUT-2，v1.6+）；
- Worker 线程并发（OUT-3，v1.6+）；
- 影响范围分析（OUT-4，v1.6+）；
- 架构规则验证 / forbidden 规则（OUT-5，v1.6+）；
- 引入新的运行时依赖（OUT-6，保持项目依赖克制风格）；
- watch 模式 / 实时更新（OUT-7，v1.6+）；
- webpack / vite resolve.alias 支持（仅支持 tsconfig/jsconfig paths）；
- 动态 `import()` 变量表达式的解析（标记为 unresolved 边）；
- 与 quality 子命令的自动集成（完全独立，用户手动运行）。

---

## 2. 交付物清单

| 编号 | 交付物 | 路径 | 说明 |
|---|---|---|---|
| D1 | GraphOptions / GraphResult 类型扩展 | [lib/types.ts](file:///Users/creayma/personal/legacy-shield/lib/types.ts) | 新增 GraphOptions（含 hubThreshold）、GraphResult |
| D2 | 图谱内部类型定义 | `lib/knowledge-graph/types.ts` | GraphNode / GraphEdge / KnowledgeGraph / GraphStats / KnowledgeGraphJson 等 |
| D3 | 模块路径解析器 | `lib/knowledge-graph/resolver.ts` | ModuleResolver 类，自建轻量 resolver，不引入 enhanced-resolve |
| D4 | 依赖关系收集 visitor | `lib/knowledge-graph/collector.ts` | CollectedFile / CollectedDependency / parseFile / collectDependencies |
| D5 | 并发文件扫描器 | `lib/knowledge-graph/scanner.ts` | scanFilesConcurrent（索引游标）+ mtime 缓存（Record<string, CacheEntry>） |
| D6 | 图构建器 | `lib/knowledge-graph/graph.ts` | buildGraph（邻接表 + 反向邻接表同步填充）+ detectCycles（DFS 三色标记）+ computeComponents（并查集 WCC） |
| D7 | 图谱分析器 | `lib/knowledge-graph/analyzer.ts` | analyzeGraph（hub/孤立/分层/isEntry 统一计算）+ inferLayers |
| D8 | JSON 输出器 | `lib/knowledge-graph/json-output.ts` | toJson + writeJson，edges 列表替代邻接表 |
| D9 | Markdown 摘要生成器 | `lib/knowledge-graph/markdown-output.ts` | toMarkdown + writeMarkdown，中文 6 章节结构 |
| D10 | monorepo 支持 | `lib/knowledge-graph/monorepo.ts` | detectMonorepo（4 级优先级）+ generatePackageGraph + generateAggregateGraph |
| D11 | 编排入口 | `lib/knowledge-graph/index.ts` | runKnowledgeGraph，编排 scanner → graph → analyzer → monorepo → output 完整流程 |
| D12 | CLI action handler | `lib/cli/graph.ts` | runGraph，薄层适配器，仅参数转换与委托 runKnowledgeGraph |
| D13 | CLI 子命令注册 | [cli.ts](file:///Users/creayma/personal/legacy-shield/cli.ts) | 静态 import runGraph，新增 graph 子命令定义与选项校验 |
| D14 | 测试夹具 | `tests/knowledge-graph/fixtures/` | 4 套：simple-project / monorepo-project / alias-project / cycle-project |
| D15 | 测试用例 | `tests/knowledge-graph/*.test.ts` | 6 个单测 + 1 个集成测试，覆盖各模块核心场景 |
| D16 | 回归测试 | `tests/vue3-monitor.test.ts` 等 | 覆盖 v1.1~v1.4 全套既有测试，零回归 |
| D17 | 文档更新 | `README.md`（根目录）、`docs/api.md` | 能力清单新增「知识图谱生成」、graph 子命令说明（注：设计文档 §11.3 中 `docs/README.md` 为笔误，实际为根目录 `README.md`，与 v1.4 D12 一致） |
| D18 | 验收报告 | `docs/specs/v1.5/acceptance-report-v1.5.md` | v1.5 验收结论，含 12 条验收标准逐条结论 |

---

## 3. 技术方案

### 3.1 总体策略

v1.5 新增独立的 `graph` 子命令，在 `lib/knowledge-graph/` 下构建完整的知识图谱生成模块。模块复用现有 Babel AST 工具链，不引入任何新的运行时依赖。模块关系：

```
shield graph --project <path>
  └── lib/cli/graph.ts                    # 新增：CLI action handler（薄层适配器）
        └── lib/knowledge-graph/index.ts   # 新增：编排入口 runKnowledgeGraph
              ├── scanner.ts               # 并发文件扫描 + mtime 缓存
              ├── resolver.ts              # 模块路径解析器
              ├── collector.ts             # 依赖关系收集 visitor
              ├── graph.ts                 # 图构建 + 循环检测 + 连通分量
              ├── analyzer.ts              # 图谱分析（hub/孤立/分层）
              ├── monorepo.ts              # monorepo 子包识别 + 聚合
              ├── json-output.ts           # JSON 格式输出
              └── markdown-output.ts       # Markdown 摘要输出
```

详见 [design-v1.5.md §1.1](../design-v1.5.md#11-模块关系)。

### 3.2 类型定义与图谱 schema

- `lib/types.ts` 扩展：新增 `GraphOptions`（含 `hubThreshold?: number`，默认 10）与 `GraphResult`（8 字段）。
- `lib/knowledge-graph/types.ts` 新增：`FileKind` / `NodeRole` / `EdgeKind` 枚举，`GraphNode` / `GraphEdge` / `KnowledgeGraph` / `GraphStats` / `KnowledgeGraphJson` 接口。
- `KnowledgeGraphJson.edges` 为数组类型（非 Map），消费方可从 edges 重建邻接表。

详见 [design-v1.5.md §2](../design-v1.5.md#2-数据结构)。

### 3.3 模块路径解析器

- 自建轻量 `ModuleResolver` 类，不引入 `enhanced-resolve`。
- `resolve(spec, importer)` 按优先级：相对路径 → alias 路径 → node_modules 包路径。
- alias 解析：读取 tsconfig.json / jsconfig.json 的 `compilerOptions.baseUrl` 与 `compilerOptions.paths`，正则匹配 `*` 通配符。
- node_modules 解析：支持 scoped 包名（`@scope/pkg` 取前两段）；从 importer 目录逐级向上查找；**根目录检查**（`dirname(dir) === dir` 时终止）。
- 扩展名补全：`.ts` / `.tsx` / `.js` / `.jsx` / `.vue` → index 文件。

详见 [design-v1.5.md §3](../design-v1.5.md#3-模块路径解析器)。

### 3.4 依赖关系收集 visitor

- `parseFile(filePath, code): { ast: File; isTs: boolean }`：参考现有 `ast-skeleton.ts` 的 `pluginsFor` 实现思路，启用 `errorRecovery: true`；Vue SFC 用 `@vue/compiler-sfc` 提取 `<script>` / `<script setup>`。
- `collectDependencies(filePath, code, resolver): CollectedFile`：Babel visitor 覆盖 ImportDeclaration / ExportNamedDeclaration / ExportAllDeclaration / ExportDefaultDeclaration / CallExpression（require）/ ImportExpression（dynamic import）。
- `CollectedFile` 含 `dependencies: CollectedDependency[]` 与 `exports: string[]`。

详见 [design-v1.5.md §4](../design-v1.5.md#4-依赖关系收集)。

### 3.5 图构建与算法

- `buildGraph`：构建 nodes / adjacency / reverseAdjacency（同步填充）/ edges。
- `detectCycles`：DFS 三色标记法（WHITE/GRAY/BLACK），发现 GRAY 邻居时截取循环链，去重用 `[...new Set(cycle)].sort().join('|')` 作为 key。
- `computeComponents`：并查集（Union-Find）弱连通分量，`find` 带路径压缩，所有边视为无向。

详见 [design-v1.5.md §5](../design-v1.5.md#5-图构建与分析设计)。

### 3.6 图谱分析

- `analyzeGraph`：图构建完成后**统一计算** isEntry（`inDegree === 0 && outDegree > 0`），避免边插入过程中误判；计算 role（entry/core/leaf/isolated/unknown）；填充 GraphStats。
- `inferLayers`：入口层 / 核心层 / 中间层 / 叶子层 / 孤立 5 层分类。
- hub 阈值默认 10，可通过 `hubThreshold` 参数配置。

详见 [design-v1.5.md §5.3 / §5.4](../design-v1.5.md#53-hub--孤立文件识别)。

### 3.7 输出格式

- **JSON**：`knowledge-graph.json`，含 meta / nodes / edges / cycles / stats 五个顶层字段；以 edges 列表替代邻接表。
- **Markdown**：`architecture-summary.md`，中文 6 章节结构（项目架构概览 / 模块依赖拓扑 / 关键节点识别 / 循环依赖分析 / 分层结构推断 / 架构健康度评估）。

详见 [design-v1.5.md §7](../design-v1.5.md#7-输出格式)。

### 3.8 monorepo 支持

- `detectMonorepo`：4 级优先级识别（package.json workspaces → lerna.json → pnpm-workspace.yaml 简化解析 → packages/* 目录约定）。
- `generatePackageGraph`：以子包根目录为 projectRoot 生成独立图谱。
- `generateAggregateGraph`：合并所有子包图谱，解析跨包依赖（workspace:* / link: / file: 协议 / node_modules 软链接（pnpm 风格）），重新计算统计指标。
- pnpm-workspace.yaml 采用**简化解析**（仅识别 `packages:` 顶层数组字面量），不引入 js-yaml。

详见 [design-v1.5.md §6](../design-v1.5.md#6-monorepo-支持)。

### 3.9 并发扫描与缓存

- `scanFilesConcurrent`：索引游标 `cursor` 替代 `queue.shift()` 避免 O(n) 开销；concurrency 个 worker；单文件 try-catch 异常隔离。
- mtime 缓存：`CacheFile.entries: Record<string, CacheEntry>`（非 Map，确保 JSON 可序列化）；四种失效策略（mtime 变更 / aliasHash 变更 / --fresh / 缓存不存在）。

详见 [design-v1.5.md §8](../design-v1.5.md#8-性能设计)。

### 3.10 CLI 子命令

- `cli.ts` 静态 import `runGraph`（与其他子命令一致）。
- 选项校验：数值参数（concurrency / hubThreshold）先 `Number()` 转换再校验。
- 默认输出路径：`<project>/.legacy-shield/knowledge-graph/`。
- 与 quality 子命令完全独立。

详见 [design-v1.5.md §9](../design-v1.5.md#9-cli-子命令设计)。

---

## 4. 任务拆解与依赖

| 任务编号 | 任务名称 | 依赖 | 任务 Spec |
|---|---|---|---|
| T1 | 类型定义与图谱 schema（lib/types.ts 扩展 + lib/knowledge-graph/types.ts） | 无 | [phase-v1.5-t1-spec.md](phase-v1.5-t1-spec.md) |
| T2 | 模块路径解析器（alias/node_modules/扩展名补全） | 无 | [phase-v1.5-t2-spec.md](phase-v1.5-t2-spec.md) |
| T3 | 依赖关系收集 visitor（import/export/require + exports 收集） | T1、T2 | [phase-v1.5-t3-spec.md](phase-v1.5-t3-spec.md) |
| T4 | 文件扫描器改造（并发 + mtime 缓存 + 异常处理） | T2、T3 | [phase-v1.5-t4-spec.md](phase-v1.5-t4-spec.md) |
| T5 | 图构建器（邻接表 + 反向索引 + 循环检测 + 连通分量） | T1、T3 | [phase-v1.5-t5-spec.md](phase-v1.5-t5-spec.md) |
| T6 | 图谱分析器（hub/孤立/分层推断 + isEntry 计算） | T5 | [phase-v1.5-t6-spec.md](phase-v1.5-t6-spec.md) |
| T7 | JSON 输出器 | T5、T6 | [phase-v1.5-t7-spec.md](phase-v1.5-t7-spec.md) |
| T8 | Markdown 摘要生成器（中文 AI 优化格式） | T6 | [phase-v1.5-t8-spec.md](phase-v1.5-t8-spec.md) |
| T9 | monorepo 支持（子包识别 + 独立图谱 + 聚合图谱） | T2、T4、T5、T6 | [phase-v1.5-t9-spec.md](phase-v1.5-t9-spec.md) |
| T10 | 编排入口（lib/knowledge-graph/index.ts runKnowledgeGraph） | T7、T8、T9 | [phase-v1.5-t10-spec.md](phase-v1.5-t10-spec.md) |
| T11 | CLI 子命令集成（lib/cli/graph.ts runGraph 参数转换 + cli.ts 扩展） | T10 | [phase-v1.5-t11-spec.md](phase-v1.5-t11-spec.md) |
| T12 | 测试夹具、单测、集成测试、回归测试 | T11 | [phase-v1.5-t12-spec.md](phase-v1.5-t12-spec.md) |
| T13 | 文档更新与验收报告 | T12 | [phase-v1.5-t13-spec.md](phase-v1.5-t13-spec.md) |

**执行顺序与并行性**：
- T1 / T2 可完全并行启动（互不依赖，文件无交叉）。
- T3 依赖 T1（类型）与 T2（ModuleResolver），在 T1、T2 完成后启动。
- T4 依赖 T2（ModuleResolver）与 T3（CollectedFile + collectDependencies）。
- T7 与 T8 互不依赖，可在 T5、T6 完成后并行。
- T9 依赖 T2 / T4 / T5 / T6，与 T7 / T8 在时间上可重叠。
- T10 为编排入口，在 T7、T8、T9 全部完成后进行。
- T11 依赖 T10，仅做 CLI 参数转换与 commander 注册。
- **关键路径**：T2 → T3 → T5 → T6 → T8/T9 → T10 → T11 → T12 → T13（T8 与 T9 并行收敛于 T10；T2、T8、T9 为高复杂度任务，是关键路径上的主要风险点；T4 有 4 小时松弛，不在关键路径上）。

详见 [execution-plan-v1.5.md §1 / §3](../execution-plan-v1.5.md#1-任务总览)。

---

## 5. 验收标准（阶段级）

| 编号 | 验收项 | 验收方法 |
|---|---|---|
| AC-1 | `shield graph --project <path>` 可生成 `knowledge-graph.json` 与 `architecture-summary.md` | T12 集成测试：simple-project 端到端 |
| AC-2 | JSON 格式知识图谱结构完整，含 meta / nodes / edges / cycles / stats 五部分 | T12 单测：graph.test.ts + integration.test.ts |
| AC-3 | Markdown 架构摘要为中文，含 §7.2 定义的 6 个章节 | T12 单测：markdown-output 验证 |
| AC-4 | 知识图谱正确反映文件间 import / export / require 依赖关系 | T12 单测：collector.test.ts |
| AC-5 | 路径解析覆盖相对路径、`@/` alias、node_modules 包、扩展名补全 | T12 单测：resolver.test.ts + alias-project 端到端 |
| AC-6 | 循环依赖被正确检测并输出循环链 | T12 单测：graph.test.ts + cycle-project 端到端 |
| AC-7 | monorepo 项目可生成每个子包独立图谱 + 全局聚合图谱 | T12 单测：monorepo.test.ts + monorepo-project 端到端 |
| AC-8 | 增量更新模式下，未变更文件跳过重新解析，性能显著优于全量重建 | T12 单测：scanner.test.ts 缓存命中/失效 |
| AC-9 | 5000 文件规模项目全量扫描在 30 秒内完成（SSD，并发数=8） | T12 性能基线测试 |
| AC-10 | `pnpm typecheck`、`pnpm build`、`pnpm test` 全量通过 | T12 / T13 CI 验证 |
| AC-11 | README、api.md 文档与代码行为一致 | T13 文档审查 |
| AC-12 | v1.1 ~ v1.4 已有能力无回归 | T12 回归测试全绿 |

---

## 6. 风险与依赖

| 风险 / 依赖 | 影响 | 应对措施 |
|---|---|---|
| 模块路径解析边界情况多 | 中 | v1.5 只处理静态 import/require，动态 import() 标记为 unresolved 边；文档明确不支持的场景 |
| T2（路径解析）、T8（Markdown 摘要）、T9（monorepo）为高复杂度任务，均位于关键路径上 | 中 | T1 可与 T2 并行启动；T8 与 T9 在 T6 完成后并行推进，收敛于 T10；T9 依赖 T2/T4/T5/T6，可在 T7 期间重叠 |
| 大型项目性能不达标 | 中 | 并发扫描 + mtime 缓存 + 增量更新；T12 测试阶段验证，若不达标则升级为 v1.6 引入 Worker 线程 |
| 5000 文件性能基线在 T12 才验证，若不达标需返工 | 中 | T4 完成后可用真实项目提前验证并发扫描性能；若不达标在设计文档已预留升级为 v1.6 引入 Worker 线程的方案 |
| monorepo 包间依赖解析不完整 | 中 | 4 级优先级识别；workspace 协议解析覆盖 workspace:* / link: / file: / node_modules 软链接；pnpm-workspace.yaml 简化解析降级为 packages/* 目录约定 |
| 图谱 schema 设计不当导致 AI 难消费 | 中 | Markdown 摘要已在 §7.2 给出样例，T12 测试阶段在真实 LLM 上验证效果 |
| alias 配置多样性 | 中 | v1.5 仅支持 tsconfig/jsconfig paths，不支持 webpack/vite resolve.alias；文档明确说明 |
| mtime 缓存失效策略不当 | 低 | 缓存 key 包含文件路径 + mtime + alias 配置 hash；alias 变更时全部失效 |
| pnpm-workspace.yaml 简化解析漏覆盖部分 monorepo 配置 | 中 | 降级为优先级 4（packages/* 目录约定）；文档明确不支持 YAML 高级特性 |
| T3 依赖 T1 与 T2，若 T2 延迟将级联影响 T3 / T4 / T5 / T6 / T7 / T8 / T9 / T10 / T11 / T12 / T13 | 中 | T2 优先启动并尽早暴露边界问题；T1 完成后可先基于类型定义编写 T3 的 visitor 骨架（用 mock resolver） |
| T12 测试夹具（4 套）工作量集中，可能延迟验收 | 低 | T12 依赖 T11，但夹具文件（simple-project / monorepo-project / alias-project / cycle-project）不涉及生产代码，可在 T7 / T8 / T9 期间提前准备 |
| 与现有 custom-rules scanner 职责重叠 | 低 | graph 模块独立实现扫描器，不复用 custom-rules 的串行扫描；后续可考虑抽取公共能力 |
| 回归测试覆盖 v1.1~v1.4 全套既有测试，任一回归将阻塞交付 | 低 | T12 回归测试要求 `pnpm test` 全量通过；v1.5 模块独立于 `lib/knowledge-graph/`，与运行时监控 / code-quality / 结构化日志 / store 错误采集代码无交叉，回归风险低 |

详见 [design-v1.5.md §13](../design-v1.5.md#13-风险与缓解) 与 [execution-plan-v1.5.md §4](../execution-plan-v1.5.md#4-风险与缓解)。

---

## 7. 评审记录

| 轮次 | 日期 | 结论 | P0/P1 问题 | 修复方案 |
|---|---|---|---|---|
| 1 | 2026-06-22 | 修改后通过 | P1-1 AC-2 验收标准与 §3.7 矛盾（"四部分"遗漏 meta，应为"五部分"）；P2-1 三处锚点链接失效；P2-2 §3.8 遗漏 node_modules 软链接协议；P2-3 §6 遗漏 3 项上游风险；P2-4 级联清单遗漏 T12/T13；P2-5 D17 路径需标注设计文档笔误 | 已全部修订完成（P1-1 AC-2 改为"五部分"；P2-1 锚点修正为 §2-数据结构/§5-图构建与分析设计/§8-性能设计；P2-2 补充 node_modules 软链接；P2-3 补充 3 项风险；P2-4 级联清单补 T12/T13；P2-5 D17 注明笔误） |
| 2 | 2026-06-22 | 通过 | 无 P0/P1 问题；P1-1 修订正确，AC-2 与 §3.7 / 设计文档 §2.3 / 执行计划 T7 一致；P2 全部修复 | 进入任务 Spec 拆解阶段（phase-v1.5-t1-spec.md ~ phase-v1.5-t13-spec.md） |

> **说明**：本阶段 Spec 已于 2026-06-22 经评审通过，文件头状态为「已通过」。所有 13 个任务 Spec 评审通过后，本阶段 Spec 才视为整体通过，方可进入代码开发。任务 Spec 评审可在本阶段 Spec 评审通过后并行推进。
