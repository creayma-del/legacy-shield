# legacy-shield 需求分解文档（v1.1）

> 文档版本：v1.1
> 对应项目总规范：project-rules.md
> 对应设计文档：design-v1.1.md
> 对应执行计划：execution-plan-v1.1.md
> 对应阶段 Spec：phases/phase-v1.1-spec.md
> 状态：已通过
> 创建时间：2026-06-18

---

## 1. 版本背景与目标

### 1.1 背景

legacy-shield v1.0 已实现 MVP，可通过 `shield` 子命令对老项目进行运行时监控。当前对 Vue 3 生态的错误采集仅覆盖了 `app.config.errorHandler`，存在以下缺口：

- 未采集 Vue 3 运行时警告（`app.config.warnHandler`）；
- 未自动补丁页面运行期间动态创建的 Vue 3 app；
- 未采集 Vue Router 4 导航错误与守卫异常；
- 不支持 Vue 2（本版本明确不扩展）。

### 1.2 目标

在 v1.1 版本中，将 Vue 3 运行时监控能力补齐，实现对 **Vue 3 运行时错误、警告、路由错误** 的全面采集，并支持 **动态创建的 app** 自动接入监控。

**不在范围内**：

- Vue 2 支持；
- Pinia / Vuex 状态管理错误（已由 Vue errorHandler 与 `unhandledrejection` 兜底）；
- Vue 编译时错误（不在运行时监控范畴）。

---

## 2. 需求分解

### 2.1 运行时错误完整采集（REQ-V1.1-001）

**优先级**：P0

**需求描述**：

在 v1.0 基础上，增强 Vue 3 运行时错误采集：

- 覆盖页面初始加载时已存在的 Vue 3 app；
- 覆盖页面运行期间通过 `createApp()` 动态创建的 Vue 3 app；
- 对 `app.config.errorHandler` 打补丁，采集组件渲染、生命周期、watcher、指令、异步组件等抛出的错误。

**日志字段要求**：

沿用 v1.0 `RuntimeLog` 结构，`subType` 为 `vue-render-error`，并在 `context` 中补充：

```json
{
  "info": "Vue 内部错误信息字符串，如 'render function'",
  "componentName": "组件名",
  "appId": "可选，用于区分多个 app"
}
```

**验收标准**：

- [ ] 初始 app 的错误被采集；
- [ ] 动态创建的 app 的错误在创建后立即被采集（通过 createApp 拦截）；
- [ ] 日志写入 `<legacy>/.runtime-log-ignore/runtime/YYYY-MM-DD.jsonl`。

---

### 2.2 运行时警告采集（REQ-V1.1-002）

**优先级**：P1

**需求描述**：

通过 `app.config.warnHandler` 采集 Vue 3 运行时警告，包括 prop 类型不匹配、响应式 API 误用、已废弃 API 调用等。

**日志字段要求**：

```json
{
  "type": "runtime",
  "subType": "vue-warn",
  "level": "warn",
  "message": "警告消息",
  "stack": "可选的调用栈",
  "context": {
    "trace": "Vue 警告追踪信息"
  }
}
```

**验收标准**：

- [ ] Vue 3 运行时警告被采集；
- [ ] 警告不影响页面默认控制台输出；
- [ ] 日志写入 `runtime` 目录。

---

### 2.3 Vue Router 4 错误采集（REQ-V1.1-003）

**优先级**：P1

**需求描述**：

采集 Vue Router 4 导航过程中的错误，包括：

- `router.onError` 注册的异步错误；
- 导航守卫（`beforeEach` / `beforeResolve` / `afterEach`）中抛出的同步或异步错误；
- 路由懒加载组件失败。

**日志字段要求**：

```json
{
  "type": "runtime",
  "subType": "vue-router-error",
  "level": "error",
  "message": "错误消息",
  "stack": "堆栈信息",
  "context": {
    "to": "目标路由",
    "from": "来源路由"
  }
}
```

**验收标准**：

- [ ] `router.onError` 错误被采集；
- [ ] 守卫抛错被采集；
- [ ] 路由懒加载组件失败被采集；

---

### 2.4 日志分析与报告兼容（REQ-V1.1-004）

**优先级**：P1

**需求描述**：

新增的错误/警告子类型需在 `report` 命令和 `/errors/top` API 中正常聚合与展示，不影响现有分析逻辑。

**验收标准**：

- [ ] `vue-warn` 被计入运行时警告数；
- [ ] `vue-router-error` 被计入运行时错误数；
- [ ] `/errors/top` 能按 `errorId` 正确聚合新的子类型。

---

### 2.5 文档更新（REQ-V1.1-005）

**优先级**：P2

**需求描述**：

更新用户文档，说明 Vue 3 监控能力范围。

**涉及文档**：

- `README.md`
- `docs/usage.md`

> 注：`docs/custom-rules.md` 本次不涉及 Vue 相关规则新增，无需更新。

**验收标准**：

- [ ] 文档中明确说明支持 Vue 3 运行时错误、警告、Vue Router 错误；
- [ ] 文档中明确说明不支持 Vue 2。

---

## 3. 非功能性需求

| 编号 | 需求 | 说明 |
|---|---|---|
| NFR-V1.1-001 | 零侵入 | 仍不修改老项目源码，通过注入脚本实现 |
| NFR-V1.1-002 | 兼容性 | 不影响无 Vue 项目的正常运行 |
| NFR-V1.1-003 | 性能 | 补丁逻辑不阻塞页面主线程，注入脚本额外开销 < 1ms/事件 |
| NFR-V1.1-004 | 稳定性 | 补丁失败不导致页面功能异常 |

---

## 4. 验收总则

v1.1 验收需满足：

1. 所有 P0/P1 需求已实现并通过测试；
2. `pnpm typecheck`、`pnpm build`、`pnpm test` 全量通过；
3. 新增文档与实现一致；
4. 无回归问题（v1.0 功能不受影响）。
