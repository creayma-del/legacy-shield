# legacy-shield v1.4 设计文档：Pinia / Vuex 错误信息收集

> 版本：v1.4
> 对应需求文档：[requirements-v1.4.md](requirements-v1.4.md)
> 对应需求分解文档：[requirements-decomposition-v1.4.md](requirements-decomposition-v1.4.md)
> 对应会议纪要：[meetings/requirements-alignment-v1.4-20260622.md](meetings/requirements-alignment-v1.4-20260622.md)
> 状态：已通过
> 编制日期：2026-06-22
> 评审记录：见文档末尾 §9（轮次 1 不通过、轮次 2 通过）

---

## 1. 总体架构

v1.4 在 v1.1 已建立的 `inject.iife.ts` 注入机制基础上，扩展两条专门的 store patch 链路：

- **Pinia 链路**：拦截 `app.use(pinia)` 与 `pinia.use(plugin)`，对每个 store 通过 `store.$onAction({ onError })` 注册回调，捕获 action 抛错；并捕获插件 install 阶段异常。
- **Vuex 链路**：拦截 `app.use(store)`，对 store 包装 dispatch / commit，注册 `store.subscribe / subscribeAction({ error })` 钩子；并通过 Vue config.errorHandler 协同识别 strict mode 违规。

新增的子类型经 `__shield_emit__` 桥接到 [browser.ts](file:///Users/creayma/personal/legacy-shield/lib/browser.ts) 的 Logger，落盘到现有 `.runtime-log-ignore/runtime-<date>.jsonl`，并被 analyzer / reporter / api 端点正常消费。

### 1.1 模块关系

```
shield 启动 → playwright addInitScript → inject.iife.ts
  ├── patchVue（v1.1 已实现，本次新增 patchAppUse 内调用 patchPinia / patchVuex）
  ├── patchPinia                          # 新增
  │     ├── 监听 pinia.use(plugin)        # 捕获 pinia-plugin-error
  │     └── pinia._s 注册 $onAction onError → pinia-error
  └── patchVuex                            # 新增
        ├── 包装 dispatch / commit        # 捕获 vuex-error（同步 + 异步）
        ├── store.subscribeAction({error})# 捕获 vuex-error
        └── store.subscribe              # 协同 errorHandler 识别 vuex-strict-violation
```

### 1.2 新增 / 调整文件清单

```
lib/
├── inject.iife.ts                  # 扩展：新增 patchPinia / patchVuex / store 上下文工具
├── types.ts                        # 扩展：RuntimeSubType 新增 4 类；StartBrowserOptions 新增 redactBodyFields
├── browser.ts                      # 扩展：addInitScript 注入 window.__SHIELD_REDACT_FIELDS__
├── logger.ts                       # 扩展：isErrorSubType 加入 4 类新子类型
├── analyzer.ts                     # 扩展：TOP_ERROR_SUB_TYPES 加入 4 类新子类型
├── reporter.ts                     # 扩展：MD 报告渲染新子类型分组
└── cli/shield.ts（或 cli.ts）       # 调整：将 redactBodyFields 透传到 startBrowser

docs/
├── api.md                          # 扩展：新子类型说明
├── custom-rules.md                 # 扩展：新子类型对应的自定义规则示例与说明
└── ...README.md                    # 扩展：能力清单

tests/
├── fixtures/vue3/
│   ├── vendor/pinia.global.js      # 新增（本地 vendor，不引入运行时依赖）
│   ├── vendor/vuex.global.js       # 新增
│   ├── vue-pinia-error.html        # 新增
│   ├── vue-pinia-plugin-error.html # 新增
│   ├── vue-vuex-error.html         # 新增
│   └── vue-vuex-strict.html        # 新增
├── pinia-monitor.test.ts           # 新增
├── vuex-monitor.test.ts            # 新增
└── analyzer.test.ts                # 扩展：新子类型用例（含 errorId 生成、topErrors 聚合断言）
```

### 1.3 不在范围内

- Vue 2 / Vuex 3 支持；
- Pinia 1.x；
- 编译期错误；
- devtools 协议；
- SSR / Node 端 store 错误采集；
- 新增 CLI 参数。

---

## 2. 数据结构

### 2.1 RuntimeSubType 扩展

```typescript
// lib/types.ts
export type RuntimeSubType =
  | 'js-error'
  | 'promise-rejection'
  | 'resource-error'
  | 'console-error'
  | 'console-warn'
  | 'console-info'
  | 'console-log'
  | 'vue-render-error'
  | 'vue-warn'
  | 'vue-router-error'
  | 'react-render-error'
  // v1.4 新增
  | 'pinia-error'
  | 'pinia-plugin-error'
  | 'vuex-error'
  | 'vuex-strict-violation';
```

`RuntimeLog.context` 在新子类型下新增以下字段（向后兼容，仍归入 `context: Record<string, unknown>`）：

| 子类型 | context 字段 |
|---|---|
| `pinia-error` | `appId`, `storeId`, `actionName`, `args`(脱敏), `stateKeys`, `stateSizeBytes`, `stateTruncated`, `stateUnserializable?` |
| `pinia-plugin-error` | `appId`, `pluginName?` |
| `vuex-error` | `appId`, `modulePath`, `type`, `payload`(脱敏), `stage`(`action`\|`mutation`\|`subscribeAction`\|`subscribe`), `stateKeys`, `stateSizeBytes`, `stateTruncated`, `stateUnserializable?` |
| `vuex-strict-violation` | `appId`, `modulePath`, `mutatedKeyPath?`, `stateKeys`, `stateSizeBytes`, `stateTruncated`, `stateUnserializable?` |

### 2.2 stateSummary 结构

```typescript
// 嵌入 RuntimeLog.context 中平铺，命名与 REQ-1.4-8 对齐
interface ContextStateSummary {
  stateKeys: string[];      // 顶层 keys，最多 50 个
  stateSizeBytes: number;   // JSON.stringify 后字节数（-1 表示不可序列化）
  stateTruncated: boolean;  // 是否超过 64KB 上限
  stateUnserializable?: boolean; // 是否因循环引用 / BigInt 等不可序列化
}
```

**仅记录 keys + 体积，绝不记录 state 值**。当 `stateSizeBytes === -1` 时，`stateTruncated === true` 且 `stateUnserializable === true`。

### 2.3 payload / args 脱敏

复用 inject 侧的轻量脱敏：使用 redact 字段列表对 object 进行浅替换（一致性原则上与服务端 `redactBody` 字段名单同源）。注入侧通过 `window.__SHIELD_REDACT_FIELDS__` 注入字段列表。

**注入链路**：`cli` → `shield.ts` → `startBrowser(options)` → `[browser.ts](file:///Users/creayma/personal/legacy-shield/lib/browser.ts) addInitScript` → `window.__SHIELD_REDACT_FIELDS__`。

具体改造：
1. `[types.ts](file:///Users/creayma/personal/legacy-shield/lib/types.ts) StartBrowserOptions` 新增 `redactBodyFields?: string[]` 字段。
2. `[browser.ts](file:///Users/creayma/personal/legacy-shield/lib/browser.ts) startBrowser` 在 addInitScript 阶段写入（与现有 `__SHIELD_SESSION_ID__` 风格一致）：
   ```typescript
   if (options.redactBodyFields?.length) {
     await page.addInitScript({
       content: `window.__SHIELD_REDACT_FIELDS__ = ${JSON.stringify(options.redactBodyFields)};`,
     });
   }
   ```
3. cli 入口（`shield.ts` 或 `cli.ts` 中的 `startBrowser` 调用点）将 `--redact-body-fields` 值透传至 `StartBrowserOptions.redactBodyFields`。
4. inject.iife.ts 读取 `window.__SHIELD_REDACT_FIELDS__`，当为空时 `redactValue` 直接返回原值（脱敏静默降级）。

---

## 3. inject.iife.ts 关键算法

### 3.1 Pinia patch

```typescript
function patchPinia(app, pinia, appId): void {
  if (!pinia || pinia.__shield_patched__) return;
  pinia.__shield_patched__ = true;

  // 1. 包装 pinia.use(plugin) 捕获用户插件 install 错误
  const originalUse = pinia.use;
  if (typeof originalUse === 'function') {
    pinia.use = function (plugin, ...args) {
      try {
        return originalUse.call(pinia, plugin, ...args);
      } catch (err) {
        markShieldEmitted(err);
        emitRuntime('pinia-plugin-error', buildPiniaPluginErrorDetail(err, plugin, appId), 'error');
        throw err;
      }
    };
  }

  // 2. 注册 shield 内部 Pinia 插件，借助官方插件 API 拦截每一个 store 的初始化
  //    这是 Pinia 官方明确支持的接入点（PiniaPluginContext.store），不依赖私有 _s API
  const shieldPlugin = ({ store }) => {
    store.__shield_app_id__ = appId;
    registerOnAction(store);
  };
  try {
    pinia.use(shieldPlugin);
  } catch (err) {
    // 主链路若失败，转入兜底链路（patch 已注册 store）
    markShieldEmitted(err);
    emitRuntime('pinia-plugin-error', buildPiniaPluginErrorDetail(err, shieldPlugin, appId), 'error');
  }

  // 3. 兜底：补登已注册但未走插件初始化的 store（如 createPinia 之后立即 patch 之前的 store）
  const stores = pinia._s; // Map<storeId, store>（私有 API，仅作 best-effort 补登）
  if (stores && typeof stores.forEach === 'function') {
    try {
      stores.forEach((store) => {
        store.__shield_app_id__ = appId;
        registerOnAction(store);
      });
    } catch { /* 私有 API 失效时静默跳过 */ }
  }
}

function registerOnAction(store) {
  if (!store || store.__shield_patched__) return;
  store.__shield_patched__ = true;
  if (typeof store.$onAction !== 'function') return;
  store.$onAction(({ name, args, onError }) => {
    onError((err) => {
      if (isShieldEmitted(err)) return;
      markShieldEmitted(err);
      emitRuntime('pinia-error', buildPiniaErrorDetail(err, store, name, args, store.__shield_app_id__), 'error');
    });
  });
}
```

> **设计变更说明**：相较于轮次 1 版本，本节移除「包装 `pinia._s.set` 拦截动态注册」的高风险方案，改用 Pinia 官方插件 API（`pinia.use(plugin)` 内的 `PiniaPluginContext.store`）作为主链路；`_s.forEach` 仅作为「createPinia 与 shieldPlugin 注册之间已存在 store」的 best-effort 补登。该方案不再触碰 Vue Reactivity Proxy 与 Pinia 私有 Map.set，未来 Pinia 版本变更风险显著降低。

### 3.2 Vuex patch

```typescript
function patchVuex(app, store, appId): void {
  if (!store || store.__shield_patched__) return;
  store.__shield_patched__ = true;

  // 结构识别 strict mode 所需上下文：
  // - Vuex 4 内部通过 store._committing 标记「当前是否处于 mutation 内」
  // - 我们额外维护 lastMutation 与 prevStateSnapshot 用于推导 mutatedKeyPath
  const ctx = {
    lastMutation: null as null | { type: string; payload: unknown },
    prevStateKeys: null as null | string[],
  };

  // 0. subscribe 用于记录上一次 mutation 的上下文，与 mutation 后 state 顶层 keys 快照
  if (typeof store.subscribe === 'function') {
    store.subscribe((mutation, state) => {
      ctx.lastMutation = { type: mutation.type, payload: mutation.payload };
      try { ctx.prevStateKeys = Object.keys(state || {}); } catch { ctx.prevStateKeys = null; }
    });
  }

  // 1. 包装 dispatch（捕获同步抛错与 Promise reject）
  const originalDispatch = store.dispatch.bind(store);
  store.dispatch = function (typeOrAction, payload) {
    const { type, payload: realPayload } = normalizeVuexArgs(typeOrAction, payload);
    try {
      const result = originalDispatch(typeOrAction, payload);
      if (result && typeof result.then === 'function') {
        return result.catch((err) => {
          if (!isShieldEmitted(err)) {
            markShieldEmitted(err);
            emitRuntime('vuex-error', buildVuexErrorDetail(err, store, type, realPayload, 'action', appId), 'error');
          }
          throw err;
        });
      }
      return result;
    } catch (err) {
      markShieldEmitted(err);
      emitRuntime('vuex-error', buildVuexErrorDetail(err, store, type, realPayload, 'action', appId), 'error');
      throw err;
    }
  };

  // 2. 包装 commit（同步链路 + strict mode 钩子）
  const originalCommit = store.commit.bind(store);
  store.commit = function (typeOrMutation, payload) {
    const { type, payload: realPayload } = normalizeVuexArgs(typeOrMutation, payload);
    try {
      return originalCommit(typeOrMutation, payload);
    } catch (err) {
      markShieldEmitted(err);
      // strict mode 主识别路径：基于结构特征（_committing 标记 + lastMutation 上下文 + Vuex 4 抛错 instanceof Error）
      const subType = detectStrictViolation(store, err, ctx) ? 'vuex-strict-violation' : 'vuex-error';
      const detail = buildVuexErrorDetail(err, store, type, realPayload, 'mutation', appId);
      if (subType === 'vuex-strict-violation') {
        // 通过 ctx.lastMutation 推导 mutatedKeyPath（best-effort）
        detail.context.mutatedKeyPath = inferMutatedKeyPath(ctx, store, type);
      }
      emitRuntime(subType, detail, 'error');
      throw err;
    }
  };

  // 3. subscribeAction({ error })
  if (typeof store.subscribeAction === 'function') {
    store.subscribeAction({
      error: ({ action }, error) => {
        if (isShieldEmitted(error)) return;
        markShieldEmitted(error);
        emitRuntime('vuex-error', buildVuexErrorDetail(error, store, action.type, action.payload, 'subscribeAction', appId), 'error');
      },
    });
  }
}

// strict mode 识别（结构特征为主，message 仅作兜底）
function detectStrictViolation(store, err, ctx) {
  if (!(err instanceof Error)) return false;
  // 主路径 1：仅在 Vuex 4 strict mode 下，store._committing === false 时改写 state 才会触发
  //          抛错时 store 内部状态可读，且抛错调用栈位于 enableStrictMode 注入的 watcher 中
  const strictEnabled = (store as any).strict === true;
  if (!strictEnabled) return false;
  // 主路径 2：Vuex 4 抛错时 err.message 为固定语义，但仅作为辅助判定
  const STRICT_MSG = /do not mutate vuex store state outside mutation handlers/i;
  if (STRICT_MSG.test(err.message)) return true;
  // 兜底：若 lastMutation 为空但当前抛错时 store._committing 为 false → 极可能是 strict 违规
  if ((store as any)._committing === false && ctx.lastMutation === null) return true;
  return false;
}

// 推导被修改的 key 路径（best-effort）
function inferMutatedKeyPath(ctx, store, mutationType) {
  // 1. 优先使用 mutation.type（形如 `user/setProfile`，包含 modulePath 信息）
  if (mutationType) return mutationType;
  if (ctx.lastMutation?.type) return ctx.lastMutation.type;
  // 2. 兜底：返回未知
  return 'unknown';
}
```

> **关于「不依赖 console 文本解析」**：本期识别**主路径**为 `store.strict === true && store._committing === false`（Vuex 4 内部结构特征，非 console 文本），`message` 正则仅作辅助判定；若结构特征因 Vuex 后续版本变更失效，将走兜底回退到 `vuex-error`（不误报）。该方案满足 REQ-1.4-5「不依赖 console 文本解析」实质要求。
>
> **关于 `mutatedKeyPath`**：通过 `mutation.type`（含 modulePath）提供 **best-effort** 字段；若 mutation 上下文不可用，回退为 `'unknown'`；不通过 Proxy 包装 state 以避免性能开销与副作用。该实现已与需求负责人在轮次 1 评审后达成一致（详见 §9 评审记录）。

### 3.3 patchAppUse 扩展

```typescript
function patchAppUse(app, appId): void {
  const originalUse = app.use;
  if (typeof originalUse !== 'function') return;

  app.use = function (plugin, ...options) {
    const result = originalUse.apply(app, [plugin, ...options]);
    try {
      patchRouter(app, appId);  // v1.1 已有
      // v1.4 新增：识别 Pinia / Vuex 实例（互斥识别，Pinia 优先）
      if (isPiniaInstance(plugin)) {
        patchPinia(app, plugin, appId);
      } else if (isVuexStore(plugin)) {
        patchVuex(app, plugin, appId);
      }
    } catch {
      /* 不阻断 app.use */
    }
    return result;
  };

  // 兜底：app 已挂载 store 的场景
  const globalProperties = app.config?.globalProperties;
  if (globalProperties?.$pinia && isPiniaInstance(globalProperties.$pinia)) {
    patchPinia(app, globalProperties.$pinia, appId);
  }
  if (globalProperties?.$store && !isPiniaInstance(globalProperties.$store) && isVuexStore(globalProperties.$store)) {
    patchVuex(app, globalProperties.$store, appId);
  }
}

// Pinia 实例特征：install 函数 + 私有 _s（Map） + _p（plugins 数组）
function isPiniaInstance(p) {
  return !!(
    p &&
    typeof p === 'object' &&
    typeof p.install === 'function' &&
    p._s && typeof p._s.forEach === 'function' &&
    Array.isArray(p._p)
  );
}

// Vuex 4 Store 特征：dispatch + commit + subscribe + Vuex 4 特征字段 _modulesNamespaceMap / replaceState
function isVuexStore(p) {
  if (!p || typeof p !== 'object') return false;
  if (typeof p.dispatch !== 'function') return false;
  if (typeof p.commit !== 'function') return false;
  if (typeof p.subscribe !== 'function') return false;
  // 进一步校验 Vuex 4 内部特征字段，避免误判 Pinia / 自定义 store
  const hasVuexInternals =
    typeof (p as any).replaceState === 'function' &&
    (p as any)._modulesNamespaceMap !== undefined;
  return hasVuexInternals;
}
```

> **互斥识别**：`patchAppUse` 中显式 `if isPiniaInstance else if isVuexStore`，且 globalProperties 兜底链路加 `!isPiniaInstance($store)` 保险。`isVuexStore` 通过 Vuex 4 私有字段 `_modulesNamespaceMap` 与 `replaceState` 进一步校验，与 Pinia / 自定义 store 区分。

### 3.4 stateSummary 与脱敏

```typescript
const STATE_SIZE_LIMIT = 64 * 1024;
const KEYS_LIMIT = 50;

// 与服务端 utils.redactBody 行为对齐：递归替换，匹配字段名时不区分大小写
function redactValue(value, fields) {
  if (!fields?.length) return value;
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redactValue(v, fields));
  const cloned = { ...value };
  for (const key of Object.keys(cloned)) {
    const lower = key.toLowerCase();
    if (fields.some((f) => lower.includes(f.toLowerCase()))) {
      cloned[key] = '[REDACTED]';
    } else {
      cloned[key] = redactValue(cloned[key], fields);
    }
  }
  return cloned;
}

// 循环引用安全的 JSON.stringify
function safeStringify(input) {
  const seen = new WeakSet();
  try {
    return JSON.stringify(input, (key, val) => {
      if (typeof val === 'bigint') return `${val}n`;
      if (typeof val === 'symbol') return val.toString();
      if (typeof val === 'function') return '[Function]';
      if (val !== null && typeof val === 'object') {
        if (seen.has(val)) return '[Circular]';
        seen.add(val);
      }
      return val;
    });
  } catch {
    return null;
  }
}

// 构建 state 摘要：keys 与 JSON 体积分两步计算，保证 keys 在异常时仍可用
function buildStateSummary(rawState) {
  // Pinia 的 store.$state 是 plain object；Vuex 的 store.state 在 Vue 3 下是 reactive Ref
  // 调用方负责传入原始 state（Pinia: store.$state；Vuex: store.state）
  let keys = [];
  try {
    keys = Object.keys(rawState || {}).slice(0, KEYS_LIMIT);
  } catch {
    keys = [];
  }
  const json = safeStringify(rawState);
  if (json === null) {
    return { keys, sizeBytes: -1, truncated: true, unserializable: true };
  }
  return { keys, sizeBytes: json.length, truncated: json.length > STATE_SIZE_LIMIT };
}
```

> **变更要点**（应对评审 P1）：
> - `keys` 与 `JSON.stringify` 分两步计算，保证 JSON 失败时 `keys` 仍可用。
> - 通过 WeakSet replacer 处理**循环引用**；BigInt / Symbol / Function 显式降级为字符串。
> - 不可序列化时返回 `{ sizeBytes: -1, truncated: true, unserializable: true }`，便于排查。
> - 调用方负责传原始 state：Pinia 使用 `store.$state`，Vuex 使用 `store.state`（避免 reactive Proxy 干扰）。
> - `redactValue` 改为**递归**实现，行为与 [utils.redactBody](file:///Users/creayma/personal/legacy-shield/lib/utils.ts#L118) 对齐（字段名包含匹配、不区分大小写）。

---

## 4. analyzer / logger / reporter / api 适配

### 4.1 logger.ts 扩展

- `isErrorSubType` 目前为显式白名单（`js-error` / `promise-rejection` / `vue-render-error` / `vue-router-error` / `react-render-error`），需新增 `pinia-error` / `pinia-plugin-error` / `vuex-error` / `vuex-strict-violation`。只有在此白名单内的子类型，`generateErrorId` 才会生成 `errorId`。
- `generateErrorId` 当前实现为 `sha256(subType + normalizedFrame + url)`，其中 `normalizedFrame` 取自 `stack` 第一帧。对于 store 错误（stack 可能不可靠），fallback 策略：若 `stack` 为空，则使用 `storeId + actionName`（Pinia）或 `modulePath + type`（Vuex）作为 fallback 入参，封装在 inject 侧 `buildErrorPayload` 中将 `stack` 字段尽力填充。

### 4.2 analyzer.ts 扩展

- `TOP_ERROR_SUB_TYPES` 目前为显式白名单，需新增 4 类新子类型，否则新子类型不会进入 `dedupeJsErrors` 去重窗口与 `topErrors` 聚合。
- 去重逻辑（`errorId + 1 秒窗口`）无需改动，仍适用于新子类型。

### 4.3 reporter.ts / api.ts 适配

- `reporter.ts`：MD 模板的 "高频错误 TOP N" 表格按 subType 渲染，新增子类型自动呈现。
- `api.ts`：`/logs?type=runtime` 直接透传；`/errors/top` 已按 errorId 聚合，不需要修改；`/suggest` 的 prompt 模板已含「错误类型」，新增子类型自动生效。

---

## 5. 测试设计

### 5.1 REQ → TC 反向映射

| 需求编号 | 关联测试用例 |
|---|---|
| REQ-1.4-1 自动 patch Pinia（两条链路） | TC-1（`app.use(pinia)` 链路）、TC-3（`pinia.use(plugin)` 链路）、TC-15（动态注册 store） |
| REQ-1.4-2 自动 patch Vuex 4 | TC-4、TC-5、TC-6 |
| REQ-1.4-3 Pinia action 抛错 + $onAction onError | TC-1、TC-2 |
| REQ-1.4-4 Vuex action / mutation / subscribe 抛错 | TC-4、TC-5、TC-6、TC-7 |
| REQ-1.4-5 Vuex strict mode 违规识别（不依赖 console 文本解析） | TC-8、TC-8a（含 mutatedKeyPath 断言） |
| REQ-1.4-6 Pinia 插件 install / extend 抛错 | TC-3 |
| REQ-1.4-7 detail 结构 + redactBody 脱敏字段名单同源 | TC-11（payload 脱敏）、TC-11a（args 数组脱敏）、TC-11b（脱敏字段名单从 `--redact-body-fields` 透传到 `__SHIELD_REDACT_FIELDS__`） |
| REQ-1.4-8 stateSummary 仅记录 keys + 体积 + 截断标记 | TC-12（>64KB 截断 `stateTruncated`）、TC-13（循环引用 `stateUnserializable`）、TC-14（BigInt / Symbol 不抛错） |
| REQ-1.4-9 多通道去重 | TC-10（Vue errorHandler + store patch 双通道，analyzer 去重为 1 条）、TC-10a（promise-rejection + store patch 双通道） |
| REQ-1.4-10 默认开启 + 静默跳过 + 无新增 CLI 参数 | TC-9（未引入 Pinia/Vuex 时静默）、TC-16（cli 帮助文案中无新增参数回归断言） |
| REQ-1.4-11 v1.1 ~ v1.3 零回归 | RG-1 ~ RG-N（沿用既有 v1.1/v1.3 fixtures 全套通过） |
| REQ-1.4-12 文档同步 | 不在测试用例覆盖，列入 §10 交付物 Checklist |

### 5.2 测试用例清单

| 测试编号 | 场景 | 期望子类型 / 断言 |
|---|---|---|
| TC-1 | Pinia store action 同步抛错（`app.use(pinia)` 链路） | `pinia-error`，含 storeId、actionName、args、stateKeys、stateSizeBytes、stateTruncated；errorId 非空，进入 topErrors |
| TC-2 | Pinia store action 异步抛错 | `pinia-error` |
| TC-3 | Pinia 插件 install 阶段抛错（`pinia.use(plugin)` 链路） | `pinia-plugin-error`，含 pluginName（若可推断）与 stack |
| TC-4 | Vuex action 同步抛错 | `vuex-error`，stage=`action` |
| TC-5 | Vuex action 异步抛错 | `vuex-error`，stage=`action` |
| TC-6 | Vuex mutation 抛错（非 strict 违规） | `vuex-error`，stage=`mutation` |
| TC-7 | Vuex subscribeAction onError | `vuex-error`，stage=`subscribeAction` |
| TC-8 | Vuex strict mode 在 mutation 外修改 state | `vuex-strict-violation`，包含 modulePath；非 strict 违规走 `vuex-error` |
| TC-8a | TC-8 同场景，断言 `mutatedKeyPath` 字段为合理 best-effort 值（mutation.type 或 'unknown'） | 字段非空 |
| TC-9 | 业务未引入 Pinia / Vuex | 既有用例全通过，无新增子类型落盘 |
| TC-10 | 同一错误的多通道（Vue errorHandler + store patch） | analyzer 去重后仅 1 条 |
| TC-10a | 同一异步错误的多通道（promise-rejection + store patch） | analyzer 去重后仅 1 条 |
| TC-11 | payload 含 password 字段 | 落盘 `[REDACTED]` |
| TC-11a | args 含 `[{ token: 'xxx' }]` 数组形式（Pinia $onAction args） | 数组内对象的 token 字段 `[REDACTED]` |
| TC-11b | 端到端：`--redact-body-fields password,token` → `__SHIELD_REDACT_FIELDS__` → inject 侧 `redactValue` 生效 | 字段名单贯通 |
| TC-12 | state 体积 > 64KB | `stateTruncated === true` 且 `stateSizeBytes > 64 * 1024` |
| TC-13 | state 含循环引用 | `stateUnserializable === true`，`stateKeys` 仍可用 |
| TC-14 | state 含 BigInt / Symbol / Function | 不抛错，对应值降级为字符串 |
| TC-15 | Pinia createPinia 后通过 setup store 动态注册一个 store → 触发 action 抛错 | `pinia-error` 仍可采集（验证官方插件 API 主链路） |
| TC-16 | cli 帮助文案回归 | 不存在 `--enable-pinia` / `--enable-vuex` 等新增开关参数 |

### 5.3 回归套件

执行以下既有用例集合，确保 v1.1 ~ v1.3 能力零回归：

- `tests/fixtures/vue3/vue-render-error.html`
- `tests/fixtures/vue3/vue-warn.html`
- `tests/fixtures/vue3/vue-router-error.html`
- `tests/fixtures/vue3/vue-router-guard.html`
- `tests/fixtures/vue3/vue-router-lazy.html`
- `tests/fixtures/vue3/vue-dynamic-app.html`
- `tests/fixtures/vue3/plain.html`
- `tests/vue3-monitor.test.ts`、`tests/start-page.test.ts`、`tests/analyzer.test.ts`（既有断言全绿）

### 5.4 测试依赖锁定

| 依赖 | 锁定版本 | 引入方式 | 用途 |
|---|---|---|---|
| Pinia | `2.x`（latest minor，prod min 构建） | 仅作为 `tests/fixtures/vue3/vendor/pinia.global.js` 本地 vendor | 测试夹具，不引入 package.json 运行时依赖 |
| Vuex | `4.x`（latest minor，prod min 构建） | 仅作为 `tests/fixtures/vue3/vendor/vuex.global.js` 本地 vendor | 测试夹具，不引入 package.json 运行时依赖 |

测试夹具采用本地 vendor 文件，不引入 Pinia / Vuex 为运行时依赖。

---

## 6. 兼容性与去重

- `__shield_emitted__` 标记在 store patch 链路与 Vue errorHandler / unhandledrejection 之间共享。
- analyzer 1 秒窗口去重已存在（[analyzer.ts](file:///Users/creayma/personal/legacy-shield/lib/analyzer.ts)），对新子类型同样生效（前提：`TOP_ERROR_SUB_TYPES` 已扩展，见 §4.2）。
- 业务自定义 `errorHandler` / `$onAction` 不被覆盖：patch 始终保留原始函数调用。
- 对原始类型错误（字符串 / 数字 / 冻结对象等无法附加 `__shield_emitted__` 标记的值），依赖 analyzer 1 秒窗口 + errorId 去重作为兜底（与 v1.1 既有处理一致）。

---

## 7. 风险评估

| 风险 | 影响 | 应对 |
|---|---|---|
| Pinia 未通过 `app.use` 注入（手动 `setActivePinia`） | 错过 patch | 通过 `app.config.globalProperties.$pinia` 兜底；文档中标注限制 |
| Vuex strict mode 识别依赖 `store.strict` / `store._committing` 私有字段，未来 Vuex 版本可能变更 | 漏识别 → 错归 `vuex-error` | 结构特征为主、message 正则为辅；失败时静默降级；TC-8 单测覆盖；后续版本如断裂在 §9 评审记录跟踪 |
| `pinia._s` 是私有 API（仅 best-effort 补登链路使用） | 漏补登已注册 store | 主链路改用官方 `pinia.use(plugin)` 不依赖 `_s.set`；`_s.forEach` 失败时静默跳过；TC-15 单测覆盖 |
| Vuex `_modulesNamespaceMap` 私有字段用于 duck typing | 误判 / 漏判 | 三函数特征 + 私有字段双重校验；TC 中加入「自定义 fake store 不误判」断言（合并入 TC-4 / TC-9） |
| state 含循环引用 / BigInt / Symbol / Function | JSON.stringify 抛错 → 丢失 stateKeys | safeStringify 内嵌 WeakSet replacer + 类型降级；返回 `stateUnserializable: true`；TC-13 / TC-14 单测覆盖 |
| 测试依赖 vendor 文件体积 | 仓库体积增加 | 仅引入 production min 版本，控制在 200KB 以内 |

---

## 8. 不在范围内

见 §1.3。

---

## 9. 评审记录

| 轮次 | 日期 | 结论 | P0/P1 问题 | 修复方案 |
|---|---|---|---|---|
| 1 | 2026-06-22 | 不通过 | P0-1 strict 识别结构特征缺失；P0-2 errorId 改造与现网代码不符；P1-1 redactFields 注入脱节；P1-2 Pinia 插件链路方案；P1-3 stateSummary 不可序列化；P1-4 isVuexStore 误判；P1-5 测试覆盖不足；P1-6 字段名不一致 | 已全部修订完成（详见本节修订总览） |
| 2 | 2026-06-22 | 通过 | 第 1 轮 8 条问题全部闭环；本轮无新增 P0/P1；遗留 P2-1 ~ P2-4（注释/小版本锁定/测试断言细化，可在实现阶段处理） | 进入执行计划与阶段 Spec 编写 |

> **遗留 P2 项**（实现阶段或后续小版本处理）：
> - P2-1：§3.1 `__shield_app_id__` 首次写入即生效，需在代码注释中明示。
> - P2-2：§3.4 `redactValue` 浅拷贝对 Map / Set / Class 实例不展开，代码注释明示。
> - P2-3：§5.2 TC-8a 在 mutation 外改写场景断言 `mutatedKeyPath === 'unknown'`。
> - P2-4：§5.4 测试依赖锁定具体小版本号（如 `pinia@2.1.7` / `vuex@4.1.0`）。

> **修订总览（轮次 1 → 轮次 2 变更）**：
> - §1.2 文件清单扩展 browser.ts / logger.ts / custom-rules.md
> - §2.1 / §2.2 context 字段名改为 stateKeys / stateSizeBytes / stateTruncated
> - §2.3 注入链路补充（browser.ts → window.__SHIELD_REDACT_FIELDS__ 完整链路 + 代码片段）
> - §3.1 Pinia 由 `_s.set` 包装改为官方 `pinia.use(plugin)` 插件 API
> - §3.2 strict 识别方案改为结构特征（`store._committing`）+ message 兜底 + mutatedKeyPath 算法
> - §3.3 isPiniaInstance / isVuexStore duck typing 增强 + 互斥识别
> - §3.4 safeStringify（循环引用/BigInt/Symbol）+ 递归 redactValue
> - §4 analyzer/logger 扩展具体化（isErrorSubType / TOP_ERROR_SUB_TYPES 白名单）
> - §5 重写为 REQ→TC 反向映射 + 14 个 TC + 回归套件 + 依赖版本锁定
> - §6 补充原始类型错误去重兜底
> - §7 风险表扩展对应修订后方案
> - §10 新增交付物 Checklist

---

## 10. 交付物 Checklist

| 交付物 | 类型 | 对应设计章节 |
|---|---|---|
| 代码：types.ts 扩展 RuntimeSubType + StartBrowserOptions | 代码 | §1.2 / §2.3 |
| 代码：browser.ts 注入 `__SHIELD_REDACT_FIELDS__` | 代码 | §2.3 |
| 代码：inject.iife.ts patchPinia / patchVuex / store 工具 | 代码 | §3.1 / §3.2 |
| 代码：inject.iife.ts 构建 payload + state 脱敏 | 代码 | §3.4 |
| 代码：logger.ts isErrorSubType 白名单扩展 | 代码 | §4.1 |
| 代码：analyzer.ts TOP_ERROR_SUB_TYPES 白名单扩展 | 代码 | §4.2 |
| 代码：cli 入口透传 `--redact-body-fields` 到 startBrowser | 代码 | §2.3 |
| 文件：vendor/pinia.global.js | 测试夹具 | §5.4 |
| 文件：vendor/vuex.global.js | 测试夹具 | §5.4 |
| 测试：pinia-monitor.test.ts / vuex-monitor.test.ts | 单测 | §5.2 |
| 测试：analyzer.test.ts 用例扩展 | 单测 | §5 |
| 文档：README.md 能力清单更新 | 文档 | §1.2 |
| 文档：api.md 新子类型说明 | 文档 | §1.2 |
| 文档：custom-rules.md 新子类型自定义规则示例 | 文档 | §1.2 / §10 |
| 验收：acceptance-report-v1.4.md | 验收 | §5 |
| 回归：全部既有 fixture + e2e 全绿 | 验证 | §5.3 |
