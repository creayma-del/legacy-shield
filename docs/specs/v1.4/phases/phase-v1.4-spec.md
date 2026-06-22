# legacy-shield v1.4 Spec：Pinia / Vuex 错误信息收集

> 版本：v1.4
> 对应需求文档：[requirements-v1.4.md](../requirements-v1.4.md)
> 对应需求分解文档：[requirements-decomposition-v1.4.md](../requirements-decomposition-v1.4.md)
> 对应设计文档：[design-v1.4.md](../design-v1.4.md)
> 对应执行计划：[execution-plan-v1.4.md](../execution-plan-v1.4.md)
> 状态：已完成，已归档（冻结，不再修改）
> 编制日期：2026-06-22
> 评审记录：见本文档末尾 §7（轮次 1 通过，含 5 条 P2 在任务 Spec / 实现阶段闭环）

---

## 1. 目标

在 legacy-shield 现有 `shield` 子命令的零侵入注入机制基础上，扩展对 Vue 3 业务系统中状态管理库 **Pinia 2.x** 与 **Vuex 4** 的结构化错误信息采集，使开发者与 AI 智能体无需打开 DevTools 即可获得 store id / action 名 / payload / state 摘要等关键上下文。

具体落点：
- **自动识别** Pinia 2.x 与 Vuex 4 实例，自动 patch，无需业务代码改造。
- **结构化采集** Pinia action 抛错、Pinia 插件错误、Vuex action / mutation / subscribe 错误、Vuex strict mode 违规。
- **新增 4 个 runtime 子类型**：`pinia-error`、`pinia-plugin-error`、`vuex-error`、`vuex-strict-violation`。
- **复用现有去重链路**：与 Vue errorHandler / unhandledrejection / console-error 协同，analyzer 层 errorId + 1s 窗口去重。
- **复用现有脱敏链路**：payload / args / state 通过 `--redact-body-fields` 同源脱敏。
- **零回归**：v1.1 ~ v1.3 已有运行时采集行为保持不变。

**明确不在范围内**：
- Vue 2 / Vuex 3 支持；
- Pinia 1.x；
- Pinia / Vuex 编译时错误采集；
- Pinia / Vuex devtools 协议对接与可视化 store 状态时间机器；
- 服务端 / SSR 场景下的 store 错误采集；
- 新增 CLI 参数控制 store 采集开关（默认始终开启）；
- 自动修复建议生成（由 `/suggest` 端点 AI 智能体处理）。

---

## 2. 交付物清单

| 编号 | 交付物 | 路径 | 说明 |
|---|---|---|---|
| D1 | RuntimeSubType 与 StartBrowserOptions 扩展 | [lib/types.ts](file:///Users/creayma/personal/legacy-shield/lib/types.ts) | 新增 4 个子类型；StartBrowserOptions 新增 `redactBodyFields?: string[]` |
| D2 | 浏览器初始化注入扩展 | [lib/browser.ts](file:///Users/creayma/personal/legacy-shield/lib/browser.ts) | addInitScript 阶段注入 `window.__SHIELD_REDACT_FIELDS__` |
| D3 | CLI 透传 redactBodyFields | [lib/cli/shield.ts](file:///Users/creayma/personal/legacy-shield/lib/cli/shield.ts) | `startBrowser({ ..., redactBodyFields })` |
| D4 | inject.iife.ts 工具函数 | [lib/inject.iife.ts](file:///Users/creayma/personal/legacy-shield/lib/inject.iife.ts) | `buildStateSummary` / `safeStringify` / `redactValue` / `normalizeVuexArgs` |
| D5 | Pinia patch 实现 | [lib/inject.iife.ts](file:///Users/creayma/personal/legacy-shield/lib/inject.iife.ts) | `patchPinia` + `isPiniaInstance`；官方 `pinia.use(plugin)` 主链路 |
| D6 | Vuex patch 实现 | [lib/inject.iife.ts](file:///Users/creayma/personal/legacy-shield/lib/inject.iife.ts) | `patchVuex` + `isVuexStore`；包装 dispatch / commit / subscribeAction |
| D7 | Vuex strict mode 识别 | [lib/inject.iife.ts](file:///Users/creayma/personal/legacy-shield/lib/inject.iife.ts) | `detectStrictViolation` + `inferMutatedKeyPath` |
| D8 | logger.ts 白名单扩展 | [lib/logger.ts](file:///Users/creayma/personal/legacy-shield/lib/logger.ts) | `isErrorSubType` 加入 4 类新子类型 |
| D9 | analyzer.ts 白名单扩展 | [lib/analyzer.ts](file:///Users/creayma/personal/legacy-shield/lib/analyzer.ts) | `TOP_ERROR_SUB_TYPES` 加入 4 类新子类型 |
| D10 | 测试夹具 | `tests/fixtures/vue3/vendor/`、`tests/fixtures/vue3/vue-pinia-*.html`、`tests/fixtures/vue3/vue-vuex-*.html` | 本地 vendor（Pinia 2.x / Vuex 4 prod min），4 个新 HTML 夹具 |
| D11 | 测试用例 | `tests/pinia-monitor.test.ts`、`tests/vuex-monitor.test.ts`、`tests/analyzer.test.ts`、`tests/api.test.ts` | 覆盖 TC-1 ~ TC-16 与回归套件 |
| D12 | 文档更新 | `README.md`、`docs/api.md`、`docs/custom-rules.md` | 同步新子类型说明 |
| D13 | 验收报告 | `docs/specs/v1.4/acceptance-report-v1.4.md` | v1.4 验收结论 |

---

## 3. 技术方案

### 3.1 总体策略

v1.4 保持 `shield` 子命令作为唯一入口，不新增 CLI 参数（默认开启）。在 `inject.iife.ts` 的 `patchAppUse` 链路中插入 Pinia / Vuex 实例识别与 patch 调用。模块关系：

```
shield 启动
  → cli/shield.ts startBrowser(options + redactBodyFields)
    → browser.ts addInitScript(__SHIELD_SESSION_ID__ / __SHIELD_REDACT_FIELDS__ / inject.iife)
      → inject.iife.ts patchVueAndStore:
          - patchVue（v1.1 已有）
          - patchAppUse（扩展，识别 Pinia / Vuex）
              ├── patchPinia                   # 新增
              │     ├── pinia.use(shieldPlugin)         # 主链路（官方插件 API）
              │     └── _s.forEach 兜底补登              # 兜底
              └── patchVuex                     # 新增
                    ├── 包装 dispatch / commit
                    ├── store.subscribeAction({ error })
                    └── store.subscribe（记录 lastMutation）
  → __shield_emit__ 桥接 → logger.logRuntime → NDJSON 落盘
  → analyzer / reporter / api 端点（白名单扩展后自动消费）
```

详见 [design-v1.4.md §1.1](../design-v1.4.md#11-模块关系)。

### 3.2 RuntimeSubType 与 context 扩展

新增 4 个 `RuntimeSubType`：`pinia-error` / `pinia-plugin-error` / `vuex-error` / `vuex-strict-violation`。

context 字段（与 REQ-1.4-7 / REQ-1.4-8 字段名对齐）：

| 子类型 | context 字段 |
|---|---|
| `pinia-error` | `appId`, `storeId`, `actionName`, `args`(脱敏), `stateKeys`, `stateSizeBytes`, `stateTruncated`, `stateUnserializable?` |
| `pinia-plugin-error` | `appId`, `pluginName?` |
| `vuex-error` | `appId`, `modulePath`, `type`, `payload`(脱敏), `stage`(`action`\|`mutation`\|`subscribeAction`\|`subscribe`), `stateKeys`, `stateSizeBytes`, `stateTruncated`, `stateUnserializable?` |
| `vuex-strict-violation` | `appId`, `modulePath`, `mutatedKeyPath?`, `stateKeys`, `stateSizeBytes`, `stateTruncated`, `stateUnserializable?` |

详见 [design-v1.4.md §2](../design-v1.4.md#2-数据结构)。

### 3.3 Pinia patch 主链路

主链路改用 Pinia 官方 `pinia.use(plugin)` 插件 API：
- 通过 `PiniaPluginContext.store` 在每个 store 初始化时注册 `$onAction` onError；
- `pinia._s.forEach` 仅作为「createPinia 与 shieldPlugin 注册之间已存在 store」的 best-effort 补登；
- 包装 `pinia.use(plugin)` 捕获用户插件 install 阶段抛错。

详见 [design-v1.4.md §3.1](../design-v1.4.md#31-pinia-patch)。

### 3.4 Vuex patch 与 strict mode 识别

- 包装 `dispatch` / `commit`，支持同步 / 异步抛错；
- 注册 `subscribeAction({ error })` 捕获 action 链路；
- 注册 `subscribe` 记录 `ctx.lastMutation`，用于 strict mode 违规时推导 `mutatedKeyPath`；
- strict mode 识别 **主路径**：`store.strict === true && store._committing === false`（Vuex 4 内部结构特征，非 console 文本），message 正则仅作辅助判定；
- `mutatedKeyPath` 通过 `mutation.type` best-effort 推导，回退 `'unknown'`。

详见 [design-v1.4.md §3.2](../design-v1.4.md#32-vuex-patch)。

### 3.5 stateSummary 与脱敏

- `buildStateSummary(rawState)`：keys 与 stringify 分两步计算，保证 JSON 失败时 keys 仍可用；`safeStringify` 通过 WeakSet 处理循环引用，BigInt / Symbol / Function 显式降级；返回 `{ stateKeys, stateSizeBytes, stateTruncated, stateUnserializable? }`。
- `redactValue(value, fields)`：递归脱敏，行为与 [utils.redactBody](file:///Users/creayma/personal/legacy-shield/lib/utils.ts#L118) 对齐；字段名 includes 匹配、大小写不敏感。
- 脱敏字段名单链路：`--redact-body-fields` → `StartBrowserOptions.redactBodyFields` → `addInitScript` 写入 `window.__SHIELD_REDACT_FIELDS__` → inject 读取使用。

详见 [design-v1.4.md §2.3 / §3.4](../design-v1.4.md#23-payload--args-脱敏)。

### 3.6 logger / analyzer 白名单扩展

- `lib/logger.ts isErrorSubType`：扩展白名单纳入 4 类新子类型，保证 `generateErrorId` 对新子类型生成 errorId。
- `lib/analyzer.ts TOP_ERROR_SUB_TYPES`：扩展白名单，保证 `dedupeJsErrors` 与 `topErrors` 聚合新子类型；去重逻辑（`errorId + 1 秒窗口`）自动生效。
- `lib/reporter.ts` / `lib/api.ts`：无代码变更，仅在测试阶段验证端点对新子类型的响应。

详见 [design-v1.4.md §4](../design-v1.4.md#4-analyzer--logger--reporter--api-适配)。

### 3.7 互斥识别与去重

- `patchAppUse` 中 Pinia 优先识别，再 Vuex；
- `isPiniaInstance` / `isVuexStore` 通过双重私有字段校验避免误判；
- `__shield_emitted__` 标记跨 store patch、Vue errorHandler、unhandledrejection 链路共享；
- 原始类型错误（字符串 / 数字 / 冻结对象）依赖 analyzer 1s 窗口 + errorId 兜底去重。

详见 [design-v1.4.md §3.3 / §6](../design-v1.4.md#33-patchappuse-扩展)。

---

## 4. 任务拆解与依赖

| 任务编号 | 任务名称 | 依赖 | 任务 Spec |
|---|---|---|---|
| T1 | types / 子类型 / 工具函数 / browser.ts 注入 redactFields | 无 | [phase-v1.4-t1-spec.md](phase-v1.4-t1-spec.md) |
| T2 | Pinia patch 与 action / 插件错误采集 | T1 | [phase-v1.4-t2-spec.md](phase-v1.4-t2-spec.md) |
| T3 | Vuex patch 与 action / mutation / subscribe 错误采集 | T2 | [phase-v1.4-t3-spec.md](phase-v1.4-t3-spec.md) |
| T4 | Vuex strict mode 违规识别 | T3 | [phase-v1.4-t4-spec.md](phase-v1.4-t4-spec.md) |
| T5 | logger / analyzer / reporter / api 适配新子类型 | T2、T3、T4 | [phase-v1.4-t5-spec.md](phase-v1.4-t5-spec.md) |
| T6 | 测试夹具、单测、集成测试、回归测试 | T5 | [phase-v1.4-t6-spec.md](phase-v1.4-t6-spec.md) |
| T7 | 文档更新与验收报告 | T6 | [phase-v1.4-t7-spec.md](phase-v1.4-t7-spec.md) |

**执行顺序**：T1 → T2 → T3 → T4 → T5 → T6 → T7。T2 / T3 / T4 因同改 `lib/inject.iife.ts` 强制顺序；T1 完成后 T6 测试夹具 HTML 文件可并行准备。

---

## 5. 验收标准（阶段级）

| 编号 | 验收项 | 验收方法 |
|---|---|---|
| AC-1 | 业务系统未做任何代码改造，shield 启动后自动采集 Pinia 2.x 错误（同步 / 异步 / 插件） | TC-1 / TC-2 / TC-3 全绿 |
| AC-2 | 业务系统未做任何代码改造，shield 启动后自动采集 Vuex 4 错误（action / mutation / subscribeAction） | TC-4 / TC-5 / TC-6 / TC-7 全绿 |
| AC-3 | Vuex strict mode 违规识别基于结构特征，不依赖 console 文本解析 | TC-8 / TC-8a 全绿 |
| AC-4 | 业务未引入 Pinia / Vuex 时静默跳过 | TC-9 全绿 |
| AC-5 | 多通道错误经 analyzer 去重为 1 条 | TC-10 / TC-10a 全绿 |
| AC-6 | payload / args / state 通过 `--redact-body-fields` 端到端脱敏；state 仅记录 keys + 体积 + 截断标记 | TC-11 / TC-11a / TC-11b / TC-12 / TC-13 / TC-14 全绿 |
| AC-7 | 动态注册的 Pinia store 仍可被采集 | TC-15 全绿 |
| AC-8 | CLI 帮助文案未新增 store 相关参数 | TC-16 全绿 |
| AC-9 | v1.1 ~ v1.3 已有运行时采集行为零回归 | §5.3 回归套件全绿 |
| AC-10 | 全量工程检查通过 | `pnpm typecheck` / `pnpm build` / `pnpm test` 全绿 |
| AC-11 | 文档与代码一致 | README / api.md / custom-rules.md 与实际行为一致；验收报告签字 |

---

## 6. 风险与依赖

| 风险 / 依赖 | 影响 | 应对措施 |
|---|---|---|
| Pinia 内部 API（`_p`、`_s`）未来版本变更 | best-effort 补登链路失效 | 主链路改用官方插件 API；`_s.forEach` 失败时静默跳过；TC-15 单测覆盖 |
| Vuex 内部字段（`_committing`、`_modulesNamespaceMap`）未来变更 | strict 识别失效 / store 误判 | 结构特征为主、message 兜底；失败时降级为 `vuex-error`；TC-8 单测覆盖 |
| store state 含循环引用 / BigInt / Symbol | JSON.stringify 抛错 | safeStringify + WeakSet replacer；TC-13 / TC-14 单测覆盖 |
| inject.iife.ts 体积增长 | 注入耗时增加 | 工具函数复用、最小化体积、构建后体积监控（沿用 v1.3 既有阈值） |
| T2 / T3 / T4 关键路径串行 | 进度风险 | T1 完成后 T6 HTML 夹具并行准备；任务粒度小，单任务工作量 ≤ 5 人时 |

---

## 7. 评审记录

| 轮次 | 日期 | 结论 | P0/P1 问题 | 修复方案 |
|---|---|---|---|---|
| 1 | 2026-06-22 | 通过 | 无 P0 / P1；5 条 P2（AC 颗粒度、api 端点 AC、并行边界注释、inject.iife 体积阈值、上游遗留 P2 闭环跟踪） | P2-1/P2-2/P2-3 已在任务 Spec 中显式落点；P2-4 体积阈值在 T1/T6 任务 Spec 中以 baseline+5KB 描述；P2-5 上游 P2 项在任务 Spec 中逐条承接（详见各 T spec §6 与 T7 §3.4） |

> **遗留 P2 项闭环跟踪**：
> - 评审 P2-1 / P2-2：AC 颗粒度细化与 api 端点 AC 在 T5 / T6 测试计划中落点。
> - 评审 P2-3：执行顺序中「T6 HTML 夹具可并行准备」边界在 T6 §3.1 与 T1 任务 Spec 中显式约束。
> - 评审 P2-4：inject.iife.ts 体积阈值由 T1 任务 Spec §5 与 T6 §5 共同约束。
> - 评审 P2-5：上游设计/执行计划遗留 P2 项在 T1/T2/T4/T6/T7 任务 Spec 中分别承接，T7 §3.4 验收报告负责最终闭环。
