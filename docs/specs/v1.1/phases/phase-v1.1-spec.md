# legacy-shield v1.1 Spec：Vue 3 生态运行时错误完整采集

> 版本：v1.1
> 对应需求文档：[requirements-v1.1.md](../requirements-v1.1.md)
> 对应设计文档：[design-v1.1.md](../design-v1.1.md)
> 对应执行计划：[execution-plan-v1.1.md](../execution-plan-v1.1.md)
> 状态：已完成，已归档
> 评审记录：见本文档末尾

---

## 1. 目标

将 legacy-shield 对 Vue 3 生态的监控能力从「仅支持初始 app 的 errorHandler」补齐为：

- 覆盖 Vue 3 运行时错误（含动态创建 app）；
- 覆盖 Vue 3 运行时警告；
- 覆盖 Vue Router 4 导航错误与守卫异常。

**明确不在范围内**：Vue 2 支持、Pinia/Vuex 单独 patch、编译时错误。

---

## 2. 交付物清单

| 编号 | 交付物 | 路径 | 说明 |
|---|---|---|---|
| D1 | 更新后的浏览器注入脚本 | `lib/inject.iife.ts` | 完整 Vue 3 / Vue Router 4 补丁逻辑 |
| D2 | 扩展的运行时子类型 | `lib/types.ts` | 新增 `vue-warn`、`vue-router-error` |
| D3 | 日志级别兼容 | `lib/logger.ts` | `vue-router-error` 识别为错误子类型 |
| D4 | 分析与报告兼容 | `lib/analyzer.ts`、`lib/api.ts` | 新子类型纳入统计、TOP 错误聚合；`/suggest` 端点兼容新错误子类型 |
| D5 | 单元/E2E 测试 | `tests/` | 覆盖 Vue 3 错误、警告、路由错误及 `/suggest` 兼容性 |
| D6 | 用户文档更新 | `README.md`、`docs/usage.md` | 说明 Vue 3 监控范围与限制 |
| D7 | 验收报告 | `docs/specs/acceptance-report-v1.1.md` | v1.1 验收结论 |

---

## 3. 技术方案

### 3.1 总体策略

在 `lib/inject.iife.ts` 中重写 `window.__VUE__.createApp`，使所有 Vue 3 app（无论初始还是动态创建）在创建后自动被打补丁。补丁内容包括：

1. `app.config.errorHandler`
2. `app.config.warnHandler`
3. `app.use` 钩子，用于检测 Router 插件安装

### 3.2 `patchVue()` 重构

注入脚本通过 Playwright `addInitScript` 在页面脚本之前执行。核心机制是**重写 `createApp`**，使所有 Vue 3 app 创建时自动被打补丁。同时保留 500ms 轮询（最多 20 次）作为防御性兜底，用于处理 Vue 在注入脚本之前已加载的极少数场景。

```ts
function patchVue(): void {
  let pollCount = 0;
  const maxPoll = 20;
  const interval = 500;

  const tryPatch = (): void => {
    const vueGlobal = (window.__VUE__ || window.Vue) as Record<string, unknown> | undefined;
    if (!vueGlobal || vueGlobal.__shield_patched__ === true) return;

    vueGlobal.__shield_patched__ = true;

    // 防御性兜底：若 Vue 在注入前已加载，尝试 patch 当前已挂载的 apps（非官方 API，仅兜底）
    try {
      const apps = vueGlobal.apps;
      if (Array.isArray(apps)) {
        apps.forEach((app) => patchApp(app as Record<string, unknown>));
      }
    } catch {
      // 兜底 patch 失败不影响核心机制
    }

    // 核心机制：重写 createApp，拦截后续所有新 app
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

> **注意**：`vueGlobal.apps` 并非 Vue 3 官方 API，仅作为防御性兜底。v1.1 的覆盖前提是注入脚本先于页面脚本执行，从而通过 `createApp` 拦截所有 app。
>
> 实际场景中，Vue 3 常通过 `<script src>` 同步加载并立即对 `window.Vue` 赋值，页面内联脚本随即调用 `createApp`，仅靠 500ms 轮询可能错过首次 `createApp`。因此 `patchVue()` 还会在 `window.Vue` 可配置时，通过 `Object.defineProperty` 监听其 setter，在 Vue 全局对象出现的瞬间同步调用 `tryPatch()` 完成 `createApp` 重写；监听失败或属性不可配置时，仍回退到 500ms 轮询兜底。


### 3.3 `patchApp(app)`

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
      try { originalErrorHandler(err, instance, info); } catch { /* 用户 handler 抛错不阻断 emit */ }
    } else {
      // 无原始 handler 时保留 Vue 默认控制台输出，使用原始 console 避免再次触发 shield 的 console-error 采集
      originalConsole.error(err, info);
    }
    emitRuntime('vue-render-error', buildVueErrorDetail(err, instance, info, appId), 'error');
  };
}

function patchWarnHandler(config: Record<string, unknown>, appId: string): void {
  const originalWarnHandler = config.warnHandler as ((msg: string, instance: unknown, trace: string) => void) | undefined;
  config.warnHandler = (msg: string, instance: unknown, trace: string): void => {
    if (typeof originalWarnHandler === 'function') {
      try { originalWarnHandler(msg, instance, trace); } catch { /* 用户 handler 抛错不阻断 emit */ }
    } else {
      // 无原始 handler 时保留 Vue 默认控制台输出，使用原始 console 避免再次触发 shield 的 console-warn 采集
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

`buildVueErrorDetail` 返回结构需符合 `RuntimeLog` 类型，所有 Vue 专属字段放入 `context`：

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


### 3.4 `patchRouter(app, appId)`

```ts
function patchRouter(app: Record<string, unknown>, appId: string): void {
  const globalProperties = (app.config as Record<string, unknown> | undefined)?.globalProperties as Record<string, unknown> | undefined;
  if (!globalProperties) return;

  const router = globalProperties.$router;
  if (!router || (router as Record<string, unknown>).__shield_patched__ === true) return;
  (router as Record<string, unknown>).__shield_patched__ = true;

  // 注册 router.onError 处理器
  const onError = (router as Record<string, unknown>).onError as ((handler: (err: unknown) => void) => void) | undefined;
  if (typeof onError === 'function') {
    onError.call(router, (err: unknown) => {
      if (isShieldEmitted(err)) return;
      emitRuntime('vue-router-error', buildRouterErrorDetail(err, appId), 'error');
    });
  }

  // 包装守卫，捕获同步/异步错误
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
```

`wrapGuardHandler` 需处理：

- 同步抛错：try/catch 后 emit 并标记，再抛出；
- 返回 Promise reject：.catch 后 emit 并标记，再 reject；
- 普通返回值：透传。

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

### 3.5 类型扩展

在 `lib/types.ts` 的 `RuntimeSubType` 中增加：

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

在 `lib/logger.ts` 的 `isErrorSubType` 中增加 `vue-router-error`：

```ts
subType === 'vue-render-error' ||
subType === 'vue-router-error' ||
...
```

在 `lib/logger.ts` 的 `runtimeLevelFor` 中增加 `vue-warn` 防御性映射：

```ts
if (subType === 'vue-warn') return 'warn';
```

`vue-warn` 的 `level` 由调用方显式传入 `'warn'`，不进入 `isErrorSubType`。

### 3.6 分析与报告兼容

`lib/analyzer.ts` 中：

- `runtimeWarningCount` 已统计 `level === 'warn'` 的日志，`vue-warn` 会自动计入；
- `runtimeErrorCount` 已统计 `level === 'error'` 的日志，`vue-router-error` 会自动计入；
- `buildTOPErrors` / `dedupeJsErrors` 需扩展为聚合以下子类型中带有 `errorId` 的日志：
  - `js-error`
  - `promise-rejection`
  - `vue-render-error`
  - `vue-router-error`
  - `react-render-error`

将 `dedupeJsErrors` 的过滤条件由 `log.subType !== 'js-error' || !log.errorId` 改为 `subType 属于上述白名单 && !!log.errorId`，避免 `console-error`、`resource-error` 等进入 TOP 聚合导致非预期回归。

同步更新 `tests/analyzer.test.ts`，补充 `vue-render-error` 与 `vue-router-error` 进入 TOP 聚合的断言。

`/suggest` 端点当前仅对 `subType === 'js-error'` 生成修复提示词。为兼容新增子类型，将 `lib/api.ts` 的 `generateFixPrompt` 过滤条件改为与 TOP 聚合一致的子类型白名单（`js-error`、`promise-rejection`、`vue-render-error`、`vue-router-error`、`react-render-error`），并在 `tests/api.test.ts` 中补充对应断言。

---

## 4. 任务拆解与验收标准

### 任务 1：重构 `inject.iife.ts` 的 Vue patch 逻辑

**实现内容**：

- 重写 `patchVue()`，支持 `createApp` 拦截；
- 新增 `patchApp()`，统一给 app 打 errorHandler/warnHandler/use 补丁；
- 新增 `patchRouter()`，支持 Vue Router 4 错误与守卫捕获。

**验收标准**：

- [ ] 代码通过 TypeScript 编译；
- [ ] 不依赖 `@types/vue` 等外部类型，使用 `Record<string, unknown>` 防御式访问；
- [ ] `lib/analyzer.ts`、`lib/api.ts` 对新子类型兼容；
- [ ] `tests/analyzer.test.ts`、`tests/api.test.ts` 新增断言通过。

### 任务 2：扩展 `types.ts` 与 `logger.ts`

**实现内容**：

- 新增 `vue-warn`、`vue-router-error` 子类型；
- `isErrorSubType` 包含 `vue-router-error`。

**验收标准**：

- [ ] `pnpm typecheck` 通过；
- [ ] 运行时 `vue-router-error` 生成 `errorId`。

### 任务 3：单元/E2E 测试

**实现内容**：

1. 创建测试夹具目录 `tests/fixtures/vue3/`，Vue 3 / Vue Router 4 静态文件存放于 `tests/fixtures/vue3/vendor/`；
2. 创建 7 个夹具 HTML 页面（`vue-render-error.html`、`vue-dynamic-app.html`、`vue-warn.html`、`vue-router-error.html`、`vue-router-guard.html`、`vue-router-lazy.html`、`plain.html`）；
3. 新增 `tests/vue3-monitor.test.ts`，通过 Playwright 加载包含 Vue 3 的页面，验证：
   - 初始 app errorHandler 错误被采集；
   - 动态 createApp 错误被采集；
   - warnHandler 警告被采集；
   - Vue Router onError 与守卫错误被采集；
   - 路由懒加载组件失败被采集；
   - 非 Vue 页面无异常回归。
4. `tests/analyzer.test.ts` 的更新由任务 1 负责，本任务不重复覆盖。

**验收标准**：

- [ ] 7 个端到端用例全部通过；
- [ ] 测试默认使用本地静态 Vue 3 / Vue Router 4 文件（位于 `tests/fixtures/vue3/vendor/`），CDN 仅作为可选回退，CI 环境禁止使用 CDN。

### 任务 4：用户文档更新

**实现内容**：

- `README.md` 与 `docs/usage.md` 的 `shield` 参数说明中增加 Vue 3 监控能力说明；
- 明确说明「支持 Vue 3 运行时错误、警告、Vue Router 错误；不支持 Vue 2」。

**验收标准**：

- [ ] 文档描述与实现一致；
- [ ] 无错别字或失效链接。

### 任务 5：全量回归验证

**验收标准**：

- [ ] `pnpm typecheck` 通过；
- [ ] `pnpm build` 通过；
- [ ] `pnpm test` 全量通过；
- [ ] 无 v1.0 功能回归；
- [ ] `docs/specs/acceptance-report-v1.1.md` 已生成；
- [ ] 本阶段 Spec 状态已归档。

---

## 5. 测试用例

### 5.1 Vue 3 运行时错误

```ts
it('captures initial Vue 3 app render error', async () => {
  // 加载包含 Vue 3 的页面，组件 render 抛错
  // 断言 runtime 日志包含 subType === 'vue-render-error'
});

it('captures dynamically created Vue 3 app error', async () => {
  // 页面脚本 1s 后 createApp().mount()
  // 触发错误后断言日志
});
```

### 5.2 Vue 3 警告

```ts
it('captures Vue 3 runtime warning', async () => {
  // 触发 prop 类型不匹配警告
  // 断言 runtime 日志包含 subType === 'vue-warn'
});
```

### 5.3 Vue Router 4 错误

```ts
it('captures router onError', async () => {
  // 配置 router.onError 并触发导航错误
  // 断言 subType === 'vue-router-error'
});

it('captures guard thrown error', async () => {
  // beforeEach 中抛出错误
  // 断言 subType === 'vue-router-error'
});

it('captures lazy route component failure', async () => {
  // 配置一个返回 rejected Promise 的异步组件路由
  // 触发导航后断言 subType === 'vue-router-error'
});
```

---

## 6. 风险与应对

| 风险 | 影响 | 应对措施 |
|---|---|---|
| Vue 3 全局变量名不标准 | 无法检测 Vue | 检测 `window.__VUE__` 和 `window.Vue`；未来版本可通过配置扩展 |
| 用户自定义 errorHandler 被覆盖 | 功能异常 | 补丁中优先调用原始 handler，再 emit；原始 handler 抛错不阻断 emit |
| Router 守卫与 onError 重复报告 | 同一错误记录两次 | `markShieldEmitted` / `isShieldEmitted` 去重标记；primitive 类型抛错无法标记，可能重复上报；在 `app.use(router)` 之前注册的守卫由 `router.onError` 兜底，可能缺少 `to`/`from` 上下文 |
| Router 守卫返回 Promise reject | 守卫包装需兼容异步 | `wrapGuardHandler` 统一处理同步/异步 |
| 初始 app 在注入脚本之前已创建 | 无法 patch | 以重写 `createApp` 为核心机制，依赖 Playwright `addInitScript` 保证注入顺序 |
| 测试依赖 CDN | 网络不稳定 | 测试夹具默认使用本地静态 Vue 3 / Vue Router 4 文件，CDN 作为可选 |
| 无原始 error/warn handler | 默认控制台输出被静默 | 补丁中无原始 handler 时调用 `console.error` / `console.warn` 保留默认行为 |

---

## 7. 验收标准

1. `lib/inject.iife.ts` 完整实现 Vue 3 app/warn/router 补丁；
2. `lib/types.ts` 与 `lib/logger.ts` 支持 `vue-warn`、`vue-router-error`；
3. 新增测试覆盖 5 个以上 Vue 3 生态错误/警告场景；
4. `pnpm typecheck && pnpm build && pnpm test` 全量通过；
5. README/usage 文档已更新；
6. 验收报告 `docs/specs/acceptance-report-v1.1.md` 已生成。

---

## 8. 评审记录

| 轮次 | 时间 | 结论 | 主要问题 | 修订内容 |
|---|---|---|---|---|
| 1 | 2026-06-18 | 不通过 | 1. detail 字段位置与 TypeScript 类型不兼容；<br>2. Router 守卫与 onError 重复报告；<br>3. 初始 app 补丁机制不可靠；<br>4. TOP 聚合与需求冲突；<br>5. 缺少 appId；<br>6. 缺轮询与 try/catch；<br>7. 缺懒加载失败用例 | 1. Vue/Router 专属字段统一放入 `context`；<br>2. 增加 `__shield_emitted__` 去重标记；<br>3. 以重写 `createApp` 为核心机制；<br>4. `dedupeJsErrors` 改为按 `level === 'error' && !!errorId` 聚合；<br>5. 增加 `appId`；<br>6. 补充轮询与 try/catch；<br>7. 补充懒加载失败测试用例 |
| 2 | 2026-06-18 | 不通过 | 1. warnHandler 会抑制默认控制台输出；<br>2. `patchVue()` 兜底 patch 失败会阻断 `createApp` 重写；<br>3. Spec 与 Design 在 `app.use` / guard `this` 绑定上不一致；<br>4. TOP 聚合泛化可能引入回归；<br>5. 测试夹具 Vue 来源不一致；<br>6. 需求验收标准缺懒加载失败 | 1. 无原始 handler 时调用 `console.error` / `console.warn`；<br>2. `patchVue()` 增加 try/catch；<br>3. 统一 `app.use` / guard 为显式对象绑定；<br>4. TOP 聚合改为子类型白名单；<br>5. 统一为本地静态文件；<br>6. 需求文档补充懒加载失败验收标准 |
| 3 | 2026-06-18 | 不通过 | 1. 执行计划 TOP 聚合过滤条件与 Spec/Design 不一致；<br>2. Spec 任务 3 测试夹具来源与 Design/执行计划矛盾；<br>3. Design 中 `isErrorSubType` 范围与 Spec/现有代码不一致 | 1. 执行计划改为子类型白名单；<br>2. Spec 任务 3 验收标准改为默认本地静态文件；<br>3. Design 的 `isErrorSubType` 仅追加 `vue-router-error`；同步处理 P2：使用原始 console、加 `try/catch` 标记冻结对象、兜底同步 patchRouter、增加 `vue-warn` 防御性映射、明确已有守卫边界 |
| 4 | 2026-06-18 | 不通过 | 1. `patchRouter` 在 `app.use` 包装内通过 `setTimeout(0)` 延迟注册，可能错过初始导航错误；<br>2. `patchVue` 代码片段未对 `vueGlobal` 做 `Record<string, unknown>` 类型断言；<br>3. `__shield_patched__` 用于布尔判断时类型为 `unknown`；<br>4. 无原始 handler 时兜底输出未保留 Vue 的 `info` / `trace`；<br>5. 执行计划 T3 验收标准表述矛盾；<br>6. 测试夹具目录结构不一致；<br>7. `patchRouter` 调用处缺少局部 try/catch | 1. `app.use` 返回后同步调用 `patchRouter`；<br>2. `vueGlobal` 增加类型断言；<br>3. `__shield_patched__` 判断统一为 `=== true`；<br>4. 兜底输出附带 `info` / `trace`；<br>5. 执行计划 T3 验收标准统一；<br>6. 统一 `tests/fixtures/vue3/vendor/` 目录约定；<br>7. `patchRouter` 调用处加 try/catch |
| 5 | 2026-06-18 | 不通过 | 1. 执行计划 T1 的 `dedupeJsErrors` 过滤条件与 Spec/Design 不一致；<br>2. 执行计划 T3 验收标准与 Spec 矛盾（CDN 使用策略）；<br>3. Spec 代码片段中 `patchApp(app)` 缺少 `Record<string, unknown>` 类型断言 | 1. 执行计划 T1 改为子类型白名单 + `!!log.errorId`；<br>2. 执行计划 T3 统一为「默认本地静态文件，CDN 仅作为可选回退，CI 禁止 CDN」；<br>3. `apps.forEach` 与 `createApp` 返回 app 调用 `patchApp` 处添加类型断言 |
| 6 | 2026-06-18 | 不通过 | 1. Spec 3.1 描述出现范围蔓延（Pinia）；<br>2. Spec/Design 中 `patchRouter` 参数类型不一致；<br>3. Spec/Design 中 `patchApp` 入口防御不一致；<br>4. Spec/Design 中 `patchApp` 代码组织方式不一致 | 1. 删除 Pinia 字样；<br>2. 统一 `patchRouter` 参数为 `Record<string, unknown>`；<br>3. Design `patchApp` 补全 `!app` 防御；<br>4. Spec 提取 `patchErrorHandler` / `patchWarnHandler` 与 Design 对齐 |
| 7 | 2026-06-18 | 通过 | 无 P0/P1 缺陷 | 文档状态改为「已通过」，可进入代码开发；剩余 P2 优化项可在开发/验收阶段并行处理 |
