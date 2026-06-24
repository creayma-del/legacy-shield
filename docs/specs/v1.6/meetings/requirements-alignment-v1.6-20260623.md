# 需求对齐会议纪要

> 版本：v1.6
> 会议时间：2026-06-23 21:00
> 会议地点：Trae IDE 在线会话
> 记录人：SOLO Coder

## 参与人员

- 用户 / 产品负责人：creayma
- SOLO Coder：开发助手（Trae IDE 内置）

## 会议背景

用户提出修复两个已知限制：
1. v1.4 遗留的 2 个 `it.skip` 测试用例（Pinia plugin install 异常 R-1 / Vuex 4 strict 违规 R-2）
2. v1.5 遗留的知识图谱不支持 webpack/vite resolve.alias 配置解析

用户初始定性为"bugfix，小版本迭代"。经 spec-guardian 分析，两个问题在 v1.4 / v1.5 验收报告中均作为**已知限制**透明披露并归档，代码按设计预期工作，修复属于**能力增强**，应判定为 **MINOR 版本（v1.6）**，需走完整 MINOR 流程。

## 需求条目确认

| 需求编号 | 需求描述 | 确认结论 | 备注 |
|---|---|---|---|
| REQ-1.6-1 | 遍历 `pinia._p` 内部数组，包装每个 plugin function | 确认 | 用户选择"访问 _p 私有数组（推荐）"方案 |
| REQ-1.6-2 | `_p` 数组访问的防御性处理 | 确认 | `_p` 不存在或非数组时静默跳过 |
| REQ-1.6-3 | 恢复 TC-3 为活跃测试用例 | 确认 | 取消 `it.skip`，验证修复后测试通过 |
| REQ-1.6-4 | Hook Vue `app.config.errorHandler` 协同捕获 strict 违规 | 确认 | 用户选择"errorHandler 协同（推荐）"方案 |
| REQ-1.6-5 | errorHandler 链式调用保障 | 确认 | 先调用业务 errorHandler 再执行 shield 识别 |
| REQ-1.6-6 | 与 `__shield_emitted__` 去重机制协同 | 确认 | 避免重复落盘 |
| REQ-1.6-7 | 恢复 TC-8 / TC-8a 为活跃测试用例 | 确认 | 取消 `it.skip`，验证修复后测试通过 |
| REQ-1.6-8 | 支持 vite.config.ts resolve.alias 解析 | 确认 | 支持对象格式与数组格式 |
| REQ-1.6-9 | 支持 webpack.config.js resolve.alias 解析 | 确认 | 支持对象格式 |
| REQ-1.6-10 | 使用 jiti 加载 JS/TS 配置文件 | 确认 | 用户接受 jiti 作为运行时依赖（已在 devDependencies） |
| REQ-1.6-11 | 自动检测配置文件，无需新增 CLI 参数 | 确认 | 用户选择"自动检测（推荐）" |
| REQ-1.6-12 | alias 优先级：tsconfig > vite > webpack | 确认 | 用户选择"tsconfig > vite > webpack（推荐）" |
| REQ-1.6-13 | 仅支持静态 alias 配置 | 确认 | 用户选择"仅静态配置（推荐）"，不支持 webpack-chain / webpack-merge / 函数式 alias |
| REQ-1.6-14 | 配置文件解析耗时 < 500ms | 确认 | 用户选择"< 500ms（推荐）" |
| REQ-1.6-15 | alias 路径解析为绝对路径 | 确认 | 基于 projectRoot 解析 |
| REQ-1.6-16 | v1.1 ~ v1.5 零回归 | 确认 | 全量测试通过 |
| REQ-1.6-17 | 文档同步更新 | 确认 | README / api.md |
| REQ-1.6-18 | 新增测试夹具 | 确认 | webpack-alias-project / vite-alias-project |

## 验收标准确认

1. TC-3 取消 `it.skip` 后通过，Pinia plugin install 抛错落盘 `pinia-plugin-error`。
2. TC-8 / TC-8a 取消 `it.skip` 后通过，Vuex strict 违规经 errorHandler 协同捕获落盘 `vuex-strict-violation`。
3. 知识图谱对 webpack alias 项目可正确解析 `@/`、`~/` 等别名。
4. 知识图谱对 vite alias 项目可正确解析对象格式与数组格式 alias。
5. alias 优先级正确：tsconfig > vite > webpack。
6. 配置解析耗时 < 500ms，v1.5 既有性能基线不受影响。
7. `pnpm typecheck` / `build` / `test` 全量通过，零回归。
8. 文档与代码行为一致。

## 成功指标确认

- v1.4 遗留 3 个 `it.skip`（TC-3 / TC-8 / TC-8a）全部恢复为活跃用例并通过，R-1 / R-2 闭环。
- v1.5 遗留 webpack/vite alias 不支持限制消除。
- v1.1 ~ v1.5 已交付能力无回归。

## 风险与约束

| 风险 | 影响 | 应对措施 |
|---|---|---|
| Pinia 2.x 内部 `_p` 私有 API 变更 | R-1 修复在 Pinia 版本升级后可能失效 | 防御性检查 `_p` 存在性与类型；失败时静默降级为现有 errorHandler 兜底 |
| Vue errorHandler 被业务系统覆盖 | R-2 修复的 errorHandler 链路可能被业务代码覆盖 | shield 包装层先调用业务 errorHandler 再执行 shield 识别逻辑 |
| jiti 运行时加载配置文件性能 | 大型项目配置文件可能含复杂导入链 | 配置解析耗时 < 500ms 约束；加载失败时静默降级 |
| webpack/vite 配置文件格式多样性 | 部分项目使用非标准配置文件名或导出方式 | 仅支持 `webpack.config.{js,ts}` / `vite.config.{ts,js}` 标准文件名；不支持 webpack-chain / webpack-merge |
| jiti 从 devDependencies 提升为运行时依赖 | 改变依赖管理边界 | 需将 jiti 从 devDependencies 移至 dependencies，在设计文档中明确记录 |

## 遗留问题

| 问题 | 责任人 | 解决时限 |
|---|---|---|
| 无 | - | - |

## 签字确认

- 用户 / 产品负责人：creayma，2026-06-23，已确认
- SOLO Coder：开发助手（Trae IDE 内置），2026-06-23，已确认

> 在 IDE / 聊天场景下，「签字」指用户明确回复「确认」「同意」等文字确认。
