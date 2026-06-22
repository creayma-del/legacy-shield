# T2：Pinia patch 与 action / 插件错误采集

> 版本：v1.4
> 任务编号：T2
> 对应阶段 Spec：[phase-v1.4-spec.md](phase-v1.4-spec.md)
> 对应设计文档：[design-v1.4.md](../design-v1.4.md)
> 对应执行计划：[execution-plan-v1.4.md](../execution-plan-v1.4.md)
> 依赖任务：T1
> 状态：已通过
> 评审记录：见本文档末尾（轮次 1 不通过、轮次 2 通过）

---

## 1. 任务目标

在 `lib/inject.iife.ts` 中实现 Pinia 2.x 实例识别与 patch 逻辑，自动采集：
- Pinia store action 同步 / 异步抛错（落盘 `pinia-error`）；
- Pinia 插件 install 阶段抛错（落盘 `pinia-plugin-error`）；
- 动态注册的 store action 抛错（验证官方插件 API 主链路）。

主链路采用 Pinia 官方 `pinia.use(plugin)` 插件 API，不依赖私有 `_s.set` 包装。

对应阶段 Spec §3.3 与交付物 D5。

---

## 2. 对应需求与验收标准

| 需求编号 | 需求描述 | 本任务验收标准 |
|---|---|---|
| REQ-1.4-1 | 自动识别并 patch Pinia 2.x | shield 启动后无业务改造，Pinia store 错误被采集；`isPiniaInstance` 通过 `_p` 数组等私有特征强校验 |
| REQ-1.4-3 | 采集 Pinia action 抛错与 `$onAction` onError 回调 | 同步 / 异步抛错均落盘为 `pinia-error`，含 storeId、actionName、args(脱敏)、stateKeys 等 |
| REQ-1.4-6 | 采集 Pinia 插件 install / extend 抛错 | 落盘 `pinia-plugin-error`，含 pluginName（best-effort）与 stack |
| REQ-1.4-9 | 与 Vue errorHandler 链路去重 | `__shield_emitted__` 标记跨链路共享，不重复落盘 |
| REQ-1.4-10 | 默认开启 + 未使用时静默跳过 | 业务未引入 Pinia 时 `isPiniaInstance` 返回 false，不影响现有流程 |

---

## 3. 实现步骤

### 3.1 在 `lib/inject.iife.ts` 新增 `isPiniaInstance`

```typescript
function isPiniaInstance(p: unknown): boolean {
  return !!(
    p &&
    typeof p === 'object' &&
    typeof (p as any).install === 'function' &&
    (p as any)._s && typeof (p as any)._s.forEach === 'function' &&
    Array.isArray((p as any)._p)
  );
}
```

### 3.2 新增 `patchPinia` 主链路

实现见 [design-v1.4.md §3.1](../design-v1.4.md#31-pinia-patch) 中代码片段。要点：
1. 守卫：`pinia.__shield_patched__ = true`；
2. 包装 `pinia.use`：先保存原始方法引用 `const originalUse = pinia.use.bind(pinia);`，再以包装函数覆盖 `pinia.use`，包装函数内部统一通过 `originalUse(plugin)` 调用原始方法；捕获用户插件 install 抛错，emit `pinia-plugin-error` 后 throw 回业务；
3. 注册 shield 内部插件：**必须使用 `originalUse(shieldPlugin)` 调用原始方法**，避免再次经过已包装的 `pinia.use`，防止 shieldPlugin 自身（极端边界场景下）抛错被包装层捕获后误发 `pinia-plugin-error`；在每个 store 初始化时设置 `store.__shield_app_id__ = appId` 并调用 `registerOnAction(store)`；
   - 备选方案（若实现上必须经由包装层）：在 `pinia.use` 包装函数的外层 catch 中追加 `if (!isShieldEmitted(err)) { ... }` 守卫，避免对同一错误重复 `emitRuntime('pinia-plugin-error', ...)`；两种方案二选一即可，推荐前者；
4. 兜底 `pinia._s.forEach`：对已注册 store 补登 `registerOnAction`，**逐 store try/catch 包裹**（在 forEach 回调内部对单个 store 的处理整体 try/catch），确保单个 store 失败不影响其他 store 的补登，捕获后静默跳过。

### 3.3 新增 `registerOnAction`

```typescript
function registerOnAction(store: any): void {
  if (!store || store.__shield_patched__) return;
  store.__shield_patched__ = true;
  if (typeof store.$onAction !== 'function') return;
  store.$onAction(({ name, args, onError }: any) => {
    onError((err: unknown) => {
      if (isShieldEmitted(err)) return;
      markShieldEmitted(err);
      emitRuntime(
        'pinia-error',
        buildPiniaErrorDetail(err, store, name, args, store.__shield_app_id__),
        'error',
      );
    });
  });
}
```

### 3.4 新增 `buildPiniaErrorDetail` / `buildPiniaPluginErrorDetail`

- `buildPiniaErrorDetail(err, store, actionName, args, appId)`：
  - 输入 `args` 经 `redactValue(args, SHIELD_REDACT_FIELDS)` 脱敏；
  - 调用 `buildStateSummary(store.$state)` 得到 state 摘要字段；
  - 返回 detail：`{ message, stack, source: 'pinia', context: { appId, storeId: store.$id, actionName, args: redactedArgs, stateKeys, stateSizeBytes, stateTruncated, stateUnserializable? } }`。
- `buildPiniaPluginErrorDetail(err, plugin, appId)`：
  - 尝试推断 `pluginName`：优先取 `plugin?.name`，其次 `plugin?.install?.name`；若仍为空再尝试 `plugin?.toString?.().slice(0, 40)`，但**仅当 toString 结果不包含字符串 `"function"` 且不包含 `"=>"`** 时才采用（即过滤掉匿名函数 / 箭头函数的源码字符串），否则置为 `undefined`；
  - 返回 detail：`{ message, stack, source: 'pinia-plugin', context: { appId, pluginName? } }`。

### 3.5 在 `patchAppUse` 中调用 patchPinia

- 在 `patchAppUse` 内 `app.use` 包装函数中，于 `patchRouter` 调用之后，增加：
  ```typescript
  if (isPiniaInstance(plugin)) {
    patchPinia(app, plugin, appId);
  } else if (isVuexStore(plugin)) {
    /* T3 在此处插入 */
  }
  ```
- 在 `patchAppUse` 末尾兜底：位置位于 **`patchAppUse` 函数体尾部、现有 `globalProperties.$router` 兜底块之后**，与 `globalProperties` 读取语句保持同层级（即与 `$router` 兜底块平级，同属 `patchAppUse` 函数体最外层作用域，而非嵌套在 `app.use` 包装函数内部）。代码片段示例：
  ```typescript
  function patchAppUse(app: any, appId: string): void {
    // ... 既有 app.use 包装逻辑 ...

    // 既有 $router 兜底块（位置参考，不在本任务变更范围）
    const globalProperties = app?.config?.globalProperties;
    if (globalProperties?.$router && !globalProperties.$router.__shield_patched__) {
      patchRouter(app, globalProperties.$router, appId);
    }

    // 新增：$pinia 兜底块（与上方 $router 兜底块同层级）
    if (globalProperties?.$pinia && isPiniaInstance(globalProperties.$pinia)) {
      patchPinia(app, globalProperties.$pinia, appId);
    }
  }
  ```
- T3 未完成时，`isVuexStore` 可临时返回 `false`（由 T3 提供实现），但代码结构保留 else if 分支。

> **代码注释要求**：`__shield_app_id__` 首次写入即生效，store 一旦被 `__shield_patched__` 守卫早返后不会被二次覆盖（对应评审 P2-1）。

---

## 4. 测试计划

### 4.1 单元测试

- `tests/pinia-monitor.test.ts`（新增，覆盖部分在 T6 落地，本任务先做最小冒烟）：
  - TC-1（同步抛错）：启动 fixture `vue-pinia-error.html` 后触发 store action 同步抛错，断言落盘 `pinia-error`，含 storeId / actionName / stateKeys；**并断言 `detail.stack` 字段存在且为非空字符串**（若运行环境不保证非空，至少断言该字段存在于 detail 中）。
  - TC-2（异步抛错）：同 fixture，触发 async action 抛错，断言同 TC-1；**同样断言 `detail.stack` 字段存在且为非空字符串**（或至少存在该字段）。
  - TC-3（插件抛错）：启动 fixture `vue-pinia-plugin-error.html`，断言落盘 `pinia-plugin-error`；**并断言 `detail.context.pluginName` 字段的类型为 `string | undefined`**（即匿名 / 箭头函数场景下应为 `undefined`，具名函数 / 显式 `name` 属性场景下应为 string）。

### 4.2 集成测试 / 端到端测试

- 与 T6 协同，使用 Playwright + 本地 vendor 完成完整链路验证。

### 4.3 回归测试

- TC-9：业务未引入 Pinia 时，`isPiniaInstance` 返回 false，`plain.html` / `vue-render-error.html` 等既有 fixture 行为不变。
- 既有 Vue render error / router error / vue-warn / unhandledrejection 用例全绿。

---

## 5. 风险与依赖

| 风险 / 依赖 | 影响 | 应对措施 |
|---|---|---|
| 依赖 T1 工具函数（`redactValue` / `buildStateSummary`） | 阻塞本任务开发 | T1 评审通过且实现完成后启动本任务 |
| Pinia 内部 `_p` / `_s` 私有字段未来变更 | 识别失效 | duck typing 双重校验；TC-15 单测覆盖动态 store 注册 |
| 业务自定义插件抛出非 Error 对象（字符串 / 数字 / 冻结对象） | `markShieldEmitted` 无法打标 | 依赖 analyzer 1s 窗口 + errorId 兜底去重（v1.1 已有） |

---

## 6. 变更范围

- **本任务范围内**：`lib/inject.iife.ts` 中 `isPiniaInstance` / `patchPinia` / `registerOnAction` / `buildPiniaErrorDetail` / `buildPiniaPluginErrorDetail` 与 `patchAppUse` 内 Pinia 识别分支。
- **不在本任务范围内**：
  - Vuex patch（T3）；
  - strict mode 识别（T4）；
  - logger / analyzer 白名单扩展（T5）；
  - 测试夹具与完整测试用例（T6）；
  - 文档更新（T7）。

---

## 7. 评审记录

| 轮次 | 日期 | 结论 | P0/P1 问题 | 修复方案 |
|---|---|---|---|---|
| 1 | 2026-06-22 | 不通过 → 修订后待重评 | P1-1 `pinia.use` 包装与 `shieldPlugin` 嵌套 try/catch 双重发射风险；P1-2 `globalProperties` 兜底作用域不明确；P2-1 测试计划缺 stack / pluginName 断言；P2-2 `buildPiniaPluginErrorDetail` pluginName toString 未过滤匿名函数；P2-3 `_s.forEach` 未做逐元素 try/catch | P1-1：§3.2 步骤 2/3 明确使用 `originalUse.call(pinia, shieldPlugin)`（或备选：外层 catch 增加 `isShieldEmitted` 守卫）；P1-2：§3.5 明确兜底位于 `patchAppUse` 函数体尾部、`$router` 兜底块之后，与 `globalProperties` 同层级，并补充代码示例；P2-1：§4.1 TC-1/TC-2 补充 `stack` 字段断言、TC-3 补充 `pluginName` 类型断言；P2-2：§3.4 增加 toString 过滤条件（不含 `"function"` 且不含 `"=>"`）；P2-3：§3.2 步骤 4 改为逐 store try/catch |
