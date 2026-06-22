# legacy-shield v1.1 任务 Spec：T4 更新用户文档

> 版本：v1.1
> 对应阶段 Spec：[phase-v1.1-spec.md](./phase-v1.1-spec.md)
> 对应执行计划：[execution-plan-v1.1.md](../execution-plan-v1.1.md)
> 状态：已通过，可进入代码开发

---

## 1. 目标

更新用户文档，明确说明 legacy-shield v1.1 对 Vue 3 生态的监控能力边界：

- 支持 Vue 3 运行时错误、运行时警告、Vue Router 4 错误；
- 不支持 Vue 2；
- 不支持 Pinia/Vuex 单独 patch、Vue 编译时错误。

---

## 2. 范围

**包含**：

- `README.md` 中 `shield` 子命令说明与「支持的框架」小节更新；
- `docs/usage.md` 中 `shield` 工作流程与监控范围更新；
- `docs/api.md` 中 `/errors/top` 端点示例检查（如有必要则更新）。

**不包含**：

- 代码实现；
- `docs/custom-rules.md`（本次无 Vue 相关规则新增）。

---

## 3. 依赖

- T1、T2 实现已完成，最终行为已确定；
- 建议参考 T3 稳定用例作为文档示例（T4 开发可在 T3 完成前启动，但需在其后复核）。

---

## 4. 文档变更

### 4.1 `README.md`

#### 4.1.1 在「注意事项」前新增「支持的框架」小节

位置：在「注意事项」之前、文档索引之前。

内容：

```markdown
## 支持的框架

### Vue 3

`shield` 会自动检测页面中的 Vue 3 运行时，并采集以下错误：

- 组件渲染错误（`vue-render-error`）
- 运行时警告（`vue-warn`），如 prop 类型不匹配、响应式 API 误用等
- Vue Router 4 导航错误（`vue-router-error`），包括 `router.onError`、导航守卫抛错、路由懒加载组件失败

动态创建的 Vue 3 app（页面运行期间通过 `createApp()` 创建）也会被自动监控。

### 不支持的框架

- **Vue 2**：v1.1 明确不扩展 Vue 2 支持。
- **编译时错误**：Vue 模板/单文件组件编译阶段错误不在运行时监控范畴。
- **Pinia / Vuex**：状态管理错误由 Vue errorHandler 与 `unhandledrejection` 兜底，不做单独 patch。
```

### 4.2 `docs/usage.md`

#### 4.2.1 在「shield 命令详解」工作流程中补充

在工作流程第 4 步后补充：

```markdown
4. 注入 `inject.iife.js` 监控脚本，采集 `window.onerror`、console 输出、网络请求、点击等行为；
   若页面使用 Vue 3，还会自动 patch `app.config.errorHandler`、`app.config.warnHandler` 与 Vue Router 4，
   采集 Vue 运行时错误、警告与路由错误。
```

#### 4.2.2 在「shield 命令详解」常用参数后新增「Vue 3 监控」小节

```markdown
### Vue 3 监控

当目标页面使用 Vue 3 时，`shield` 会自动拦截 `Vue.createApp`，无需额外配置。

采集范围：

- `vue-render-error`：组件渲染、生命周期、watcher、指令、异步组件抛错；
- `vue-warn`：prop 类型不匹配、响应式 API 误用、已废弃 API 调用等运行时警告；
- `vue-router-error`：`router.onError`、导航守卫抛错、路由懒加载组件失败。

页面运行期间通过 `createApp()` 动态创建的 Vue 3 app 同样会被自动监控。

不支持 Vue 2。若页面同时使用 Vue 2 与 Vue 3，仅 Vue 3 部分会被监控。
```

### 4.3 `docs/api.md`

修改 `/errors/top` 端点响应示例的注释：补充说明 `subType` 字段除 `js-error` 外，还可能为 `vue-render-error`、`vue-router-error`、`promise-rejection`、`react-render-error` 等。同时检查 `/suggest` 端点示例中的「错误类型：js-error」说明，若存在则更新为「错误类型：js-error 等」。

示例修改：

```markdown
<!-- 在 /errors/top 响应示例的 subType 字段旁添加 -->
`subType` 还可能为 `vue-render-error`、`vue-router-error`、`promise-rejection`、`react-render-error` 等。
```

---

## 5. 实现步骤

1. 打开 `README.md`，新增「支持的框架」小节；
2. 打开 `docs/usage.md`，更新 `shield` 工作流程与新增「Vue 3 监控」小节；
3. 打开 `docs/api.md`，检查 `/errors/top` 示例；
4. 使用 Markdown 链接检查工具或手动点击验证内部链接有效；
5. 通读修改后的文档，确保无错别字、无范围蔓延描述。

---

## 6. 验收标准

- [ ] `README.md` 明确说明支持 Vue 3 运行时错误、警告、Vue Router 4 错误；
- [ ] `README.md` 明确说明不支持 Vue 2；
- [ ] `docs/usage.md` 的 `shield` 说明中包含 Vue 3 监控范围；
- [ ] `docs/api.md` 的 `/errors/top` 示例与实际返回的子类型一致；
- [ ] `docs/api.md` 的 `/suggest` 示例中错误类型说明已更新为包含 `vue-render-error`、`vue-router-error` 等新子类型；
- [ ] 文档中无错别字；
- [ ] 文档内部链接有效；
- [ ] 文档描述与 T1/T2 实现一致。

---

## 7. 风险与应对

| 风险 | 影响 | 应对措施 |
|---|---|---|
| 文档描述与实现不一致 | 用户误解 | 文档更新在 T1/T2 完成后进行，验收时由 T5 复核 |
| 参数表新增不存在的 CLI 开关 | 文档错误 | 仅当实现引入该开关时才写入参数表；否则仅在说明性文字中描述 |
| 内部链接失效 | 体验下降 | 手动验证或运行 Markdown 链接检查 |

---

## 8. 评审记录

| 轮次 | 时间 | 结论 | 主要问题 | 修订内容 |
|---|---|---|---|---|
| 1 | - | 待评审 | - | - |
| 最终 | 2026-06-18 | 通过 | 无 P0/P1；P2 文档对称性与依赖表述 | 1. 状态改为「已通过，可进入代码开发」；<br>2. `docs/usage.md` 增加动态 app 监控说明；<br>3. 验收标准补充 `/suggest` 文档检查；<br>4. 依赖表述与执行计划对齐 |
