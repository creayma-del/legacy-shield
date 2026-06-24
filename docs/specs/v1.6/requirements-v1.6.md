# legacy-shield v1.6 需求文档

> 版本：v1.6
> 对应会议纪要：[meetings/requirements-alignment-v1.6-20260623.md](meetings/requirements-alignment-v1.6-20260623.md)
> 对应需求分解文档：[requirements-decomposition-v1.6.md](requirements-decomposition-v1.6.md)（待生成）
> 状态：已完成，已归档（冻结，不再修改）
> 编制日期：2026-06-23
> 批准日期：2026-06-23

---

## 1. 需求背景

legacy-shield v1.4 实现了 Pinia 2.x / Vuex 4 的零侵入错误采集，v1.5 实现了基于 AST 静态分析的项目知识图谱生成。两个版本在验收时均透明披露了已知限制并归档冻结：

### 1.1 v1.4 遗留限制（R-1 / R-2）

- **R-1（TC-3）**：Pinia 2.x 的 `pinia.use(plugin)` 仅将 plugin push 至内部 `_p` 数组，plugin install 在 store 首次实例化时才被遍历调用。当前 `pinia.use` 包装层无法捕获该异步路径异常，`pinia-plugin-error` 子类型主链路覆盖率受限，仅能通过 Vue errorHandler 兜底捕获。
- **R-2（TC-8 / TC-8a）**：Vuex 4 strict mode 通过 Vue 3 异步 watcher 触发，commit 同步 try/catch 无法捕获。当前 `detectStrictViolation` 主路径在 commit 失败时识别仍正确（基于 `_committing === false`），但实际触发路径需依赖 watcher，`vuex-strict-violation` 子类型在「mutation 外直接修改 state」场景下需 Vue errorHandler 协同捕获。

v1.4 验收报告已记录修复方案：
- R-1："后续小版本计划通过遍历 `pinia._p` 数组 + 包装每个 plugin function 增强主链路"
- R-2："后续小版本计划通过在 patchVuex 阶段订阅 store 的 `$watch` 或 hook errorHandler 协同补强"

### 1.2 v1.5 遗留限制（webpack/vite alias）

v1.5 知识图谱的模块路径解析器仅支持 tsconfig/jsconfig paths alias，明确不支持 webpack `resolve.alias` 与 vite `resolve.alias` 配置解析，理由为"引入复杂度高"。这导致使用 webpack/vite alias（而非 tsconfig paths）的项目，其 `@/`、`~/` 等别名无法被知识图谱正确解析，依赖图中出现大量 unresolved 边。

### 1.3 v1.6 目标

v1.6 作为 MINOR 版本，目标为：**闭环 v1.4 遗留的 2 个 it.skip 测试用例（Pinia plugin install 异常 + Vuex strict 违规），并扩展知识图谱模块路径解析器以支持 webpack/vite resolve.alias 配置解析，消除 v1.4 / v1.5 的已知限制。**

---

## 2. 需求条目

### 2.1 Pinia plugin install 异常捕获（R-1 修复）

| 需求编号 | 需求描述 | 优先级 | 验收要点 |
|---|---|---|---|
| REQ-1.6-1 | 遍历 `pinia._p` 内部数组，逐个包装 plugin function 为 try/catch | P0 | patchPinia 中访问 `pinia._p`，对每个 plugin function 包裹 try/catch；install 抛错时 emit `pinia-plugin-error`，含 appId、pluginName（若可推断） |
| REQ-1.6-2 | `_p` 数组访问的防御性处理 | P0 | `_p` 不存在或非数组时静默跳过；单个 plugin 包装失败不影响其他 plugin；与现有 `pinia.use` 包装层去重协同 |
| REQ-1.6-3 | 恢复 TC-3 为活跃测试用例 | P0 | 取消 `tests/pinia-monitor.test.ts` 中 TC-3 的 `it.skip`，验证 plugin install 抛错被正确捕获并落盘为 `pinia-plugin-error` |

### 2.2 Vuex 4 strict 违规捕获（R-2 修复）

| 需求编号 | 需求描述 | 优先级 | 验收要点 |
|---|---|---|---|
| REQ-1.6-4 | Hook Vue `app.config.errorHandler` 协同捕获 strict 违规 | P0 | 在 patchVuex 阶段注册 errorHandler 链路；匹配 Vuex strict 错误消息（`/do not mutate vuex store state outside mutation handlers/i`）后关联 store 并 emit `vuex-strict-violation` |
| REQ-1.6-5 | errorHandler 链式调用保障 | P0 | 若业务系统已设置 `app.config.errorHandler`，shield 包装层需先调用业务 errorHandler 再执行 shield 识别逻辑，不吞错 |
| REQ-1.6-6 | 与现有 `__shield_emitted__` 去重机制协同 | P0 | strict 违规经 errorHandler 捕获后，标记 `__shield_emitted__`，避免与 commit 包装层 / Vue render error 通道重复落盘 |
| REQ-1.6-7 | 恢复 TC-8 / TC-8a 为活跃测试用例 | P0 | 取消 `tests/vuex-monitor.test.ts` 中 TC-8 / TC-8a 的 `it.skip`，验证 mutation 外修改 state 触发 strict 违规被正确捕获并落盘为 `vuex-strict-violation` |

### 2.3 webpack/vite resolve.alias 解析支持

| 需求编号 | 需求描述 | 优先级 | 验收要点 |
|---|---|---|---|
| REQ-1.6-8 | 支持 vite.config.ts resolve.alias 解析 | P0 | 读取项目根目录 `vite.config.ts`（或 `.js`），解析 `resolve.alias` 配置；支持对象格式 `{ '@': '/src' }` 与数组格式 `[{ find: '@', replacement: '/src' }]` |
| REQ-1.6-9 | 支持 webpack.config.js resolve.alias 解析 | P0 | 读取项目根目录 `webpack.config.js`（或 `.ts`），解析 `resolve.alias` 配置；支持对象格式 `{ '@': path.resolve(__dirname, 'src') }` |
| REQ-1.6-10 | 使用 jiti 加载 JS/TS 配置文件 | P0 | 复用项目已有 `jiti`（devDependencies）作为运行时配置加载器；处理 ESM/CJS 互操作；加载失败时静默降级为无 alias |
| REQ-1.6-11 | 自动检测配置文件，无需新增 CLI 参数 | P0 | resolver 自动检测 webpack.config.{js,ts} / vite.config.{ts,js}，与 v1.5 tsconfig 自动检测一致，保持零配置体验 |
| REQ-1.6-12 | alias 解析优先级：tsconfig paths > vite alias > webpack alias | P0 | 当多个 alias 来源同时存在时，按优先级合并；高优先级来源的 alias 不被低优先级覆盖 |
| REQ-1.6-13 | 仅支持静态 alias 配置 | P1 | 不支持 webpack-chain / webpack-merge / 函数式 alias / 正则 alias 等动态配置；与 v1.5「不支持动态计算路径」原则一致 |
| REQ-1.6-14 | 配置文件解析性能约束 | P1 | 单次配置文件解析耗时 < 500ms；配置解析仅执行一次，不进入并发扫描阶段 |
| REQ-1.6-15 | alias 路径解析为基于项目根目录的绝对路径 | P0 | webpack alias 中的 `path.resolve(__dirname, 'src')` 需正确解析为项目根目录下的绝对路径 |

### 2.4 回归与文档

| 需求编号 | 需求描述 | 优先级 | 验收要点 |
|---|---|---|---|
| REQ-1.6-16 | 保持 v1.1 ~ v1.5 已有能力零回归 | P0 | 现有 vue-render-error / vue-warn / vue-router-error / pinia-error / vuex-error / 知识图谱 tsconfig paths 解析等行为不变；全量测试通过 |
| REQ-1.6-17 | 文档同步更新 README、api.md | P1 | README 知识图谱章节移除「不支持 webpack/vite resolve.alias」说明；补充 v1.6 新增能力说明 |
| REQ-1.6-18 | 新增测试夹具覆盖 webpack/vite alias 场景 | P0 | 在 `tests/knowledge-graph/fixtures/` 下新增 webpack-alias-project / vite-alias-project 夹具，验证端到端解析正确性 |

---

## 3. 验收标准

1. `tests/pinia-monitor.test.ts` 中 TC-3 取消 `it.skip` 后测试通过，Pinia plugin install 抛错被正确捕获并落盘为 `pinia-plugin-error`。
2. `tests/vuex-monitor.test.ts` 中 TC-8 / TC-8a 取消 `it.skip` 后测试通过，Vuex 4 strict 违规经 Vue errorHandler 协同捕获并落盘为 `vuex-strict-violation`。
3. 知识图谱 `graph` 子命令对使用 webpack alias 的项目可正确解析 `@/`、`~/` 等别名，依赖图中无因 alias 未解析导致的 unresolved 边。
4. 知识图谱 `graph` 子命令对使用 vite alias 的项目可正确解析对象格式与数组格式 alias。
5. alias 解析优先级正确：tsconfig paths > vite alias > webpack alias，高优先级不被低优先级覆盖。
6. 配置文件解析耗时 < 500ms，不影响 v1.5 既有性能基线（5000 文件全量 < 30s）。
7. `pnpm typecheck`、`pnpm build`、`pnpm test` 全量通过，v1.1 ~ v1.5 已有能力零回归。
8. README、api.md 文档与代码行为一致。

---

## 4. 成功指标

- v1.4 遗留的 3 个 `it.skip` 测试用例（TC-3 / TC-8 / TC-8a）全部恢复为活跃用例并通过，遗留问题表 R-1 / R-2 闭环。
- v1.5 遗留的 webpack/vite alias 不支持限制消除，知识图谱对使用 webpack/vite 构建工具的项目可正确解析 alias。
- v1.1 ~ v1.5 已交付能力无回归。

---

## 5. 不在范围内

以下事项已在需求澄清中明确排除，v1.6 不予实现：

- webpack-chain / webpack-merge / 函数式 alias / 正则 alias 等动态配置解析。
- Vue 2 + Vuex 3 的支持（项目整体不支持 Vue 2）。
- Pinia / Vuex devtools 协议对接。
- 新增 CLI 参数控制 alias 来源（自动检测，不引入新参数）。
- webpack `resolve.modules` / `resolve.extensions` 配置解析（仅支持 `resolve.alias`）。
- vite `resolve.dedupe` / `resolve.conditions` 等其他 resolve 配置项（仅支持 `resolve.alias`）。
- Proxy 包装 Vuex state 精确定位被修改字段路径（v1.4 已排除，v1.6 不实现）。
- 知识图谱对 webpack/vite 构建配置的其他字段解析（如 `resolve.plugins`、`resolve.fallback` 等）。

---

## 6. 批准记录

- 用户 / 产品负责人：creayma，2026-06-23，已批准
- 项目负责人：creayma，2026-06-23，已批准
