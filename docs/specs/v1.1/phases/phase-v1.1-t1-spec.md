# legacy-shield v1.1 任务 Spec：T1 重构 `inject.iife.ts` Vue 3 补丁逻辑

> 版本：v1.1
> 对应阶段 Spec：[phase-v1.1-spec.md](./phase-v1.1-spec.md)
> 对应执行计划：[execution-plan-v1.1.md](../execution-plan-v1.1.md)
> 状态：已通过，可进入代码开发

---

## 1. 目标

在 `lib/inject.iife.ts` 中实现 Vue 3 运行时错误、运行时警告、Vue Router 4 错误的完整采集，并支持页面运行期间动态创建的 Vue 3 app 自动接入监控。

同时修改 `lib/analyzer.ts` 的 `dedupeJsErrors`，使新增的 `vue-render-error` 与 `vue-router-error` 能正确进入 TOP 错误聚合，且不引入 v1.0 回归。

---

## 2. 范围

**包含**：

- `lib/inject.iife.ts` 中 Vue 3 相关补丁逻辑的重构；
- 新增 `patchVue()`、`patchApp()`、`patchErrorHandler()`、`patchWarnHandler()`、`patchAppUse()`、`patchRouter()`、`wrapGuardHandler()` 等辅助函数；
- `lib/analyzer.ts` 中 `dedupeJsErrors` 过滤条件调整；
- `lib/api.ts` 中 `/suggest` 端点对新增子类型的兼容（`generateFixPrompt` 过滤条件调整）；
- `tests/analyzer.test.ts` 中新增/更新断言；
- `tests/api.test.ts` 中新增 `/suggest` 对新增子类型的兼容性断言。

**不包含**：

- Vue 2 支持；
- Pinia / Vuex 单独 patch；
- Vue 编译时错误采集；
- 测试夹具与端到端测试（由 T3 负责）。

---

## 3. 依赖

- 已批准的 [phase-v1.1-spec.md](../phase-v1.1-spec.md)
- T2 将同步扩展 `lib/types.ts` 与 `lib/logger.ts`，T1 代码实现需在 T2 完成后才能通过 `pnpm typecheck`。

---

## 4. 实现步骤

### 步骤 1：替换 `lib/inject.iife.ts` 中的 `patchVue()`

将现有仅 patch 初始 app `config.errorHandler` 的 `patchVue()` 替换为以下实现。核心机制是**重写 `createApp`**，使所有新 app 创建时自动被打补丁；同时保留 500ms 轮询（最多 20 次）作为防御性兜底。

> 前置依赖：确保 IIFE 顶部已保存原始 console 引用（如 `const originalConsole = { error: console.error.bind(console), warn: console.warn.bind(console) };`），并对全局变量做类型声明（如 `declare const window: Window & { __VUE__?: unknown; Vue?: unknown; };`）。

```ts
function patchVue(): void {
  let pollCount = 0;
  const maxPoll = 20;
  const interval = 500;

  const tryPatch = (): void => {
    const vueGlobal = (window.__VUE__ || window.Vue) as Record<string, unknown> | undefined;
    if (!vueGlobal || vueGlobal.__shield_patched__ === true) return;

    vueGlobal.__shield_patched__ = true;

    try {
      const apps = vueGlobal.apps;
      if (Array.isArray(apps)) {
        apps.forEach((app) => patchApp(app as Record<string, unknown>));
      }
    } catch {
      // 兜底 patch 失败不影响核心机制
    }

    const originalCreateApp = vueGlobal.createApp;
    if (typeof originalCreateApp === 'function') {
      vueGlobal.createApp = function (...args: unknown[]) {
        const app = originalCreateApp.apply(vueGlobal, args);
        try {
          patchApp(app as Record<string, unknown>);
        } catch {
          // patch 失败不阻断 app 创建
        }
        return app;
      };
    }
  };

  tryPatch();
  const timer = setInterval(() => {
    pollCount++;
    tryPatch();
    if (pollCount >= maxPoll) clearInterval(timer);
  }, interval);
}
```

### 步骤 2：新增 `patchApp()` 及辅助函数

在 `patchVue()` 之前（或同一作用域内）新增以下函数。所有函数均不得依赖 `@types/vue`，使用 `Record<string, unknown>` 防御式访问。

```ts
let appIdCounter = 0;

function patchApp(app: Record<string, unknown>): void {
  if (!app || app.__shield_patched__ === true) return;
  app.__shield_patched__ = true;
  const appId = `vue-app-${++appIdCounter}`;

  const config = app.config as Record<string, unknown> | undefined;
  if (!config) return;

  patchErrorHandler(config, appId);
  patchWarnHandler(config, appId);
  patchAppUse(app, appId);
}

function patchErrorHandler(config: Record<string, unknown>, appId: string): void {
  const originalErrorHandler = config.errorHandler as ((err: unknown, instance: unknown, info: string) => void) | undefined;
  config.errorHandler = (err: unknown, instance: unknown, info: string): void => {
    if (typeof originalErrorHandler === 'function') {
      try {
        originalErrorHandler(err, instance, info);
      } catch {
        // 用户 handler 自身抛错不阻断 emit
      }
    } else {
      originalConsole.error(err, info);
    }
    emitRuntime('vue-render-error', buildVueErrorDetail(err, instance, info, appId), 'error');
  };
}

function patchWarnHandler(config: Record<string, unknown>, appId: string): void {
  const originalWarnHandler = config.warnHandler as ((msg: string, instance: unknown, trace: string) => void) | undefined;
  config.warnHandler = (msg: string, instance: unknown, trace: string): void => {
    if (typeof originalWarnHandler === 'function') {
      try {
        originalWarnHandler(msg, instance, trace);
      } catch {
        // 用户 handler 自身抛错不阻断 emit
      }
    } else {
      originalConsole.warn(msg, trace);
    }
    emitRuntime('vue-warn', {
      message: msg,
      source: 'vue-warn-handler',
      context: { trace, appId },
    }, 'warn');
  };
}

function patchAppUse(app: Record<string, unknown>, appId: string): void {
  const originalUse = app.use as (plugin: unknown, ...options: unknown[]) => unknown;
  if (typeof originalUse !== 'function') return;

  app.use = function (plugin: unknown, ...options: unknown[]): unknown {
    const result = originalUse.apply(app, [plugin, ...options]);
    try {
      patchRouter(app, appId);
    } catch {
      // patch 失败不阻断 app.use 返回
    }
    return result;
  };

  const globalProperties = (app.config as Record<string, unknown> | undefined)?.globalProperties as Record<string, unknown> | undefined;
  if (globalProperties?.$router) {
    try {
      patchRouter(app, appId);
    } catch {
      // patch 失败不影响 app 初始化
    }
  }
}
```

### 步骤 3：新增 `patchRouter()` 与守卫包装

```ts
function patchRouter(app: Record<string, unknown>, appId: string): void {
  const globalProperties = (app.config as Record<string, unknown> | undefined)?.globalProperties as Record<string, unknown> | undefined;
  if (!globalProperties) return;

  const router = globalProperties.$router;
  if (!router || (router as Record<string, unknown>).__shield_patched__ === true) return;
  (router as Record<string, unknown>).__shield_patched__ = true;

  const onError = (router as Record<string, unknown>).onError as ((handler: (err: unknown) => void) => void) | undefined;
  if (typeof onError === 'function') {
    onError.call(router, (err: unknown) => {
      if (isShieldEmitted(err)) return;
      emitRuntime('vue-router-error', buildRouterErrorDetail(err, appId), 'error');
    });
  }

  const guardNames = ['beforeEach', 'beforeResolve', 'afterEach'] as const;
  for (const guardName of guardNames) {
    const originalGuard = (router as Record<string, unknown>)[guardName] as ((handler: unknown) => void) | undefined;
    if (typeof originalGuard !== 'function') continue;
    (router as Record<string, unknown>)[guardName] = function (handler: unknown) {
      const wrapped = wrapGuardHandler(handler, appId);
      return originalGuard.call(router, wrapped);
    };
  }
}

function wrapGuardHandler(handler: unknown, appId: string): unknown {
  if (typeof handler !== 'function') return handler;

  return function (this: unknown, ...args: unknown[]): unknown {
    try {
      const result = (handler as (...args: unknown[]) => unknown).apply(this, args);
      if (result && typeof (result as Promise<unknown>).then === 'function' && typeof (result as Promise<unknown>).catch === 'function') {
        return (result as Promise<unknown>).catch((err: unknown) => {
          markShieldEmitted(err);
          emitRuntime('vue-router-error', buildRouterErrorDetail(err, appId, args[0], args[1]), 'error');
          throw err;
        });
      }
      return result;
    } catch (err) {
      markShieldEmitted(err);
      emitRuntime('vue-router-error', buildRouterErrorDetail(err, appId, args[0], args[1]), 'error');
      throw err;
    }
  };
}

function markShieldEmitted(err: unknown): void {
  if (err && typeof err === 'object') {
    try {
      (err as Record<string, unknown>).__shield_emitted__ = true;
    } catch {
      // 对冻结/只读对象赋值失败时不阻断原始异常传播
    }
  }
}

function isShieldEmitted(err: unknown): boolean {
  return !!(err && typeof err === 'object' && (err as Record<string, unknown>).__shield_emitted__);
}
```

### 步骤 4：新增错误详情构建函数

```ts
function buildVueErrorDetail(err: unknown, instance: unknown, info: string, appId: string): Record<string, unknown> {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack || '' : '';
  const componentName = instance ? getComponentName(instance) : '';

  return {
    message,
    stack,
    source: 'vue-error-handler',
    context: { info, componentName, appId },
  };
}

function getComponentName(instance: unknown): string {
  const typed = instance as Record<string, unknown> | undefined;
  if (!typed) return '';
  const type = typed.type as Record<string, unknown> | undefined;
  const name = typed.name || typed.__name || type?.name || type?.__name;
  return typeof name === 'string' ? name : '';
}

function buildRouterErrorDetail(err: unknown, appId: string, to?: unknown, from?: unknown): Record<string, unknown> {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack || '' : '';

  return {
    message,
    stack,
    source: 'vue-router',
    context: {
      appId,
      to: to ? String((to as Record<string, unknown>).path ?? to) : '',
      from: from ? String((from as Record<string, unknown>).path ?? from) : '',
    },
  };
}
```

### 步骤 5：调用 `patchVue()`

确保在 IIFE 末尾、React patch 之前调用 `patchVue()`：

```ts
patchVue();
```

### 步骤 6：修改 `lib/analyzer.ts` 的 `dedupeJsErrors`

将过滤条件由 `log.subType !== 'js-error'` 改为子类型白名单 + `!!log.errorId`。函数名 `dedupeJsErrors` 沿用 v1.0 命名，实际语义已泛化为「TOP 错误聚合」：

```ts
const TOP_ERROR_SUB_TYPES = new Set<RuntimeSubType>([
  'js-error',
  'promise-rejection',
  'vue-render-error',
  'vue-router-error',
  'react-render-error',
]);

function dedupeJsErrors(runtimeLogs: RuntimeLog[]): TopError[] {
  const buckets = new Map<string, ErrorBucket>();
  for (const log of runtimeLogs) {
    if (!TOP_ERROR_SUB_TYPES.has(log.subType) || !log.errorId) continue;
    const second = Math.floor(parseTimestamp(log.timestamp) / 1000);
    const key = `${log.errorId}|${second}`;
    const existing = buckets.get(key);
    if (!existing) {
      buckets.set(key, { representative: log, samples: [log], total: 1 });
    } else {
      existing.total += 1;
      existing.samples.push(log);
      // 保持与 v1.0 一致的样本维护逻辑；后续阶段如产生性能瓶颈，可优化为单次排序
      existing.samples.sort(
        (a, b) => parseTimestamp(a.timestamp) - parseTimestamp(b.timestamp),
      );
      if (existing.samples.length > 3) {
        existing.samples = existing.samples.slice(existing.samples.length - 3);
      }
      if (log.source !== 'browser-pageerror') {
        existing.representative = log;
      }
    }
  }
  return Array.from(buckets.values()).map((b) => ({
    errorId: b.representative.errorId ?? '',
    subType: b.representative.subType,
    message: b.representative.message,
    source: b.representative.source,
    url: b.representative.url,
    count: b.total,
    firstAt: b.samples[0].timestamp,
    lastAt: b.samples[b.samples.length - 1].timestamp,
    samples: b.samples,
  }));
}
```

### 步骤 7：更新 `tests/analyzer.test.ts`

扩展现有 `aggregates runtime errors` 用例：追加覆盖新子类型的日志样本，并同步更新聚合数量断言，确保：

- `vue-render-error` 带有 `errorId` 时进入 `topErrors`；
- `vue-router-error` 带有 `errorId` 时进入 `topErrors`；
- `console-error`（无论是否有 `errorId`）均**不**进入 `topErrors`；
- `resource-error` 均**不**进入 `topErrors`。

### 步骤 8：更新 `lib/api.ts` 的 `/suggest` 端点

`generateFixPrompt` 当前仅过滤 `subType === 'js-error'`。为使新增的 `vue-render-error` 与 `vue-router-error`（二者均生成 `errorId` 并可能进入 TOP 聚合）也能通过 `/suggest` 生成修复提示词，将过滤条件改为与 `dedupeJsErrors` 一致的子类型白名单：

```ts
const FIX_SUGGEST_SUB_TYPES = new Set<RuntimeSubType>([
  'js-error',
  'promise-rejection',
  'vue-render-error',
  'vue-router-error',
  'react-render-error',
]);

async function generateFixPrompt(
  errorId: string,
  logDir: string,
  date: string,
): Promise<FixPromptResult | null> {
  const filePath = join(logDir, 'runtime', `${date}.jsonl`);
  const raw = readJsonlWithWarnings(filePath);
  const logs = raw.filter(isRuntimeLog);
  const matches = logs
    .filter((l) => FIX_SUGGEST_SUB_TYPES.has(l.subType) && l.errorId === errorId)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  if (matches.length === 0) return null;

  const samples = matches.slice(-3);
  const representative = samples[samples.length - 1];
  const firstAt = samples[0].timestamp;
  const lastAt = samples[samples.length - 1].timestamp;
  const stack = representative.stack || '无 stack 信息';

  const prompt = `请根据以下运行时错误信息，分析根因并给出修复建议：

错误类型：${representative.subType}
错误标识：${errorId}
消息：${representative.message}
页面 URL：${representative.url}
Stack 片段：
${stack}

最近 ${samples.length} 条样本中，最早发生在 ${firstAt}，最晚发生在 ${lastAt}。
请优先检查以上 stack 指向的源码位置，并给出可执行的修复方案。`;

  return { errorId, date, prompt };
}
```

在 `tests/api.test.ts` 中补充断言：当存在 `vue-render-error` 或 `vue-router-error` 日志时，`POST /suggest`（请求体为 `{ errorId: 'xxx' }`）能返回非空 `prompt`。

---

## 5. 测试计划

### 5.1 单元测试

| 用例 | 位置 | 断言 |
|---|---|---|
| TOP 聚合包含 vue-render-error | `tests/analyzer.test.ts` | `topErrors` 中存在 `subType === 'vue-render-error'` |
| TOP 聚合包含 vue-router-error | `tests/analyzer.test.ts` | `topErrors` 中存在 `subType === 'vue-router-error'` |
| console-error 不进入 TOP | `tests/analyzer.test.ts` | 即使带 `errorId`，`topErrors` 中也不存在 `console-error` |
| resource-error 不进入 TOP | `tests/analyzer.test.ts` | `topErrors` 中不存在 `resource-error` |
| `POST /suggest` 支持 vue-render-error | `tests/api.test.ts` | 返回 `prompt` 非空 |
| `POST /suggest` 支持 vue-router-error | `tests/api.test.ts` | 返回 `prompt` 非空 |

### 5.2 端到端测试

由 T3 负责。T1 开发完成后，T3 的测试用例应能直接验证 `inject.iife.ts` 的补丁行为。

### 5.3 类型与构建检查

- `pnpm typecheck`
- `pnpm build`

---

## 6. 验收标准

- [ ] `lib/inject.iife.ts` 包含完整 `patchVue` / `patchApp` / `patchRouter` / `wrapGuardHandler` 实现；
- [ ] 所有补丁函数内部使用 `try/catch`，失败不阻断原函数执行；
- [ ] 不引入 `@types/vue` 等 Vue 专用类型依赖；
- [ ] `lib/analyzer.ts` 的 `dedupeJsErrors` 使用子类型白名单 + `!!log.errorId`；
- [ ] `tests/analyzer.test.ts` 新增/更新断言通过；
- [ ] `lib/api.ts` 的 `/suggest` 端点对 `vue-render-error` / `vue-router-error` 兼容；
- [ ] `tests/api.test.ts` 新增 `/suggest` 兼容性断言通过；
- [ ] `pnpm typecheck` 通过；
- [ ] `pnpm build` 通过。

---

## 7. 风险与应对

| 风险 | 影响 | 应对措施 |
|---|---|---|
| `window.__VUE__` 在注入脚本执行后仍未加载 | 无法拦截 createApp | 保留 500ms × 20 次轮询兜底 |
| 用户自定义 errorHandler/warnHandler 抛错 | 中断 shield emit | 原始 handler 用 try/catch 包裹 |
| Router 守卫与 `router.onError` 重复报告 | 同一错误记录两次 | `__shield_emitted__` 标记去重 |
| 补丁失败影响页面功能 | 页面异常 | 所有 patch 入口加 try/catch |

---

## 8. 评审记录

| 轮次 | 时间 | 结论 | 主要问题 | 修订内容 |
|---|---|---|---|---|
| 1 | - | 待评审 | - | - |
| 最终 | 2026-06-18 | 通过 | 无 P0/P1；1 个 P2 表述优化 | 1. `originalConsole` 示例改用 `.bind(console)`；<br>2. `buildRouterErrorDetail` 统一使用 `path ?? to` / `path ?? from`；<br>3. 步骤 7 明确为「扩展现有用例并同步更新聚合断言」 |
