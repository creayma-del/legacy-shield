# T13：文档更新与验收报告

> 版本：v1.5
> 任务编号：T13
> 对应阶段 Spec：[phase-v1.5-spec.md](phase-v1.5-spec.md)
> 对应设计文档：[design-v1.5.md](../design-v1.5.md)
> 对应执行计划：[execution-plan-v1.5.md](../execution-plan-v1.5.md)
> 依赖任务：T12
> 状态：已完成，已归档（冻结，不再修改）
> 评审记录：见本文档末尾

---

## 1. 任务目标

完成 v1.5 用户文档更新与验收报告输出，使文档与代码行为完全一致，且 v1.5 具备进入归档的最终条件。

具体包括：
- 创建 `docs/specs/v1.5/acceptance-report-v1.5.md`，依据设计文档 §12 的 12 条验收标准逐条填写测试结果与结论；
- 扩展 `README.md`，新增「知识图谱生成」能力说明与 `shield graph` 用法；
- 扩展 `docs/api.md`，新增 graph 子命令说明（参数定义、输出路径、与 quality 的关系、示例命令）；
- 验证文档与代码行为一致（参数名、默认值、输出文件名均与代码一致）。

对应阶段 Spec 交付物 D17 / D18 与 REQ-1.5-18。

---

## 2. 对应需求与验收标准

| 需求编号 | 需求描述 | 本任务验收标准 |
|---|---|---|
| REQ-1.5-10 | 新增独立 graph 子命令，与 quality/report/api 并列 | `docs/api.md` 含 graph 子命令的参数定义、输出路径、示例命令 |
| REQ-1.5-14 | 默认输出到 `<project>/.legacy-shield/knowledge-graph/` 目录，可通过 --out 自定义 | `docs/api.md` 与 `README.md` 说明默认输出路径与 `--out` 自定义用法，与代码行为一致 |
| REQ-1.5-15 | graph 子命令与 quality 子命令完全独立，不自动集成 | `docs/api.md` 明确说明 graph 与 quality 完全独立，用户需手动运行 |
| REQ-1.5-18 | 文档同步更新 README、api.md | `README.md` 含「知识图谱生成」章节；`docs/api.md` 含 graph 子命令说明；文档与代码行为一致 |
| 阶段 Spec AC-11 | README、api.md 文档与代码行为一致 | 文档中参数名、默认值、输出文件名均与代码一致；文档审查通过 |
| 阶段 Spec AC-10 | `pnpm typecheck`、`pnpm build`、`pnpm test` 全量通过 | 三套 CI 全绿（T12 已验证，T13 复核） |

---

## 3. 实现步骤

### 3.1 创建 `docs/specs/v1.5/acceptance-report-v1.5.md`

> 模板沿用 [acceptance-report-v1.4.md](file:///Users/creayma/personal/legacy-shield/docs/specs/v1.4/acceptance-report-v1.4.md) 风格，完整包含以下要素。

#### 3.1.1 验收报告结构

1. **测试环境**：OS / Node / pnpm / Playwright / Vitest / TypeScript 版本。
2. **实现变更摘要**：新增 / 修改文件清单（对应设计文档 §11 交付物 Checklist）。
3. **端到端示例验证**：手工 review 命令与产出确认（`shield graph --project <path>` 输出 `knowledge-graph.json` + `architecture-summary.md`）。
4. **REQ 覆盖 + AC 覆盖**：逐条勾选 REQ-1.5-1 ~ REQ-1.5-18，以及阶段 Spec AC-1 ~ AC-12。
5. **12 条验收标准逐条结论**（对应设计文档 §12）：
   - AC-1：`shield graph --project <path>` 可在目标项目上生成 `knowledge-graph.json` 与 `architecture-summary.md`。
     - 结论：[通过/不通过]
     - 证据：T12 集成测试 TC-INT-1（simple-project 端到端）结果
   - AC-2：JSON 格式知识图谱结构完整，包含 meta、nodes、edges、cycles、stats 五个部分。
     - 结论：[通过/不通过]
     - 证据：T12 单测 graph.test.ts + 集成测试 integration.test.ts JSON 输出结构验证结果
   - AC-3：Markdown 架构摘要为中文，包含 §7.2 定义的 6 个章节。
     - 结论：[通过/不通过]
     - 证据：T12 单测 markdown-output 验证 + 集成测试 integration.test.ts Markdown 输出验证结果（6 章节中文内容）
   - AC-4：知识图谱正确反映文件间 import / export / require 依赖关系。
     - 结论：[通过/不通过]
     - 证据：T12 单测 collector.test.ts 结果
   - AC-5：路径解析覆盖相对路径、`@/` alias、node_modules 包、扩展名补全。
     - 结论：[通过/不通过]
     - 证据：T12 单测 resolver.test.ts + alias-project 端到端测试结果
   - AC-6：循环依赖被正确检测并输出循环链。
     - 结论：[通过/不通过]
     - 证据：T12 单测 graph.test.ts + cycle-project 端到端测试结果（a→b→a 与 c→d→e→c）
   - AC-7：monorepo 项目可生成每个子包的独立图谱 + 全局聚合图谱。
     - 结论：[通过/不通过]
     - 证据：T12 单测 monorepo.test.ts + monorepo-project 端到端测试结果
   - AC-8：增量更新模式下，未变更文件跳过重新解析，性能显著优于全量重建。
     - 结论：[通过/不通过]
     - 证据：T12 单测 scanner.test.ts 缓存命中/失效 + integration.test.ts 增量更新场景结果
   - AC-9：5000 文件规模项目全量扫描在 30 秒内完成（SSD 存储，并发数=8）。
     - 结论：[通过/不通过]
     - 证据：T12 性能基线测试结果（实际耗时 ms）
   - AC-10：`pnpm typecheck`、`pnpm build`、`pnpm test` 全量通过。
     - 结论：[通过/不通过]
     - 证据：三套 CI 执行结果
   - AC-11：README、api.md 文档与代码行为一致。
     - 结论：[通过/不通过]
     - 证据：T13 文档审查结果（参数名、默认值、输出文件名一致性核对表）
   - AC-12：v1.1 ~ v1.4 已有能力无回归。
     - 结论：[通过/不通过]
     - 证据：T12 回归测试 16 个单元测试文件 + 3 个 e2e 测试文件全绿结果
6. **测试结果表**：
   - 单元测试结果（6 个测试文件、70 用例全绿结果表）；
   - 集成测试结果（5 个端到端场景全绿结果表）；
   - 回归测试结果（16 个单元测试文件 + 3 个 e2e 测试文件全绿结果表）；
   - 性能基线测试结果（5000 文件实际耗时、内存占用）。
7. **遗留问题表**：含设计评审、执行计划评审、阶段 Spec 评审、任务 Spec 评审中的 P2 问题处理结论。
8. **双签字位**：测试验收专家 + 用户/产品负责人。

#### 3.1.2 验收阶段特别核验项

- **文档与代码一致性核对表**（对应 AC-11）：列出 `shield graph` 全部参数（`--project` / `--out` / `--concurrency` / `--fresh` / `--format` / `--hub-threshold`）的文档描述值与代码实际值对照，确认默认值、类型、校验规则一致。
- **覆盖矩阵证据**：附件中附加 REQ×AC 全维矩阵截图或链接。

### 3.2 扩展 `README.md`

> 实现前必须先阅读 `README.md` 现状，按现有写作风格扩展，不修改 `quality` / `runtime-monitor` 等无关章节。

#### 3.2.1 新增「知识图谱生成」章节

在能力清单中新增「知识图谱生成」说明，包含：

- **能力概述**：`shield graph --project <path>` 为目标项目生成 AI 可读的项目知识图谱，包含文件级依赖关系、循环依赖、hub 文件、分层架构等关键信息。
- **快速开始**：
  ```bash
  # 生成知识图谱（JSON + Markdown 双格式）
  shield graph --project /path/to/project

  # 仅生成 JSON 格式
  shield graph --project /path/to/project --format json

  # 仅生成 Markdown 格式
  shield graph --project /path/to/project --format md

  # 自定义输出目录
  shield graph --project /path/to/project --out /custom/output/path

  # 强制全量重建（忽略缓存）
  shield graph --project /path/to/project --fresh

  # 自定义并发数与 hub 阈值
  shield graph --project /path/to/project --concurrency 16 --hub-threshold 5
  ```
- **输出文件**：
  - `knowledge-graph.json`：机器可读的 JSON 格式知识图谱（含 meta / nodes / edges / cycles / stats 五个顶层字段）
  - `architecture-summary.md`：中文 AI 优化格式的架构摘要（6 章节结构：项目架构概览 / 模块依赖拓扑 / 关键节点识别 / 循环依赖分析 / 分层结构推断 / 架构健康度评估）
- **默认输出路径**：`<project>/.legacy-shield/knowledge-graph/`
- **与 quality 子命令的关系**：完全独立，不自动集成，用户需手动运行 `shield graph`。
- **支持的路径解析**：相对路径、tsconfig/jsconfig paths alias（`@/*` 等）、node_modules 包（含 scoped 包）、扩展名补全（`.ts` / `.tsx` / `.js` / `.jsx` / `.vue`）。
- **monorepo 支持**：自动识别 pnpm-workspace.yaml / lerna.json / package.json workspaces / packages/* 目录约定，为每个子包生成独立图谱 + 全局聚合图谱。
- **不支持的场景**（明确说明）：
  - webpack `resolve.alias` 配置（需读取 `webpack.config.js`）
  - vite `resolve.alias` 配置（需读取 `vite.config.ts`）
  - 动态 `import()` 变量表达式的解析（标记为 unresolved 边）
  - 变量 `require()` 路径解析（标记为 unresolved 边）

### 3.3 扩展 `docs/api.md`

> 实现前必须先阅读 `docs/api.md` 现状，按现有写作风格扩展，不修改其他子命令说明。

#### 3.3.1 新增 graph 子命令说明

新增「graph 子命令」章节，包含：

- **命令说明**：`shield graph --project <path>` — 生成项目知识图谱。
- **参数定义表**：

  | 参数 | 类型 | 必填 | 默认值 | 说明 |
  |---|---|---|---|---|
  | `--project <path>` | string | 是 | — | 目标项目根路径 |
  | `--out <path>` | string | 否 | `<project>/.legacy-shield/knowledge-graph/` | 输出目录 |
  | `--concurrency <n>` | integer | 否 | `8` | 并发扫描数，必须 >= 1 |
  | `--fresh` | boolean | 否 | `false` | 强制全量重建，忽略缓存 |
  | `--format <format>` | `json` / `md` / `both` | 否 | `both` | 输出格式 |
  | `--hub-threshold <n>` | integer | 否 | `10` | hub 文件入度阈值，必须 >= 0 |

- **选项校验规则**：
  - `concurrency` 非整数或 < 1 时抛错（如 `--concurrency 0` / `--concurrency abc`）
  - `format` 非 `json` / `md` / `both` 时抛错（如 `--format xml`）
  - `hubThreshold` 非整数或 < 0 时抛错（如 `--hub-threshold -1`）
- **输出文件**：
  - `knowledge-graph.json`：JSON 格式知识图谱（结构含 meta / nodes / edges / cycles / stats）
  - `architecture-summary.md`：Markdown 架构摘要（中文 6 章节结构）
  - `.cache.json`：mtime 缓存（隐藏文件，用于增量更新）
- **输出路径**：
  - 默认：`<project>/.legacy-shield/knowledge-graph/`
  - 自定义：通过 `--out <path>` 指定
- **与 quality 子命令的关系**：完全独立，不自动集成。运行 `shield graph` 不触发 quality 流程，反之亦然。
- **示例命令**：
  ```bash
  # 基本用法
  shield graph --project /path/to/project

  # 仅输出 JSON
  shield graph --project /path/to/project --format json

  # 强制全量重建
  shield graph --project /path/to/project --fresh

  # 自定义并发数与 hub 阈值
  shield graph --project /path/to/project --concurrency 16 --hub-threshold 5
  ```
- **JSON 输出 Schema 说明**：简要说明 `KnowledgeGraphJson` 的顶层字段（meta / nodes / edges / cycles / stats），并说明 edges 列表可重建邻接表（`edges.forEach(e => adjacency[e.from].push(e.to))`）。
- **路径解析能力说明**：
  - 支持的解析方式：相对路径、tsconfig/jsconfig paths alias、node_modules 包（含 scoped 包）、扩展名补全（`.ts` / `.tsx` / `.js` / `.jsx` / `.vue`）、index 文件解析
  - 不支持的场景：webpack/vite resolve.alias、动态 `import()` 变量表达式、变量 `require()` 路径
- **monorepo 支持说明**：
  - 识别优先级：package.json workspaces → lerna.json → pnpm-workspace.yaml 简化解析 → packages/* 目录约定
  - 输出：每个子包独立图谱 + 全局聚合图谱
  - 支持的跨包依赖协议：`workspace:*` / `link:./packages/foo` / `file:./packages/foo` / node_modules 软链接（pnpm 风格）

### 3.4 文档与代码一致性验证

> **验证目标**：确保文档中描述的参数名、默认值、输出文件名、校验规则与实际代码行为 100% 一致。

#### 3.4.1 一致性核对表

| 核对项 | 文档描述 | 代码实际值 | 一致性 |
|---|---|---|---|
| 子命令名称 | `graph` | `program.command('graph')` | [待核对] |
| `--project` 参数 | 必填，string | `.requiredOption('--project <path>')` | [待核对] |
| `--out` 参数 | 可选，默认 `<project>/.legacy-shield/knowledge-graph/` | `.option('--out <path>', '', '')` + 代码内 `opts.out \|\| undefined` | [待核对] |
| `--concurrency` 参数 | 可选，默认 8，整数 >= 1 | `.option('--concurrency <n>', '', '8')` + `Number.isInteger` 校验 | [待核对] |
| `--fresh` 参数 | 可选，默认 false | `.option('--fresh')` + `opts.fresh ?? false` | [待核对] |
| `--format` 参数 | 可选，默认 both，枚举 json/md/both | `.option('--format <format>', '', 'both')` + `['json','md','both'].includes` 校验 | [待核对] |
| `--hub-threshold` 参数 | 可选，默认 10，整数 >= 0 | `.option('--hub-threshold <n>', '', '10')` + `Number.isInteger` 校验 | [待核对] |
| JSON 输出文件名 | `knowledge-graph.json` | `writeJson` 写入 `knowledge-graph.json` | [待核对] |
| Markdown 输出文件名 | `architecture-summary.md` | `writeMarkdown` 写入 `architecture-summary.md` | [待核对] |
| 缓存文件名 | `.cache.json` | `loadCache` / `saveCache` 读写 `.cache.json` | [待核对] |
| 默认输出路径 | `<project>/.legacy-shield/knowledge-graph/` | `options.out \|\| <project>/.legacy-shield/knowledge-graph/` | [待核对] |
| JSON 顶层字段 | meta / nodes / edges / cycles / stats | `KnowledgeGraphJson` 接口 | [待核对] |
| Markdown 章节数 | 6 个章节 | `toMarkdown` 生成 6 章节 | [待核对] |

#### 3.4.2 验证方式

- 通过 `RunCommand` 执行 `pnpm typecheck` / `pnpm build` / `pnpm test`，确认三套 CI 全绿。
- 手工 review：文档示例命令在本机执行后输出与文档描述一致。
- 文档内部链接有效性回归校验：检查所有站内相对路径链接（`*.md` 文件间引用）可正确跳转，无断链。

### 3.5 文档归档准备

- T13 完成后，等待用户 / 产品负责人对 `acceptance-report-v1.5.md` 签字「通过」；
- 准备归档清单与顺序说明（不实际修改文档状态）：
  - 按 spec-guardian-checklists 归档前最终检查清单记录以下文档的归档顺序 — 所有 `phase-v1.5-t*-spec.md` → `phase-v1.5-spec.md` → `execution-plan-v1.5.md` → `design-v1.5.md` → `requirements-decomposition-v1.5.md` / `requirements-alignment-v1.5-20260622.md`（视情况）。
  - **实际状态更新待用户授权或 PATCH 任务执行**，本任务不执行写入操作。

---

## 4. 测试计划

### 4.1 单元测试

- 不涉及（文档类任务）。

### 4.2 集成测试 / 端到端测试

- 手工 review：文档示例命令在本机执行后输出与文档一致；
- 通过 `RunCommand` 执行 `pnpm typecheck` / `pnpm build` / `pnpm test`，确认三套 CI 全绿。

### 4.3 回归测试

- 既有 `README.md` / `docs/api.md` 内容未被破坏；
- 既有验收报告（v1.1 / v1.2 / v1.3 / v1.4）链接与状态未受影响；
- 文档内部链接有效性回归校验：检查所有站内相对路径链接（`*.md` 文件间引用）可正确跳转，无断链。

---

## 5. 风险与依赖

| 风险 / 依赖 | 影响 | 应对措施 |
|---|---|---|
| 依赖 T12 全部测试通过 | 验收报告无法签字 | 严格按 T1 ~ T12 顺序执行；T12 任一测试失败时本任务暂缓 |
| 文档与代码行为不一致 | AC-11 验收不通过 | §3.4 一致性核对表逐项核对，参数名 / 默认值 / 输出文件名均与代码对照 |
| 签字流程异步 | 归档延迟 | 提交验收报告后即可挂起；签字回收后再走归档 |
| `docs/api.md` 现有结构与设想不符 | 文档新增章节风格不一致 | 实现前先读取现有 `docs/api.md`，按既有写作风格扩展 |
| `README.md` 现有结构与设想不符 | 文档新增章节风格不一致 | 实现前先读取现有 `README.md`，按既有写作风格扩展 |

---

## 6. 变更范围

- **本任务范围内**：
  - `docs/specs/v1.5/acceptance-report-v1.5.md`（新增验收报告）；
  - `README.md`（扩展「知识图谱生成」章节）；
  - `docs/api.md`（扩展 graph 子命令说明）。
- **不在本任务范围内**：
  - 业务代码修改（已在 T1 ~ T11 完成）；
  - 测试代码修改（T12）；
  - 归档操作（在签字之后由用户授权或单独 PATCH 任务执行）。

---

## 7. 评审记录

| 轮次 | 日期 | 结论 | P0/P1 问题 | 修复方案 |
|---|---|---|---|---|
| 1 | 2026-06-22 | 修改后通过 | P1：AC-2 描述"四个部分"应为"五个部分"（与阶段 Spec 同类问题，遗漏 meta）；P2：AC-3 证据与阶段 Spec 验收方法不一致（阶段 Spec 为"T12 单测：markdown-output 验证"，T13 仅写集成测试证据） | P1：AC-2 改为"包含 meta、nodes、edges、cycles、stats 五个部分"；P2：AC-3 证据补充"T12 单测 markdown-output 验证"，与阶段 Spec 验收方法对齐；同步修正回归测试结果表为 16+3 个文件、单元测试用例数为 70 |
