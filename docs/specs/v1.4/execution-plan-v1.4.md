# legacy-shield v1.4 执行计划

> 版本：v1.4
> 对应设计文档：[design-v1.4.md](design-v1.4.md)
> 对应阶段 Spec：phases/phase-v1.4-spec.md（待创建，本执行计划评审通过后生成）
> 状态：已完成，已归档（冻结，不再修改）
> 编制日期：2026-06-22
> 评审记录：见文档末尾 §6（轮次 1 不通过、轮次 2 通过）

---

## 1. 任务总览

| 任务编号 | 任务名称 | 工作量 | 依赖 | 可并行 |
|---|---|---|---|---|
| T1 | types / 子类型 / 工具函数 / browser.ts 注入 redactFields | 中 | 无 | — |
| T2 | Pinia patch 与 action / 插件错误采集 | 中 | T1 | 否（与 T3 顺序执行，均修改 inject.iife.ts 同一函数） |
| T3 | Vuex patch 与 action / mutation / subscribe 错误采集 | 中 | T2 | 否 |
| T4 | Vuex strict mode 违规识别（结构特征 + mutatedKeyPath） | 中 | T3 | — |
| T5 | logger / analyzer / reporter / api 适配新子类型 | 低 | T2、T3、T4 | — |
| T6 | 测试夹具、单测、集成测试、回归测试 | 中 | T5 | — |
| T7 | 文档更新（README / api.md / custom-rules.md）与验收报告 | 低 | T6 | — |

> **并行性说明**：T2 / T3 / T4 均修改 `lib/inject.iife.ts` 同一文件中的 `patchAppUse / patchPinia / patchVuex / commit 包装` 等逻辑，从代码合并角度无法真正并行，必须按 T2 → T3 → T4 顺序执行；T5 / T6 / T7 顺序执行。

---

## 2. 各任务详细计划

### T1：types / 子类型 / 工具函数 / browser.ts 注入 redactFields

**输入**：[design-v1.4.md §2.1](design-v1.4.md#21-runtimesubtype-扩展)、[design-v1.4.md §2.2](design-v1.4.md#22-statesummary-结构)、[design-v1.4.md §2.3](design-v1.4.md#23-payload--args-脱敏)、[design-v1.4.md §3.4](design-v1.4.md#34-statesummary-与脱敏)

**输出**：
- `lib/types.ts`：
  - `RuntimeSubType` 新增 `pinia-error` / `pinia-plugin-error` / `vuex-error` / `vuex-strict-violation` 4 个枚举值
  - `StartBrowserOptions` 新增 `redactBodyFields?: string[]` 字段
- `lib/browser.ts`：`startBrowser` 中新增 `addInitScript` 注入 `window.__SHIELD_REDACT_FIELDS__`（仅当 `options.redactBodyFields?.length` 时注入），实现参考 [design-v1.4.md §2.3](design-v1.4.md#23-payload--args-脱敏)
- `lib/cli/shield.ts`（或 `cli.ts` 中 `startBrowser` 调用点）：将 `--redact-body-fields` 解析后的字段名单透传至 `StartBrowserOptions.redactBodyFields`
- `lib/inject.iife.ts` 内的工具函数（与 T2、T3 在同一文件，但 T1 仅做最小骨架）：
  - `buildStateSummary(rawState)`：返回 `{ stateKeys, stateSizeBytes, stateTruncated, stateUnserializable? }`
  - `safeStringify(input)`：循环引用 / BigInt / Symbol / Function 安全序列化
  - `redactValue(value, fields)`：递归脱敏（与 `utils.redactBody` 行为对齐）
  - `normalizeVuexArgs(typeOrAction, payload)`：归一化 Vuex dispatch / commit 多签名形参

**验收标准**：
- `pnpm typecheck` 零错误，`pnpm build` 通过
- `redactValue({ password: '123', nested: { token: 'abc' } }, ['password', 'token'])` 输出 `{ password: '[REDACTED]', nested: { token: '[REDACTED]' } }`（递归生效）
- `redactValue([{ token: 'x' }], ['token'])` 输出 `[{ token: '[REDACTED]' }]`（数组递归）
- `buildStateSummary({ a: 1, b: 2 })` 返回字段满足：`stateKeys` 等于 `['a','b']`，`typeof stateSizeBytes === 'number'` 且 `stateSizeBytes > 0`，`stateTruncated === false`
- `buildStateSummary(circularObj)` 返回 `stateUnserializable === true`，`stateKeys` 仍正确
- 启动 shield 后，浏览器页面 `window.__SHIELD_REDACT_FIELDS__` 当传入 `--redact-body-fields=password,token` 时为 `["password","token"]`，未传时为 `undefined`

---

### T2：Pinia patch 与 action / 插件错误采集

**输入**：[design-v1.4.md §3.1](design-v1.4.md#31-pinia-patch)、[design-v1.4.md §3.3](design-v1.4.md#33-patchappuse-扩展)

**输出**：
- `lib/inject.iife.ts`：
  - 新增 `patchPinia(app, pinia, appId)` 函数，采用 Pinia 官方 `pinia.use(plugin)` 插件 API 作为主链路、`pinia._s.forEach` 作为兜底补登
  - 新增 `isPiniaInstance(p)` 强 duck typing（含 `_p` 数组校验）
  - 在 `patchAppUse` 中调用 Pinia 检测与 patch（Pinia 优先）
  - 新增 `buildPiniaErrorDetail` / `buildPiniaPluginErrorDetail` 工具，detail 中含 `appId`、`storeId`、`actionName`、`args`(脱敏)、`stateKeys`、`stateSizeBytes`、`stateTruncated`、`stateUnserializable?`，调用 `store.$state` 作为 state 输入

**验收标准**：
- Pinia action 同步抛错 → 落盘 `pinia-error`，字段齐全
- Pinia action 异步抛错 → 同上
- Pinia 插件 install 阶段抛错 → 落盘 `pinia-plugin-error`，含 pluginName（若可推断）/ stack
- 通过 setup store 动态注册一个 store → action 抛错可被官方插件 API 主链路捕获
- 未引入 Pinia 时静默跳过
- `__shield_emitted__` 标记正确，与 Vue errorHandler / unhandledrejection 协同，不重复落盘

---

### T3：Vuex patch 与 action / mutation / subscribe 错误采集

**输入**：[design-v1.4.md §3.2](design-v1.4.md#32-vuex-patch)、[design-v1.4.md §3.3](design-v1.4.md#33-patchappuse-扩展)

**输出**：
- `lib/inject.iife.ts`：
  - 新增 `patchVuex(app, store, appId)` 函数，包装 `dispatch` / `commit`，注册 `subscribeAction({ error })` 与 `subscribe`（用于记录 `ctx.lastMutation`）
  - 新增 `isVuexStore(p)` 强 duck typing（含 `_modulesNamespaceMap` / `replaceState` 校验）
  - 在 `patchAppUse` 中调用 Vuex 检测与 patch（Pinia 优先，再 Vuex）
  - 新增 `buildVuexErrorDetail` 工具，detail 中含 `appId`、`modulePath`、`type`、`payload`(脱敏)、`stage`、`stateKeys`、`stateSizeBytes`、`stateTruncated`、`stateUnserializable?`，使用 `store.state` 作为 state 输入

**验收标准**：
- Vuex action 同步抛错 → 落盘 `vuex-error`，stage=`action`
- Vuex action 异步抛错 → 同上
- Vuex mutation 抛错（非 strict 违规） → 落盘 `vuex-error`，stage=`mutation`
- Vuex subscribeAction({ error }) 捕获 → 落盘 `vuex-error`，stage=`subscribeAction`
- 未引入 Vuex 时静默跳过
- 同时挂载 Pinia 与 Vuex 时各自被识别，不互相误判

---

### T4：Vuex strict mode 违规识别

**输入**：[design-v1.4.md §3.2 detectStrictViolation / inferMutatedKeyPath](design-v1.4.md#32-vuex-patch)

**输出**：
- `lib/inject.iife.ts`：
  - 新增 `detectStrictViolation(store, err, ctx)`：主路径基于 `store.strict === true && store._committing === false` 结构特征，message 正则仅作辅助判定
  - 新增 `inferMutatedKeyPath(ctx, store, mutationType)`：基于 `mutation.type` / `ctx.lastMutation` best-effort 推导，回退 `'unknown'`
  - commit 包装内根据 `detectStrictViolation` 选择 subType

**验收标准**：
- Vuex strict mode 下在 mutation 外修改 state → 落盘 `vuex-strict-violation`，含 `modulePath`、`mutatedKeyPath`（best-effort，非空字符串）
- 非 strict 违规的 mutation 抛错 → 落盘 `vuex-error`（不影响正常流程）
- 主路径不依赖 console.error 文本解析

---

### T5：logger / analyzer / reporter / api 适配新子类型

**输入**：[design-v1.4.md §4](design-v1.4.md#4-analyzer--logger--reporter--api-适配)

**输出**：
- `lib/logger.ts`：扩展 `isErrorSubType`，加入 4 类新子类型；确保 `generateErrorId` 对 stack 不完整的 store 错误仍能稳定生成 errorId（必要时由 inject 侧在 detail 中传入合成 stack）
- `lib/analyzer.ts`：扩展 `TOP_ERROR_SUB_TYPES`，加入 4 类新子类型；去重逻辑 `errorId + 1s 窗口` 自动生效
- `lib/reporter.ts`：MD/JSON 报告自动包含新子类型分组
- `lib/api.ts`：无代码变更，仅在 T6 中验证 `/logs?type=runtime`、`/errors/top`、`/report?format=json` 端点对新子类型正确响应

**验收标准**：
- `GET /logs?type=runtime&date=xxx` 返回内容包含新子类型条目
- `GET /errors/top` 能聚合 `pinia-error` / `vuex-error` 等并按 errorId 去重
- `GET /report?format=json` 的 `summary.runtimeErrorCount` 包含新子类型计数
- 同一错误经 errorHandler + store patch 双通道上报后，analyzer 层去重为 1 条

---

### T6：测试夹具、单测、集成测试、回归测试

**输入**：[design-v1.4.md §5](design-v1.4.md#5-测试设计)、T1-T5 输出

**输出**：
- 测试夹具（不引入运行时依赖）：
  - `tests/fixtures/vue3/vendor/pinia.global.js`（Pinia 2.x prod min）
  - `tests/fixtures/vue3/vendor/vuex.global.js`（Vuex 4.x prod min）
  - `tests/fixtures/vue3/vue-pinia-error.html`
  - `tests/fixtures/vue3/vue-pinia-plugin-error.html`
  - `tests/fixtures/vue3/vue-vuex-error.html`
  - `tests/fixtures/vue3/vue-vuex-strict.html`
- 单测 / 集成测试：
  - `tests/pinia-monitor.test.ts`：覆盖 TC-1 / TC-2 / TC-3 / TC-15
  - `tests/vuex-monitor.test.ts`：覆盖 TC-4 ~ TC-8a
  - `tests/analyzer.test.ts` 扩展：覆盖新子类型 errorId 生成、topErrors 聚合、TC-10 / TC-10a 去重
  - `tests/api.test.ts` 扩展：覆盖 `/logs?type=runtime`、`/errors/top`、`/report?format=json` 对新子类型的响应（验证 §4 设计假设）
  - 脱敏 / 边界单测：TC-11 / TC-11a / TC-11b / TC-12 / TC-13 / TC-14
  - 回归校验：TC-9 / TC-16 + §5.3 回归套件全套既有 fixture 通过

**验收标准**：
- TC-1 ~ TC-16 全部通过（使用 `pnpm test`）
- §5.3 回归套件（既有 v1.1 / v1.3 fixtures + tests）零回归
- `pnpm typecheck`、`pnpm build`、`pnpm test` 全量通过

---

### T7：文档更新与验收报告

**输出**：
- `docs/specs/v1.4/acceptance-report-v1.4.md`：依据 §5 测试结果填充
- `README.md`：「支持的框架与平台」「shield」章节加入 Pinia 2.x / Vuex 4 说明
- `docs/api.md`：`/logs?type=runtime`、`/errors/top` 子类型清单加入 4 类新子类型
- `docs/custom-rules.md`：补充新子类型对应的自定义规则示例与说明（满足 REQ-1.4-12）

**验收标准**：
- 文档内容与实际行为一致
- `pnpm typecheck`、`pnpm build`、`pnpm test` 全量通过

---

## 3. 工作量估算与里程碑

> 由于本项目为单人开发，里程碑日期为 SOLO Coder 自评的预估窗口，实际可滑动。

| 里程碑 | 工作量（人时） | 预计完成 | 触发条件 |
|---|---|---|---|
| 设计文档评审通过 | — | 待定（取决于评审反馈轮次） | 评审专家结论为「通过」，文件头状态改为「已通过」 |
| 执行计划评审通过 | — | 待定 | 同上 |
| 阶段 Spec / 任务 Spec 评审通过 | — | 待定 | 全部任务 Spec 状态为「已通过」 |
| T1 完成 | 2-4 | 阶段 Spec 通过后 +1 工作日 | `pnpm typecheck` 通过且 T1 验收标准全绿 |
| T2 完成 | 3-5 | T1 +1 工作日 | T2 验收标准全绿 |
| T3 完成 | 3-5 | T2 +1 工作日 | T3 验收标准全绿 |
| T4 完成 | 2-4 | T3 +1 工作日 | T4 验收标准全绿 |
| T5 完成 | 1-2 | T4 当日 | T5 验收标准全绿 |
| T6 完成 | 4-6 | T5 +2 工作日 | TC-1 ~ TC-16 全绿 + 回归全绿 |
| T7 完成 | 1-2 | T6 +1 工作日 | 文档与代码一致，三套 CI 全绿 |
| 验收通过 | — | T7 当日 | 用户 / 产品负责人在 acceptance-report 上签字「通过」 |
| 归档关闭 | — | 验收通过 +1 工作日 | 全套文档状态改为「已完成，已归档」并 PR 合并 |

> 总工作量预估：约 **16 ~ 28 人时**（不含评审等待时间），单人连续投入约 3 ~ 5 个工作日。

---

## 4. 风险

见 [design-v1.4.md §7](design-v1.4.md#7-风险评估) 与 [requirements-decomposition-v1.4.md §5](requirements-decomposition-v1.4.md#5-风险与假设)。

执行计划层面新增风险：
- T2 / T3 / T4 顺序执行存在「关键路径」属性，任何一个任务延迟将级联推迟里程碑；缓解：T1 完成后即可启动 T6 测试夹具准备（HTML 文件不涉及 inject.iife.ts，可并行）。

---

## 5. 批准记录

- 项目负责人：creayma，2026-06-22，已批准（依据第 2 轮评审「通过」结论）

---

## 6. 评审记录

| 轮次 | 日期 | 结论 | P0/P1 问题 | 修复方案 |
|---|---|---|---|---|
| 1 | 2026-06-22 | 不通过 | P0-1 文件头状态自评违规；P1-1 browser.ts 注入 `__SHIELD_REDACT_FIELDS__` 任务缺失；P1-2 T7 未覆盖 custom-rules.md；P1-3 T2 / T3 "可并行"标记错误 | 已全部修订完成（详见本节修订总览） |
| 2 | 2026-06-22 | 通过 | 第 1 轮 4 条问题全部闭环；本轮无新增 P0/P1；遗留 P2-R2-1 ~ P2-R2-3（文字定位/交叉引用/归档补充，可在任务 Spec 拆解阶段处理） | 进入阶段 Spec 与任务 Spec 编写 |

> **遗留 P2 项**（任务 Spec 拆解阶段或归档前处理）：
> - P2-R2-1：T1 输出中 cli 入口明确为 `lib/cli/shield.ts`（而非「或 cli.ts」）。
> - P2-R2-2：T2 / T3 任务 Spec 中补充 stack 字段断言（与 T5 交叉引用）。
> - P2-R2-3：归档前补全第 1 轮修复后的覆盖矩阵截图或链接。

> **修订总览（轮次 1 → 轮次 2 变更）**：
> - 文件头状态改回「评审中」；删除「批准日期：—」与 §5 中预填的「已批准」记录
> - T1 输出新增 `lib/browser.ts` 注入 `__SHIELD_REDACT_FIELDS__` 与 cli 入口透传 `--redact-body-fields`
> - T7 输出新增 `docs/custom-rules.md` 更新
> - T2 / T3 / T4 「可并行」标记取消，明确顺序执行（同文件 patchAppUse 改造）
> - §3 时间线补充人时估算与里程碑触发条件
> - 阶段 Spec 引用标注「待创建」
> - T6 补充 api 端点集成测试任务
> - T1 验收标准 `sizeBytes` 改为类型断言
