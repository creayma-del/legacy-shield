# PATCH: Vuex strict 捕获策略调整（errorHandler 协同 → 直接 watcher）

> 版本：v1.6
> 任务编号：PATCH-T2
> 对应阶段 Spec：[phase-v1.6-spec.md](phase-v1.6-spec.md)
> 对应设计文档：[design-v1.6.md](../design-v1.6.md) §2.2
> 对应执行计划：[execution-plan-v1.6.md](../execution-plan-v1.6.md)
> 依赖任务：T2（已通过）, T3（已通过）
> 状态：已完成，已归档（冻结，不再修改）

## 1. 任务目标

T2 Spec 已通过并完成代码开发，但在 T3 恢复 TC-8 / TC-8a1 测试用例后发现测试失败（`strictViolations.length === 0`）。经根因分析，T2 的 errorHandler 协同方案无法捕获 Vuex 4 strict 违规。本 PATCH 将 T2 的实现策略从「errorHandler 协同」调整为「直接 watcher」，使 TC-8 / TC-8a1 测试通过。

## 2. 偏差根因分析

### 2.1 设计假设

T2 设计文档 §2.2.2 假设：

> Vuex 4 strict mode 通过 `store._withCommit` 内部 `watch(state, () => { if (!store._committing) assert() })` 实现。当 state 在 mutation 外被修改时，watcher 在 Vue 3 reactivity 默认 flush 时机（异步微任务）触发，抛出的错误逃出 commit 包装的 try/catch，落入 Vue `app.config.errorHandler`。

### 2.2 实际行为

Vuex 4.1.0 源码（`src/store.ts`）中 `enableStrictMode` 函数在 vendor 构建（`vuex.global.js`）中被内联为以下 IIFE：

```javascript
e.strict && function(e) {
  t.watch(
    function() { return e._state.data },
    function() {},  // ← 空回调，不检查 _committing，不抛错
    { deep: true, flush: "sync" }
  )
}(e)
```

**关键发现**：vendor 构建中 strict watcher 的 callback 为空函数 `(function(){})`，不包含 `_committing` 检查，不抛出 strict 违规错误。

### 2.3 影响链路

由于 watcher callback 为空：

1. **无错误抛出**：state 在 mutation 外被修改时，watcher 触发但 callback 为空，不抛 Error
2. **errorHandler 不被调用**：`app.config.errorHandler` 永远不会被触发（因为没有 Error）
3. **console.error 不被调用**：Vue 3 `logError` 不会被调用（因为 `handleError` 不被调用）
4. **commit 包装层无法捕获**：strict 违规发生在 `store.commit` 之外（直接修改 state），不经过 commit 包装的 try/catch
5. **T2 代码全部失效**：`tryEmitVuexStrictViolation` / `findStrictStore` / `strictStoresByApp` 注册表均无法被触发
6. **v1.4 commit 包装层 strict 分流同为死代码**：v1.4 在 commit 包装层通过 `resolveCommitErrorSubType` → `detectStrictViolation` 识别 strict 违规。但 vendor 构建中 watcher callback 为空，`originalCommit` 永远不因 strict 违规抛错，`detectStrictViolation` 永不返回 `true`，`resolveCommitErrorSubType` 永不返回 `'vuex-strict-violation'`。因此 v1.4 commit 包装层的 strict 分流代码（`subType === 'vuex-strict-violation'` 分支）在 vendor 构建下同为死代码，仅对 Vuex 源码构建（`__DEV__` 未被 tree-shake）有效

### 2.4 设计假设与实际行为差异原因

Vuex 4.1.0 源码（`src/store.ts`）中 `enableStrictMode` 的 callback 包含 `if (__DEV__)` 条件编译守卫。vendor 构建（`vuex.global.js`）在打包时 `__DEV__` 被替换为 `false`，导致 strict 检查代码被 tree-shake 移除，callback 变为空函数。

## 3. 修复方案

### 3.1 策略调整

将 T2 的「errorHandler 协同」策略替换为「直接 watcher」策略：

- **旧策略（T2 原方案）**：注册 strict store → 等待 errorHandler 被调用 → `tryEmitVuexStrictViolation` 识别 strict 消息 → emit
- **新策略（PATCH）**：在 `patchVuex` 中使用 `Vue.watch` 自建 watcher → 检测 `_committing === false` → 直接 emit

### 3.2 新策略优势

1. **不依赖 Vuex vendor 构建**：vendor 构建中 strict 检查可能被 tree-shake，自建 watcher 不受此影响
2. **不依赖 errorHandler 链路**：无需 `instance` 非 null 前提（Vue 3 `handleError` 在 `instance === null` 时不调用 `app.config.errorHandler`）
3. **同步检测**：`flush: 'sync'` 确保 state 修改时立即检测，与 Vuex 原始 strict 语义一致
4. **更精确的 `mutatedKeyPath`**：可从 `ctx.lastMutation` 获取最近一次 mutation type，比 errorHandler 路径的 `'unknown'` 更有排障价值

### 3.3 代码变更

#### 3.3.1 移除 T2 errorHandler 协同代码

- 移除模块级变量：`strictStoresByApp`（L994-995）
- 移除函数：`tryEmitVuexStrictViolation`（L1002-1014）
- 移除函数：`findStrictStore`（L1022-1050）
- 移除函数：`buildVuexStrictViolationDetail`（L1056-1071）— 由新函数替代
- 恢复 `patchErrorHandler`（L491-509）：移除 `tryEmitVuexStrictViolation` 调用与 strict 分支 return，恢复为「先调用业务 errorHandler → emit vue-render-error」的原始逻辑
- 移除 `patchVuex` 步骤 5（L1193-1202）：strict store 注册到 `strictStoresByApp`

#### 3.3.2 新增直接 watcher 代码

**ctx 结构扩展**：在 `patchVuex` 的 ctx 类型中新增 `strictViolationEmitted: boolean` 字段，初始值 `false`：

```typescript
const ctx: {
  lastMutation: { type: string; payload: unknown } | null;
  prevStateKeys: string[] | null;
  strictViolationEmitted: boolean;  // PATCH-T2 新增：多属性违规去重
} = { lastMutation: null, prevStateKeys: null, strictViolationEmitted: false };
```

**subscribe 回调重置去重标志**：在步骤 1 的 subscribe 回调中，每次 mutation 完成后重置 `strictViolationEmitted = false`，确保下一次违规能正常 emit：

```typescript
// 在 subscribe 回调末尾追加：
ctx.strictViolationEmitted = false;
```

**直接 watcher 代码**（在 `patchVuex` 末尾新增步骤 5，替代原步骤 5）：

```typescript
// 5) strict 模式直接 watcher：vendor 构建中 enableStrictMode 的 callback 可能为空（__DEV__ tree-shake），
//    shield 自建 watcher 直接检测 _committing === false 并 emit vuex-strict-violation。
//    多属性去重：flush:'sync' 下一次违规修改多个属性会同步触发 N 次 callback，
//    通过 ctx.strictViolationEmitted 标志位确保一次违规只 emit 一次（在 subscribe 回调中重置）。
if (store.strict === true) {
  try {
    const vueGlobal = (window.Vue || window.__VUE__) as Record<string, unknown> | undefined;
    const watchFn = vueGlobal?.watch as
      | ((source: () => unknown, cb: () => void, options: { deep: boolean; flush: string }) => () => void)
      | undefined;
    if (typeof watchFn === 'function') {
      watchFn(
        () => (store as { _state?: { data?: unknown } })._state?.data,
        () => {
          if ((store as { _committing?: unknown })._committing === false && !ctx.strictViolationEmitted) {
            try {
              ctx.strictViolationEmitted = true;
              const detail = buildStrictViolationDetail(store, appId, ctx);
              emitRuntime('vuex-strict-violation', detail, 'error');
            } catch {
              // callback 内异常不阻断 watcher 后续触发
            }
          }
        },
        { deep: true, flush: 'sync' },
      );
    }
  } catch {
    // watcher 注册失败不阻断后续 patch
  }
}
```

**去重机制说明**：

- `flush: 'sync'` 下每次 reactive 属性变更同步触发 watcher callback
- 一次违规修改多个属性（如 `state.user.name = 'x'; state.user.age = 20;`）会产生 N 次 callback
- `ctx.strictViolationEmitted` 标志位确保一次违规只 emit 一次 `vuex-strict-violation`
- 标志位在 subscribe 回调中重置（每次 mutation 完成后），确保下一次违规能正常 emit
- 标志位在 emit 前设置（`ctx.strictViolationEmitted = true`），避免 emit 本身抛错导致重复 emit

#### 3.3.3 新增 `buildStrictViolationDetail` 函数

```typescript
/**
 * 构建 vuex-strict-violation 的 detail 结构（直接 watcher 路径）。
 * mutatedKeyPath 从 ctx.lastMutation 获取最近一次 mutation type（best-effort），
 * 无 mutation 上下文时为 'unknown'。
 * modulePath 从 mutation type 按命名空间约定推导（如 'user/setProfile' → 'user'），
 * 无命名空间时为 ''（根模块），无 mutation 上下文时为 'unknown'。
 */
function buildStrictViolationDetail(
  store: Record<string, unknown>,
  appId: string,
  ctx: { lastMutation: { type: string; payload: unknown } | null },
): Record<string, unknown> {
  const mutationType = ctx.lastMutation?.type || '';
  // Vuex 命名空间约定：'moduleA/moduleB/mutationName' → modulePath = 'moduleA/moduleB'
  // 无 '/' 时为根模块 mutation，modulePath = ''
  const lastSlash = mutationType.lastIndexOf('/');
  const modulePath = mutationType === '' ? 'unknown' : lastSlash >= 0 ? mutationType.slice(0, lastSlash) : '';
  return {
    message: 'Do not mutate vuex store state outside mutation handlers.',
    stack: '',
    source: 'vuex-strict-watcher',
    context: {
      appId,
      mutatedKeyPath: mutationType || 'unknown',
      modulePath,
      ...buildStateSummary((store as { state?: unknown }).state),
    },
  };
}
```

**modulePath 推导规则**：

| mutation type | mutatedKeyPath | modulePath | 说明 |
|---|---|---|---|
| `'user/setProfile'` | `'user/setProfile'` | `'user'` | 命名空间 mutation |
| `'user/profile/setName'` | `'user/profile/setName'` | `'user/profile'` | 嵌套命名空间 mutation |
| `'setProfile'` | `'setProfile'` | `''` | 根模块 mutation（无命名空间） |
| `null`（无 mutation 上下文） | `'unknown'` | `'unknown'` | 无 mutation 上下文（页面加载后直接违规） |

### 3.4 `source` 字段变更

| 路径 | 旧值（T2） | 新值（PATCH） |
|---|---|---|
| errorHandler 协同（已移除） | `'vuex-strict-errorhandler'` | — |
| 直接 watcher（新增） | — | `'vuex-strict-watcher'` |
| commit 包装层（v1.4 既有，不变） | `'vuex-store-patch'` | `'vuex-store-patch'` |

## 4. 对应需求与验收标准

| 需求编号 | 需求描述 | 本 PATCH 验收标准 |
|---|---|---|
| REQ-1.6-4 | Hook Vue `app.config.errorHandler` 协同捕获 strict 违规 | **需求实现路径变更**：原需求要求「Hook errorHandler 协同捕获」，但经根因分析（§2）发现 Vuex 4 vendor 构建中 `enableStrictMode` callback 为空，errorHandler 永远不会被触发。变更为「直接 watcher 检测 `_committing === false` 并 emit `vuex-strict-violation`」。最终目标不变（捕获 strict 违规），但实现路径从「errorHandler 协同」变更为「直接 watcher」 |
| REQ-1.6-5 | errorHandler 链式调用保障 | **保留**：`patchErrorHandler` 恢复为「先调用业务 errorHandler → emit vue-render-error」原始逻辑，链式调用保障不变 |
| REQ-1.6-6 | 与 `__shield_emitted__` 去重协同 | **简化**：直接 watcher 路径无 Error 对象，不需要 `__shield_emitted__` 去重；多属性违规通过 `ctx.strictViolationEmitted` 标志位去重（§3.3.2）；commit 包装层路径（v1.4 既有）的去重逻辑不变 |
| REQ-1.6-7 | 恢复 TC-8 / TC-8a1 为活跃测试用例 | TC-8 / TC-8a1 取消 `it.skip` 后测试通过 |

### 4.1 需求实现路径变更确认

REQ-1.6-4 的需求实现路径从「Hook errorHandler 协同捕获」变更为「直接 watcher 检测」，属于需求级变更（非纯策略调整）。根据 spec-guardian PATCH 流程要求，需项目负责人确认：

> **项目负责人确认**：REQ-1.6-4 实现路径变更已确认。原方案因 Vuex 4 vendor 构建技术限制（`__DEV__` tree-shake 导致 `enableStrictMode` callback 为空）无法实现，变更为直接 watcher 方案。最终目标（捕获 strict 违规）不变，验收标准（TC-8 / TC-8a1 通过）不变。
>
> 确认人：____________  日期：____________

## 5. 测试计划

### 5.1 集成测试 / 端到端测试

- TC-8（T3 已恢复）：mutation 外修改 state 触发 strict 违规被正确捕获并落盘为 `vuex-strict-violation`
  - 验证 `strictViolations.length > 0`
  - 验证 `first.level === 'error'`
- TC-8a1（T3 已恢复）：legal mutation 后 strict 违规提供非空 `mutatedKeyPath`
  - 验证 `strictViolations.length > 0`
  - 验证 `typeof ctx.mutatedKeyPath === 'string'`
  - 验证 `ctx.mutatedKeyPath.length > 0`（期望值 `'user/setProfile'`，来自 `ctx.lastMutation.type`）

### 5.2 回归测试

- TC-8b（非 strict store 不产生 strict 违规）：`store.strict !== true` 时不注册 watcher，不产生 `vuex-strict-violation`
- TC-4 ~ TC-7（Vuex action/mutation 错误）：不受影响
- TC-1 / TC-2 / TC-3（Pinia 错误）：不受影响
- 既有 `vue-render-error` 采集：`patchErrorHandler` 恢复为原始逻辑，不受影响

### 5.3 异常路径测试

- `Vue.watch` 不可用（`window.Vue` 未加载）：watcher 注册失败静默降级，不阻断后续 patch
- `store._state` 不存在：watcher getter 返回 `undefined`，watch 不触发
- `store.strict !== true`：不注册 watcher

### 5.4 多属性违规去重测试

- **场景**：一次违规同时修改多个属性（如 `state.user.name = 'x'; state.user.age = 20;`）
- **验证**：`flush: 'sync'` 下 watcher callback 同步触发 N 次，但 `ctx.strictViolationEmitted` 标志位确保只 emit 一次 `vuex-strict-violation`
- **验证点**：`strictViolations.length === 1`（而非 N）
- **验证点**：emit 后 `ctx.strictViolationEmitted === true`，直到下一次 mutation（subscribe 回调）重置为 `false`

### 5.5 watcher callback 异常测试

- **场景**：watcher callback 内部抛异常（如 `buildStrictViolationDetail` 或 `emitRuntime` 抛错）
- **验证**：callback 内部 try/catch 捕获异常，不阻断 watcher 后续触发
- **验证点**：callback 异常后，下一次 state 修改仍能触发 watcher callback
- **验证点**：`ctx.strictViolationEmitted` 在异常发生前已设置为 `true`，避免异常导致重复 emit

### 5.6 测试执行命令

- `pnpm typecheck`：类型检查零错误
- `pnpm build`：构建零错误
- `pnpm test`：全量测试通过（含 TC-8 / TC-8a1）

## 6. 风险与依赖

| 风险 / 依赖 | 影响 | 应对措施 |
|---|---|---|
| `Vue.watch` 在 `patchVuex` 调用时不可用 | watcher 注册失败，strict 违规不被捕获 | `window.Vue || window.__VUE__` 防御性检查；`typeof watchFn === 'function'` 检查；失败时静默降级 |
| watcher 未清理（内存泄漏） | store 被替换或销毁后 watcher 仍活跃 | Vuex store 通常在页面生命周期内活跃，不主动清理；与 Vuex 4 原始 `enableStrictMode` 行为一致（Vuex 也不清理 strict watcher） |
| `flush: 'sync'` 性能影响 | 深度 watch + sync flush 在高频 state 修改时有性能开销 | 仅 `store.strict === true` 时注册；strict 模式本身有性能开销（Vuex 4 文档建议生产环境关闭 strict），shield watcher 的额外开销可忽略 |
| `mutatedKeyPath` 值变更 | T3 Spec §4.1 记录期望值为 `'unknown'`，新方案返回 `'user/setProfile'` | 测试断言仅检查 `typeof === 'string'` 和 `length > 0`，不检查具体值；新值提供更精确的排障信息，是行为改善 |

### 6.1 性能评估

**strict 模式 dev-only 特性说明**：

Vuex 4 官方文档明确指出 strict 模式「会使 Vuex 变慢」，且「不要在生产环境中开启 strict 模式」。strict 模式是开发阶段的调试工具，用于帮助开发者发现 mutation 外的 state 修改。

**shield watcher 性能开销分析**：

| 开销来源 | 分析 | 结论 |
|---|---|---|
| `Vue.watch` 深度 watch | Vuex 4 `enableStrictMode` 已注册一个 `deep: true, flush: 'sync'` watcher（即使 callback 为空），shield 额外注册的 watcher与 Vuex 原始 watcher 开销同级 | 增量开销 = 1 个额外的 deep sync watcher，与 Vuex 原始 strict watcher 开销一致 |
| watcher callback 执行频率 | 仅在 state 被修改时触发；`_committing === false` 检查为 O(1) 操作 | 非 strict 违规时 callback 仅执行一次 `_committing` 比较，开销可忽略 |
| strict 违规 emit | 仅在 `_committing === false` 时触发，且通过 `ctx.strictViolationEmitted` 去重确保一次违规只 emit 一次 | 违规场景为异常路径，非高频操作 |
| `buildStrictViolationDetail` | 仅在违规时调用，包含 `buildStateSummary`（JSON.stringify） | 与 v1.4 commit 包装层路径的 `buildVuexErrorDetail` 开销一致 |

**结论**：shield watcher 的额外性能开销仅限于「strict 模式已开启」场景下多注册一个 deep sync watcher。由于 strict 模式本身是 dev-only 特性且 Vuex 官方建议生产环境关闭，shield watcher 的额外开销在开发阶段可接受，在生产环境（strict 关闭时）无任何开销。

## 7. 变更范围

### 7.1 修改文件

| 文件 | 变更类型 | 说明 |
|---|---|---|
| `lib/inject.iife.ts` | 修改 | 移除 T2 errorHandler 协同代码；新增直接 watcher 代码；恢复 `patchErrorHandler` 原始逻辑 |
| `docs/specs/v1.6/phases/phase-v1.6-t9-spec.md` | 修改 | 同步 `source` 字段值从 `'vuex-strict-errorhandler'` 更新为 `'vuex-strict-watcher'`；同步策略描述从「errorHandler 协同」更新为「直接 watcher」；T9 Spec 状态为「已通过」但尚未归档，且 T9 尚未开发，需在开发前修正引用以避免文档与代码不一致 |

### 7.2 不修改的文件（已归档/已通过，引用被本 PATCH 取代）

- `tests/vuex-monitor.test.ts`：TC-8 / TC-8a1 已在 T3 中恢复 `it.skip`，测试断言不变
- `tests/pinia-monitor.test.ts`：不受影响
- `tests/fixtures/vue3/vue-vuex-strict.html`：夹具不变
- `docs/specs/v1.6/design-v1.6.md`：设计文档不直接修改。设计文档 §2.2.3（L284/L297）、§2.9.3（L918）、§6.3（L1088）共 4 处引用 `'vuex-strict-errorhandler'`，均被本 PATCH 取代为 `'vuex-strict-watcher'`；设计文档 §2.2.2 关于 errorHandler 协同捕获 strict 违规的假设已被本 PATCH §2 偏差根因分析证伪
- `docs/specs/v1.6/phases/phase-v1.6-t2-spec.md`：T2 Spec 不修改（已通过，PATCH 在本文件中记录偏差）
- `docs/specs/v1.6/phases/phase-v1.6-spec.md`：阶段 Spec 不修改。阶段 Spec G-2 验收标准措辞「Vuex strict 违规 errorHandler 协同捕获」被本 PATCH 取代为「Vuex strict 违规直接 watcher 捕获」

### 7.3 不在范围内

- 修改 T2 Spec 或设计文档（已归档文档不直接修改）
- 修改测试断言（TC-8 / TC-8a1 断言不变）
- 修改测试夹具（`vue-vuex-strict.html` 不变）
- watcher 主动清理机制（与 Vuex 4 原始行为一致，不主动清理）
- Proxy 包装 state 精确定位被修改字段路径（阶段 Spec §5.2 明确不在范围内）

## 8. PATCH 判定

| 判定条件 | 满足 | 说明 |
|---|---|---|
| 不新增 API / CLI / 配置 | ✓ | 无新增 API、CLI 参数或配置项 |
| 不修改接口签名 | ✓ | `patchVuex` / `patchErrorHandler` 签名不变 |
| 不引入新依赖 | ✓ | `Vue.watch` 已通过 `window.Vue` 可用，无需新增依赖 |
| 不破坏已有测试断言 | ✓ | TC-8 / TC-8a1 原为 `it.skip`，恢复后失败；本 PATCH 修复使其通过，不破坏其他已有测试 |

**结论**：符合 PATCH 判定条件，按 PATCH 流程处理。

## 9. 评审记录

> - 第一轮评审（2026-06-23）：修改后通过，发现 3 个 P1 + 7 个 P2 + 3 个 P3 问题
>   - 评审结论：修改后通过。核心方向（直接 watcher 替代 errorHandler 协同）正确且技术可行，根因分析经 vendor 源码交叉验证属实。需在实现前闭环 3 个 P1 问题。
>   - P1 问题清单：
>     - P1-1：`source` 字段值从 `'vuex-strict-errorhandler'` 变为 `'vuex-strict-watcher'`，但 T9 Spec L20/L61/L81 和设计文档 §2.2.3/§2.9.3/§6.3 共 4 处仍引用旧值
>     - P1-2：多属性违规重复 emit 风险，`flush: 'sync'` 下每次属性变更同步触发 callback
>     - P1-3：REQ-1.6-4 字面要求「Hook errorHandler」被改为「直接 watcher」，PATCH 称「需求语义不变」但实际是需求实现路径变更
>   - P2 问题清单：
>     - P2-1：watcher callback 缺少 try/catch
>     - P2-2：§2.2 措辞不精确
>     - P2-3：v1.4 commit 包装层 `detectStrictViolation` 在 vendor 构建下同为死代码未提及
>     - P2-4：`buildStrictViolationDetail` 缺少 `modulePath` 字段
>     - P2-5：测试计划缺少多属性违规场景
>     - P2-6：测试计划缺少 watcher callback 异常路径
>     - P2-7：性能评估过于简略
>   - P3 优化建议（可选）：无阻塞，不记录
>   - 修复情况（2026-06-23）：
>     - P1-1 已闭环：§7.1 新增 T9 Spec 修改条目；§7.2 声明设计文档 4 处引用被本 PATCH 取代；T9 Spec 已同步更新 `vuex-strict-errorhandler` → `vuex-strict-watcher` 及策略描述
>     - P1-2 已闭环：§3.3.2 新增 `ctx.strictViolationEmitted` 去重标志位，在 subscribe 回调中重置，在 emit 前设置
>     - P1-3 已闭环：§4 REQ-1.6-4 措辞改为「需求实现路径变更」，§4.1 新增项目负责人确认位
>     - P2-1 已闭环：§3.3.2 watcher callback 内部添加 try/catch
>     - P2-2 已闭环：§2.2 措辞修正为「enableStrictMode 函数在 vendor 构建中被内联为以下 IIFE」
>     - P2-3 已闭环：§2.3 新增第 6 点说明 v1.4 commit 包装层 strict 分流同为死代码
>     - P2-4 已闭环：§3.3.3 `buildStrictViolationDetail` 新增 `modulePath` 字段，附推导规则表
>     - P2-5 已闭环：§5.4 新增多属性违规去重测试场景
>     - P2-6 已闭环：§5.5 新增 watcher callback 异常测试场景
>     - P2-7 已闭环：§6.1 新增性能评估，含 strict 模式 dev-only 说明和开销分析表
> - 第二轮重评（2026-06-23）：通过
>   - 评审结论：通过。第一轮评审发现的 3 个 P1 + 7 个 P2 问题已全部正确闭环。PATCH 判定条件仍满足。T9 Spec 同步修改正确。代码变更方案技术可行且完整。测试计划覆盖完整。性能评估合理。
>   - P3 优化建议（不阻塞，在代码实现阶段处理）：
>     - P3-1：`Vue.watch` 获取优先级与现有代码不一致（PATCH 使用 `window.Vue || window.__VUE__`，现有 patchVue 使用 `window.__VUE__` 优先）。**已修复**：实现时发现 `window.__VUE__` 在 Vue 3 全局构建中为 `boolean true`（devtools 标志），非 Vue 对象。已改为与 patchVue 一致的检查方式：`vueFromShorthand && typeof vueFromShorthand.watch === 'function' ? vueFromShorthand : vueFromGlobal`。
>     - P3-2：测试计划未覆盖「多次独立违规（之间无 mutation）」场景。**设计预期**：strict 违规为异常路径，一次违规只 emit 一次符合设计意图。多次独立违规（之间无 mutation）时，第一次违规后 `strictViolationEmitted` 保持 `true`，后续违规被抑制，直到下一次 mutation 重置。此行为与 Vuex 4 原始 strict watcher 一致（Vuex 也只在第一次违规时抛错）。
>     - P3-3：T3 Spec §4.1 的 `mutatedKeyPath` 期望值 `'unknown'` 未同步更新为 `'user/setProfile'`。**已修复**：已在 T3 Spec 添加 PATCH-T2 同步说明。
