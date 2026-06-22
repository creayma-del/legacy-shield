# legacy-shield v1.1 详细执行计划

> 文档版本：v1.1
> 对应需求文档：[requirements-v1.1.md](requirements-v1.1.md)
> 对应设计文档：[design-v1.1.md](design-v1.1.md)
> 对应阶段 Spec：[phases/phase-v1.1-spec.md](phases/phase-v1.1-spec.md)
> 状态：已通过

---

## 1. 版本总体进度

| 任务 | 名称 | 优先级 | 依赖 | 预计耗时 |
|---|---|---|---|---|
| T1 | 重构 `lib/inject.iife.ts` Vue 3 补丁逻辑 | P0 | T2 | 中等 |
| T2 | 扩展类型定义与日志级别 | P0 | 无 | 低 |
| T3 | 新增 Vue 3 监控测试 | P0 | T1、T2 | 高 |
| T4 | 更新用户文档 | P1 | T1 | 低 |
| T5 | 全量回归与验收 | P0 | T1-T4 | 中等 |

---

## 2. 任务详细说明

### 任务 T1：重构 `lib/inject.iife.ts` Vue 3 补丁逻辑

**目标**：

实现 Vue 3 app 错误、警告、Vue Router 4 错误的完整采集。

**实现步骤**：

1. 重构 `patchVue()`：
   - 以重写 `createApp` 为核心机制，自动 patch 所有新 app；
   - 保留 500ms 轮询（最多 20 次）作为防御性兜底；
   - 仅将 `vueGlobal.apps` 作为兜底尝试；
   - 兜底 patch 失败不阻断 `createApp` 重写。
2. 新增 `patchApp(app, appId)`：
   - 为每个 app 生成唯一 `appId`；
   - patch `config.errorHandler`（try/catch 保护原始 handler；无原始 handler 时调用 `console.error` 保留默认输出）；
   - patch `config.warnHandler`（try/catch 保护原始 handler；无原始 handler 时调用 `console.warn` 保留默认输出）；
   - patch `app.use` 以监听 router 安装。
3. 新增 `patchRouter(app, appId)`：
   - 读取 `app.config.globalProperties.$router`；
   - 注册 `router.onError` 监听器；
   - 包装 `beforeEach`/`beforeResolve`/`afterEach`；
   - 使用 `__shield_emitted__` 标记避免 guard 与 onError 重复报告。
4. 新增辅助函数：
   - `buildVueErrorDetail(err, instance, info, appId)`；
   - `buildRouterErrorDetail(err, appId, to?, from?)`；
   - `wrapGuardHandler(handler, appId)`；
   - `markShieldEmitted(err)` / `isShieldEmitted(err)`；
   - `getComponentName(instance)`。
5. 在 `init()` 中调用 `patchVue()`。
6. 修改 `lib/analyzer.ts` 的 `dedupeJsErrors`：
   - 过滤条件改为子类型白名单 + `!!log.errorId`；
   - 白名单包括 `js-error`、`promise-rejection`、`vue-render-error`、`vue-router-error`、`react-render-error`；
   - 避免 `console-error`、`resource-error` 等进入 TOP 聚合导致非预期回归。
7. 修改 `lib/api.ts` 的 `/suggest` 端点：
   - 将 `generateFixPrompt` 的过滤条件改为与 TOP 聚合一致的子类型白名单；
   - 在 `tests/api.test.ts` 中补充 `vue-render-error` / `vue-router-error` 的 `/suggest` 兼容性断言。

**验收标准**：

- [ ] 代码通过 `pnpm typecheck`；
- [ ] 不依赖 Vue 类型包；
- [ ] 所有补丁函数内部有 try/catch，失败不抛到页面。

**风险与应对**：

| 风险 | 应对措施 |
|---|---|
| Vue 全局变量检测时机 | 保留 500ms 轮询，最多 20 次 |
| 用户自定义 handler 被覆盖 | 优先调用原始 handler |
| Router 守卫异步 reject | `wrapGuardHandler` 统一包装 Promise |

---

### 任务 T2：扩展类型定义与日志级别

**目标**：

让 `vue-warn` 和 `vue-router-error` 在类型系统与日志工具中被识别。

**实现步骤**：

1. 在 `lib/types.ts` 的 `RuntimeSubType` 中追加 `vue-warn` 和 `vue-router-error`；
2. 在 `lib/logger.ts` 的 `isErrorSubType` 中追加 `vue-router-error`；
3. 确认 `emitRuntime` 调用时 `level` 参数正确：
   - `vue-render-error` → `'error'`
   - `vue-warn` → `'warn'`
   - `vue-router-error` → `'error'`

**验收标准**：

- [ ] `pnpm typecheck` 通过；
- [ ] `vue-router-error` 日志写入时包含 `errorId`。

---

### 任务 T3：新增 Vue 3 监控测试

**目标**：

覆盖 v1.1 新增能力的端到端测试。

**实现步骤**：

1. 创建测试夹具目录 `tests/fixtures/vue3/`，Vue 3 / Vue Router 4 静态文件存放于 `tests/fixtures/vue3/vendor/`；
2. 创建 7 个静态 HTML 文件：
   - `vue-render-error.html`：组件 render 抛错；
   - `vue-dynamic-app.html`：延迟 createApp 后抛错；
   - `vue-warn.html`：prop 类型不匹配；
   - `vue-router-error.html`：router onError（守卫返回 rejected Promise）；
   - `vue-router-guard.html`：导航守卫抛错；
   - `vue-router-lazy.html`：异步路由组件加载失败；
   - `plain.html`：非 Vue 页面回归。
3. 新增 `tests/vue3-monitor.test.ts`：
   - 启动本地 HTTP 服务提供夹具页面；
   - 使用 Playwright 打开页面并触发错误；
   - 读取 runtime 日志并断言 `subType` 与 `level`。
4. `tests/analyzer.test.ts` 的更新由 T1 负责，本任务不重复覆盖。

**验收标准**：

- [ ] 7 个端到端用例全部通过；
- [ ] 每个用例使用独立 `sessionId`；
- [ ] 测试默认使用本地静态 Vue 3 / Vue Router 4 文件（位于 `tests/fixtures/vue3/vendor/`），CDN 仅作为可选回退，CI 环境禁止使用 CDN。

**风险与应对**：

| 风险 | 应对措施 |
|---|---|
| CDN 不稳定导致测试失败 | 默认使用本地静态 Vue 3 文件，CDN 作为可选 |
| Playwright 启动慢 | 每个 describe 复用 browser，page 级别隔离 |

---

### 任务 T4：更新用户文档

**目标**：

让用户了解 v1.1 的 Vue 3 监控能力边界。

**实现步骤**：

1. 修改 `README.md`：
   - 在 `shield` 子命令功能描述中增加 Vue 3 监控说明；
   - 增加「支持的框架」小节，明确 Vue 3 与 Vue Router 4。
2. 修改 `docs/usage.md`：
   - 在 `shield` 使用说明中补充 Vue 3 错误采集范围；
   - 明确标注不支持 Vue 2。
3. 检查 `docs/api.md` 中 `/errors/top` 端点示例是否需要更新。

**验收标准**：

- [ ] 文档与实现一致；
- [ ] 无错别字；
- [ ] 链接有效。

---

### 任务 T5：全量回归与验收

**目标**：

确保 v1.1 不引入回归，并完成验收。

**实现步骤**：

1. 运行 `pnpm typecheck`；
2. 运行 `pnpm build`；
3. 运行 `pnpm test`；
4. 如失败，修复后重新运行；
5. 生成 `docs/specs/acceptance-report-v1.1.md`；
6. 调用测试验收专家评审。

**验收标准**：

- [ ] `pnpm typecheck` 通过；
- [ ] `pnpm build` 通过；
- [ ] `pnpm test` 全量通过；
- [ ] 验收报告通过专家评审。

---

## 3. 依赖与资源

### 3.1 外部依赖

- Vue 3（测试夹具使用，运行时不依赖）
- Vue Router 4（测试夹具使用）
- Playwright（已有）

### 3.2 关键角色

| 角色 | 任务 |
|---|---|
| SOLO Coder | 协调文档、调度专家、最终交付 |
| Spec 评审专家 | 评审 requirements-v1.1 / design-v1.1 / execution-plan-v1.1 / phase-v1.1-spec |
| 开发专家 | 按 Spec 完成 T1-T4 代码实现 |
| 测试验收专家 | 验收 T5 |

---

## 4. 里程碑

| 里程碑 | 时间 | 交付物 |
|---|---|---|
| M1 Spec 评审通过 | 待定 | phase-v1.1-spec.md 状态改为「已通过」 |
| M2 开发完成 | 待定 | T1-T4 代码与文档提交 |
| M3 测试验收通过 | 待定 | 验收报告 acceptance-report-v1.1.md |
| M4 归档 | 待定 | phase-v1.1-spec.md 状态改为「已完成，已归档」 |

---

## 5. 变更控制

- 任何对 v1.1 范围的变更必须走新版本流程（v1.2 或补丁流程）；
- 已归档的 Phase 1-5 文档禁止修改；
- 开发过程中如发现 Spec 缺陷，需暂停开发，升级 Spec 并重新评审。
