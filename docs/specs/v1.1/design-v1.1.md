# legacy-shield v1.1 详细设计方案

> 文档版本：v1.1
> 对应需求文档：[requirements-v1.1.md](requirements-v1.1.md)
> 对应阶段 Spec：[phases/phase-v1.1-spec.md](phases/phase-v1.1-spec.md)
> 对应执行计划：[execution-plan-v1.1.md](execution-plan-v1.1.md)
> 状态：已通过

---

## 1. 设计目标

在 v1.0 基础上，补齐 Vue 3 运行时监控能力：

1. 自动补丁所有 Vue 3 app，包括页面运行期间动态创建的 app；
2. 采集 Vue 3 运行时错误与运行时警告；
3. 采集 Vue Router 4 导航错误与守卫异常。

设计约束：

- 不修改老项目源码；
- 不支持 Vue 2；
- 不引入 `@types/vue` 等 Vue 专用类型依赖；
- 补丁失败不得影响页面正常运行。

---

## 2. 架构变化

v1.1 仅改动浏览器注入脚本 `lib/inject.iife.ts`、类型定义 `lib/types.ts`、日志工具 `lib/logger.ts`、分析器 `lib/analyzer.ts` 及测试与文档。CLI、代理、API 服务、自定义规则等模块保持不变。

```
┌──────────────────────────────────────┐
│        lib/inject.iife.ts            │
│  ┌────────────────────────────────┐  │
│  │        patchVue()              │  │
│  │  - 检测 window.__VUE__         │  │
│  │  - patch 已有 apps             │  │
│  │  - 重写 createApp              │  │
│  └────────────┬───────────────────┘  │
│               │                      │
│               ▼                      │
│  ┌────────────────────────────────┐  │
│  │        patchApp(app)           │  │
│  │  - errorHandler                │  │
│  │  - warnHandler                 │  │
│  │  - use() wrapper               │  │
│  └────────────┬───────────────────┘  │
│               │                      │
│               ▼                      │
│  ┌────────────────────────────────┐  │
│  │       patchRouter(app)         │  │
│  │  - onError listener            │  │
│  │  - guard wrappers              │  │
│  └────────────────────────────────┘  │
└──────────────────┬───────────────────┘
                   │ emitRuntime()
                   ▼
          lib/logger.ts
                   │
                   ▼
   <legacy>/.runtime-log-ignore/runtime/*.jsonl
```

---

## 3. 模块详细设计

### 3.1 `lib/inject.iife.ts`

#### 3.1.1 `patchVue()`

由页面加载后调用，负责：

1. 检测 `window.__VUE__` 或 `window.Vue`；
2. 标记全局，避免重复 patch；
3. 重写 `createApp`，使所有 Vue 3 app 创建时自动被打补丁；
4. 防御性兜底：若 Vue 在注入前已加载，尝试 patch 当前已挂载的 `apps` 数组（非官方 API）。

**核心机制**：注入脚本通过 Playwright `addInitScript` 在页面脚本之前执行，重写 `createApp` 可拦截页面内所有 `createApp()` 调用。保留 500ms 轮询（最多 20 次）作为防御性兜底。

**注意**：`vueGlobal.apps` 并非 Vue 3 官方 API，仅作为兜底。兜底 patch 失败不阻断 `createApp` 重写。

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

#### 3.1.2 `patchApp(app)`

对单个 Vue 3 app 打补丁：

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
```

##### `patchErrorHandler(config, appId)`

```ts
function patchErrorHandler(config: Record<string, unknown>, appId: string): void {
  const original = config.errorHandler as ((err: unknown, instance: unknown, info: string) => void) | undefined;
  config.errorHandler = (err: unknown, instance: unknown, info: string): void => {
    if (typeof original === 'function') {
      try {
        original(err, instance, info);
      } catch (e) {
        // 用户 handler 自身抛错不阻断 emit
      }
    } else {
      // 使用原始 console 避免再次触发 shield 的 console-error 采集
      originalConsole.error(err, info);
    }
    emitRuntime('vue-render-error', buildVueErrorDetail(err, instance, info, appId), 'error');
  };
}
```

##### `patchWarnHandler(config, appId)`

```ts
function patchWarnHandler(config: Record<string, unknown>, appId: string): void {
  const original = config.warnHandler as ((msg: string, instance: unknown, trace: string) => void) | undefined;
  config.warnHandler = (msg: string, instance: unknown, trace: string): void => {
    if (typeof original === 'function') {
      try {
        original(msg, instance, trace);
      } catch (e) {
        // 用户 handler 自身抛错不阻断 emit
      }
    } else {
      // 使用原始 console 避免再次触发 shield 的 console-warn 采集
      originalConsole.warn(msg, trace);
    }
    emitRuntime('vue-warn', {
      message: msg,
      source: 'vue-warn-handler',
      context: { trace, appId },
    }, 'warn');
  };
}
```

##### `patchAppUse(app, appId)`

```ts
function patchAppUse(app: Record<string, unknown>, appId: string): void {
  const originalUse = app.use as (plugin: unknown, ...options: unknown[]) => unknown;
  app.use = function (plugin: unknown, ...options: unknown[]): unknown {
    const result = originalUse.apply(app, [plugin, ...options]);
    // 同步 patch router，避免错过 router.isReady()/router.push() 触发的初始导航错误
    try {
      patchRouter(app, appId);
    } catch {
      // patch 失败不阻断 app.use 返回
    }
    return result;
  };

  // 兜底：若 router 在 app.use 包装前已安装，同步 patch 一次
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

#### 3.1.3 `patchRouter(app, appId)`

```ts
function patchRouter(app: Record<string, unknown>, appId: string): void {
  const globalProperties = (app.config as Record<string, unknown> | undefined)?.globalProperties as Record<string, unknown> | undefined;
  if (!globalProperties) return;

  const router = globalProperties.$router as Record<string, unknown> | undefined;
  if (!router || router.__shield_patched__ === true) return;
  router.__shield_patched__ = true;

  // onError
  const onError = router.onError as ((handler: (err: unknown) => void) => void) | undefined;
  if (typeof onError === 'function') {
    onError.call(router, (err: unknown) => {
      if (isShieldEmitted(err)) return;
      emitRuntime('vue-router-error', buildRouterErrorDetail(err, appId), 'error');
    });
  }

  // guards
  const guards = ['beforeEach', 'beforeResolve', 'afterEach'] as const;
  for (const guard of guards) {
    const original = router[guard] as ((handler: unknown) => void) | undefined;
    if (typeof original !== 'function') continue;
    router[guard] = function (handler: unknown): void {
      const wrapped = wrapGuardHandler(handler, appId);
      return original.call(router, wrapped);
    };
  }
}
```

#### 3.1.4 `wrapGuardHandler(handler, appId)`

守卫处理函数签名：`NavigationGuard = (to, from, next?) => void | RouteLocationRaw | Promise<...>`

包装逻辑：

```ts
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

#### 3.1.5 `buildVueErrorDetail(err, instance, info, appId)`

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
```

#### 3.1.6 `buildRouterErrorDetail(err, appId, to?, from?)`

```ts
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

### 3.2 `lib/types.ts`

扩展 `RuntimeSubType`：

```ts
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
  | 'react-render-error';
```

### 3.3 `lib/logger.ts`

修改 `isErrorSubType`：

```ts
function isErrorSubType(subType: RuntimeSubType): boolean {
  return (
    subType === 'js-error' ||
    subType === 'promise-rejection' ||
    subType === 'vue-render-error' ||
    subType === 'vue-router-error' ||
    subType === 'react-render-error'
  );
}
```

在 `runtimeLevelFor` 中增加 `vue-warn` 防御性映射：

```ts
if (subType === 'vue-warn') return 'warn';
```

### 3.4 `lib/analyzer.ts`

新增子类型会自动被以下逻辑统计：

- `runtimeErrorCount`：统计 `level === 'error'`；
- `runtimeWarningCount`：统计 `level === 'warn'`；

**需要修改** `buildTopErrors` / `dedupeJsErrors`：

将 `dedupeJsErrors` 的过滤条件从 `subType === 'js-error'` 改为子类型白名单 + `!!log.errorId`。白名单包括：

- `js-error`
- `promise-rejection`
- `vue-render-error`
- `vue-router-error`
- `react-render-error`

避免 `console-error`、`resource-error` 等进入 TOP 聚合导致非预期回归。

同步更新 `tests/analyzer.test.ts` 的断言。

---

## 4. 测试设计

### 4.1 测试策略

- 使用 Playwright 启动本地静态 HTML 页面；
- 页面默认使用本地静态 Vue 3 与 Vue Router 4 文件（位于 `tests/fixtures/vue3/vendor/`），CDN 作为可选回退；
- 触发各类错误/警告后，读取 `.runtime-log-ignore/runtime/*.jsonl` 断言。

### 4.2 测试文件

新增 `tests/vue3-monitor.test.ts`：

| 用例 | 触发方式 | 断言 |
|---|---|---|
| 初始 app render 错误 | 组件 render 函数抛错 | `subType === 'vue-render-error'` |
| 动态 createApp 错误 | setTimeout 后 createApp + render 抛错 | `subType === 'vue-render-error'` |
| Vue 3 警告 | prop 类型不匹配 | `subType === 'vue-warn'` |
| Vue Router onError | 守卫返回 rejected Promise，触发 `router.onError` | `subType === 'vue-router-error'` |
| Router guard 错误 | `beforeEach` 中抛错 | `subType === 'vue-router-error'` |
| Router lazy component | 异步路由组件返回 rejected Promise | `subType === 'vue-router-error'` |
| 非 Vue 页面回归 | 普通页面触发 `console-error` | 不存在 Vue 相关子类型 |

### 4.3 测试基础设施

- 在 `tests/fixtures/vue3/` 下创建测试 HTML 文件；
- 使用 `vitest` + `playwright` 集成；
- 每个用例独立 `sessionId`，避免日志互相污染。

---

## 5. 兼容性设计

| 场景 | 行为 |
|---|---|
| 页面无 Vue | `patchVue()` 检测不到全局变量，安全退出 |
| Vue 版本为 2 | 无 `apps` 数组也无 Vue 3 风格 `createApp`，不 patch |
| 用户已自定义 errorHandler/warnHandler | 优先调用原始 handler，再 emit |
| 无 Vue Router | `patchRouter()` 检测不到 `$router`，安全退出 |
| 注入脚本执行在 Vue 之前 | 保留轮询，10 秒内检测到 Vue 后 patch |

---

## 6. 非功能性设计

- **性能**：补丁逻辑仅在 Vue 全局变量出现/创建时执行一次，运行时事件处理无额外开销；
- **稳定性**：所有补丁内部 try/catch，失败不阻断原函数；
- **可维护性**：不引入 Vue 类型依赖，使用 `Record<string, unknown>` 防御式访问；
- **可测试性**：通过静态 HTML + CDN 实现端到端测试，无需修改真实老项目。

---

## 7. 文档更新

- `README.md`：在 `shield` 子命令说明中增加「支持 Vue 3 运行时错误、警告、Vue Router 错误」；
- `docs/usage.md`：补充 Vue 3 监控范围与限制；
- 明确标注不支持 Vue 2。
