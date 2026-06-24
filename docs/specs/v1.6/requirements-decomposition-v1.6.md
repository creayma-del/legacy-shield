# legacy-shield v1.6 需求分解文档

> 版本：v1.6
> 对应需求文档：[requirements-v1.6.md](requirements-v1.6.md)
> 对应会议纪要：[meetings/requirements-alignment-v1.6-20260623.md](meetings/requirements-alignment-v1.6-20260623.md)
> 状态：已完成，已归档（冻结，不再修改）

## 1. 功能分解

| 功能点编号 | 名称 | 描述 | 对应需求 | 验收标准 | 优先级 |
|---|---|---|---|---|---|
| F-1 | Pinia _p 数组包装 | 遍历 `pinia._p` 内部数组，逐个包装 plugin function 为 try/catch，install 抛错时 emit `pinia-plugin-error` | REQ-1.6-1, REQ-1.6-2 | TC-3 取消 it.skip 后通过；_p 不存在时静默跳过 | P0 |
| F-2 | Vuex strict errorHandler 协同 | Hook Vue `app.config.errorHandler`，匹配 Vuex strict 错误消息后关联 store 并 emit `vuex-strict-violation` | REQ-1.6-4, REQ-1.6-5, REQ-1.6-6 | TC-8 / TC-8a 取消 it.skip 后通过；errorHandler 链式调用不吞错 | P0 |
| F-3 | it.skip 测试恢复 | 取消 TC-3 / TC-8 / TC-8a 的 `it.skip`，恢复为活跃测试用例 | REQ-1.6-3, REQ-1.6-7 | 3 个测试用例全部通过 | P0 |
| F-4 | jiti 依赖提升 + 配置加载器 | 将 jiti 从 devDependencies 移至 dependencies；实现 `loadConfigFile` 函数加载 JS/TS 配置文件 | REQ-1.6-10 | jiti 可正确加载 webpack.config.{js,ts} / vite.config.{ts,js}；加载失败时静默降级 | P0 |
| F-5 | vite.config alias 解析 | 解析 vite.config 的 `resolve.alias`，支持对象格式与数组格式 | REQ-1.6-8 | 对象格式 `{ '@': '/src' }` 与数组格式 `[{ find, replacement }]` 均可正确解析 | P0 |
| F-6 | webpack.config alias 解析 | 解析 webpack.config 的 `resolve.alias`，支持对象格式 | REQ-1.6-9, REQ-1.6-15 | `{ '@': path.resolve(__dirname, 'src') }` 可正确解析为绝对路径 | P0 |
| F-7 | alias 优先级合并 + resolver 集成 | 修改 `createResolver` 自动检测配置文件，按 tsconfig > vite > webpack 优先级合并 alias | REQ-1.6-11, REQ-1.6-12 | 多来源 alias 正确合并；高优先级不被低优先级覆盖 | P0 |
| F-8 | 测试夹具与测试用例 | 新增 webpack-alias-project / vite-alias-project 夹具；扩展 resolver / integration / performance 测试 | REQ-1.6-14, REQ-1.6-18 | 端到端验证 alias 解析正确性；配置解析耗时 < 500ms | P0 |
| F-9 | 回归测试 + 文档更新 | 全量回归测试；更新 README / api.md | REQ-1.6-16, REQ-1.6-17 | v1.1 ~ v1.5 零回归；文档与代码一致 | P0 |

## 2. 任务依赖关系

| 任务 | 依赖 | 可并行任务 |
|---|---|---|
| T1（Pinia _p 包装） | 无 | T2, T4 |
| T2（Vuex strict errorHandler） | 无 | T1, T4 |
| T3（恢复 it.skip 测试） | T1, T2 | T4, T5, T6 |
| T4（jiti + 配置加载器） | 无 | T1, T2 |
| T5（vite alias 解析） | T4 | T6, T3 |
| T6（webpack alias 解析） | T4 | T5, T3 |
| T7（alias 优先级合并 + 集成） | T5, T6 | T3 |
| T8（测试夹具与测试用例） | T7 | T3 |
| T9（回归测试 + 文档更新） | T3, T8 | 无 |

### 并行执行批次

| 批次 | 任务 | 说明 |
|---|---|---|
| 批次 1 | T1, T2, T4 | 三个独立任务，无依赖关系 |
| 批次 2 | T3, T5, T6 | T3 依赖 T1/T2；T5/T6 依赖 T4 |
| 批次 3 | T7 | 依赖 T5/T6 |
| 批次 4 | T8 | 依赖 T7 |
| 批次 5 | T9 | 依赖 T3/T8，最终收尾 |

## 3. 资源分配估算

| 任务 | 工作量 | 角色 | 外部资源 |
|---|---|---|---|
| T1 | 低 | 开发专家 | 无 |
| T2 | 中 | 开发专家 | 无 |
| T3 | 低 | 开发专家 | 无 |
| T4 | 中 | 开发专家 | jiti 库 |
| T5 | 中 | 开发专家 | 无 |
| T6 | 中 | 开发专家 | 无 |
| T7 | 中 | 开发专家 | 无 |
| T8 | 中 | 开发专家 | 无 |
| T9 | 低 | 开发专家 | 无 |

## 4. 时间线里程碑

| 里程碑 | 预计日期 |
|---|---|
| 需求对齐完成 | 2026-06-23 |
| 需求分解文档批准 | 2026-06-23 |
| 设计文档评审通过 | 2026-06-23 |
| 执行计划评审通过 | 2026-06-23 |
| 阶段 Spec 评审通过 | 2026-06-23 |
| 任务 Spec 评审通过 | 2026-06-23 |
| 代码开发完成 | 2026-06-24 |
| 测试验收通过 | 2026-06-24 |
| 归档关闭 | 2026-06-24 |

## 5. 风险与假设

| 风险 / 假设 | 说明 | 应对措施 |
|---|---|---|
| Pinia 2.x `_p` 私有 API 变更 | `_p` 数组结构在 Pinia 后续版本可能变更 | 防御性检查 `_p` 存在性与类型；失败时静默降级为 errorHandler 兜底 |
| Vue errorHandler 已被业务覆盖 | 业务系统可能已设置 `app.config.errorHandler` | shield 包装层先调用业务 errorHandler 再执行 shield 识别逻辑（现有 patchErrorHandler 已实现此模式） |
| jiti 运行时加载性能 | 大型项目配置文件可能含复杂导入链 | 配置解析耗时 < 500ms 约束；加载失败时静默降级为无 alias |
| jiti 依赖提升影响 | jiti 从 devDependencies 移至 dependencies 改变依赖边界 | 设计文档明确记录；jiti 为轻量级库，无传递依赖风险 |
| webpack `path.resolve` 调用 | webpack.config.js 中 `path.resolve(__dirname, 'src')` 需被 jiti 正确求值 | jiti 在加载时执行配置文件，`__dirname` 会被正确设置为配置文件所在目录 |
| T1/T2 同文件修改冲突 | T1（patchPinia）和 T2（patchErrorHandler）均修改 inject.iife.ts | 修改不同函数，无逻辑冲突；开发时顺序执行避免合并冲突 |
