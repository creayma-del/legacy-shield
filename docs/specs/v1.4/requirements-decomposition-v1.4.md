# legacy-shield v1.4 需求分解文档

> 版本：v1.4
> 对应需求文档：[requirements-v1.4.md](requirements-v1.4.md)
> 对应会议纪要：[meetings/requirements-alignment-v1.4-20260622.md](meetings/requirements-alignment-v1.4-20260622.md)
> 状态：已批准
> 编制日期：2026-06-22
> 批准日期：2026-06-22

---

## 1. 功能分解

| 功能点编号 | 名称 | 描述 | 对应需求 | 验收标准 | 优先级 |
|---|---|---|---|---|---|
| F-1 | Pinia 自动 patch 与 action 错误采集 | 在 inject.iife.ts 中识别 Pinia 实例，注入 `$onAction` 钩子；同步/异步 action 抛错均落盘为 `pinia-error` | REQ-1.4-1、REQ-1.4-3 | shield 启动后 Pinia 项目自动捕获 action 错误；store id / action / args / stack 字段齐全 | P0 |
| F-2 | Vuex 自动 patch 与 action/mutation 错误采集 | 拦截 `app.use(store)`，对 store 包装 dispatch/commit；订阅 subscribe / subscribeAction onError | REQ-1.4-2、REQ-1.4-4 | shield 启动后 Vuex 4 项目自动捕获 action / mutation 错误；module / type / payload / stack 字段齐全 | P0 |
| F-3 | Vuex strict mode 违规识别 | 通过 store.subscribe 与 Vue config.errorHandler 协同识别 mutation 外修改 state 抛出的 strict 错误，结构化输出 | REQ-1.4-5 | 不依赖 console 文本解析；可输出 module path、修改 key 路径与 stack | P1 |
| F-4 | Pinia 插件错误采集 | 包装 `pinia.use(plugin)` 调用，捕获 plugin install / extend 阶段抛错 | REQ-1.4-6 | 输出 `pinia-plugin-error`，包含 plugin 名称（若可推断）与 stack | P1 |
| F-5 | 错误上下文结构化与脱敏 | 抽取 store 上下文构造工具：store id、action / mutation、payload（redactBody）、state 摘要（keys + 体积，64KB 截断） | REQ-1.4-7、REQ-1.4-8 | detail 字段与设计文档定义一致；payload / state 不泄漏敏感字段 | P0 |
| F-6 | 多通道去重 | 复用 `__shield_emitted__` 标记机制；analyzer 层支持新增子类型按 errorId + 1 秒窗口去重 | REQ-1.4-9 | 同一 store 错误仅落盘一次，不与 vue-render-error / promise-rejection 重复 | P0 |
| F-7 | 类型、analyzer、reporter、api 适配 | 在 types.ts、analyzer.ts、reporter.ts、api.ts 中加入新子类型支持 | REQ-1.4-11 | `/logs?type=runtime`、`/errors/top`、report MD/JSON 均可识别并展示新子类型 | P0 |
| F-8 | 测试与文档 | 新增 fixtures（pinia / vuex 错误场景）、单测、集成测试；更新 README、api.md | REQ-1.4-11、REQ-1.4-12 | 测试矩阵覆盖正反场景；文档与代码一致；全量测试通过 | P1 |

---

## 2. 任务依赖关系

| 任务 | 依赖 | 可并行任务 |
|---|---|---|
| T1：types / 子类型 / 工具函数（脱敏 + 上下文构造） | 无 | — |
| T2：Pinia patch 与 action / 插件错误采集 | T1 | T3 |
| T3：Vuex patch 与 action / mutation / subscribe 错误采集 | T1 | T2 |
| T4：Vuex strict mode 违规识别 | T3 | — |
| T5：analyzer / reporter / api 适配新子类型与去重 | T2、T3、T4 | — |
| T6：测试夹具、单测、集成测试 | T5 | — |
| T7：文档更新与验收报告 | T6 | — |

---

## 3. 资源分配估算

| 任务 | 工作量 | 角色 | 外部资源 |
|---|---|---|---|
| T1 types / 工具函数 | 低 | 开发专家 / SOLO Coder | 无 |
| T2 Pinia patch | 中 | 开发专家 | Pinia 2.x（devDependency 或本地 fixture vendor） |
| T3 Vuex patch | 中 | 开发专家 | Vuex 4（devDependency 或本地 fixture vendor） |
| T4 Vuex strict 违规识别 | 中 | 开发专家 | 无 |
| T5 analyzer / reporter / api 适配 | 低 | 开发专家 | 无 |
| T6 测试 | 中 | 开发专家 | Playwright（已有） |
| T7 文档与验收 | 低 | SOLO Coder | 无 |

> 注：Pinia 与 Vuex 仅作为测试 fixture 引入，不作为运行时依赖；inject.iife.ts 中通过 duck typing 检测，不静态 import。

---

## 4. 时间线里程碑

| 里程碑 | 预计日期 | 说明 |
|---|---|---|
| 需求对齐完成 | 2026-06-22 | 会议纪要已双方确认 |
| 需求分解文档批准 | 2026-06-22 | 项目负责人批准 |
| 设计文档评审通过 | 待定 | 完成 design-v1.4.md 并评审通过 |
| 执行计划与阶段 Spec 评审通过 | 待定 | 完成 execution-plan-v1.4.md 与 phase-v1.4-spec.md |
| 代码开发完成 | 待定 | T1-T6 完成 |
| 测试验收通过 | 待定 | T7 完成，验收报告生成 |
| 归档关闭 | 待定 | phase-v1.4-spec.md 状态改为「已完成，已归档」 |

---

## 5. 风险与假设

| 风险 / 假设 | 说明 | 应对措施 |
|---|---|---|
| Pinia / Vuex 注入时机错过 | 业务通过非 `app.use` 路径（如手动 `setActivePinia`）注入 | 在 design 中加入 `createPinia` / `setActivePinia` / `Vuex.createStore` 关键 API 的兜底拦截 |
| 业务 try/catch 吞错 | 错误被业务自行捕获，inject 无法获知 | 与现有兜底机制一致，仅采集冒泡或可监听的错误，文档中明确说明 |
| state 快照泄漏敏感数据 | state 中可能包含 token / 用户隐私 | 强制仅记录 keys + 序列化体积，不记录值；64KB 截断；payload 复用 redactBody |
| 多通道重复上报 | store 抛错可能同时触发 errorHandler / unhandledrejection / patch 三通道 | 复用 `__shield_emitted__` 标记 + analyzer 1 秒窗口去重 |
| Pinia / Vuex 版本碎片 | Pinia 1.x / Vuex 3 API 差异 | v1.4 明确仅支持 Pinia 2.x 与 Vuex 4；不支持版本 patch 静默跳过 |

---

## 6. 批准记录

- 项目负责人：creayma，2026-06-22，已批准
