# legacy-shield v1.5 验收报告

> 版本：v1.5
> 验收日期：2026-06-23
> 对应需求文档：[meetings/requirements-alignment-v1.5-20260622.md](meetings/requirements-alignment-v1.5-20260622.md)
> 对应需求分解：[requirements-decomposition-v1.5.md](requirements-decomposition-v1.5.md)
> 对应设计文档：[design-v1.5.md](design-v1.5.md)
> 对应执行计划：[execution-plan-v1.5.md](execution-plan-v1.5.md)
> 对应阶段 Spec：[phases/phase-v1.5-spec.md](phases/phase-v1.5-spec.md)
> 对应任务 Spec：T1 ~ T13（见 [phases/](phases/) 目录）
> 状态：已完成，已归档（冻结，不再修改）

---

## 1. 测试环境

| 项 | 版本 / 说明 |
|---|---|
| 操作系统 | macOS（Darwin） |
| Node.js | v22.12.0（满足 vitest 4.x `>=20.19` 要求） |
| pnpm | 10.33.4 |
| 测试框架 | Vitest v4.1.9 |
| TypeScript | v5.9.3 |
| 主项目目录 | `/Users/creayma/personal/legacy-shield` |

---

## 2. 实现变更摘要

### 2.1 新增文件

- 知识图谱模块（`lib/knowledge-graph/`）：
  - `types.ts` — 模块内部类型（GraphNode / GraphEdge / GraphStats / KnowledgeGraph / KnowledgeGraphJson 等）
  - `resolver.ts` — ModuleResolver 类 + createResolver 工厂（tsconfig/jsconfig paths 解析）
  - `collector.ts` — collectDependencies / parseFile / parseVueSFC（Babel visitor）
  - `scanner.ts` — scanFilesConcurrent（索引游标并发）+ mtime 缓存（Record<string, CacheEntry>）
  - `graph.ts` — buildGraph + detectCycles（迭代式 DFS 三色标记）+ computeComponents（并查集 WCC）
  - `analyzer.ts` — analyzeGraph（hub/孤立/分层/isEntry 统一计算）+ inferLayers
  - `monorepo.ts` — detectMonorepo（4 级优先级）+ generatePackageGraph + generateAggregateGraph
  - `json-output.ts` — toJson + writeJson
  - `markdown-output.ts` — toMarkdown + writeMarkdown（中文 6 章节结构）
  - `index.ts` — runKnowledgeGraph 编排入口
- CLI 适配器：
  - `lib/cli/graph.ts` — runGraph 薄层适配器
- 测试夹具（`tests/knowledge-graph/fixtures/`）：
  - `simple-project/` — 单包项目夹具
  - `monorepo-project/` — monorepo 项目夹具
  - `alias-project/` — alias 配置项目夹具
  - `cycle-project/` — 循环依赖项目夹具
  - `generate-large-project.ts` — 5000 文件合成项目生成脚本（.gitignore 排除）
- 测试文件（`tests/knowledge-graph/`）：
  - `resolver.test.ts` — 路径解析器单测（11 用例）
  - `collector.test.ts` — 依赖收集单测（14 用例）
  - `graph.test.ts` — 图构建与循环检测单测（10 用例）
  - `analyzer.test.ts` — 图谱分析单测（10 用例）
  - `monorepo.test.ts` — monorepo 支持单测（13 用例）
  - `scanner.test.ts` — 并发扫描与缓存单测（12 用例）
  - `integration.test.ts` — 集成测试（5 端到端场景）
  - `performance.test.ts` — 性能基线测试（3 用例：全量/增量/缓存验证）
- 验收文档：
  - `docs/specs/v1.5/acceptance-report-v1.5.md`（本文档）

### 2.2 修改文件

- `lib/types.ts`：新增 `GraphOptions`（含 `hubThreshold`）与 `GraphResult` 导出类型。
- `cli.ts`：静态 import `runGraph`，新增 `graph` 子命令定义与选项校验（concurrency / format / hubThreshold）。
- `tsconfig.test.json`：`exclude` 新增 `tests/knowledge-graph/fixtures`，避免夹具源码触发 TS2307。
- `.gitignore`：新增 `tests/knowledge-graph/fixtures/large-project/`，排除 5000 文件合成项目。

### 2.3 开发期间发现并修复的 Bug

| Bug | 文件 | 原因 | 修复 |
|---|---|---|---|
| 相对路径解析返回 null | `resolver.ts` L26 | `resolve(spec, importer)` 将 `main.ts` 视为目录组件，返回 `main.ts/foo` | 改为 `resolveRelative(spec, dirname(importer))` |
| jsconfig baseUrl='.' 相对 CWD | `resolver.ts` L120-123 | `baseUrl: '.'` 未解析为基于 projectRoot 的绝对路径 | `createResolver` 中 `resolve(projectRoot, compilerOptions.baseUrl)` |
| dynamic import() 未收集 | `collector.ts` L33/L58-76/L205-252 | Babel 7.29.7 将 `import()` 解析为 `CallExpression`（`callee.type === 'Import'`），而非 `ImportExpression` | 新增 `'dynamicImport'` 插件 + `CallExpression` 中 `callee.type === 'Import'` 分支 |
| 严重语法错误导致 collectDependencies 抛异常 | `collector.ts` L114-125 | `errorRecovery: true` 无法处理的严重语法错误 | `parseFile` 调用外加 try-catch，返回空依赖 |
| detectCycles 递归栈溢出 | `graph.ts` L127-190 | 递归 DFS 在 5000 文件深度依赖链下触发 `RangeError: Maximum call stack size exceeded` | 改为迭代式 DFS（显式栈 + neighborIdx 游标） |

---

## 3. 端到端示例验证

### 3.1 自动化 CI 链路

执行命令链 `pnpm typecheck && pnpm build && pnpm test`：

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && pnpm typecheck
# tsc --noEmit && tsc -p tsconfig.test.json --noEmit
# 退出码 0，无类型错误

source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && pnpm build
# tsc && node scripts/strip-inject-export.js
# 退出码 0，构建成功

source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && pnpm test
# RUN  vitest v4.1.9
# Test Files  27 passed (27)
#       Tests  206 passed | 3 skipped (209)
# Duration  22.92s
# 退出码 0
```

> Skip 3 条说明（沿用 v1.4 遗留）：TC-3（Pinia plugin install 异常实测无法在 `pinia.use` 包装层捕获）、TC-8 / TC-8a（Vuex 4 strict 通过 Vue 3 异步 watcher 触发，commit 同步 try/catch 无法捕获）。这两类限制已在 v1.4 T4 任务 Spec §3.1 watcher 抛错论证中预见，相应用例采用 `it.skip` 并保留断言代码。

### 3.2 手工 review

- `shield graph --project <path>` 命令在本机执行后输出 `knowledge-graph.json` + `architecture-summary.md`，与文档描述一致。
- JSON 输出含 `meta` / `nodes` / `edges` / `cycles` / `stats` 五个顶层字段，与 [lib/knowledge-graph/types.ts](file:///Users/creayma/personal/legacy-shield/lib/knowledge-graph/types.ts) `KnowledgeGraphJson` 接口一致。
- Markdown 输出为中文，含 6 章节结构（项目架构概览 / 模块依赖拓扑 / 关键节点识别 / 循环依赖分析 / 分层结构推断 / 架构健康度评估），与设计文档 §7.2 一致。
- 文档站内链接（README → docs/api.md / docs/usage.md / docs/custom-rules.md；docs/* 之间相对路径）经手工浏览验证无断链。

### 3.3 性能基线验证（对应 AC-9）

执行 `npx vitest run tests/knowledge-graph/performance.test.ts --reporter=verbose`：

```text
[TC-PERF-1] 全量扫描：5000 节点、32500 边、耗时 1080ms
[TC-PERF-2] 增量扫描：5000 节点、32500 边、耗时 653ms
[TC-PERF-3] 缓存条目数：5000
```

| 场景 | 目标 | 实际耗时 | 结论 |
|---|---|---|---|
| 5000 文件全量扫描（fresh=true，并发数=8） | < 30 秒 | 1080ms | 通过（27x 余量） |
| 5000 文件增量扫描（fresh=false，缓存命中） | < 5 秒 | 653ms | 通过（7.6x 余量） |

---

## 4. REQ × AC × TC 覆盖矩阵

### 4.1 REQ 覆盖（对应 requirements-alignment-v1.5-20260622.md）

| 需求编号 | 描述（节选） | 实现位置 | 覆盖测试 | 结论 |
|---|---|---|---|---|
| REQ-1.5-1 | 扫描 src 下 JS/JSX/TS/TSX/Vue 文件构建依赖图 | scanner.ts `collectSourceFiles` + graph.ts `buildGraph` | TC-INT-1 / TC-PERF-1 | 通过 |
| REQ-1.5-2 | 解析 import/export/require 依赖关系 | collector.ts `collectDependencies` | TC-COL-1 ~ TC-COL-14 | 通过 |
| REQ-1.5-3 | 路径解析：相对路径、alias、node_modules、扩展名补全、index | resolver.ts `ModuleResolver` | TC-RES-1 ~ TC-RES-11 | 通过 |
| REQ-1.5-4 | 读取 tsconfig/jsconfig paths 自动识别 alias | resolver.ts `createResolver` | TC-RES-2 / TC-RES-11 | 通过 |
| REQ-1.5-5 | 检测循环依赖并输出循环链 | graph.ts `detectCycles`（迭代式 DFS） | TC-GRAPH-5 ~ TC-GRAPH-8 / TC-INT-4 | 通过 |
| REQ-1.5-6 | 识别 hub 文件与孤立文件 | analyzer.ts `analyzeGraph` | TC-ANA-1 ~ TC-ANA-5 | 通过 |
| REQ-1.5-7 | 推断项目分层结构 | analyzer.ts `inferLayers` | TC-ANA-7 | 通过 |
| REQ-1.5-8 | 输出 JSON 格式知识图谱 | json-output.ts `toJson` / `writeJson` | TC-INT-1 JSON 结构验证 | 通过 |
| REQ-1.5-9 | 输出中文 Markdown 架构摘要 | markdown-output.ts `toMarkdown` / `writeMarkdown` | TC-INT-1 Markdown 验证 | 通过 |
| REQ-1.5-10 | 新增独立 graph 子命令 | cli.ts `program.command('graph')` | TC-INT-1 端到端 | 通过 |
| REQ-1.5-11 | 支持并发文件扫描 | scanner.ts `scanFilesConcurrent`（索引游标） | TC-SCAN-1 ~ TC-SCAN-3 | 通过 |
| REQ-1.5-12 | 支持 mtime 缓存，增量更新 | scanner.ts `scanWithCache` / `loadCache` / `saveCache` | TC-SCAN-4 ~ TC-SCAN-10 / TC-INT-5 | 通过 |
| REQ-1.5-13 | 支持 monorepo 独立 + 聚合图谱 | monorepo.ts `detectMonorepo` / `generatePackageGraph` / `generateAggregateGraph` | TC-MONO-1 ~ TC-MONO-13 / TC-INT-2 | 通过 |
| REQ-1.5-14 | 默认输出到 `<project>/.legacy-shield/knowledge-graph/`，可 --out 自定义 | index.ts `resolveOutputPath` | TC-INT-1 输出路径验证 | 通过 |
| REQ-1.5-15 | graph 与 quality 完全独立 | cli.ts graph 子命令不引用 quality 模块 | 代码核验 | 通过 |
| REQ-1.5-16 | 目标项目规模支持到 5000 文件 | scanner.ts 并发扫描 + 缓存 | TC-PERF-1 / TC-PERF-2 | 通过 |
| REQ-1.5-17 | 保持 v1.1 ~ v1.4 已有能力零回归 | — | 19 回归测试文件全绿 | 通过 |
| REQ-1.5-18 | 文档同步更新 README、api.md | README.md / docs/api.md | §3.2 手工 review | 通过 |

### 4.2 阶段 Spec AC 覆盖（对应 phase-v1.5-spec.md §5）

| 编号 | 验收项 | 验证方法 | 结论 |
|---|---|---|---|
| AC-1 | `shield graph --project <path>` 可生成 `knowledge-graph.json` 与 `architecture-summary.md` | TC-INT-1（simple-project 端到端）全绿 | 通过 |
| AC-2 | JSON 格式知识图谱结构完整，含 meta / nodes / edges / cycles / stats 五部分 | TC-INT-1 JSON 结构验证 + graph.test.ts 全绿 | 通过 |
| AC-3 | Markdown 架构摘要为中文，含 §7.2 定义的 6 个章节 | TC-INT-1 Markdown 验证 + markdown-output 代码核验 | 通过 |
| AC-4 | 知识图谱正确反映文件间 import / export / require 依赖关系 | collector.test.ts（14 用例）全绿 | 通过 |
| AC-5 | 路径解析覆盖相对路径、`@/` alias、node_modules 包、扩展名补全 | resolver.test.ts（11 用例）+ alias-project 端到端全绿 | 通过 |
| AC-6 | 循环依赖被正确检测并输出循环链 | graph.test.ts + cycle-project 端到端（a→b→a 与 c→d→e→c）全绿 | 通过 |
| AC-7 | monorepo 项目可生成每个子包独立图谱 + 全局聚合图谱 | monorepo.test.ts（13 用例）+ monorepo-project 端到端全绿 | 通过 |
| AC-8 | 增量更新模式下，未变更文件跳过重新解析，性能显著优于全量重建 | scanner.test.ts 缓存命中/失效 + TC-INT-5 增量更新全绿 | 通过 |
| AC-9 | 5000 文件规模项目全量扫描在 30 秒内完成（SSD，并发数=8） | TC-PERF-1：1080ms（< 30 秒） | 通过 |
| AC-10 | `pnpm typecheck`、`pnpm build`、`pnpm test` 全量通过 | §3.1 三套 CI 全绿 | 通过 |
| AC-11 | README、api.md 文档与代码行为一致 | §6 一致性核对表逐项核对 | 通过 |
| AC-12 | v1.1 ~ v1.4 已有能力无回归 | 19 回归测试文件全绿（含 vue3-monitor / pinia-monitor / vuex-monitor / structured-logger / custom-rules / e2e 等） | 通过 |

### 4.3 TC × REQ 反向矩阵

| TC | 覆盖 REQ | 覆盖 AC | 状态 |
|---|---|---|---|
| TC-RES-1 ~ TC-RES-11 | REQ-1.5-3, 4 | AC-5 | passed (11) |
| TC-COL-1 ~ TC-COL-14 | REQ-1.5-2 | AC-4 | passed (14) |
| TC-GRAPH-1 ~ TC-GRAPH-10 | REQ-1.5-5 | AC-6 | passed (10) |
| TC-ANA-1 ~ TC-ANA-10 | REQ-1.5-6, 7 | — | passed (10) |
| TC-MONO-1 ~ TC-MONO-13 | REQ-1.5-13 | AC-7 | passed (13) |
| TC-SCAN-1 ~ TC-SCAN-12 | REQ-1.5-11, 12 | AC-8 | passed (12) |
| TC-INT-1 ~ TC-INT-5 | REQ-1.5-1, 8, 9, 10, 14 | AC-1, 2, 3, 5, 6, 7, 8 | passed (5) |
| TC-PERF-1 ~ TC-PERF-3 | REQ-1.5-16 | AC-9 | passed (3) |
| 回归套件（19 文件） | REQ-1.5-17 | AC-12 | passed |
| `pnpm typecheck` / `build` / `test` | — | AC-10 | passed |

---

## 5. 测试结果汇总

### 5.1 自动化测试

```text
vitest v4.1.9
Test Files  27 passed (27)
      Tests  206 passed | 3 skipped (209)
Duration  22.92s
```

涉及的测试文件（27 个）：

- v1.5 新增（8 个）：
  - `tests/knowledge-graph/resolver.test.ts`（11 用例）
  - `tests/knowledge-graph/collector.test.ts`（14 用例）
  - `tests/knowledge-graph/graph.test.ts`（10 用例）
  - `tests/knowledge-graph/analyzer.test.ts`（10 用例）
  - `tests/knowledge-graph/monorepo.test.ts`（13 用例）
  - `tests/knowledge-graph/scanner.test.ts`（12 用例）
  - `tests/knowledge-graph/integration.test.ts`（5 端到端场景）
  - `tests/knowledge-graph/performance.test.ts`（3 性能基线用例）
- v1.1 ~ v1.4 回归（19 个）：
  - `tests/vue3-monitor.test.ts`、`tests/pinia-monitor.test.ts`、`tests/vuex-monitor.test.ts`、`tests/shield-cli.test.ts`、`tests/start-page.test.ts`、`tests/structured-logger.test.ts`、`tests/custom-rules.test.ts`、`tests/e2e/shield.e2e.test.ts`、`tests/e2e/boundary.test.ts`、`tests/e2e/performance.test.ts`、`tests/platform.test.ts`、`tests/risk-aggregator.test.ts`、`tests/quality.integration.test.ts`、`tests/quality.test.ts`、`tests/logger.test.ts`、`tests/utils.test.ts`、`tests/reporter.test.ts`、`tests/analyzer.test.ts`、`tests/scanner.test.ts`、`tests/api.test.ts`

### 5.2 单元测试结果

| 测试文件 | 用例数 | 状态 |
|---|---|---|
| resolver.test.ts | 11 | 全绿 |
| collector.test.ts | 14 | 全绿 |
| graph.test.ts | 10 | 全绿 |
| analyzer.test.ts | 10 | 全绿 |
| monorepo.test.ts | 13 | 全绿 |
| scanner.test.ts | 12 | 全绿 |
| **小计** | **70** | **全绿** |

### 5.3 集成测试结果

| 场景 | 用例 ID | 状态 |
|---|---|---|
| 单包项目端到端（JSON + Markdown 输出 + Header.vue 依赖收集） | TC-INT-1 | 全绿 |
| monorepo 项目端到端（子包识别 + 跨包依赖 + 聚合图谱） | TC-INT-2 | 全绿 |
| alias 项目端到端（tsconfig paths 解析） | TC-INT-3 | 全绿 |
| 循环依赖检测端到端（a→b→a 与 c→d→e→c） | TC-INT-4 | 全绿 |
| 增量更新端到端（首次全量 → 修改文件 → 增量扫描） | TC-INT-5 | 全绿 |

### 5.4 回归测试结果

| 测试范围 | 测试文件 | 状态 |
|---|---|---|
| v1.1 运行时监控 | vue3-monitor / shield-cli / start-page / e2e / boundary | 全绿 |
| v1.2 code-quality | quality / quality.integration / scanner / custom-rules | 全绿 |
| v1.3 结构化日志 | structured-logger / platform / risk-aggregator / performance | 全绿 |
| v1.4 Pinia/Vuex | pinia-monitor / vuex-monitor / analyzer / reporter / api | 全绿 |
| 通用工具 | logger / utils | 全绿 |

### 5.5 性能基线测试结果

| 场景 | 目标 | 实际耗时 | 节点数 | 边数 | 结论 |
|---|---|---|---|---|---|
| 5000 文件全量扫描（fresh=true） | < 30 秒 | 1080ms | 5000 | 32500 | 通过 |
| 5000 文件增量扫描（fresh=false） | < 5 秒 | 653ms | 5000 | 32500 | 通过 |
| 缓存条目数验证 | 5000 | 5000 | — | — | 通过 |

### 5.6 类型检查 / 构建

| 命令 | 结果 |
|---|---|
| `pnpm typecheck` (`tsc --noEmit && tsc -p tsconfig.test.json --noEmit`) | 通过，无类型错误 |
| `pnpm build` (`tsc && node scripts/strip-inject-export.js`) | 通过，构建成功 |

---

## 6. 文档与代码一致性核对表（对应 AC-11）

| 核对项 | 文档描述 | 代码实际值 | 一致性 |
|---|---|---|---|
| 子命令名称 | `graph` | `program.command('graph')`（[cli.ts](file:///Users/creayma/personal/legacy-shield/cli.ts#L127)） | 一致 |
| `--project` 参数 | 必填，string | `.requiredOption('--project <path>')`（[cli.ts L129](file:///Users/creayma/personal/legacy-shield/cli.ts#L129)） | 一致 |
| `--out` 参数 | 可选，默认 `<project>/.legacy-shield/knowledge-graph/` | `.option('--out <path>', '', '')` + `opts.out \|\| undefined`（[cli.ts L130](file:///Users/creayma/personal/legacy-shield/cli.ts#L130)）+ [index.ts resolveOutputPath](file:///Users/creayma/personal/legacy-shield/lib/knowledge-graph/index.ts#L163-L168) | 一致 |
| `--concurrency` 参数 | 可选，默认 8，整数 >= 1 | `.option('--concurrency <n>', '', '8')` + `Number.isInteger` 校验（[cli.ts L131/L136-138](file:///Users/creayma/personal/legacy-shield/cli.ts#L131)） | 一致 |
| `--fresh` 参数 | 可选，默认 false | `.option('--fresh')` + `opts.fresh ?? false`（[cli.ts L132/L151](file:///Users/creayma/personal/legacy-shield/cli.ts#L132)） | 一致 |
| `--format` 参数 | 可选，默认 both，枚举 json/md/both | `.option('--format <format>', '', 'both')` + `['json','md','both'].includes` 校验（[cli.ts L133/L140-142](file:///Users/creayma/personal/legacy-shield/cli.ts#L133)） | 一致 |
| `--hub-threshold` 参数 | 可选，默认 10，整数 >= 0 | `.option('--hub-threshold <n>', '', '10')` + `Number.isInteger` 校验（[cli.ts L134/L143-145](file:///Users/creayma/personal/legacy-shield/cli.ts#L134)） | 一致 |
| JSON 输出文件名 | `knowledge-graph.json` | `writeJson` 写入 `knowledge-graph.json`（[json-output.ts L70](file:///Users/creayma/personal/legacy-shield/lib/knowledge-graph/json-output.ts#L70)） | 一致 |
| Markdown 输出文件名 | `architecture-summary.md` | `writeMarkdown` 写入 `architecture-summary.md`（[markdown-output.ts L673](file:///Users/creayma/personal/legacy-shield/lib/knowledge-graph/markdown-output.ts#L673)） | 一致 |
| 缓存文件名 | `.cache.json` | `loadCache` / `saveCache` 读写 `.cache.json`（[scanner.ts L35](file:///Users/creayma/personal/legacy-shield/lib/knowledge-graph/scanner.ts#L35)） | 一致 |
| 默认输出路径 | `<project>/.legacy-shield/knowledge-graph/` | `resolveOutputPath` 返回 `join(projectRoot, '.legacy-shield', 'knowledge-graph')`（[index.ts L167](file:///Users/creayma/personal/legacy-shield/lib/knowledge-graph/index.ts#L167)） | 一致 |
| JSON 顶层字段 | meta / nodes / edges / cycles / stats | `KnowledgeGraphJson` 接口（[types.ts](file:///Users/creayma/personal/legacy-shield/lib/knowledge-graph/types.ts)） | 一致 |
| Markdown 章节数 | 6 个章节 | `toMarkdown` 生成 6 章节（[markdown-output.ts](file:///Users/creayma/personal/legacy-shield/lib/knowledge-graph/markdown-output.ts)） | 一致 |

---

## 7. 遗留问题表

### 7.1 实现遗留

| 编号 | 描述 | 影响范围 | 处理结论 |
|---|---|---|---|
| R-1 | `detectCycles` 原递归实现在 5000 文件规模下栈溢出 | 大型项目循环检测失败 | 已修复：改为迭代式 DFS（显式栈 + neighborIdx 游标），TC-PERF-1 验证通过 |
| R-2 | v1.4 遗留 TC-3（Pinia plugin install 异常） | `pinia-plugin-error` 主链路覆盖率受限 | 沿用 v1.4 结论，`it.skip` 保留断言代码 |
| R-3 | v1.4 遗留 TC-8/TC-8a（Vuex 4 strict 异步 watcher） | `vuex-strict-violation` 需 errorHandler 协同 | 沿用 v1.4 结论，`it.skip` 保留断言代码 |

### 7.2 上游 P2 项闭环跟踪

| 来源 | 编号 | 处理结论 |
|---|---|---|
| 设计评审 | P0/P1（3 轮评审） | 3 轮评审后全部修复，第 3 轮通过 |
| 执行计划评审 | P1-1 ~ P1-5 / P2-1 ~ P2-3 | 2 轮评审后全部修复，第 3 轮通过 |
| 阶段 Spec 评审 | P1-1（AC-2 五部分） | 已修正为"含 meta / nodes / edges / cycles / stats 五部分" |
| 任务 Spec 评审 | T2 P1（正则 m 标志） | 已修复为 `/\/\/[^\n]*/g` |
| 任务 Spec 评审 | T4 P2（mtimeCache 复用） | 已实现 `mtimeCache: Map<string, number>` |
| 任务 Spec 评审 | T13 P1（AC-2 五部分） | 已修正 |
| 任务 Spec 评审 | T13 P2（AC-3 证据补充） | 已补充 T12 单测 markdown-output 验证 |

---

## 8. 双签字位

### 8.1 测试验收专家

- 评审人：开发助手（Trae IDE 内置 SOLO Coder）+ Vitest 自动化测试套件
- 评审日期：2026-06-23
- 评审结论：v1.5 全部任务实现符合需求 / 设计 / 执行计划 / 阶段 Spec / 任务 Spec；类型检查、构建、单元 / 集成 / 端到端 / 性能基线 / 回归测试全部通过；文档已同步更新；开发期间发现的 5 个 Bug 已全部修复并验证；遗留 R-2 / R-3 限制为 v1.4 既有问题，已透明披露并保留 it.skip 用例代码。**同意验收通过，建议归档。**

### 8.2 用户 / 产品负责人

- 签字人：creayma
- 签字日期：2026-06-23
- 签字结论：☑ 通过归档
- 签字确认：用户授权执行归档，测试验收专家端到端验收通过后，所有 v1.5 spec 文档状态已更新为「已完成，已归档（冻结，不再修改）」

---

## 9. 归档清单与顺序（已执行）

按 spec-guardian-checklists 归档前最终检查清单，v1.5 归档顺序：

1. `docs/specs/v1.5/phases/phase-v1.5-t1-spec.md` ~ `phase-v1.5-t13-spec.md` — ✅ 已归档
2. `docs/specs/v1.5/phases/phase-v1.5-spec.md` — ✅ 已归档
3. `docs/specs/v1.5/execution-plan-v1.5.md` — ✅ 已归档
4. `docs/specs/v1.5/design-v1.5.md` — ✅ 已归档
5. `docs/specs/v1.5/requirements-decomposition-v1.5.md` — ✅ 已归档
6. `docs/specs/v1.5/meetings/requirements-alignment-v1.5-20260622.md` — ✅ 已归档
7. 本文档 `docs/specs/v1.5/acceptance-report-v1.5.md` — ✅ 已归档

> **归档已于 2026-06-23 执行完毕**。测试验收专家端到端验收通过（12 项 AC 全通过、CI 三件套全绿、78 专项用例全绿、文档一致性 13 项全一致），用户授权归档后，所有 v1.5 spec 文档状态已更新为「已完成，已归档（冻结，不再修改）」。后续如需变更，须走 PATCH 或新版本流程。
