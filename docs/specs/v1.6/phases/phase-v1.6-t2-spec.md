# Vuex strict errorHandler 协同

> 版本：v1.6
> 任务编号：T2
> 对应阶段 Spec：[phase-v1.6-spec.md](phase-v1.6-spec.md)
> 对应设计文档：[design-v1.6.md](../design-v1.6.md) §2.2
> 对应执行计划：[execution-plan-v1.6.md](../execution-plan-v1.6.md)
> 依赖任务：无
> 状态：已完成，已归档（冻结，不再修改）

## 1. 任务目标

在 `patchVuex` 阶段注册 Vue `app.config.errorHandler` 协同捕获链路，使 Vuex 4 strict mode 通过 Vue 3 异步 watcher 触发的违规错误能被 shield 捕获并落盘为 `vuex-strict-violation`。对应阶段 Spec G-2。

## 2. 对应需求与验收标准

| 需求编号 | 需求描述 | 本任务验收标准 |
|---|---|---|
| REQ-1.6-4 | Hook Vue `app.config.errorHandler` 协同捕获 strict 违规 | errorHandler 中匹配 Vuex strict 错误消息后关联 store 并 emit `vuex-strict-violation` |
| REQ-1.6-5 | errorHandler 链式调用保障 | 先调用业务 errorHandler 再执行 shield 识别逻辑，不吞错 |
| REQ-1.6-6 | 与 `__shield_emitted__` 去重协同 | strict 违规经 errorHandler 捕获后标记 `__shield_emitted__`，避免重复落盘 |

## 3. 实现步骤

### 3.1 新增 strict store 注册表

- 修改文件：`lib/inject.iife.ts`
- 新增模块级变量：`const strictStoresByApp = typeof WeakRef !== 'undefined' ? new Map<string, WeakRef<Record<string, unknown>>[]>() : null`（浏览器不支持 WeakRef 时降级为 null，findStrictStore 返回 null，errorHandler 仍可 emit）
- 在 `patchVuex` 末尾新增步骤 5：若 `store.strict === true && strictStoresByApp !== null`，注册到 `strictStoresByApp`

### 3.2 新增辅助函数

- `tryEmitVuexStrictViolation(err, appId)`：识别 strict 违规并 emit，返回 boolean
  - `if (!(err instanceof Error)) return false`（前置检查，非 Error 类型直接返回 false）
  - 匹配 `STRICT_MSG = /do not mutate vuex store state outside mutation handlers/i`（与既有 `detectStrictViolation` L867 中的局部正则一致，此处为模块级独立定义，因 tryEmitVuexStrictViolation 运行在 errorHandler 上下文，与 detectStrictViolation 的 commit 包装上下文隔离）
  - `isShieldEmitted` 去重检查：若已标记，返回 `true`（不再 emit，但仍阻止 errorHandler 重复 emit vue-render-error）
  - `findStrictStore` 查找关联 store
  - `buildVuexStrictViolationDetail` 构建 detail（source: `'vuex-strict-errorhandler'`）
- `findStrictStore(appId)`：从注册表查找有效 strict store，清理 GC 回收的 WeakRef
  - 若 `strictStoresByApp === null`（浏览器不支持 WeakRef），返回 null
  - 第一轮：查找 `store.strict === true && store._committing === false` 的 store
  - 第二轮（best-effort）：未命中时返回第一个有效 strict store（设计文档 §2.2.3 设计 D）
- `buildVuexStrictViolationDetail(err, store, appId)`：构建 detail 结构
  - `mutatedKeyPath: 'unknown'`（errorHandler 路径无 mutation 上下文，设计文档 §2.2.3 设计 E）

### 3.3 修改 patchErrorHandler

- 修改位置：`patchErrorHandler` 函数（L491-502）
- 链式调用顺序（REQ-1.6-5）：
  1. 先调用业务 `originalErrorHandler`（既有逻辑，不变；无业务 handler 时调用 `originalConsole.error`）
  2. 在 emit `vue-render-error` 之前调用 `tryEmitVuexStrictViolation`
  3. 若返回 true：return（不再 emit vue-render-error）
  4. 若返回 false：走既有逻辑（emit vue-render-error）

## 4. 测试计划

### 4.1 单元测试

- 非 strict store 不注册到 strictStoresByApp
- WeakRef GC 回收后 findStrictStore 正确清理
- WeakRef 不支持时（mock `typeof WeakRef === 'undefined'`）strictStoresByApp 为 null，findStrictStore 返回 null，tryEmitVuexStrictViolation 仍 emit vuex-strict-violation（detail 中 store 上下文为空）
- 业务 errorHandler 被正确调用（链式调用不吞错，先业务 handler 后 shield 识别）

### 4.2 集成测试 / 端到端测试

- TC-8（T3 恢复）：mutation 外修改 state 触发 strict 违规被正确捕获
- TC-8a1（T3 恢复）：legal mutation 后 strict 违规提供非空 mutatedKeyPath

### 4.2 回归测试

- TC-8b（非 strict store 不产生 vuex-strict-violation）不受影响
- 既有 vue-render-error 采集不受影响

## 5. 风险与依赖

| 风险 / 依赖 | 影响 | 应对措施 |
|---|---|---|
| Vue errorHandler 已被业务覆盖 | 业务 handler 可能吞错 | 先调用业务 handler 再执行 shield 识别（REQ-1.6-5）；业务 handler 抛错不阻断 emit |
| WeakRef 浏览器兼容性 | strict store 注册表在 ES2021 之前浏览器不可用 | `typeof WeakRef !== 'undefined'` 防御性检查；不支持时降级为 null（设计文档 §2.2.3）；errorHandler 仍可 emit vuex-strict-violation（detail 中 store 上下文为空） |
| T1 同文件修改 | inject.iife.ts 合并冲突 | 修改不同函数，按批次顺序执行 |

## 6. 变更范围

- 仅修改 `lib/inject.iife.ts`
- 新增模块级变量 `strictStoresByApp`
- 新增函数：`tryEmitVuexStrictViolation`、`findStrictStore`、`buildVuexStrictViolationDetail`
- 修改函数：`patchErrorHandler`（新增 strict 识别分支）、`patchVuex`（末尾新增 strict 注册）
- 不修改任何函数签名

## 7. 评审记录

> - 第一轮评审（2026-06-23）：不通过，发现 3 个 P1 + 7 个 P2 问题
>   - P1-1：§3.1 遗漏 WeakRef 兼容性降级逻辑
>   - P1-2：§5 风险表遗漏 WeakRef 浏览器兼容性风险
>   - P1-3：§3.3 errorHandler 链式调用顺序表述歧义
>   - P2-1 ~ P2-7：TC-8a1 命名统一、findStrictStore best-effort 兜底、mutatedKeyPath 取值说明、isShieldEmitted 返回值语义、STRICT_MSG 关系说明、测试计划重组、WeakRef 降级测试用例
> - 第二轮重评（2026-06-23）：通过
>   - P1 全部闭环：P1-1（§3.1 WeakRef 降级 + 步骤 5 注册条件）、P1-2（§5 风险表补充 WeakRef 兼容性）、P1-3（§3.3 四步流程明确）
>   - P2 优化项全部处理：7 项均已现场修复
>   - 源代码修改位置引用准确：patchErrorHandler（L491-502）、patchVuex（L931+）、detectStrictViolation（L855-870）均与实际代码一致
>   - 与设计文档 §2.2 对齐验证通过，与阶段 Spec REQ-1.6-4/5/6 验收标准覆盖完整
>   - 无范围变更，无需重新全量评审
>   - 遗留 2 个 P2 文档细节问题（不影响实现，后续修订时一并处理）：
>     - §4 测试计划章节编号重复：L64 与 L69 均为 §4.2，L69 应改为 §4.3
>     - §3.2 L35 STRICT_MSG 作用域描述为「模块级独立定义」，与设计文档 §2.2.3 设计 C（函数级局部变量）不一致，应改为「函数级局部独立定义」
