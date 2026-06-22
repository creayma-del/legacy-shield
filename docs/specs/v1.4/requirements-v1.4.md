# legacy-shield v1.4 需求文档

> 版本：v1.4
> 对应会议纪要：[meetings/requirements-alignment-v1.4-20260622.md](meetings/requirements-alignment-v1.4-20260622.md)（待生成）
> 对应需求分解文档：[requirements-decomposition-v1.4.md](requirements-decomposition-v1.4.md)（待生成）
> 状态：已批准
> 编制日期：2026-06-22
> 批准日期：2026-06-22

---

## 1. 需求背景

legacy-shield v1.1 已完整支持 Vue 3 运行时渲染错误、运行时警告、Vue Router 4 导航错误的自动注入采集；v1.3 在此基础上扩展了 H5 / Web 平台识别、内存与资源运行时监控、NDJSON 结构化日志。

在实际使用中，状态管理库（Pinia / Vuex）是 Vue 业务系统中错误高发的关键链路：

- Action / Mutation 中的异步抛错（尤其是 try/catch 吞错）、订阅者函数报错、Vuex strict mode 违规修改等，目前仅能通过 `vue-render-error` / `promise-rejection` / `console-error` **兜底**捕获；
- 兜底数据缺少 store name、action / mutation type、payload、state 快照等结构化上下文，AI 智能体与开发者难以直接定位根因；
- v1.1 已在需求范围中显式排除"Pinia/Vuex 单独 patch"（详见 [requirements-v1.1.md#L31](../v1.1/requirements-v1.1.md)），本次作为新的 MINOR 版本反转该排除项。

v1.4 作为 MINOR 版本，目标为：**在 shield 子命令的现有零侵入注入机制上，自动识别并 patch Pinia 2.x 与 Vuex 4，结构化采集 store 相关错误与违规，扩展运行时日志的子类型，不引入任何业务侵入。**

---

## 2. 需求条目

| 需求编号 | 需求描述 | 优先级 | 验收要点 |
|---|---|---|---|
| REQ-1.4-1 | 自动识别并 patch Pinia 2.x（Vue 3），无需业务代码改造 | P0 | shield 启动后，业务系统若使用 Pinia，inject 脚本自动完成 patch，且支持 Pinia 通过 `createApp().use(pinia)` 注入与 `pinia.use(plugin)` 扩展两种链路 |
| REQ-1.4-2 | 自动识别并 patch Vuex 4（Vue 3），无需业务代码改造 | P0 | shield 启动后，业务系统若使用 Vuex 4，inject 脚本自动完成 patch，且支持 `createApp().use(store)` 注入 |
| REQ-1.4-3 | 采集 Pinia action 抛错与 `$onAction` onError 回调 | P0 | 同步 / 异步抛错均落盘为 `pinia-error` 子类型；store id、action 名、参数（脱敏后）、错误堆栈完整记录 |
| REQ-1.4-4 | 采集 Vuex action / mutation 抛错与 subscribe / subscribeAction 回调报错 | P0 | 同步 / 异步抛错均落盘为 `vuex-error` 子类型；module path、type、payload（脱敏后）、错误堆栈完整记录 |
| REQ-1.4-5 | 采集 Vuex strict mode 在 mutation 外修改 state 的违规 | P1 | 落盘为 `vuex-strict-violation` 子类型；包含 module path、被修改 key 路径、错误堆栈；不依赖 console 文本解析 |
| REQ-1.4-6 | 采集 Pinia 插件 install / extend 阶段抛错 | P1 | 落盘为 `pinia-plugin-error` 子类型；包含 plugin 名称（若可推断）与错误堆栈 |
| REQ-1.4-7 | 错误上下文 detail 包含 store name / id、action / mutation name、payload、state 快照摘要 | P0 | detail 结构遵循设计文档定义；payload 与 state 摘要均经过现有 `redactBody` 脱敏，复用 `--redact-body-fields` 字段名单 |
| REQ-1.4-8 | state 快照仅记录 keys 列表与 JSON 序列化体积，不记录完整值 | P0 | 防止敏感数据落盘；当 state 体积超过 64KB 时，标记 `stateTruncated: true` 并仅记录 keys |
| REQ-1.4-9 | 与 Vue errorHandler 链路去重，避免一条错误被多通道重复上报 | P0 | 复用现有 `__shield_emitted__` 标记机制；analyzer 层按 errorId 1 秒窗口去重 |
| REQ-1.4-10 | 默认开启 Pinia / Vuex 采集，无需新增 CLI 参数 | P0 | shield 启动后自动激活，不引入新的命令行参数；若业务未使用 Pinia / Vuex，patch 静默跳过 |
| REQ-1.4-11 | 保持 v1.1 ~ v1.3 已有运行时采集行为零回归 | P0 | 现有 `vue-render-error` / `vue-warn` / `vue-router-error` / `promise-rejection` 子类型行为不变；全量测试通过 |
| REQ-1.4-12 | 文档同步更新 README、api.md、custom-rules.md 中相关说明 | P1 | README 在「支持的框架与平台」「shield」章节加入 Pinia / Vuex 说明；api.md 在 `/logs?type=runtime` 与 `/errors/top` 说明中加入新子类型 |

---

## 3. 验收标准

1. 业务系统未做任何代码改造的前提下，shield 启动后可以自动采集到 Pinia 2.x 与 Vuex 4 的指定错误。
2. 所有新增子类型（`pinia-error`、`vuex-error`、`vuex-strict-violation`、`pinia-plugin-error`）的 detail 结构与设计文档一致，能被 analyzer / reporter / api 端点正常消费。
3. 与既有运行时采集链路（Vue render error、router error、unhandledrejection、console）去重正确，同一错误不会重复落盘。
4. 当业务系统未引入 Pinia / Vuex 时，inject 脚本静默跳过，不影响现有功能。
5. `pnpm typecheck`、`pnpm build`、`pnpm test` 全量通过，不引入破坏性变更，无新增运行时依赖。
6. README、api.md 文档与代码行为一致。

---

## 4. 成功指标

- 开发者在排查 Vue 业务系统 store 报错时，无需打开浏览器 DevTools 手动调试，仅通过 legacy-shield 日志 / API 即可获得 store id / action 名 / payload 等结构化上下文。
- AI 智能体通过 `/logs?type=runtime` 或 `/errors/top` 可直接区分 store 类错误并生成针对性的修复建议。
- v1.1 ~ v1.3 已交付能力无回归。

---

## 5. 不在范围内

以下事项已在需求澄清中明确排除，v1.4 不予实现：

- Vue 2 + Vuex 3 的支持（项目整体不支持 Vue 2）。
- Pinia / Vuex 编译时错误采集。
- Pinia / Vuex devtools 协议对接、可视化 store 状态时间机器。
- 服务端 / SSR 场景下的 store 错误采集。
- 新增 CLI 参数控制 store 采集开关（默认始终开启，未来如需关闭可在后续版本再行评估）。
- 自动修复建议生成（由 AI 智能体通过 `/suggest` 端点自行处理）。

---

## 6. 批准记录

- 用户 / 产品负责人：creayma，2026-06-22，已批准
- 项目负责人：creayma，2026-06-22，已批准
