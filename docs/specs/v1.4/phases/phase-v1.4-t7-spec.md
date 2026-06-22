# T7：文档更新与验收报告

> 版本：v1.4
> 任务编号：T7
> 对应阶段 Spec：[phase-v1.4-spec.md](phase-v1.4-spec.md)
> 对应设计文档：[design-v1.4.md](../design-v1.4.md)
> 对应执行计划：[execution-plan-v1.4.md](../execution-plan-v1.4.md)
> 依赖任务：T6
> 状态：已完成，已归档（冻结，不再修改）
> 评审记录：见本文档末尾（轮次 1 不通过、轮次 2 通过）

---

## 1. 任务目标

完成 v1.4 用户文档更新与验收报告输出，使文档与代码行为完全一致，且 v1.4 具备进入归档的最终条件。

对应阶段 Spec 交付物 D12 / D13 与 REQ-1.4-12。

---

## 2. 对应需求与验收标准

| 需求编号 | 需求描述 | 本任务验收标准 |
|---|---|---|
| REQ-1.4-12 | 文档同步更新 README、api.md、custom-rules.md（范围以 design §10 D14 / execution-plan T7 为准，含 custom-rules.md） | 三份文档均按下文 §3 章节级要求更新到位，且与代码行为一致 |
| 阶段 Spec AC-11 | 文档与代码一致 + 验收报告签字 | 用户 / 产品负责人在 `acceptance-report-v1.4.md` 上签字「通过」 |

---

## 3. 实现步骤

### 3.1 更新 `README.md`

- 「支持的框架与平台」/「快速开始」相关段落：在 Vue 3 段落中加入 Pinia 2.x / Vuex 4 自动错误采集说明，同时附带示例输出片段（展示 `pinia-error` / `vuex-error` / `vuex-strict-violation` / `pinia-plugin-error` 在 runtime 日志中的样例）；不再编写独立的「shield」章节。
- 不修改 `quality` / `runtime-monitor` 等无关章节。

### 3.2 更新 `docs/api.md`

- `/logs?type=runtime` 响应体：在 `/logs` 端点响应示例前后新增子类型说明表格，表格中补充 4 个新子类型（`pinia-error` / `pinia-plugin-error` / `vuex-error` / `vuex-strict-violation`）的字段说明（来源、context 字段、典型示例）。
- `/errors/top` 说明：补充新子类型纳入聚合的说明。
- `/report?format=json` 说明：补充 `summary.runtimeErrorCount` 包含新子类型计数的说明。
- 不修改其他端点说明。

### 3.3 更新 `docs/custom-rules.md`

- 新增小节「Pinia / Vuex 自定义规则示例」，包含：
  - 基于 `subType` 编写自定义规则的语法示例（沿用现有 custom-rules 框架）；
  - **必须**提供一个完整的 `vuex-strict-violation` 自定义规则代码示例（如「同一次会话内出现 vuex-strict-violation ≥ 3 次时上报风险」），该规则完全基于现有 [risk-aggregator.ts](file:///Users/creayma/personal/legacy-shield/lib/custom-rules/risk-aggregator.ts) 与 [scanner.ts](file:///Users/creayma/personal/legacy-shield/lib/custom-rules/scanner.ts) 的能力实现，不引入新的扩展点；此示例为必选，非"二选一兜底"。
  - 同时说明「新子类型可直接通过现有 subType 字段配置自定义规则」。
- 实现前必须先阅读 `docs/custom-rules.md` 现状，按现有写作风格扩展。

### 3.4 创建 `docs/specs/v1.4/acceptance-report-v1.4.md`

模板沿用 [acceptance-report-v1.3.md](file:///Users/creayma/personal/legacy-shield/docs/specs/v1.3/acceptance-report-v1.3.md) 风格，完整包含以下要素：

1. **测试环境**：OS / Node / pnpm / Playwright / Vitest / TypeScript 版本。
2. **实现变更摘要**：新增/修改文件清单。
3. **端到端示例验证**：手工 review 命令与产出确认。
4. **REQ 覆盖 + AC 覆盖**：逐条勾选 REQ-1.4-1 ~ REQ-1.4-12，以及阶段 Spec AC-1 ~ AC-11。
5. **测试结果表**：
   - TC-1 ~ TC-16 全绿结果表；
   - 回归套件全绿结果。
6. **遗留问题表**：含设计评审 P2-1 ~ P2-4、执行计划评审 P2-R2-1 ~ P2-R2-3 的处理结论。
7. **双签字位**：测试验收专家 + 用户/产品负责人。

> **验收阶段特别核验项（对应 P2-2）**：验收阶段须核验 `inject.iife.ts` 中 `redactValue` 函数的 JSDoc 注释，确认 Map/Set/Class 实例的浅拷贝行为已正确注释。
>
> **覆盖矩阵证据（对应 P2-R2-3）**：附件中附加 REQ×TC×AC 全维矩阵截图或链接。

### 3.5 文档归档准备

- T7 完成后，等待用户 / 产品负责人对 `acceptance-report-v1.4.md` 签字「通过」；
- 准备归档清单与顺序说明（不实际修改文档状态）：
  - 按 [spec-guardian-checklists 归档前最终检查清单](file:///Users/creayma/personal/legacy-shield/.trae/skills/spec-guardian-checklists/SKILL.md) 记录以下文档的归档顺序 — 所有 `phase-v1.4-t*-spec.md` → `phase-v1.4-spec.md` → `execution-plan-v1.4.md` → `design-v1.4.md` → `requirements-decomposition-v1.4.md` / `requirements-v1.4.md`（视情况）。
  - **实际状态更新待用户授权或 PATCH 任务执行**，本任务不执行写入操作。

---

## 4. 测试计划

### 4.1 单元测试

- 不涉及（文档类任务）。

### 4.2 集成测试 / 端到端测试

- 手工 review：文档示例命令在本机执行后输出与文档一致；
- 通过 `RunCommand` 执行 `pnpm typecheck` / `pnpm build` / `pnpm test`，确认三套 CI 全绿。

### 4.3 回归测试

- 既有 README / api.md / custom-rules.md 内容未被破坏；
- 既有验收报告（v1.1 / v1.2 / v1.3）链接与状态未受影响；
- 文档内部链接有效性回归校验：检查所有站内相对路径链接（`*.md` 文件间引用）可正确跳转，无断链。

---

## 5. 风险与依赖

| 风险 / 依赖 | 影响 | 应对措施 |
|---|---|---|
| 依赖 T6 全部测试通过 | 验收报告无法签字 | 严格按 T1 ~ T6 顺序执行；T6 任一 TC 失败时本任务暂缓 |
| custom-rules.md 当前结构与设想不符 | 文档新增小节风格不一致 | 实现前先读取现有 custom-rules.md，按既有写作风格扩展 |
| 签字流程异步 | 归档延迟 | 提交验收报告后即可挂起；签字回收后再走归档 |

---

## 6. 变更范围

- **本任务范围内**：`README.md`、`docs/api.md`、`docs/custom-rules.md`、`docs/specs/v1.4/acceptance-report-v1.4.md`。
- **不在本任务范围内**：
  - 业务代码修改（已在 T1 ~ T5 完成）；
  - 测试代码修改（T6）；
  - 归档操作（在签字之后由用户授权或单独 PATCH 任务执行）。

---

## 7. 评审记录

| 轮次 | 日期 | 结论 | P0/P1 问题 | 修复方案 |
|---|---|---|---|---|
| 1 | 2026-06-22 | 不通过 | P1-1 验收报告大纲要素不全；P1-2 P2-2 核验项未明确、P2-R2-3 覆盖矩阵证据缺失；P1-3 README/api.md 章节定位不准确、REQ-1.4-12 范围未加注 | P1-1~P1-3 按此表意见修订 |
| 2 | 2026-06-22 | 修订后待重评 | 见第 1 轮评审意见 | 已全部修订，见当前版本 |
