# T4：Vuex strict mode 违规识别

> 版本：v1.4
> 任务编号：T4
> 对应阶段 Spec：[phase-v1.4-spec.md](phase-v1.4-spec.md)
> 对应设计文档：[design-v1.4.md](../design-v1.4.md)
> 对应执行计划：[execution-plan-v1.4.md](../execution-plan-v1.4.md)
> 依赖任务：T3
> 状态：已通过
> 评审记录：见本文档末尾（轮次 1 不通过、轮次 2 通过）

---

## 1. 任务目标

在 T3 已实现的 Vuex commit 包装基础上，新增 strict mode 违规识别能力：
- 主路径基于 Vuex 4 内部结构特征（`store.strict === true && (store as any)._committing === false`）作为命中条件，命中即判定 strict 违规；不依赖 console 文本解析；
- message 正则（`/do not mutate vuex store state outside mutation handlers/i`）仅作辅助兜底，防止 `_committing` 字段在 Vuex 后续版本被重命名时漏报；
- 命中时落盘 `vuex-strict-violation`，含 `modulePath`、`mutatedKeyPath`（best-effort）、stateKeys 等；
- 未命中时回退到 `vuex-error`，不误报。

对应阶段 Spec §3.4 strict mode 部分与交付物 D7；与 design §3.2 保持一致。

---

## 2. 对应需求与验收标准

| 需求编号 | 需求描述 | 本任务验收标准 |
|---|---|---|
| REQ-1.4-5 | 采集 Vuex strict mode 在 mutation 外修改 state 的违规 | 落盘 `vuex-strict-violation`；包含 modulePath、mutatedKeyPath、stack；不依赖 console 文本解析 |
| REQ-1.4-9 | 与 errorHandler 协同去重 | 同一违规不重复落盘 |

---

## 3. 实现步骤

### 3.1 新增 `detectStrictViolation`

```typescript
function detectStrictViolation(store: any, err: unknown, ctx: { lastMutation: { type: string; payload: unknown } | null }): boolean {
  if (!(err instanceof Error)) return false;
  // 前置门控：仅在 store.strict === true 时启用 strict 识别
  if (store?.strict !== true) return false;
  // 主路径（结构特征）：Vuex 4 内部通过 store._committing 标记「当前是否处于 mutation 内」。
  // 抛错时若 _committing === false，意味着当前不在 mutation 上下文 → 判定 strict 违规命中。
  // 不再叠加 ctx.lastMutation === null 约束：subscribe 会持续刷新 lastMutation，
  // 该条件几乎永远不成立，会导致漏报（评审 P0-2）。
  if ((store as any)._committing === false) return true;
  // 辅助兜底：若 Vuex 后续版本将 _committing 字段重命名导致主路径失效，
  // 通过 message 正则识别 strict 抛错的固定语义（Vuex 4 源码内英文硬编码，不受 i18n 影响）。
  const STRICT_MSG = /do not mutate vuex store state outside mutation handlers/i;
  if (STRICT_MSG.test(err.message)) return true;
  return false;
}
```

> **判定顺序说明（评审 P0-1）**：结构特征作为主路径置于 message 正则之前，命中即 return；message 正则仅在结构特征失效时作为兜底，确保版本演进时不会因 `_committing` 重命名而漏报。
>
> **关于 strict watcher 抛错是否经 commit 包装捕获**：Vuex 4 通过 `store._watcherVM.$watch`（或 vue-next reactivity 的 `watch`）在 state 变更时执行 `assert(store._committing, ...)`，若不满足将 throw。该 throw 是否能落入 commit 包装的 `try/catch`，取决于 watcher 触发链路与 commit 调用栈是否同步：
> - 若 watcher 同步触发并在 `_withCommit` 退出前抛错，可被 commit 包装捕获；
> - 若 watcher 在异步微任务中触发（Vue 3 reactivity 默认 flush 时机），将逃出 commit 包装的 `try/catch`，落入 Vue errorHandler。
>
> 因此需在 T6 联调中实测验证：若 commit 包装无法稳定捕获 strict 抛错，则在 Vue `app.config.errorHandler` 侧协同识别（与 design §1.1「通过 Vue config.errorHandler 协同识别 strict mode 违规」一致）。本任务先完成 commit 包装内的识别分流，errorHandler 侧协同识别若需要补强，由 T6 联调后追加。

### 3.2 新增 `inferMutatedKeyPath`

```typescript
/**
 * 推导 strict 违规对应的 mutatedKeyPath（best-effort 字段）。
 *
 * 语义澄清（评审 P1-2）：
 * - mutatedKeyPath 记录的是「最近一次 mutation.type」（含 modulePath，如 `user/setProfile`），
 *   而非真正被违规修改的 state key path。Vuex 4 strict 抛错本身不携带具体被改字段路径，
 *   通过 Proxy 包装 state 才能精确定位，但会带来性能与副作用，故本期不实现。
 * - 因此该字段供排障时作为「上下文线索」使用，不应作为唯一定位依据。
 */
function inferMutatedKeyPath(
  ctx: { lastMutation: { type: string; payload: unknown } | null },
  store: any,
  mutationType: string,
): string {
  // 分支 1：本次 commit 调用传入的 type 优先（commit 包装内通常恒为非空字符串）
  if (mutationType) return mutationType;
  // 分支 2：上下文中由 store.subscribe 记录的最近一次 mutation.type
  if (ctx.lastMutation?.type) return ctx.lastMutation.type;
  // 兜底分支：理论上不可达（commit 包装入口的 mutationType 为字符串入参，
  // 调用方若构造无 type 的 commit 会被 Vuex 自身抛错前置拦截），
  // 保留 'unknown' 作为类型完备性兜底，确保函数始终返回 string，避免下游空值处理。
  return 'unknown';
}
```

### 3.3 在 T3 预留的 commit 包装分流点接入

T3 在 commit 包装 catch 分支内预留字面锚点注释 `// SHIELD_T4_HOOK`（评审 P1-3，T3/T4 之间约定）。本任务通过该锚点定位替换块。

将 T3 的 commit catch 分支替换为：
```typescript
} catch (err) {
  // SHIELD_T4_HOOK
  if (!isShieldEmitted(err)) {
    markShieldEmitted(err);
    if (detectStrictViolation(store, err, ctx)) {
      // strict 违规：detail 不携带 stage（语义上 strict 违规并非「mutation 阶段」抛错，
      // 而是 mutation 外修改 state 被 watcher 捕获，沿用 'mutation' 会误导排障，评审 P1-1）
      const detail = buildVuexErrorDetail(err, store, type, realPayload, undefined as any, appId);
      delete (detail.context as any).stage;
      (detail.context as any).mutatedKeyPath = inferMutatedKeyPath(ctx, store, type);
      emitRuntime('vuex-strict-violation', detail, 'error');
    } else {
      const detail = buildVuexErrorDetail(err, store, type, realPayload, 'mutation', appId);
      emitRuntime('vuex-error', detail, 'error');
    }
  }
  throw err;
}
```

> **去重守卫说明（评审 P1-3）**：外层 `if (!isShieldEmitted(err))` 守卫确保同一错误对象不会因 dispatch / commit / subscribeAction 多链路捕获导致重复落盘；命中后立即 `markShieldEmitted(err)`，与 T3 的 dispatch / subscribeAction 链路保持一致。
>
> **stage 字段处理说明（评审 P1-1）**：strict 分支调用 `buildVuexErrorDetail` 时传入占位实参后立即 `delete detail.context.stage`，避免在不修改 T3 已实现的 `buildVuexErrorDetail` 签名（参见 T3 §3.3）前提下，让 strict 违规 detail 不携带 stage 字段。若 T6 联调发现下游 analyzer / reporter 强依赖 stage 字段，回退方案为传入 `'mutation'` 并在 reporter 侧做语义说明。

### 3.4 文档级一致性

- 不修改 T3 已实现的 `buildVuexErrorDetail` 签名；仅在 strict 命中后增补 `mutatedKeyPath` 字段。
- 不引入新的工具函数 export，所有逻辑保留在 inject.iife.ts 内。

---

## 4. 测试计划

### 4.1 单元测试

- `tests/vuex-monitor.test.ts` 扩展：
  - **TC-8（strict 违规命中主路径）**：fixture `vue-vuex-strict.html` 中 `strict: true` 的 store，在 mutation 外修改 state，断言落盘 `vuex-strict-violation`，包含 `modulePath`、`mutatedKeyPath`，且 `context.stage` 字段不存在（对应 P1-1）。
  - **TC-8a1（mutatedKeyPath 命中 mutation.type 路径）**：在 strict 违规命中场景下，先 dispatch / commit 一次合法 mutation（形如 `user/setProfile`），随后在 mutation 外改写 state 触发 strict 违规；断言落盘的 `mutatedKeyPath === 'user/setProfile'`（命中 `ctx.lastMutation?.type` 分支或 `mutationType` 入参分支），用例不报错且字段非空。
  - **TC-8a2（unknown 兜底分支负向测试）**：构造 `mutationType` 为空字符串且 `ctx.lastMutation === null` 的极端调用路径（直接对 `inferMutatedKeyPath` 进行单元函数级调用，绕过 commit 包装），断言返回 `'unknown'`；用以覆盖兜底分支的类型完备性（评审 P2-1，理论上通过 commit 包装入口不可达，故采用函数级负向调用）。
  - **TC-8b（非 strict store 负向测试）**：fixture 中 `store.strict === false` 时，在 mutation 外改写 state，不应抛错也不应落盘 `vuex-strict-violation`（断言运行时日志中无该子类型记录，且不误报为 `vuex-error`，评审 P2-1）。
  - **TC-6 回归**：非 strict 违规的 mutation 抛错落盘 `vuex-error`，stage=`mutation`，不归入 strict 分类。

### 4.2 集成测试 / 端到端测试

- 由 T6 通过 Playwright 完整链路验证。

### 4.3 回归测试

- TC-4 / TC-5 / TC-6 / TC-7 不受 strict 分流影响。

---

## 5. 风险与依赖

| 风险 / 依赖 | 影响 | 应对措施 |
|---|---|---|
| 依赖 T3 的 commit 包装结构 | 阻塞本任务 | T3 通过后启动；T3 已在代码中预留 `TODO(T4)` 接入点 |
| `store._committing` / `store.strict` 私有字段在 Vuex 后续版本被重命名 | strict 识别失效 | 失败时回退为 `vuex-error`，不误报；§7 风险表已登记 |
| message 正则匹配仅作辅助，仍有少量「非英文环境 message 被本地化」边界 | 漏报 | Vuex 4 源码内 strict 违规 message 为英文硬编码，不受 i18n 影响（验证依据：Vuex 4 `src/store.js`） |

---

## 6. 变更范围

- **本任务范围内**：`lib/inject.iife.ts` 中 `detectStrictViolation` / `inferMutatedKeyPath`、commit 包装内的分流逻辑、`buildVuexErrorDetail` detail 中 `mutatedKeyPath` 字段补充。
- **不在本任务范围内**：
  - logger / analyzer 白名单扩展（T5）；
  - strict 违规对应的 fixture HTML（T6）；
  - 文档更新（T7）。

---

## 7. 评审记录

| 轮次 | 日期 | 结论 | P0/P1 问题 | 修复方案 |
|---|---|---|---|---|
| 1 | 2026-06-22 | 不通过 | P0-1 detectStrictViolation 判定顺序倒置（先 message 后结构特征）；P0-2 兜底分支 `lastMutation === null` 多余约束导致漏报；P1-1 strict 违规 detail 沿用 stage=`mutation` 语义误导；P1-2 inferMutatedKeyPath 函数语义未澄清；P1-3 T3/T4 接入点缺锚点 + 缺去重守卫；P2-1 TC-8a 用例未拆分、缺 strict===false 负向测试 | §1 任务目标重写（与 design §3.2 对齐）；§3.1 调整判定顺序，结构特征 `_committing === false` 为主、message 正则为辅，删除 `lastMutation === null` 约束，并补充 watcher 抛错捕获论证；§3.2 inferMutatedKeyPath 增加函数级语义注释；§3.3 引入 `// SHIELD_T4_HOOK` 锚点 + `isShieldEmitted` 去重守卫 + strict 分支 `delete context.stage`；§4.1 拆分 TC-8a1 / TC-8a2 并新增 TC-8b 负向用例 |
| 2 | — | 待评审 | — | 本版本为修订后稿，待重评 |
