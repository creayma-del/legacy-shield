# T5：logger / analyzer / reporter / api 适配新子类型

> 版本：v1.4
> 任务编号：T5
> 对应阶段 Spec：[phase-v1.4-spec.md](phase-v1.4-spec.md)
> 对应设计文档：[design-v1.4.md](../design-v1.4.md)
> 对应执行计划：[execution-plan-v1.4.md](../execution-plan-v1.4.md)
> 依赖任务：T2、T3、T4
> 状态：已通过
> 评审记录：见本文档末尾（轮次 1 不通过、轮次 2 通过）

---

## 1. 任务目标

让 4 个新 RuntimeSubType 进入既有的 errorId / topErrors / reporter / api 消费链路：
- 在 `lib/types.ts`（或新增 `lib/constants.ts`）中抽取 SSOT 常量 `ERROR_RUNTIME_SUB_TYPES: readonly RuntimeSubType[]`，作为「需要参与 errorId / topErrors / suggest 聚合」的子类型唯一事实源；
- `lib/logger.ts isErrorSubType` 改为复用该常量，并在常量中加入 4 类新子类型，保证 `generateErrorId` 为新子类型生成 errorId；
- `lib/analyzer.ts TOP_ERROR_SUB_TYPES` 改为复用该常量，保证 `dedupeJsErrors` 与 `topErrors` 聚合新子类型；
- `lib/api.ts generateFixPrompt` 中第 3 处硬编码的 5 类 subType 白名单改为复用 `isErrorSubType`（SSOT），保证 `/suggest` 对新子类型也能生成修复建议；
- 验证 `lib/reporter.ts` 在不改动的前提下能自动透传新子类型（详见 §3.3）。

对应阶段 Spec §3.6 与交付物 D8 / D9。

> 评审发现的第 3 处硬编码白名单位于 `lib/api.ts` `generateFixPrompt` 内（现网行 76-84），原 spec 初稿遗漏，本版本已纳入任务范围。

---

## 2. 对应需求与验收标准

| 需求编号 | 需求描述 | 本任务验收标准 |
|---|---|---|
| REQ-1.4-9 | 与 Vue errorHandler 链路去重，analyzer 按 errorId 1 秒窗口去重 | 新子类型经 logger 后 `errorId` 字段非空；多通道同一错误经 analyzer 去重后仅 1 条 |
| REQ-1.4-11 | v1.1 ~ v1.3 已有运行时采集行为零回归 | SSOT 常量包含的旧值保持不变（仅新增 4 类），logger / analyzer / api 三处行为对旧子类型零回归 |
| REQ-1.4-9（补充） | `/suggest` 对新子类型同样可用 | `POST /suggest` 传入 `pinia-error` / `vuex-strict-violation` 等子类型的 errorId 时返回 200 + prompt，而非 404 |
| REQ-1.4-9（补充） | stack 为空时 errorId 仍可区分不同 store | 构造 stack 为空的 pinia-error（不同 storeId / actionName）→ 经 inject 侧合成 stack 后，errorId 应不同；若合成失败则退化并标注 `degradedErrorId: true` |

---

## 3. 实现步骤

### 3.0 抽取 SSOT 常量 `ERROR_RUNTIME_SUB_TYPES`

在 `lib/types.ts` 末尾（或新增 `lib/constants.ts`，由实施时根据现网代码风格二选一，优先 `lib/types.ts` 以减少新增文件）导出：

```typescript
export const ERROR_RUNTIME_SUB_TYPES = [
  'js-error',
  'promise-rejection',
  'vue-render-error',
  'vue-router-error',
  'react-render-error',
  // v1.4 新增
  'pinia-error',
  'pinia-plugin-error',
  'vuex-error',
  'vuex-strict-violation',
] as const satisfies readonly RuntimeSubType[];
```

> 该常量是 logger / analyzer / api 三处的唯一事实源（SSOT），后续新增需要参与 errorId 聚合的子类型时只需修改此处。

### 3.1 改造 `lib/logger.ts isErrorSubType`

```typescript
import { ERROR_RUNTIME_SUB_TYPES } from './types.js';

function isErrorSubType(subType: RuntimeSubType): boolean {
  return (ERROR_RUNTIME_SUB_TYPES as readonly RuntimeSubType[]).includes(subType);
}
```

> `generateErrorId` 签名与现网一致：`sha256(subType + normalizedFrame + url)`；不改动 `generateErrorId` 实现。
>
> 对于 stack 不完整的 store 错误，detail 中已由 T2 / T3 / T4 在 inject 侧合成 stack（详见 §3.5），logger 此处无需特殊处理。

### 3.2 改造 `lib/analyzer.ts TOP_ERROR_SUB_TYPES`

```typescript
import { ERROR_RUNTIME_SUB_TYPES } from './types.js';

const TOP_ERROR_SUB_TYPES = new Set<RuntimeSubType>(ERROR_RUNTIME_SUB_TYPES);
```

去重逻辑 `dedupeJsErrors` 与 `errorId + 1 秒窗口` 自动生效。

### 3.3 验证 `lib/reporter.ts` 无需修改

- MD 模板的「高频错误 TOP N」表格按 subType 渲染，新增子类型自动呈现；
- 经 grep 确认 `lib/reporter.ts` 现网**无显式 subType 分组逻辑**（无「Vue 错误 / 状态管理错误」之类分组渲染），新子类型仅以 subType 字段透传到表格行，无需新增分组；
- 本任务**不修改 reporter.ts**。

**与 design 的偏差备注**：design §1.2 文件清单当前措辞为"reporter.ts：扩展：MD 报告渲染新子类型分组"，但 design §4.3 与现网实现均为"按 subType 渲染自动呈现"无分组。该偏差已与评审者确认：**design §1.2 该行需 PATCH 为「reporter.ts：无需修改，按 subType 渲染自动呈现」**，由 T7 文档任务统一修订，不在本任务范围内执行 design 修改。本任务对 reporter.ts 保持不改。

### 3.4 改造 `lib/api.ts generateFixPrompt`

`lib/api.ts` 现网 `generateFixPrompt`（行 76-84）存在第 3 处硬编码白名单：

```typescript
// 现网（需修改）
.filter(
  (l) =>
    (l.subType === 'js-error' ||
      l.subType === 'promise-rejection' ||
      l.subType === 'vue-render-error' ||
      l.subType === 'vue-router-error' ||
      l.subType === 'react-render-error') &&
    l.errorId === errorId,
)
```

修改为复用 logger 导出的 `isErrorSubType`（SSOT，已包含 v1.4 新增 4 类）：

```typescript
// 修改后
import { isErrorSubType } from './logger.js'; // 若 logger 未导出则同步将其 export

.filter((l) => isErrorSubType(l.subType) && l.errorId === errorId)
```

> 若 `lib/logger.ts` 现网未将 `isErrorSubType` 导出，本任务**最小化导出**该函数（仅加 `export`，不修改实现），由 api.ts 复用，从而保证三处共用同一份白名单逻辑。
>
> 其他 api 端点（`/logs?type=runtime` 直接透传子类型字段、`/errors/top` 复用 analyzer 已聚合的 topErrors、`/report?format=json` 的 `summary.runtimeErrorCount` 由 analyzer 计入）在 §3.2 改造后自动包含新子类型，无需进一步修改。

### 3.5 inject 侧 stack 合成（与 design §4.1 对齐）

> 本节定义 T2 / T3 / T4 在 inject 侧组装 `detail.stack` 时的兜底契约。本任务 T5 自身不实现合成逻辑，但需在测试中验证「stack 为空 → 经 inject 合成 → errorId 含 storeId 区分」的端到端可用性。

- **Pinia 主合成**：若原生 `err.stack` 为空 / 不可靠，inject 侧合成
  `'pinia-error\n    at {storeId}.{actionName}'` 作为 `detail.stack`；
- **Pinia 插件**：合成 `'pinia-plugin-error\n    at {pluginName ?? "anonymous"}'`；
- **Vuex 主合成**：合成 `'vuex-error\n    at {modulePath}.{type}'`；
- **Vuex strict**：合成 `'vuex-strict-violation\n    at {modulePath}.{mutationType ?? "unknown"}'`；
- **退化路径**：若合成所需字段（storeId / modulePath 等）也缺失，则在 inject 侧不再写入 `stack`，logger 落入既有 fallback：`sha256(subType + '' + url)`，并由 inject 侧在 `detail` 中标注 `degradedErrorId: true`，供 analyzer / reporter 观测使用。

---

## 4. 测试计划

### 4.1 单元测试

- 扩展 `tests/analyzer.test.ts`：
  - 注入构造的 `pinia-error` / `vuex-error` 等 RuntimeLog（`stack` 已含合成字符串）→ 断言 `errorId` 非空、`topErrors` 中聚合出现；
  - 注入两条相同 errorId 且时间间隔 < 1s 的 `vuex-error` → 断言 `dedupeJsErrors` 输出 1 条 representative + 2 个 samples；
  - 注入两条相同 errorId 且时间间隔 > 1s 的 `vuex-error` → 断言输出 2 条独立条目；
  - **新增**：注入两条 `pinia-error`，原生 stack 为空但 inject 已合成 `'pinia-error\n    at storeA.action1'` 与 `'pinia-error\n    at storeB.action1'` → 断言两条 errorId 不同（即 storeId 进入 errorId 哈希入参）；
  - **新增**：注入一条 stack 完全为空（degradedErrorId: true）的 `pinia-error` → 断言 errorId 仍稳定（等于 `sha256(subType + '' + url)` 截断）。
- 扩展 `tests/api.test.ts`：
  - mock runtime 日志包含新子类型 → `GET /logs?type=runtime` 返回包含新子类型条目；
  - `GET /errors/top` 返回包含 `pinia-error` / `vuex-error` 等聚合结果；
  - `GET /report?format=json` 的 `summary.runtimeErrorCount` 包含新子类型计数；
  - **新增（/suggest）**：mock runtime 日志包含 `pinia-error` 一条（带 errorId）→ `POST /suggest` 传入该 errorId → 断言返回 200 且 prompt 含「错误类型：pinia-error」；
  - **新增（/suggest）**：mock runtime 日志包含 `vuex-strict-violation` 一条 → `POST /suggest` 传入该 errorId → 断言返回 200 且 prompt 含「错误类型：vuex-strict-violation」；
  - **回归**：传入旧子类型（如 `js-error`）的 errorId → 断言仍能正常返回 prompt，无回归。
- **SSOT 守卫测试（建议）**：在 `tests/types.test.ts`（或现有合适测试文件中）加 1 条断言，确认 `ERROR_RUNTIME_SUB_TYPES` 至少包含 v1.4 新增 4 类，防止后续误删。

### 4.2 集成测试 / 端到端测试

- 由 T6 在 Playwright 端到端流程中验证：触发 Pinia 错误 → 落盘 → analyzer → api 端点（含 `/suggest`）返回正确。

### 4.3 回归测试

- 既有 `tests/analyzer.test.ts` / `tests/api.test.ts` 全绿；
- SSOT 常量 `ERROR_RUNTIME_SUB_TYPES` 包含原 5 类旧值，logger / analyzer / api 对旧子类型行为零变化。

---

## 5. 风险与依赖

| 风险 / 依赖 | 影响 | 应对措施 |
|---|---|---|
| 依赖 T2 / T3 / T4 已 emit 新子类型，并在 inject 侧合成 `detail.stack` | 单独运行 T5 无运行时数据；stack 合成契约若不一致会导致 errorId 不稳定 | 单元测试通过 mock RuntimeLog 注入合成 stack 实现；§3.5 已固化合成契约；端到端依赖 T6 fixture |
| `isErrorSubType` 跨模块导出可能引起意外耦合 | logger 内部函数变 public | 仅最小化加 `export`，不改实现；以注释标注「v1.4 起作为 SSOT 视图供 api 复用」 |
| reporter 现有渲染逻辑可能与新子类型不对齐（design §1.2 措辞偏差） | MD 报告呈现错位 | 经 grep 确认现网无分组逻辑，本任务不改 reporter；design §1.2 偏差由 T7 统一 PATCH |

---

## 6. 变更范围

- **本任务范围内**：
  - `lib/types.ts`（或新增 `lib/constants.ts`，二选一）：导出 SSOT 常量 `ERROR_RUNTIME_SUB_TYPES`；
  - `lib/logger.ts`：`isErrorSubType` 改为复用 `ERROR_RUNTIME_SUB_TYPES`；最小化加 `export` 以供 api.ts 复用；
  - `lib/analyzer.ts`：`TOP_ERROR_SUB_TYPES` 改为复用 `ERROR_RUNTIME_SUB_TYPES`；
  - `lib/api.ts`：`generateFixPrompt` 内第 3 处硬编码白名单改为调用 `isErrorSubType`；
  - `tests/analyzer.test.ts` / `tests/api.test.ts` 用例扩展（含 `/suggest` 与 stack-fallback 用例）。
- **不在本任务范围内**：
  - `lib/reporter.ts` 代码修改（经确认无需修改）；
  - inject 侧 stack 合成逻辑实现（T2 / T3 / T4 范围，本任务仅在 §3.5 固化契约 + 测试夹具中验证）；
  - 测试夹具 HTML 与 vendor 文件（T6）；
  - design-v1.4.md §1.2 文档措辞 PATCH（T7）；
  - 其他文档更新（T7）。

---

## 7. 评审记录

| 轮次 | 日期 | 结论 | P0/P1 问题 | 修复方案 |
|---|---|---|---|---|
| 1 | 2026-06-22 | 不通过 → 修订后待重评 | P0-1 api.ts `/suggest` 白名单遗漏；P0-2 SSOT 常量未抽取；P1-1 stack fallback 未对齐 design §4.1；P1-2 测试未覆盖 `/suggest` 新子类型；P1-3 reporter 与 design §1.2 措辞偏差未说明 | P0-1：§1 / §3.4 / §6 纳入 `lib/api.ts generateFixPrompt` 改造；P0-2：§3.0 抽取 `ERROR_RUNTIME_SUB_TYPES` 至 `lib/types.ts`，§3.1 / §3.2 / §3.4 复用；P1-1：§3.5 固化 inject 侧合成 stack 契约（`'pinia-error\n    at {storeId}.{actionName}'`）与 `degradedErrorId: true` 退化路径，§2 新增对应验收标准；P1-2：§4.1 新增 `/suggest` 对 `pinia-error` / `vuex-strict-violation` 用例；P1-3：§3.3 备注与 design §1.2 偏差，由 T7 统一 PATCH，本任务保持 reporter 不改 |
