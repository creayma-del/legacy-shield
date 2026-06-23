# T12：测试夹具、单测、集成测试、回归测试

> 版本：v1.5
> 任务编号：T12
> 对应阶段 Spec：[phase-v1.5-spec.md](phase-v1.5-spec.md)
> 对应设计文档：[design-v1.5.md](../design-v1.5.md)
> 对应执行计划：[execution-plan-v1.5.md](../execution-plan-v1.5.md)
> 依赖任务：T11
> 状态：已完成，已归档（冻结，不再修改）
> 评审记录：见本文档末尾

---

## 1. 任务目标

为 v1.5 知识图谱生成模块提供全量测试夹具、单元测试、集成测试、回归测试与性能基线测试，覆盖设计文档 §10 测试计划列出的全部场景，保证 `pnpm typecheck` / `pnpm build` / `pnpm test` 三套 CI 全绿，且 v1.1 ~ v1.4 已有能力零回归。

具体包括：
- 创建 4 套测试夹具（simple-project / monorepo-project / alias-project / cycle-project），不引入运行时依赖；
- 编写 6 个单元测试文件（resolver / collector / graph / analyzer / monorepo / scanner），覆盖各模块核心场景；
- 编写 1 个集成测试文件（integration.test.ts），覆盖 5 个端到端场景；
- 执行回归测试，覆盖 v1.1 ~ v1.4 全套既有测试，确保零回归；
- 执行性能基线测试，验证 5000 文件规模全量扫描在 30 秒内完成。

对应阶段 Spec §3.2 ~ §3.10 全部代码改动的验证，以及交付物 D14 / D15 / D16。

---

## 2. 对应需求与验收标准

| 需求编号 | 需求描述 | 本任务验收标准 |
|---|---|---|
| REQ-1.5-1 | 扫描目标项目 src 下的 JS/JSX/TS/TSX/Vue 文件，构建文件级依赖图 | simple-project 夹具端到端测试通过，Header.vue 依赖被正确收集 |
| REQ-1.5-2 | 解析 import / export / require 语句，收集文件间依赖关系 | collector.test.ts 覆盖 import/export/require/dynamic-import 收集全绿 |
| REQ-1.5-3 | 支持模块路径解析：相对路径、`@/` alias、`~` alias、node_modules 包、扩展名补全、index 解析 | resolver.test.ts 覆盖全部解析路径全绿 |
| REQ-1.5-4 | 读取目标项目 tsconfig.json / jsconfig.json 的 paths 配置，自动识别 alias | resolver.test.ts alias 场景 + alias-project 端到端测试全绿 |
| REQ-1.5-5 | 检测循环依赖并输出循环链 | graph.test.ts 循环检测 + cycle-project 端到端测试全绿（a→b→a 与 c→d→e→c） |
| REQ-1.5-6 | 识别 hub 文件（高入度节点）与孤立文件（零入度零出度） | analyzer.test.ts hub 识别（阈值边界）与孤立文件识别全绿 |
| REQ-1.5-7 | 推断项目分层结构（入口文件、核心模块、叶子模块） | analyzer.test.ts 分层推断与 isEntry 统一计算全绿 |
| REQ-1.5-8 | 输出 JSON 格式知识图谱（邻接表 + 反向索引 + 节点元数据 + 图统计指标） | graph.test.ts 邻接表构建 + integration.test.ts JSON 输出结构验证全绿 |
| REQ-1.5-9 | 输出中文 Markdown 格式架构摘要（AI 优化格式） | integration.test.ts Markdown 输出验证（6 章节中文内容）全绿 |
| REQ-1.5-10 | 新增独立 graph 子命令，与 quality/report/api 并列 | integration.test.ts 通过 `runKnowledgeGraph` 编排入口驱动完整流程，验证 graph 子命令可独立调用（CLI 层由 T11 实现，T12 验证编排入口可独立运行） |
| REQ-1.5-11 | 支持并发文件扫描（Promise.all + 限流） | scanner.test.ts 并发扫描全绿，代码中无 `shift()` 调用 |
| REQ-1.5-12 | 支持文件 mtime 缓存，未变更文件跳过重新解析（增量更新） | scanner.test.ts 缓存命中/失效 + integration.test.ts 增量更新场景全绿 |
| REQ-1.5-13 | 支持 monorepo，为每个子包生成独立图谱 + 全局聚合图谱 | monorepo.test.ts 4 级优先级识别 + monorepo-project 端到端测试全绿 |
| REQ-1.5-14 | 默认输出到 `<project>/.legacy-shield/knowledge-graph/` 目录，可通过 --out 自定义 | integration.test.ts TC-INT-1 验证默认输出路径 + TC-10-5 自定义输出路径场景全绿 |
| REQ-1.5-15 | graph 子命令与 quality 子命令完全独立，不自动集成 | 回归测试验证 `tests/quality.test.ts` / `tests/quality.integration.test.ts` 全绿，graph 模块不影响 quality 流程 |
| REQ-1.5-16 | 目标项目规模支持到 5000 文件 | 性能基线测试：5000 文件全量扫描 < 30 秒（SSD，并发数=8） |
| REQ-1.5-17 | 保持 v1.1 ~ v1.4 已有能力零回归 | 回归测试 16 个单元测试文件 + 3 个 e2e 测试文件全绿，无新增失败用例 |

---

## 3. 实现步骤

### 3.1 测试夹具（4 套，不引入运行时依赖）

> **通用要求**：所有夹具均为最小可运行的项目结构，仅包含 `package.json` / `tsconfig.json` / 源码文件，不安装任何 npm 依赖（不执行 `pnpm install`）。夹具仅用于知识图谱生成的静态分析，不需要实际运行。

#### 3.1.1 simple-project（单包项目）

```
tests/knowledge-graph/fixtures/simple-project/
├── package.json                    # { "name": "simple-project", "version": "1.0.0" }
├── tsconfig.json                   # { "compilerOptions": { "target": "ES2020", "module": "ESNext" } }
└── src/
    ├── main.ts                     # import { format } from './utils/format'; import Header from './components/Header.vue';
    ├── utils/
    │   ├── format.ts               # export function format(input: string): string { ... }
    │   └── request.ts              # export function request(url: string): Promise<any> { ... }
    └── components/
        └── Header.vue              # <script setup lang="ts"> import { format } from '../utils/format'; </script>
```

**用途**：验证单包项目端到端流程，含 TypeScript 文件、Vue SFC 文件、相对路径解析、扩展名补全。

#### 3.1.2 monorepo-project（monorepo 项目）

```
tests/knowledge-graph/fixtures/monorepo-project/
├── package.json                    # { "name": "monorepo-root", "version": "1.0.0", "private": true }
├── pnpm-workspace.yaml             # packages:\n  - 'packages/*'
└── packages/
    ├── shared/
    │   ├── package.json            # { "name": "@demo/shared", "version": "1.0.0", "main": "src/index.ts" }
    │   └── src/
    │       └── index.ts            # export function sharedUtil() { ... }
    └── app/
        ├── package.json            # { "name": "@demo/app", "version": "1.0.0", "main": "src/main.ts", "dependencies": { "@demo/shared": "workspace:*" } }
        └── src/
            └── main.ts             # import { sharedUtil } from '@demo/shared';
```

**用途**：验证 monorepo 4 级优先级识别（pnpm-workspace.yaml 简化解析）、子包独立图谱生成、聚合图谱跨包依赖解析（workspace:* 协议）。

#### 3.1.3 alias-project（alias 配置项目）

```
tests/knowledge-graph/fixtures/alias-project/
├── package.json                    # { "name": "alias-project", "version": "1.0.0" }
├── tsconfig.json                   # { "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["src/*"] } } }
└── src/
    ├── main.ts                     # import { helper } from '@/utils/helper';
    └── utils/
        └── helper.ts               # export function helper() { ... }
```

**用途**：验证 tsconfig paths alias 解析（`@/*` → `src/*`），`@/utils/helper` 被正确解析为 `src/utils/helper.ts`。

#### 3.1.4 cycle-project（循环依赖项目）

```
tests/knowledge-graph/fixtures/cycle-project/
├── package.json                    # { "name": "cycle-project", "version": "1.0.0" }
└── src/
    ├── a.ts                        # import { b } from './b';  （a → b）
    ├── b.ts                        # import { a } from './a';  （b → a，构成 a → b → a 循环）
    ├── c.ts                        # import { d } from './d';  （c → d）
    ├── d.ts                        # import { e } from './e';  （d → e）
    └── e.ts                        # import { c } from './c';  （e → c，构成 c → d → e → c 循环）
```

**用途**：验证循环依赖检测（2 节点循环 a→b→a 与 3 节点循环 c→d→e→c），以及循环去重逻辑。

### 3.2 单元测试（6 个测试文件）

#### 3.2.1 `tests/knowledge-graph/resolver.test.ts`

| 测试用例编号 | 覆盖场景 | 断言要点 |
|---|---|---|
| TC-RES-1 | 相对路径解析 | `resolve('./foo', '/proj/src/main.ts')` 解析到 `/proj/src/foo.ts`（扩展名补全） |
| TC-RES-2 | alias 路径解析 | tsconfig paths 配置 `{"@/*": ["src/*"]}` 时，`resolve('@/utils/bar', '/proj/src/main.ts')` 解析到 `/proj/src/utils/bar.ts` |
| TC-RES-3 | node_modules 包路径解析 | `resolve('@vue/compiler-sfc/foo', '/proj/src/main.ts')` 解析到 `node_modules/@vue/compiler-sfc/foo.ts`（scoped 包） |
| TC-RES-4 | 纯包名跳过 | `resolve('lodash', importer)` 返回 `null`（纯包名无子路径，跳过） |
| TC-RES-5 | 扩展名补全顺序 | `tryExtensions` 依次尝试 `.ts` / `.tsx` / `.js` / `.jsx` / `.vue` |
| TC-RES-6 | index 文件解析 | `tryExtensions` 对 `index.ts` / `index.js` 等 index 文件能正确解析 |
| TC-RES-7 | 动态 import 标记 | 动态 `import()` 与变量 `require()` 标记为 `unresolved: true`（在 collector 中覆盖，此处验证 resolver 对 `<dynamic>` 的处理） |
| TC-RES-8 | scoped 包解析 | `@scope/pkg/sub` 包名取前两段为 `@scope/pkg`，子路径为 `sub` |
| TC-RES-9 | 根目录终止 | 向上查找 node_modules 时，到达根目录（`dirname(dir) === dir`）能正确终止，不无限循环 |
| TC-RES-10 | 无 tsconfig 的纯 JS 项目 | 无 tsconfig/jsconfig 时，相对路径与 node_modules 解析仍正常工作 |
| TC-RES-11 | jsconfig.json 兼容 | tsconfig.json 不存在时读取 jsconfig.json 的 `compilerOptions.baseUrl` 与 `compilerOptions.paths` |

#### 3.2.2 `tests/knowledge-graph/collector.test.ts`

| 测试用例编号 | 覆盖场景 | 断言要点 |
|---|---|---|
| TC-COL-1 | import 收集 | `import { foo } from './bar'` 收集 spec=`'./bar'`、kind=`'import'`、symbols=`['foo']` |
| TC-COL-2 | export 本地导出 | `export { foo }` 收集 exports=`['foo']`；`export const bar = 1` 收集 exports=`['bar']` |
| TC-COL-3 | re-export 依赖 | `export { foo } from './bar'` 记录为 re-export 依赖（kind=`'re-export'`），不计入本文件 exports |
| TC-COL-4 | export * | `export * from './bar'` 记录为 re-export 依赖，symbols=`['*']` |
| TC-COL-5 | export default | `export default function(){}` 收集 exports=`['default']` |
| TC-COL-6 | require 字符串字面量 | `require('./bar')` 收集 kind=`'require'`、spec=`'./bar'` |
| TC-COL-7 | require 变量 | `require(varName)` 标记 `unresolved: true`、spec=`'<dynamic>'` |
| TC-COL-8 | dynamic import 字符串字面量 | `import('./bar')` 收集 kind=`'dynamic-import'`、spec=`'./bar'` |
| TC-COL-9 | dynamic import 变量 | `import(varName)` 标记 `unresolved: true`、spec=`'<dynamic>'` |
| TC-COL-10 | Vue SFC 解析 | `.vue` 文件能正确提取 `<script setup>` 内容并解析依赖 |
| TC-COL-11 | Vue SFC lang=ts | `lang="ts"` 的 Vue 文件 `isTs` 返回 `true` |
| TC-COL-12 | Babel 解析容错 | 语法错误文件不抛异常（`errorRecovery: true`），返回空依赖 |
| TC-COL-13 | 声明形式导出 | `export function foo() {}` 收集 exports=`['foo']`；`export class Bar {}` 收集 exports=`['Bar']` |
| TC-COL-14 | parseFile 返回类型 | `parseFile` 返回 `{ ast: File; isTs: boolean }`，`isTs` 对 `.ts`/`.tsx` 返回 `true` |

#### 3.2.3 `tests/knowledge-graph/graph.test.ts`

| 测试用例编号 | 覆盖场景 | 断言要点 |
|---|---|---|
| TC-GRAPH-1 | 邻接表构建 | `buildGraph` 返回 `KnowledgeGraph`，含 `nodes`、`adjacency`、`reverseAdjacency`、`edges` 字段 |
| TC-GRAPH-2 | 反向邻接表同步填充 | 对任意边 (from, to)，`reverseAdjacency[to]` 包含 from |
| TC-GRAPH-3 | 2 节点循环检测 | `detectCycles` 对 `a → b → a` 循环能检测出，返回 `[['a', 'b', 'a']]`（或等价形式） |
| TC-GRAPH-4 | 3 节点循环检测 | `detectCycles` 对 `a → b → c → a` 三节点循环能正确检测 |
| TC-GRAPH-5 | 无环图 | `detectCycles` 对无环图返回空数组 |
| TC-GRAPH-6 | 循环去重 | 同一循环的不同入口（如从 a 或从 b 开始 DFS）去重为 1 条 |
| TC-GRAPH-7 | 连通分量计算 | `computeComponents` 对 `a → b`、`c → d` 两个独立连通分量返回 `componentCount: 2` |
| TC-GRAPH-8 | 路径压缩 | `computeComponents` 的 `find` 函数带路径压缩（代码中可见路径压缩逻辑） |
| TC-GRAPH-9 | 三色标记法 | DFS 三色标记法使用 WHITE/GRAY/BLACK 三种状态（代码中可见三色常量） |
| TC-GRAPH-10 | 边列表构建 | `edges` 为 `GraphEdge[]`，每条边含 from / to / kind / symbols / unresolved / rawSpec |

#### 3.2.4 `tests/knowledge-graph/analyzer.test.ts`

| 测试用例编号 | 覆盖场景 | 断言要点 |
|---|---|---|
| TC-ANA-1 | hub 识别（阈值边界） | 入度 >= hubThreshold（默认 10）的节点 `role === 'core'` |
| TC-ANA-2 | hub 阈值可配置 | `hubThreshold` 参数为 5 时，入度 >= 5 的节点 `role === 'core'` |
| TC-ANA-3 | 孤立文件识别 | 入度=0 且出度=0 的节点 `role === 'isolated'` |
| TC-ANA-4 | 入口文件识别 | 入度=0 且出度>0 的节点 `isEntry === true`、`role === 'entry'` |
| TC-ANA-5 | 叶子文件识别 | 出度=0 且入度>0 的节点 `role === 'leaf'` |
| TC-ANA-6 | isEntry 统一计算 | isEntry 在图构建完成后统一计算（不在 buildGraph 边插入过程中计算） |
| TC-ANA-7 | 分层推断 | `inferLayers` 返回 5 个数组（entry / core / middle / leaf / isolated），节点总数等于图中节点数 |
| TC-ANA-8 | GraphStats 填充 | `hubCount` + `isolatedCount` + `entryCount` 与节点实际状态一致 |
| TC-ANA-9 | maxInDegree / maxOutDegree | `GraphStats.maxInDegree` / `maxOutDegree` 为所有节点的最大入度/出度 |
| TC-ANA-10 | unresolvedEdgeCount | `GraphStats.unresolvedEdgeCount` 为 edges 中 `unresolved === true` 的边数 |

#### 3.2.5 `tests/knowledge-graph/monorepo.test.ts`

| 测试用例编号 | 覆盖场景 | 断言要点 |
|---|---|---|
| TC-MONO-1 | 优先级 1：package.json workspaces | `detectMonorepo` 对 `package.json` 含 `workspaces` 字段的项目识别为 monorepo |
| TC-MONO-2 | 优先级 2：lerna.json | `detectMonorepo` 对 `lerna.json` 含 `packages` 字段的项目识别为 monorepo |
| TC-MONO-3 | 优先级 3：pnpm-workspace.yaml 简化解析 | `detectMonorepo` 对 `pnpm-workspace.yaml` 含 `packages: ['packages/*']` 的项目识别为 monorepo |
| TC-MONO-4 | 优先级 3 降级 | `pnpm-workspace.yaml` 含 YAML 锚点等高级特性的解析失败时降级为优先级 4 |
| TC-MONO-5 | 优先级 4：packages/* 目录约定 | `detectMonorepo` 对 `packages/` 目录下每个子目录都有 `package.json` 的项目识别为 monorepo |
| TC-MONO-6 | 单包项目 | `detectMonorepo` 对单包项目返回 `{ isMonorepo: false, packages: [] }` |
| TC-MONO-7 | 独立图谱生成 | `generatePackageGraph` 为每个子包生成独立图谱，节点 `packageName` 字段为子包名 |
| TC-MONO-8 | 聚合图谱合并 | `generateAggregateGraph` 合并所有子包图谱 |
| TC-MONO-9 | workspace:* 协议解析 | `workspace:*` 协议的跨包依赖被正确解析为子包入口 |
| TC-MONO-10 | link: 协议解析 | `link:./packages/foo` 协议的跨包依赖被正确解析为对应子包 |
| TC-MONO-11 | file: 协议解析 | `file:./packages/foo` 协议的跨包依赖被正确解析为对应子包 |
| TC-MONO-12 | 聚合图统计重算 | 聚合图谱的 `stats` 被重新计算（非简单累加） |
| TC-MONO-13 | 无 js-yaml 依赖 | `package.json` 中无 `js-yaml` 新增依赖 |

#### 3.2.6 `tests/knowledge-graph/scanner.test.ts`

| 测试用例编号 | 覆盖场景 | 断言要点 |
|---|---|---|
| TC-SCAN-1 | 并发扫描返回类型 | `scanFilesConcurrent` 返回 `Map<string, CollectedFile>`，key 为文件绝对路径 |
| TC-SCAN-2 | 索引游标 | 使用索引游标 `cursor` 而非 `queue.shift()`（代码中无 `shift()` 调用） |
| TC-SCAN-3 | 单文件异常隔离 | 单文件解析抛错时，该文件在返回 Map 中对应 `{ dependencies: [], exports: [] }`，整体扫描不中断 |
| TC-SCAN-4 | mtime 缓存结构 | mtime 缓存结构为 `Record<string, CacheEntry>`（CacheFile.entries 字段） |
| TC-SCAN-5 | 缓存文件生成 | 首次扫描后 `.cache.json` 文件生成于 `<project>/.legacy-shield/knowledge-graph/.cache.json` |
| TC-SCAN-6 | 缓存命中 | 第二次扫描（无文件变更）命中缓存，跳过 `collectDependencies` 调用 |
| TC-SCAN-7 | 缓存失效（mtime 变更） | 修改某文件后第二次扫描，仅该文件重新解析，其余命中缓存 |
| TC-SCAN-8 | 缓存失效（aliasHash 变更） | alias 配置变更（tsconfig.paths 修改）后，全部缓存失效，全量重建 |
| TC-SCAN-9 | --fresh 强制重建 | `--fresh` 参数为 true 时，忽略缓存全量重建 |
| TC-SCAN-10 | 缓存不存在 | 缓存文件不存在时，全量重建 |
| TC-SCAN-11 | 并发数可配置 | 并发数可通过参数配置，默认 8 |
| TC-SCAN-12 | aliasHash 计算 | `computeAliasHash` 基于 `compilerOptions.paths` 与 `compilerOptions.baseUrl` 的 MD5 hash，无 tsconfig 时返回 `'none'` |

### 3.3 集成测试（1 个测试文件，5 个端到端场景）

#### `tests/knowledge-graph/integration.test.ts`

| 场景编号 | 场景名称 | 使用夹具 | 覆盖点 |
|---|---|---|---|
| TC-INT-1 | 单包项目端到端 | simple-project | CLI 调用 `runKnowledgeGraph` → 生成 `knowledge-graph.json` + `architecture-summary.md`；断言 JSON 含 meta / nodes / edges / cycles / stats 五个顶层字段；断言 Markdown 为中文、含 6 个章节；断言 Header.vue 依赖被正确收集 |
| TC-INT-2 | monorepo 项目端到端 | monorepo-project | 子包识别（pnpm-workspace.yaml）+ 独立图谱生成 + 聚合图谱；断言 `isMonorepo === true`、`packages` 含 `packages/shared` 与 `packages/app`；断言聚合图谱包含跨包依赖（`@demo/shared` 被解析） |
| TC-INT-3 | alias 项目端到端 | alias-project | tsconfig paths 解析；断言 `@/utils/helper` 被正确解析为 `src/utils/helper.ts`；断言 JSON edges 中存在 `main.ts → helper.ts` 的边 |
| TC-INT-4 | 循环依赖检测端到端 | cycle-project | 真实循环依赖场景；断言 `cycles` 含 2 条循环链（a→b→a 与 c→d→e→c）；断言 `stats.cycleCount === 2` |
| TC-INT-5 | 增量更新 | simple-project | 首次全量扫描 → 修改 `src/utils/format.ts` → 第二次扫描；断言第二次扫描仅 `format.ts` 重新解析，其余文件命中缓存；断言 `.cache.json` 文件存在且 mtime 更新 |

### 3.4 回归测试（覆盖 v1.1 ~ v1.4）

> **回归测试要求**：`pnpm test` 全量通过，无新增失败用例。v1.5 模块独立于 `lib/knowledge-graph/`，与运行时监控 / code-quality / 结构化日志 / store 错误采集代码无交叉，回归风险低。
>
> **P1 修复说明**：原回归测试清单仅列 8 个测试文件，实际 `tests/` 目录下有 16 个测试文件 + 3 个 e2e 测试文件。以下清单已补全，覆盖全部既有测试文件。

#### 3.4.1 单元测试回归清单（16 个文件）

| 测试范围 | 测试文件 | 版本 | 说明 |
|---|---|---|---|
| v1.1 运行时监控 | `tests/vue3-monitor.test.ts` | v1.1 | 确保运行时采集无回归 |
| v1.1 CLI | `tests/shield-cli.test.ts` | v1.1 | 确保 shield 子命令无回归 |
| v1.2 code-quality | `tests/quality.test.ts` | v1.2 | 确保 ESLint / tsc / 单测能力无回归 |
| v1.2 code-quality 集成 | `tests/quality.integration.test.ts` | v1.2 | 确保 code-quality 集成测试无回归 |
| v1.3 结构化日志 | `tests/structured-logger.test.ts` | v1.3 | 确保 NDJSON 日志无回归 |
| v1.4 Pinia | `tests/pinia-monitor.test.ts` | v1.4 | 确保 Pinia 错误采集无回归 |
| v1.4 Vuex | `tests/vuex-monitor.test.ts` | v1.4 | 确保 Vuex 错误采集无回归 |
| v1.4 custom-rules | `tests/custom-rules.test.ts` | v1.4 | 确保自定义规则扫描无回归 |
| v1.4 analyzer | `tests/analyzer.test.ts` | v1.4 | 确保日志聚合分析无回归 |
| API 服务 | `tests/api.test.ts` | v1.1 | 确保 API 服务无回归 |
| 平台检测 | `tests/platform.test.ts` | v1.1 | 确保平台检测无回归 |
| 报告生成 | `tests/reporter.test.ts` | v1.2 | 确保报告生成无回归 |
| 风险聚合 | `tests/risk-aggregator.test.ts` | v1.2 | 确保风险聚合无回归 |
| 扫描器 | `tests/scanner.test.ts` | v1.2 | 确保 custom-rules 扫描器无回归 |
| 启动页 | `tests/start-page.test.ts` | v1.1 | 确保启动页无回归 |
| 工具函数 | `tests/utils.test.ts` | v1.1 | 确保工具函数无回归 |

#### 3.4.2 E2E 测试回归清单（3 个文件）

| 测试范围 | 测试文件 | 版本 | 说明 |
|---|---|---|---|
| E2E 边界测试 | `tests/e2e/boundary.test.ts` | v1.1 | 确保边界场景 E2E 无回归 |
| E2E 性能测试 | `tests/e2e/performance.test.ts` | v1.1 | 确保性能 E2E 无回归 |
| E2E CLI 测试 | `tests/e2e/shield.e2e.test.ts` | v1.1 | 确保 CLI E2E 无回归 |

### 3.5 性能基线测试（5000 文件 30 秒）

> **性能基线验证**：使用真实项目或生成 5000 文件的合成项目验证全量扫描性能。
>
> **P2 修复说明（自动化程度）**：性能基线测试为**半自动化测试**——测试脚本通过 `runKnowledgeGraph` API 调用并断言 `durationMs < 30000`，可纳入 `pnpm test` 自动执行；但 5000 文件合成项目的夹具准备（生成 5000 个 .ts 文件）为一次性脚本，不纳入常规测试夹具。CI 中执行性能基线测试时使用合成项目夹具，实际耗时数据记录在验收报告中。

- **测试场景**：5000 文件全量扫描
- **目标**：< 30 秒（SSD 存储，并发数=8）
- **增量扫描目标**：< 5 秒（90% 文件命中缓存）
- **内存占用目标**：< 500MB
- **自动化方式**：`tests/knowledge-graph/performance.test.ts` 中调用 `runKnowledgeGraph({ project: <合成项目路径> })`，断言 `GraphResult.durationMs < 30000`。合成项目夹具由 `tests/knowledge-graph/fixtures/generate-large-project.ts` 脚本一次性生成（5000 个 .ts 文件，每个含 5-10 个 import 语句），夹具不纳入 git（`.gitignore` 排除），CI 中首次运行时自动生成。
- **验证方式**：
  - 方式 1（推荐）：使用真实项目（如 legacy-shield 自身源码 + node_modules 中的 .ts/.js 文件合成到 5000 文件规模）
  - 方式 2：生成 5000 个 .ts 文件的合成项目（每个文件含 5-10 个 import 语句），执行 `runKnowledgeGraph` 并记录 `durationMs`
- **断言**：`GraphResult.durationMs < 30000`
- **不达标处理**（P1 修复：与 AC-9 对齐）：性能基线为 AC-9 的硬性验收标准，**不达标则阻塞 T12 验收**，不允许"标注后通过"。若性能不达标，须按以下流程处理：
  1. 记录实际耗时数据与瓶颈分析（CPU / IO / 内存）。
  2. 启动 v1.6 变更流程（设计文档已预留升级为 Worker 线程的方案），经需求对齐与 Spec 评审后实施优化。
  3. 优化后重新执行性能基线测试，达标后方可通过 T12 验收。
  4. 在验收报告中如实记录"首次不达标 → v1.6 优化 → 达标"的完整过程。

### 3.6 CI 命令

执行链：
```
pnpm typecheck   # 类型检查
pnpm build       # 构建（含 knowledge-graph 模块编译）
pnpm test        # vitest 全量（含 knowledge-graph 单测 + 集成测试 + 回归测试）
```

三者均为零失败时本任务方可通过验收。

---

## 4. 测试计划

### 4.1 单元测试

详见 §3.2，共 6 个测试文件、70 个测试用例（resolver 11 + collector 14 + graph 10 + analyzer 10 + monorepo 13 + scanner 12 = 70，实际以代码为准）。

> **P2 修复说明**：原 §4.1 写"67 个测试用例"，但括号内计算 11+14+10+10+13+12=70，存在矛盾。已修正为 70。

### 4.2 集成测试 / 端到端测试

详见 §3.3，共 1 个测试文件、5 个端到端场景。所有场景通过 `runKnowledgeGraph` 编排入口驱动完整流程（scanner → graph → analyzer → monorepo → output），不 mock 内部模块。

### 4.3 回归测试

详见 §3.4，共 16 个单元测试文件 + 3 个 e2e 测试文件，要求 `pnpm test` 全量通过，无新增失败用例。

### 4.4 性能基线测试

详见 §3.5，5000 文件全量扫描 < 30 秒，增量扫描 < 5 秒，内存占用 < 500MB。

---

## 5. 风险与依赖

| 风险 / 依赖 | 影响 | 应对措施 |
|---|---|---|
| 依赖 T1 ~ T11 全部完成 | 阻塞本任务 | 严格按 T1 → T2 → ... → T11 → T12 顺序执行 |
| 4 套测试夹具工作量集中 | 可能延迟验收 | 夹具文件不涉及生产代码，可在 T7 / T8 / T9 期间提前准备 |
| 5000 文件性能基线不达标 | 阻塞 AC-9 验收 | T4 完成后可用真实项目提前验证并发扫描性能；若不达标在设计文档已预留升级为 v1.6 引入 Worker 线程的方案 |
| 回归测试覆盖 v1.1~v1.4 全套既有测试 | 任一回归将阻塞交付 | v1.5 模块独立于 `lib/knowledge-graph/`，与运行时监控 / code-quality / 结构化日志 / store 错误采集代码无交叉，回归风险低 |
| monorepo-project 夹具的 pnpm-workspace.yaml 简化解析 | 部分高级 YAML 特性不支持 | 夹具仅使用简单数组形式 `packages: ['packages/*']`，不使用 YAML 锚点/合并键 |
| cycle-project 夹具的循环检测去重 | 不同 DFS 入口可能产生重复循环 | 验证去重逻辑（`[...new Set(cycle)].sort().join('|')` 作为 key） |

---

## 6. 变更范围

- **本任务范围内**：
  - `tests/knowledge-graph/fixtures/simple-project/*`（新增夹具）
  - `tests/knowledge-graph/fixtures/monorepo-project/*`（新增夹具）
  - `tests/knowledge-graph/fixtures/alias-project/*`（新增夹具）
  - `tests/knowledge-graph/fixtures/cycle-project/*`（新增夹具）
  - `tests/knowledge-graph/resolver.test.ts`（新增单测）
  - `tests/knowledge-graph/collector.test.ts`（新增单测）
  - `tests/knowledge-graph/graph.test.ts`（新增单测）
  - `tests/knowledge-graph/analyzer.test.ts`（新增单测）
  - `tests/knowledge-graph/monorepo.test.ts`（新增单测）
  - `tests/knowledge-graph/scanner.test.ts`（新增单测）
  - `tests/knowledge-graph/integration.test.ts`（新增集成测试）
- **不在本任务范围内**：
  - 业务代码修改（已在 T1 ~ T11 完成）；
  - 文档更新与验收报告（T13）；
  - 归档操作（在签字之后由用户授权或单独 PATCH 任务执行）。

---

## 7. 评审记录

| 轮次 | 日期 | 结论 | P0/P1 问题 | 修复方案 |
|---|---|---|---|---|
| 1 | 2026-06-22 | 修改后通过 | P1：回归测试清单仅列 8 个但实际 tests/ 目录有 16 个测试文件 + 3 个 e2e 测试；P1：性能基线不达标处理与 AC-9 矛盾（T12 允许"标注后通过"但 AC-9 要求必须 30 秒内完成）；P2：单元测试用例总数 67 vs 70 矛盾；P2：缺少 REQ-1.5-10/14/15 映射；P2：性能基线测试自动化程度不明 | P1：回归测试清单补全为 16 个单元测试文件 + 3 个 e2e 测试文件；P1：性能基线改为硬性要求，不达标阻塞验收，须启动 v1.6 优化流程后重新验证；P2：用例数修正为 70；P2：§2 补充 REQ-1.5-10/14/15 映射；P2：§3.5 明确性能基线为半自动化测试（脚本断言 + 合成夹具一次性生成） |
