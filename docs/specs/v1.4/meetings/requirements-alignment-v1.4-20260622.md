# 需求对齐会议纪要

> 版本：v1.4
> 会议时间：2026-06-22
> 会议地点：线上（Trae IDE 对话）
> 记录人：SOLO Coder
> 状态：已确认

## 背景

v1.3 已交付 H5 / Web 平台识别、内存与资源运行时监控、NDJSON 结构化日志。本次 v1.4 在不破坏既有能力的前提下，针对开发阶段 Vue 业务系统的 Pinia 2.x / Vuex 4 状态管理库错误链路，新增专项零侵入采集能力，反转 v1.1 中显式排除的"Pinia/Vuex 单独 patch"项。

## 参与人员

- 用户 / 产品负责人：creayma
- SOLO Coder：AI Assistant

## 需求条目确认

| 需求编号 | 需求描述 | 确认结论 | 备注 |
|---|---|---|---|
| REQ-1.4-1 | 自动识别并 patch Pinia 2.x（Vue 3） | 确认 | 复用 inject.iife.ts 的 patchVue → app.use 拦截机制 |
| REQ-1.4-2 | 自动识别并 patch Vuex 4（Vue 3） | 确认 | 同上 |
| REQ-1.4-3 | 采集 Pinia action 抛错与 `$onAction` onError 回调 | 确认 | 同步 / 异步均覆盖 |
| REQ-1.4-4 | 采集 Vuex action / mutation 抛错与 subscribe / subscribeAction 回调报错 | 确认 | 同步 / 异步均覆盖 |
| REQ-1.4-5 | 采集 Vuex strict mode 在 mutation 外修改 state 的违规 | 确认 | 不依赖 console 文本解析，通过 store.subscribe + Vue config.errorHandler 协同识别 |
| REQ-1.4-6 | 采集 Pinia 插件 install / extend 阶段抛错 | 确认 | P1 优先级 |
| REQ-1.4-7 | 错误上下文 detail 包含 store name / id、action / mutation name、payload、state 快照摘要 | 确认 | payload 与 state 摘要复用 redactBody |
| REQ-1.4-8 | state 快照仅记录 keys 列表与 JSON 序列化体积 | 确认 | 防敏感数据落盘 |
| REQ-1.4-9 | 与 Vue errorHandler 链路去重 | 确认 | 复用 `__shield_emitted__` 标记机制 |
| REQ-1.4-10 | 默认开启 Pinia / Vuex 采集，无需新增 CLI 参数 | 确认 | 未引入 Pinia / Vuex 时静默跳过 |
| REQ-1.4-11 | 保持 v1.1 ~ v1.3 已有运行时采集行为零回归 | 确认 | 测试矩阵覆盖既有用例 |
| REQ-1.4-12 | 文档同步更新 README、api.md、custom-rules.md | 确认 | P1 优先级，与代码同期交付 |

## 验收标准确认

1. 业务系统未做任何代码改造的前提下，shield 启动后可以自动采集到 Pinia 2.x 与 Vuex 4 的指定错误。
2. 所有新增子类型（`pinia-error`、`vuex-error`、`vuex-strict-violation`、`pinia-plugin-error`）的 detail 结构与设计文档一致。
3. 与既有运行时采集链路去重正确，同一错误不会重复落盘。
4. 业务系统未引入 Pinia / Vuex 时，inject 脚本静默跳过。
5. `pnpm typecheck`、`pnpm build`、`pnpm test` 全量通过。
6. README、api.md 文档与代码行为一致。

## 成功指标确认

- 开发者排查 Vue store 报错时，无需开 DevTools，仅通过 legacy-shield 日志 / API 即可获得结构化上下文。
- AI 智能体可直接区分 store 类错误并生成针对性的修复建议。
- v1.1 ~ v1.3 已交付能力无回归。

## 风险与约束

| 风险 | 影响 | 应对措施 |
|---|---|---|
| Pinia / Vuex 通过非 `app.use` 路径安装（如手动 `setActivePinia`） | 部分场景错过 patch | 在 design 中评估补充 `setActivePinia` / `createPinia` 等关键 API 的兜底拦截 |
| state 快照可能包含敏感信息 | 隐私泄漏 | 强制仅记录 keys + 体积，不记录完整值；payload 复用 redactBody |
| 异步 action / Promise 链路中错误被业务 catch | 无法采集 | 与现有兜底机制一致，采集层不强行突破业务 catch；在文档中明确说明 |
| 重复上报（store 抛错 → Vue errorHandler → unhandledrejection 多通道） | 数据冗余 | 复用 `__shield_emitted__` 标记 + analyzer 1 秒窗口去重 |

## 遗留问题

| 问题 | 责任人 | 解决时限 |
|---|---|---|
| Pinia / Vuex 注入时机的兜底策略具体实现 | SOLO Coder | 设计文档评审前 |
| state 快照体积阈值（64KB）是否可配置 | SOLO Coder / 用户 | 设计文档评审前 |

## 双方确认

- 用户 / 产品负责人：creayma，2026-06-22，已确认
- SOLO Coder：AI Assistant，2026-06-22，已确认
