# 恢复 it.skip 测试用例

> 版本：v1.6
> 任务编号：T3
> 对应阶段 Spec：[phase-v1.6-spec.md](phase-v1.6-spec.md)
> 对应设计文档：[design-v1.6.md](../design-v1.6.md) §2.1, §2.2, §2.7
> 对应执行计划：[execution-plan-v1.6.md](../execution-plan-v1.6.md)
> 依赖任务：T1, T2
> 状态：已完成，已归档（冻结，不再修改）

## 1. 任务目标

取消 TC-3 / TC-8 / TC-8a1 的 `it.skip`，恢复为活跃测试用例，验证 v1.6 补强的捕获链路（T1 Pinia _p 包装 + T2 Vuex strict errorHandler 协同）正确工作。对应阶段 Spec G-1, G-2。

## 2. 对应需求与验收标准

| 需求编号 | 需求描述 | 本任务验收标准 |
|---|---|---|
| REQ-1.6-3 | 恢复 TC-3 为活跃测试用例 | TC-3 取消 `it.skip` 后测试通过 |
| REQ-1.6-7 | 恢复 TC-8 / TC-8a1 为活跃测试用例 | TC-8 / TC-8a1 取消 `it.skip` 后测试通过 |

## 3. 实现步骤

### 3.1 恢复 TC-3

- 修改文件：`tests/pinia-monitor.test.ts`
- 修改位置：L196 `it.skip('TC-3: ...')` → `it('TC-3: ...')`
- 更新注释：移除 `it.skip` 标题中「待 inject.iife 在 T7 补强插件 install 捕获链路」说明，更新为「v1.6 已通过 _p 数组包装补强」
- 更新注释块：同步更新 `it.skip` 上方注释块中 T7 引用（L190-195），更新为 v1.6 已补强说明

### 3.2 恢复 TC-8 / TC-8a1

- 修改文件：`tests/vuex-monitor.test.ts`
- 修改位置：L210 `it.skip('TC-8: ...')` → `it('TC-8: ...')`
- 修改位置：L221 `it.skip('TC-8a1: ... - skipped (依赖 TC-8 通路)')` → `it('TC-8a1: ...')`（移除 `skipped (依赖 TC-8 通路)` 标记）
- 更新注释：移除 `it.skip` 标题中「待 T7 errorHandler 协同识别」说明，更新为「v1.6 已通过 errorHandler 协同补强」
- 更新注释块：同步更新 `it.skip` 上方注释块中 T7 引用（L205-208），更新为 v1.6 已补强说明

### 3.3 验证测试夹具

- 确认 `tests/fixtures/vue3/vue-pinia-plugin-error.html` 存在且正确
- 确认 `tests/fixtures/vue3/vue-vuex-strict.html` 存在且正确
- 确认测试夹具中的触发按钮（`#trigger-strict`、`#trigger-strict-after-mutation`）正常工作
- 确认 TC-3 夹具验证点：`badPlugin` 函数定义存在、`pinia.use(badPlugin)` 调用存在、`createPinia()` 与 `app.use(pinia)` 链路完整

## 4. 测试计划

### 4.1 集成测试 / 端到端测试

- TC-3：plugin install 抛错被正确捕获并落盘为 `pinia-plugin-error`
- TC-8：mutation 外修改 state 触发 strict 违规被正确捕获并落盘为 `vuex-strict-violation`
- TC-8a1：legal mutation 后 strict 违规提供非空 `mutatedKeyPath`（期望值 `'unknown'`，errorHandler 路径无 mutation 上下文，详见设计文档 §2.2.3 设计 E）

### 4.2 回归测试

- TC-1 / TC-2（Pinia action 错误）不受影响
- TC-4 ~ TC-7（Vuex action/mutation 错误）不受影响
- TC-8b（非 strict store 不产生 strict 违规）不受影响

### 4.3 测试执行命令

- 执行 `pnpm test` 验证 TC-3/TC-8/TC-8a1 通过且无回归

## 5. 风险与依赖

| 风险 / 依赖 | 影响 | 应对措施 |
|---|---|---|
| 依赖 T1 | T1 未完成时 TC-3 无法通过 | 等待 T1 评审通过后执行（T1 已通过） |
| 依赖 T2 | T2 未完成时 TC-8 / TC-8a1 无法通过 | 等待 T2 评审通过后执行（T2 已通过） |
| 测试夹具缺失 | fixture HTML 文件可能不存在 | 开发时检查并补充缺失夹具（夹具位于 `tests/fixtures/vue3/`） |
| 阶段 Spec P2-5 遗留项 | 阶段 Spec 评审遗留 P2-5 需在 T3 阶段确认 | T3 阶段已确认：P2-5 涉及 T3 测试恢复的验证要求，已在 T3 Spec §3/§4 中完整覆盖（TC-3/TC-8/TC-8a1 恢复、测试夹具验证、回归测试、测试执行命令） |

## 6. 变更范围

- 仅修改测试文件：`tests/pinia-monitor.test.ts`、`tests/vuex-monitor.test.ts`
- 不修改任何源代码
- 测试夹具 HTML 文件已存在（`tests/fixtures/vue3/`），无需新增

## 7. 评审记录

> - 第一轮评审（2026-06-23）：不通过，发现 4 个 P1 + 7 个 P2 问题
>   - P1-1：文件头「对应设计文档」引用遗漏 §2.7（T3 自身设计章节）
>   - P1-2：测试夹具路径错误（tests/fixtures/ → tests/fixtures/vue3/）
>   - P1-3：TC-8a1 命名不一致（§2、§3.2、§4.1 混用 TC-8a）
>   - P1-4：阶段 Spec P2-5 遗留项未在 T3 Spec 中体现
>   - P2-1 ~ P2-7：注释块更新范围、TC-8a1 标题文本说明、测试分类命名、TC-3 触发机制验证点、TC-8a1 mutatedKeyPath 期望值说明、测试执行命令、T1 Spec 状态更新
> - 第二轮重评（2026-06-23）：通过
>   - P1-1 已闭环：文件头引用已改为 §2.1, §2.2, §2.7（L6）
>   - P1-2 已闭环：夹具路径已修正为 tests/fixtures/vue3/vue-pinia-plugin-error.html 和 tests/fixtures/vue3/vue-vuex-strict.html（L41-42），与实际文件位置一致
>   - P1-3 已闭环：全文 TC-8a 已统一为 TC-8a1（L13、L20、L31-37、L50-52）
>   - P1-4 已闭环：§5 风险与依赖表已补充「阶段 Spec P2-5 遗留项」风险项（L71），说明 T3 阶段已确认处理
>   - P2-1 已处理：§3.1（L29）、§3.2（L37）补充注释块更新说明（L190-195、L205-208）
>   - P2-2 已处理：§3.2（L35）补充移除 skipped (依赖 TC-8 通路) 标记说明
>   - P2-3 已处理：§4.1 标题已改为「集成测试 / 端到端测试」（L48）
>   - P2-4 已处理：§3.3（L44）补充 badPlugin 函数定义、pinia.use(badPlugin) 调用、createPinia() 与 app.use(pinia) 链路完整验证点
>   - P2-5 已处理：§4.1（L52）补充 mutatedKeyPath 期望值 'unknown' 说明，引用设计文档 §2.2.3 设计 E
>   - P2-6 已处理：§4.3（L62）补充 pnpm test 执行命令
>   - P2-7 已处理：T1/T2 状态已标注「已通过」（L68-69）
>   - 交叉验证：设计文档 §2.1/§2.2/§2.7 实现步骤与 T3 Spec 一致；阶段 Spec REQ-1.6-3/REQ-1.6-7 验收标准已覆盖；源代码行号（pinia-monitor.test.ts L196、vuex-monitor.test.ts L210/L221）准确；测试夹具路径与实际文件位置一致；夹具内 badPlugin、#trigger-strict、#trigger-strict-after-mutation 验证点均存在
>   - 范围检查：未引入新的范围变更，与阶段 Spec §5.1 涉及文件清单一致
>
> **PATCH-T2 同步说明（2026-06-23）**：T2 实现策略从「errorHandler 协同」调整为「直接 watcher」后，本 Spec §4.1 中 TC-8a1 的 `mutatedKeyPath` 期望值已更新：
> - 原期望值：`'unknown'`（errorHandler 路径无 mutation 上下文）
> - 新期望值：`'user/setProfile'`（来自 `ctx.lastMutation.type`，直接 watcher 路径可获取 mutation 上下文）
> - 测试断言不变：仅检查 `typeof === 'string'` 和 `length > 0`，不检查具体值
> - 策略描述更新：§1 中「T2 Vuex strict errorHandler 协同」已被 PATCH-T2 取代为「T2 Vuex strict 直接 watcher」
