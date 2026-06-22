# T3：Vuex patch 与 action / mutation / subscribe 错误采集

> 版本：v1.4
> 任务编号：T3
> 对应阶段 Spec：[phase-v1.4-spec.md](phase-v1.4-spec.md)
> 对应设计文档：[design-v1.4.md](../design-v1.4.md)
> 对应执行计划：[execution-plan-v1.4.md](../execution-plan-v1.4.md)
> 依赖任务：T2
> 状态：已通过
> 评审记录：见本文档末尾（轮次 1 不通过、轮次 2 通过）

---

## 1. 任务目标

在 `lib/inject.iife.ts` 中实现 Vuex 4 实例识别与 patch 逻辑，自动采集（不含 strict mode 违规，T4 单独负责）：
- Vuex action 同步 / 异步抛错（`vuex-error`，stage=`action`）；
- Vuex mutation 抛错（`vuex-error`，stage=`mutation`，**非 strict 违规分支**）；
- Vuex `subscribeAction({ error })` 回调（`vuex-error`，stage=`subscribeAction`）；
- `store.subscribe` 记录 `ctx.lastMutation`（为 T4 提供上下文）。

对应阶段 Spec §3.4（不含 strict 主路径）与交付物 D6。

---

## 2. 对应需求与验收标准

| 需求编号 | 需求描述 | 本任务验收标准 |
|---|---|---|
| REQ-1.4-2 | 自动识别并 patch Vuex 4 | `isVuexStore` 通过 `dispatch` + `commit` + `subscribe` + `_modulesNamespaceMap` + `replaceState` 双重校验 |
| REQ-1.4-4 | 采集 Vuex action / mutation / subscribeAction 抛错 | 同步 / 异步均落盘 `vuex-error`，stage 字段正确 |
| REQ-1.4-7 | detail 含 modulePath、type、payload(脱敏)、stage、stateKeys 等 | `buildVuexErrorDetail` 字段齐全 |
| REQ-1.4-9 | 与 errorHandler 协同去重 | `__shield_emitted__` 标记跨链路共享 |
| REQ-1.4-10 | 业务未引入 Vuex 时静默跳过 | `isVuexStore` 返回 false，不影响现有流程 |

---

## 3. 实现步骤

### 3.1 新增 `isVuexStore`

```typescript
function isVuexStore(p: unknown): boolean {
  if (!p || typeof p !== 'object') return false;
  if (typeof (p as any).dispatch !== 'function') return false;
  if (typeof (p as any).commit !== 'function') return false;
  if (typeof (p as any).subscribe !== 'function') return false;
  return (
    typeof (p as any).replaceState === 'function' &&
    (p as any)._modulesNamespaceMap !== undefined
  );
}
```

### 3.2 新增 `patchVuex` 主体（不含 strict 主路径，T4 接入）

实现见 [design-v1.4.md §3.2](../design-v1.4.md#32-vuex-patch)。本任务落实：
1. 守卫：`store.__shield_patched__ = true`；
2. `ctx = { lastMutation: null, prevStateKeys: null }` 闭包；
3. `store.subscribe((mutation, state) => { ctx.lastMutation = ...; try { ctx.prevStateKeys = Object.keys(state || {}); } catch { ctx.prevStateKeys = null; } })`；
4. 包装 `dispatch`：
   - 同步抛错：`markShieldEmitted(err)` → emit → throw（不前置 `isShieldEmitted`）；
   - Promise reject：`.catch` 内 `if (!isShieldEmitted(err)) { markShieldEmitted; emit; } throw err;`；
   - dispatch 包装入口显式调用 `normalizeVuexArgs` 归一化形参；
5. 包装 `commit`：
   - commit 包装入口显式调用 `normalizeVuexArgs` 归一化形参；
   - 捕获到 err 后通过显式抽象函数获取 subType：
     ```typescript
     // T3 内 v1 实现仅返回 'vuex-error'
     // T4 将替换为基于 detectStrictViolation 的实现，签名保持稳定
     const subType = resolveCommitErrorSubType(store, err, ctx);
     ```
     T3 阶段 `resolveCommitErrorSubType` 直接返回 `'vuex-error'`，stage 固定为 `mutation`；不引入死代码占位；
6. `subscribeAction({ error })`：emit `vuex-error`，stage=`subscribeAction`。

### 3.3 新增 `buildVuexErrorDetail`

```typescript
function buildVuexErrorDetail(
  err: unknown,
  store: any,
  type: string,
  payload: unknown,
  // 'subscribe' 本任务不产生，保留类型兼容性（供 T4 / 后续阶段扩展）
  stage: 'action' | 'mutation' | 'subscribeAction' | 'subscribe',
  appId: string,
) {
  // modulePath 防御：type 在异常路径下可能非 string（如对象形态 { type: 'foo/bar', ... }）
  const safeType = typeof type === 'string' ? type : (type as any)?.type ?? '';
  const modulePath = safeType.includes('/')
    ? safeType.split('/').slice(0, -1).join('/')
    : '';
  return {
    message: (err as any)?.message ?? String(err),
    stack: (err as any)?.stack ?? '',
    // 与现网 source 命名风格对齐（参见 vue-error-handler / vue-router 等），统一使用 kebab-case 来源标识
    source: 'vuex-store-patch',
    context: {
      appId,
      modulePath,
      type: safeType,
      // redactValue 在 fields 为空（`window.__SHIELD_REDACT_FIELDS__` 未注入）时按 T1 契约返回原值
      payload: redactValue(payload, SHIELD_REDACT_FIELDS),
      stage,
      // buildStateSummary 返回字段以设计 §2.2 ContextStateSummary 为准：
      // { stateKeys, stateSizeBytes, stateTruncated, stateUnserializable? }
      ...buildStateSummary(store?.state),
    },
  };
}
```

### 3.4 在 `patchAppUse` 中接入 Vuex 识别

- 在 `patchAppUse` 内 Pinia 分支之后新增 `else if (isVuexStore(plugin)) patchVuex(app, plugin, appId);`；
- 兜底 `globalProperties?.$store && !isPiniaInstance(globalProperties.$store) && isVuexStore(globalProperties.$store)` 调用 `patchVuex`。

### 3.5 互斥识别与回归

- 互斥识别：Pinia 优先；
- 同时挂载 Pinia 与 Vuex 时，两者分别 patch，不串扰；
- 未引入 Vuex 时 `isVuexStore` 静默返回 false。

---

## 4. 测试计划

### 4.1 单元测试

- **最小冒烟边界**：本任务在 T3 内仅做 TC-4（action 同步抛错）最小冒烟，用于验证 patchVuex 主链路接通；完整 TC-4 ~ TC-7 用例（含同步/异步/mutation/subscribeAction 全分支）由 T6 落地。
- **T3 阶段已知限制声明**：T3 内 `resolveCommitErrorSubType` 仅返回 `'vuex-error'`，**Vuex strict mode 违规在 T3 阶段会暂归 `vuex-error` 子类型**，T4 替换实现后才会输出 `vuex-strict-violation`；本期单测断言以此为准，不应预期 strict 子类型。
- `tests/vuex-monitor.test.ts`（新增，主要在 T6 落地，本任务先做最小冒烟）：
  - TC-4（action 同步抛错，T3 最小冒烟）：fixture `vue-vuex-error.html`，断言落盘 `vuex-error`，stage=`action`，含 modulePath、type、payload(脱敏)、stateKeys。
  - TC-5（action 异步抛错，T6 完成）：同 fixture，断言同上。
  - TC-6（mutation 抛错，非 strict，T6 完成）：fixture `vue-vuex-error.html`，断言落盘 `vuex-error`，stage=`mutation`。
  - TC-7（subscribeAction onError，T6 完成）：fixture `vue-vuex-error.html`，断言落盘 `vuex-error`，stage=`subscribeAction`。

### 4.2 集成测试 / 端到端测试

- 由 T6 通过 Playwright 完整链路验证。

### 4.3 回归测试

- 业务未引入 Vuex 时既有 fixture 全绿；
- 同时挂载 Pinia 与 Vuex 时各自正常工作（TC-9 / TC-15 拓展）。

---

## 5. 风险与依赖

| 风险 / 依赖 | 影响 | 应对措施 |
|---|---|---|
| 依赖 T1 工具函数与 T2 inject.iife.ts 结构 | 阻塞本任务 | T2 已通过后再启动 |
| `_modulesNamespaceMap` / `replaceState` 私有字段变更 | 识别失效 | 三函数 + 私有字段双重校验；测试覆盖范围与 vendor 锁定的 Vuex 版本保持一致（不承诺跨多 minor 测试覆盖） |
| commit 包装与 T4 strict 分流的代码冲突 | 合并冲突 | 本任务通过 `resolveCommitErrorSubType` 抽象函数预留 T4 替换点，签名保持稳定 |
| 与 T2 在 `patchAppUse` 中分支冲突 | 合并冲突 | T3 须在 T2 已合并基础上以 `else if (isVuexStore(plugin))` 追加，不重写 Pinia 分支 |

---

## 6. 变更范围

- **本任务范围内**：`lib/inject.iife.ts` 中 `isVuexStore` / `patchVuex`（不含 strict 主路径）/ `resolveCommitErrorSubType`（T3 v1 实现，返回 `'vuex-error'`）/ `buildVuexErrorDetail` / `patchAppUse` 内 Vuex 识别分支。
- **消费 T1 交付**：dispatch / commit 包装入口均显式调用 T1 交付的 `normalizeVuexArgs(typeOrAction, payload)` 归一化形参；不在本任务内重复实现该工具。
- **isVuexStore 误判防御**：测试需补充 fake store 不误判断言（仅具备部分函数签名但缺少 `_modulesNamespaceMap` / `replaceState` 的对象应返回 false），避免与 Pinia / 自定义对象互相误识别。
- **不在本任务范围内**：
  - Vuex strict mode `detectStrictViolation` / `inferMutatedKeyPath`（T4）；
  - logger / analyzer 白名单扩展（T5）；
  - 测试夹具与完整测试用例（T6）；
  - 文档更新（T7）。

---

## 7. 评审记录

| 轮次 | 日期 | 结论 | P0/P1 问题 | 修复方案 |
|---|---|---|---|---|
| 1 | 2026-06-22 | 不通过→修订后待重评 | P0-1 commit 包装出现 `if (false)` 死代码占位；P0-2 dispatch 同步/异步守卫与设计不一致；P1-2 subscribe 缺 try/catch、stage 类型 `'subscribe'` 含义未注释；P1-3 buildVuexErrorDetail 字段映射（source、buildStateSummary 字段引用、payload 空 fields 行为）未对齐设计与现网风格；P1-4 modulePath 推导对非 string type 缺防御、dispatch/commit 入口未显式 normalizeVuexArgs；P1-5 风险表缺少与 T2 合并冲突行 + 测试边界未澄清；P2-2 多 minor 测试承诺超出 vendor 锁定范围；P2-3/P2-4 §6 未声明消费 T1 normalizeVuexArgs 与 fake store 不误判断言 | P0-1：以 `resolveCommitErrorSubType(store, err, ctx)` 抽象函数替代 TODO/死代码，T3 v1 实现仅返回 `'vuex-error'`，T4 替换实现签名保持稳定，测试计划补充 strict 暂归 vuex-error 的已知限制声明。P0-2：同步分支 `markShieldEmitted → emit → throw`（不前置 `isShieldEmitted`），异步分支 `.catch` 内 `if (!isShieldEmitted) { mark; emit; } throw`，dispatch/commit 入口显式 `normalizeVuexArgs`。P1-2：subscribe 内 prevStateKeys 加 try/catch 容错；`stage: 'subscribe'` 加注释「本任务不产生，保留类型兼容性」。P1-3：source 改为 `'vuex-store-patch'`；明确 `buildStateSummary` 返回字段以设计 §2.2 ContextStateSummary 为准（stateKeys 等）；声明 `redactValue` 在 fields 为空时返回原值。P1-4：modulePath 推导前加 `safeType` 防御；dispatch/commit 入口显式 `normalizeVuexArgs`。P1-5：§5 新增 T2 合并冲突行；§4.1 明确「最小冒烟」边界（TC-4 由 T3 完成，TC-4 ~ TC-7 完整由 T6 完成）。P2-2：删除「多 minor 版本测试覆盖」过度承诺，与 vendor 锁定一致。P2-3/P2-4：§6 补「消费 T1 交付的 normalizeVuexArgs」声明与「fake store 不误判断言」要求。 |
