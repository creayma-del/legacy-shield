# T6：测试夹具、单测、集成测试、回归测试

> 版本：v1.4
> 任务编号：T6
> 对应阶段 Spec：[phase-v1.4-spec.md](phase-v1.4-spec.md)
> 对应设计文档：[design-v1.4.md](../design-v1.4.md)
> 对应执行计划：[execution-plan-v1.4.md](../execution-plan-v1.4.md)
> 依赖任务：T5
> 状态：已通过
> 评审记录：见本文档末尾（轮次 1 不通过、轮次 2 通过）

---

## 1. 任务目标

为 v1.4 提供全量测试夹具（HTML + vendor）、单元测试、集成测试与回归测试，覆盖设计文档 §5 列出的 TC-1 ~ TC-16 及 §5.3 回归套件，保证 `pnpm typecheck` / `pnpm build` / `pnpm test` 三套 CI 全绿。

对应阶段 Spec §3.2 ~ §3.7 全部代码改动的验证，以及交付物 D10 / D11。

---

## 2. 对应需求与验收标准

| 需求编号 | 关联测试用例 | 验收标准 |
|---|---|---|
| REQ-1.4-1 ~ REQ-1.4-11 | TC-1 ~ TC-16 + §5.3 回归套件 | 设计文档 §5.1 REQ→TC 反向映射中的所有 TC 全绿 |
| REQ-1.4-10 | TC-9 / TC-16 | 业务未引入 Pinia / Vuex 时静默 + CLI 帮助文案无新增参数 |
| REQ-1.4-11 | §5.3 回归套件 | 既有 v1.1 / v1.3 fixtures + tests 零回归 |

---

## 3. 实现步骤

### 3.1 测试夹具

**vendor 本地副本（不引入 package.json 运行时依赖）**：
- `tests/fixtures/vue3/vendor/pinia.global.js`：Pinia 2.x prod min 构建（具体小版本号建议 `pinia 2.1.7`，对应评审 P2-4）。挂载全局变量 `window.Pinia`，fixture 通过 `window.Pinia.createPinia()` 等 API 使用。
- `tests/fixtures/vue3/vendor/vuex.global.js`：Vuex 4.x prod min 构建（具体小版本号建议 `vuex 4.1.0`）。挂载全局变量 `window.Vuex`，fixture 通过 `window.Vuex.createStore()` 等 API 使用。
- `tests/fixtures/vue3/vendor/LICENSE-pinia.txt`：Pinia 官方 MIT License 全文（含版权声明），随 vendor 一同提交，确保仓库合规。
- `tests/fixtures/vue3/vendor/LICENSE-vuex.txt`：Vuex 官方 MIT License 全文（含版权声明），随 vendor 一同提交，确保仓库合规。
- 引入方式：仅通过 fixture HTML 的 `<script src="./vendor/pinia.global.js"></script>` 标签使用；vendor 文件不被项目源码 import，不进入构建产物。
- 体积约束：**每个 vendor 文件单独 ≤ 200KB**；vendor 目录下所有 `.js` 文件总大小 ≤ 400KB（CI 自检详见 §3.4）。

**fixture HTML（基于 v1.1 已有的 vue.global.js + vue-router.global.js 风格）**：

> 通用要求：所有 fixture 的 trigger 函数（同步 / 异步 / mutation / action / 插件 install 等场景）**必须抛 `new Error(...)` 实例**（不得抛字符串或裸 `throw`），允许在 Error 对象上附加 `__shield_emitted__` 等标记字段以辅助去重断言。
- `tests/fixtures/vue3/vue-pinia-error.html`：
  - 通过 `<script>` 引入 vue + pinia vendor；
  - 定义 `useUserStore` setup store 与 `useOrderStore` options store 各一个；
  - 提供 4 个按钮：触发同步抛错、触发异步抛错、触发 args 含 password 的 action、触发 args 含数组的 action；
  - 暴露 `window.__triggerSyncError()` 等供 Playwright 调用。
- `tests/fixtures/vue3/vue-pinia-plugin-error.html`：
  - 通过 `pinia.use(badPlugin)` 注册一个 install 阶段抛错的插件；
  - 提供按钮 / 自动触发，断言 pinia-plugin-error 落盘。
- `tests/fixtures/vue3/vue-vuex-error.html`：
  - 定义包含 `user` module 的 Vuex 4 store（含 namespaced）；
  - 提供按钮触发：action 同步抛错、action 异步抛错、mutation 抛错（非 strict）、subscribeAction onError；
  - 包含含 `password` / `token` 字段的 payload 场景。
- `tests/fixtures/vue3/vue-vuex-strict.html`：
  - Vuex 4 store 使用 `strict: true`；
  - 提供按钮：通过组件直接修改 `store.state.user.name`（在 mutation 外）触发 strict 违规；
  - 提供另一按钮：在合法 mutation 内修改（不应触发 strict 违规）。

### 3.2 单元 / 集成测试

**`tests/pinia-monitor.test.ts`（新增）**：
- TC-1：触发 Pinia action 同步抛错 → 断言 NDJSON 包含 `subType: 'pinia-error'`，context 含 `storeId`、`actionName`、`stateKeys`、`stateSizeBytes`、`stateTruncated`，`errorId` 非空。
- TC-2：触发 async action 抛错 → 同上。
- TC-3：触发 Pinia 插件 install 抛错 → 断言 `subType: 'pinia-plugin-error'`，context 含 `pluginName?` 与 stack。
- TC-11：触发 action 时传入 `{ password: 'xxx' }` payload → 断言落盘 args 中 `password === '[REDACTED]'`。
- TC-11a：触发 action 时传入 `[{ token: 'x' }]` 数组 args → 断言数组内 `token === '[REDACTED]'`。
- TC-15：在 fixture 中按以下顺序验证「延迟实例化」场景：
  1. 页面加载完成（DOMContentLoaded）后**不要**立即调用 `useXxxStore()`，仅完成 `defineStore(...)` 定义；
  2. 用户点击页面按钮触发回调，**回调内首次**调用 `useUserStore()`（或同名 setup store）完成实例化；
  3. 紧接着在同一回调中调用该 store 的 action 抛出 `new Error('lazy store error')`；
  4. 断言 NDJSON 中存在一条 `subType: 'pinia-error'`，且 context.storeId 为该 store 的 id。
- **TC-10（端到端层）**：在同一 fixture 中通过 store action 抛 `new Error(...)`，使错误同时经 Pinia action 拦截通道与 Vue `app.config.errorHandler` 通道上报；落盘 NDJSON 应包含两条原始日志（不同 subType 或不同来源），但经 `tests/analyzer.test.ts` 走完整 analyzer 流程后输出**仅 1 条**聚合错误。

**`tests/vuex-monitor.test.ts`（新增）**：
- TC-4 / TC-5 / TC-6 / TC-7：分别对应 action 同步 / 异步抛错、mutation 抛错、subscribeAction onError，断言 `subType: 'vuex-error'`，stage 字段正确，context 含 modulePath / type / payload(脱敏) / stage / stateKeys。
- TC-8：strict mode 下 mutation 外修改 state → 断言 `subType: 'vuex-strict-violation'`，含 modulePath、stateKeys。
- TC-8a：TC-8 同场景下断言 `mutatedKeyPath` 字段非空（值为 mutation.type 或 `'unknown'`）。
- TC-9：在 `vue-render-error.html` / `vue-warn.html` / `vue-router-error.html` / `plain.html` 等既有 fixture 运行 shield，**断言落盘 NDJSON 中任意条目的 `subType` 均 ∉ `{'pinia-error', 'pinia-plugin-error', 'vuex-error', 'vuex-strict-violation'}`**（即业务未引入 Pinia / Vuex 时，新子类型完全静默）。
- **TC-10a（端到端层）**：在 Vuex fixture 中通过 mutation 抛 `new Error(...)`，使错误同时经 store mutation 拦截通道与 Vue `app.config.errorHandler` 通道上报；落盘 NDJSON 应包含两条原始日志，但经 analyzer 流程后输出**仅 1 条**聚合错误。

**`tests/analyzer.test.ts` 扩展（单元层）**：
- 注入构造的新子类型 RuntimeLog → 断言 errorId 生成、topErrors 聚合。
- **TC-10（单元层）**：向 `dedupeJsErrors` 注入两条 `errorId` 相同、时间戳间隔 < 1s 的 RuntimeLog（例如 `vue-render-error` + `vuex-error` 组合）→ 断言去重后输出 1 条。
- **TC-10a（单元层）**：向 `dedupeJsErrors` 注入两条 `errorId` 相同、时间戳间隔 < 1s 的 RuntimeLog（例如 `promise-rejection` + `pinia-error` 组合）→ 断言去重后输出 1 条。
- TC-12：构造 `stateSizeBytes > 64 * 1024` 的 mock 日志 → 断言 `stateTruncated === true`。
- TC-13：构造循环引用 → 断言 `stateUnserializable === true`，`stateKeys` 仍有值。
- TC-14：构造含 BigInt / Symbol / Function 的 state → 断言 buildStateSummary 不抛错，对应值降级为字符串。

**`tests/api.test.ts` 扩展**：
- 构造含 4 个新子类型（`pinia-error` / `pinia-plugin-error` / `vuex-error` / `vuex-strict-violation`）各至少 1 条的运行时日志，预置到 NDJSON 落盘文件后启动 api server，断言：
  1. `GET /logs?type=runtime` 返回的列表中，**4 个新子类型各至少出现 1 条**；
  2. `GET /errors/top` 按 `subType` 维度聚合的结果中，**4 个新子类型均出现**；
  3. `GET /report?format=json` 返回 JSON 中 `summary.runtimeErrorCount` 对 4 个新子类型**每个均 ≥ 1**（按 subType 分桶或聚合字段命名以代码实际为准）。

**`tests/reporter.test.ts` 扩展**：
- 构造一组运行时日志（覆盖 4 个新子类型 `pinia-error` / `pinia-plugin-error` / `vuex-error` / `vuex-strict-violation` 各至少 1 条），调用 reporter 生成 Markdown 报告 → 断言生成的 MD 报告文本中**包含全部 4 个新子类型字符串**（出现在子类型分组、Top Errors 或对应章节标题中）。

**`tests/shield-cli.test.ts`（新增）**：
- TC-11b（拆两步）：
  1. **静态注入断言**：启动 shield 时携带 `--redact-body-fields password,token`，在 Playwright `page.evaluate` 下断言 `window.__SHIELD_REDACT_FIELDS__` 严格等于 `['password','token']`；不传该参数时该全局变量为 `undefined`。
  2. **端到端脱敏断言**：在同一 fixture 上触发一次包含 `password` / `token` 字段的 action / payload 上报；读取 NDJSON 落盘文件，断言对应条目 `context.args`（或 `context.payload`）中 `password` 与 `token` 字段值均为字符串 `'[REDACTED]'`。
- TC-16：通过 `commander.helpInformation()` 直接生成帮助文案，**或**在 `pnpm build` 后使用 `execa` 执行 `node ./dist/cli.js shield --help` 捕获 stdout；断言文案中不存在 `--enable-pinia` / `--enable-vuex` 等新增开关。

### 3.3 回归套件（设计文档 §5.3）

下列既有用例必须全绿：
- `tests/fixtures/vue3/vue-render-error.html` + 既有 vue3-monitor 用例
- `tests/fixtures/vue3/vue-warn.html`
- `tests/fixtures/vue3/vue-router-error.html`
- `tests/fixtures/vue3/vue-router-guard.html`
- `tests/fixtures/vue3/vue-router-lazy.html`
- `tests/fixtures/vue3/vue-dynamic-app.html`
- `tests/fixtures/vue3/plain.html`
- `tests/vue3-monitor.test.ts` / `tests/start-page.test.ts` / `tests/analyzer.test.ts`（原有断言）
- **新增回归覆盖**：
  - `tests/e2e/shield.e2e.test.ts`
  - `tests/e2e/boundary.test.ts`
  - `tests/custom-rules.test.ts`
  - `tests/reporter.test.ts`
  - `tests/structured-logger.test.ts`

### 3.4 CI 命令

执行链：
```
pnpm typecheck   # 类型检查
pnpm build       # 构建（含 inject.iife.ts 打包）
pnpm test        # vitest 全量
pnpm vendor-size # vendor 文件总大小 ≤ 400KB 自检（新增；可集成至 pnpm test 的前置钩子中）
```

三者均为零失败时本任务方可通过验收。vendor-size 可使用 `du -sh` + `awk` 或脚本在 CI 中直接断言。

---

## 4. 测试计划

### 4.1 单元测试

详见 §3.2。

### 4.2 集成测试 / 端到端测试

- 所有 fixture HTML 通过 Playwright 启动 shield → 触发场景 → 读取 NDJSON 落盘文件 → 断言条目内容。
- 多通道去重测试（TC-10 / TC-10a）通过同时触发 errorHandler 与 store patch 两条链路实现。

### 4.3 回归测试

详见 §3.3。

---

## 5. 风险与依赖

| 风险 / 依赖 | 影响 | 应对措施 |
|---|---|---|
| 依赖 T1 ~ T5 全部完成 | 阻塞本任务 | 严格按 T1 → T2 → T3 → T4 → T5 → T6 顺序执行 |
| vendor 文件来源 / license 合规 | 仓库合规风险 | 使用 jsDelivr / unpkg 上的官方 production min 构建，附带 LICENSE；提交时在 PR 描述中注明版本号与来源 |
| Pinia / Vuex 在 `<script>` 标签场景下的全局变量名差异（`window.Pinia` vs `window.Vuex`）| fixture 写法差异 | 与 v1.1 `vue.global.js` 风格保持一致，按官方文档全局变量约定使用 |
| inject.iife.ts 体积监控 | CI 失败 | 构建产物体积以当前 main 分支构建产物为 baseline，新增不超过 +5KB |

---

## 6. 变更范围

- **本任务范围内**：`tests/fixtures/vue3/vendor/*`、`tests/fixtures/vue3/vendor/LICENSE-*.txt`、`tests/fixtures/vue3/vue-pinia-*.html`、`tests/fixtures/vue3/vue-vuex-*.html`、`tests/pinia-monitor.test.ts`、`tests/vuex-monitor.test.ts`、`tests/analyzer.test.ts` 扩展、`tests/api.test.ts` 扩展、`tests/reporter.test.ts` 扩展、`tests/shield-cli.test.ts`。
- **不在本任务范围内**：
  - 业务代码修改（已在 T1 ~ T5 完成）；
  - 文档更新（T7）。

---

## 7. 评审记录

| 轮次 | 日期 | 结论 | P0/P1 问题 | 修复方案 |
|---|---|---|---|---|
| 1 | 2026-06-22 | **不通过 → 修订后待重评** | P0-1 ~ P0-4（强制性）、P1-1 ~ P1-7（优先）见评审反馈 | 本文档已按第 1 轮评审意见逐条修订完成，待第 2 轮评审 |
