/// <reference lib="dom" />

declare global {
  interface Window {
    __SHIELD_INJECTED__?: boolean;
    __SHIELD_SESSION_ID__?: string;
    __SHIELD_ENABLE_REACT_PATCH__?: boolean;
    __SHIELD_REDACT_FIELDS__?: string[];
    __shield_emit__?: (event: {
      type: string;
      subType: string;
      detail: Record<string, unknown>;
      level?: string;
    }) => void;
    __VUE__?: unknown;
    Vue?: unknown;
    React?: unknown;
    ReactDOM?: unknown;
  }
}

(function shieldInject(): void {
  if (typeof window === 'undefined') return;
  if (window.__SHIELD_INJECTED__) return;
  window.__SHIELD_INJECTED__ = true;

  const sessionId = window.__SHIELD_SESSION_ID__ || 'unknown';
  const enableReactPatch = window.__SHIELD_ENABLE_REACT_PATCH__ || false;
  let sequence = 0;

  function emit(
    type: string,
    subType: string,
    detail: Record<string, unknown>,
    level?: string,
  ): void {
    const emitFn = window.__shield_emit__;
    if (typeof emitFn !== 'function') return;
    try {
      emitFn({ type, subType, detail, level });
    } catch {
      // 避免发射失败影响页面主逻辑
    }
  }

  function now(): string {
    return new Date().toISOString();
  }

  function getSelector(el: Element | null): string | null {
    if (!el) return null;
    if (el.id) return `#${el.id}`;
    if (el.className && typeof el.className === 'string') {
      const cls = el.className.split(/\s+/).filter(Boolean).join('.');
      if (cls) return `.${cls}`;
    }
    return el.tagName.toLowerCase();
  }

  function getTargetInfo(el: EventTarget | null): Record<string, unknown> | null {
    if (!(el instanceof Element)) return null;
    return {
      tagName: el.tagName,
      selector: getSelector(el),
      text: el.textContent?.slice(0, 200) ?? '',
      className: el.className || '',
      id: el.id || '',
    };
  }

  function emitRuntime(
    subType: string,
    detail: Record<string, unknown>,
    level: string,
  ): void {
    emit(
      'runtime',
      subType,
      {
        sessionId,
        timestamp: now(),
        level,
        url: location.href,
        userAgent: navigator.userAgent,
        ...detail,
      },
      level,
    );
  }

  function emitBehavior(subType: string, detail: Record<string, unknown>): void {
    sequence += 1;
    emit('behavior', subType, {
      sessionId,
      sequence,
      timestamp: now(),
      level: 'info',
      pageUrl: location.href,
      ...detail,
    });
  }

  // --- v1.4 公共工具：脱敏字段名单、安全序列化、state 摘要、Vuex 形参归一化 ---

  // 一次性读取脱敏字段名单（由 browser.ts addInitScript 写入）；为空数组时静默降级
  const SHIELD_REDACT_FIELDS: string[] = window.__SHIELD_REDACT_FIELDS__ ?? [];

  /**
   * 安全 JSON.stringify：处理循环引用（WeakSet）、BigInt、Symbol、Function；任何异常返回 null。
   */
  function safeStringify(input: unknown): string | null {
    const seen = new WeakSet<object>();
    try {
      return JSON.stringify(input, (_key, val) => {
        if (typeof val === 'bigint') return `${val}n`;
        if (typeof val === 'symbol') return (val as symbol).toString();
        if (typeof val === 'function') return '[Function]';
        if (val !== null && typeof val === 'object') {
          if (seen.has(val as object)) return '[Circular]';
          seen.add(val as object);
        }
        return val;
      });
    } catch {
      return null;
    }
  }

  /**
   * 构建 state 摘要：keys 与 stringify 分两步计算，保证 JSON 失败时 keys 仍可用。
   * 返回字段命名与设计 §2.2 ContextStateSummary 一致：
   *   stateKeys / stateSizeBytes / stateTruncated / stateUnserializable?
   */
  function buildStateSummary(rawState: unknown): {
    stateKeys: string[];
    stateSizeBytes: number;
    stateTruncated: boolean;
    stateUnserializable?: boolean;
  } {
    let stateKeys: string[] = [];
    try {
      stateKeys = Object.keys((rawState as Record<string, unknown>) || {}).slice(0, 50);
    } catch {
      stateKeys = [];
    }
    const json = safeStringify(rawState);
    if (json === null) {
      return { stateKeys, stateSizeBytes: -1, stateTruncated: true, stateUnserializable: true };
    }
    return { stateKeys, stateSizeBytes: json.length, stateTruncated: json.length > 64 * 1024 };
  }

  /**
   * 递归脱敏，与服务端 utils.redactBody 行为对齐：
   * - 字段名 includes 匹配、大小写不敏感
   * - 命中字段值替换为 '[REDACTED]'，未命中字段继续递归
   * - Map / Set / Date / Class 实例不展开递归，直接保留原引用（由 safeStringify 阶段处理）
   * - fields 为空 / 非数组时直接返回原值（静默降级）
   */
  function redactValue(value: unknown, fields: string[]): unknown {
    if (!Array.isArray(fields) || fields.length === 0) return value;
    if (value === null || value === undefined) return value;
    if (typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map((v) => redactValue(v, fields));
    // 仅展开 plain object；Map / Set / Date / Class 实例直接保留引用
    if (Object.getPrototypeOf(value) !== Object.prototype) return value;
    const src = value as Record<string, unknown>;
    const cloned: Record<string, unknown> = {};
    for (const key of Object.keys(src)) {
      const lower = key.toLowerCase();
      if (fields.some((f) => lower.includes(f.toLowerCase()))) {
        cloned[key] = '[REDACTED]';
      } else {
        cloned[key] = redactValue(src[key], fields);
      }
    }
    return cloned;
  }

  /**
   * 归一化 Vuex dispatch / commit 的双签名：
   * - 字符串签名：normalizeVuexArgs('foo/bar', { x: 1 }) → { type: 'foo/bar', payload: { x: 1 } }
   * - 对象签名：normalizeVuexArgs({ type: 'foo/bar', x: 1 }) → { type: 'foo/bar', payload: { type: 'foo/bar', x: 1 } }
   *   （对象签名时 payload 等于完整浅拷贝（含 type），与 Vuex 4 官方语义对齐）
   */
  function normalizeVuexArgs(
    typeOrAction: unknown,
    payload: unknown,
  ): { type: string; payload: unknown } {
    if (typeof typeOrAction === 'string') {
      return { type: typeOrAction, payload };
    }
    if (typeOrAction !== null && typeof typeOrAction === 'object') {
      const obj = typeOrAction as Record<string, unknown>;
      const type = typeof obj.type === 'string' ? obj.type : String(obj.type ?? '');
      return { type, payload: { ...obj } };
    }
    return { type: String(typeOrAction), payload };
  }

  // SHIELD_REDACT_FIELDS / buildStateSummary / redactValue / normalizeVuexArgs
  // 均已在 T2 patchPinia / T3 patchVuex 中消费，无需 void 占位。

  // --- 运行时错误 ---
  window.addEventListener(
    'error',
    (event) => {
      const target = event.target;
      const isResourceError =
        target instanceof HTMLScriptElement ||
        target instanceof HTMLLinkElement ||
        target instanceof HTMLImageElement;
      if (isResourceError) {
        const el = target as HTMLScriptElement | HTMLLinkElement | HTMLImageElement;
        const source =
          (el instanceof HTMLImageElement
            ? el.currentSrc || el.src
            : el instanceof HTMLScriptElement
              ? el.src
              : (el as HTMLLinkElement).href) || '';
        emitRuntime(
          'resource-error',
          {
            message: `Resource load error: ${(target as Element).tagName}`,
            source,
            url: location.href,
          },
          'error',
        );
        return;
      }
      emitRuntime(
        'js-error',
        {
          message: event.message,
          stack: event.error?.stack || '',
          source: event.filename,
          line: event.lineno,
          column: event.colno,
        },
        'error',
      );
    },
    true,
  );

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    emitRuntime(
      'promise-rejection',
      {
        message: typeof reason === 'string' ? reason : reason?.message || 'Unhandled Promise Rejection',
        stack: reason?.stack || '',
      },
      'error',
    );
  });

  // --- console 捕获 ---
  const originalConsole = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };

  function patchConsole(method: 'log' | 'info' | 'warn' | 'error', subType: string, level: string): void {
    (console as unknown as Record<string, unknown>)[method] = (...args: unknown[]) => {
      originalConsole[method](...args);
      emitRuntime(subType, { message: args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ') }, level);
    };
  }

  patchConsole('error', 'console-error', 'error');
  patchConsole('warn', 'console-warn', 'warn');
  patchConsole('info', 'console-info', 'info');
  patchConsole('log', 'console-log', 'info');

  // --- 行为捕获 ---
  document.addEventListener(
    'click',
    (e) => {
      emitBehavior('click', {
        target: getTargetInfo(e.target),
        payload: { x: e.clientX, y: e.clientY },
        coordinates: { x: e.clientX, y: e.clientY },
      });
    },
    true,
  );

  document.addEventListener(
    'input',
    (e) => {
      const target = e.target;
      const isPassword = target instanceof HTMLInputElement && target.type === 'password';
      const valueLength = isPassword ? 0 : target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement ? target.value.length : 0;
      emitBehavior('input', {
        target: getTargetInfo(target),
        payload: { valueLength },
        coordinates: null,
      });
    },
    true,
  );

  document.addEventListener('change', (e) => {
    emitBehavior('change', {
      target: getTargetInfo(e.target),
      payload: {},
      coordinates: null,
    });
  });

  document.addEventListener('submit', (e) => {
    emitBehavior('submit', {
      target: getTargetInfo(e.target),
      payload: {},
      coordinates: null,
    });
  });

  document.addEventListener('keydown', (e) => {
    emitBehavior('keydown', {
      target: getTargetInfo(e.target),
      payload: { key: e.key, code: e.code },
      coordinates: null,
    });
  });

  document.addEventListener('keyup', (e) => {
    emitBehavior('keyup', {
      target: getTargetInfo(e.target),
      payload: { key: e.key, code: e.code },
      coordinates: null,
    });
  });

  let scrollTimer: ReturnType<typeof setTimeout> | null = null;
  window.addEventListener('scroll', () => {
    if (scrollTimer) return;
    scrollTimer = setTimeout(() => {
      scrollTimer = null;
      emitBehavior('scroll', {
        target: null,
        payload: { scrollX: window.scrollX, scrollY: window.scrollY },
        coordinates: null,
      });
    }, 200);
  });

  // --- 路由变化 ---
  function emitRouteChange(): void {
    emitBehavior('route-change', {
      target: null,
      payload: { url: location.href },
      coordinates: null,
    });
  }

  const originalPushState = history.pushState.bind(history);
  const originalReplaceState = history.replaceState.bind(history);
  history.pushState = function pushState(...args: unknown[]): void {
    originalPushState.apply(history, args as never);
    emitRouteChange();
  };
  history.replaceState = function replaceState(...args: unknown[]): void {
    originalReplaceState.apply(history, args as never);
    emitRouteChange();
  };
  window.addEventListener('popstate', emitRouteChange);
  window.addEventListener('hashchange', emitRouteChange);

  // --- 可见性变化 ---
  document.addEventListener('visibilitychange', () => {
    emitBehavior('visibility-change', {
      target: null,
      payload: { hidden: document.hidden },
      coordinates: null,
    });
  });

  // --- fetch 标记 ---
  const originalFetch = window.fetch.bind(window);
  window.fetch = async function shieldFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const headers = new Headers(init?.headers || {});
    headers.set('X-Shield-Request-Type', 'fetch');
    return originalFetch(input, { ...init, headers });
  };

  // --- Vue 错误捕获 ---
  let appIdCounter = 0;

  function patchVue(): void {
    let pollCount = 0;
    const maxPoll = 20;
    const interval = 500;

    const tryPatch = (): void => {
      const vueFromShorthand = window.__VUE__ as Record<string, unknown> | undefined;
      const vueFromGlobal = window.Vue as Record<string, unknown> | undefined;
      const vueGlobal =
        (vueFromShorthand && typeof vueFromShorthand.createApp === 'function'
          ? vueFromShorthand
          : vueFromGlobal) || undefined;
      if (!vueGlobal || vueGlobal.__shield_patched__ === true) return;

      vueGlobal.__shield_patched__ = true;

      // 防御性兜底：若 Vue 在注入前已加载，尝试 patch 当前已挂载的 apps（非官方 API，仅兜底）
      try {
        const apps = vueGlobal.apps;
        if (Array.isArray(apps)) {
          apps.forEach((app: unknown) => patchApp(app as Record<string, unknown>));
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

    // 监听 window.Vue 赋值，在 Vue 全局对象出现的瞬间完成 patch，避免轮询错过同步 createApp
    try {
      const descriptor = Object.getOwnPropertyDescriptor(window, 'Vue');
      if (!descriptor || descriptor.configurable) {
        let storedValue: unknown = descriptor?.value;
        const originalSet = descriptor?.set;
        const originalGet = descriptor?.get;
        let isSetting = false;
        Object.defineProperty(window, 'Vue', {
          configurable: true,
          enumerable: descriptor?.enumerable ?? true,
          get() {
            return originalGet ? originalGet.call(window) : storedValue;
          },
          set(v: unknown) {
            if (isSetting) return;
            isSetting = true;
            try {
              if (originalSet) {
                originalSet.call(window, v);
              } else {
                storedValue = v;
              }
            } finally {
              isSetting = false;
            }
            tryPatch();
          },
        });
      }
    } catch {
      // 属性监听失败不影响轮询兜底
    }

    const timer = setInterval(() => {
      pollCount++;
      tryPatch();
      if (pollCount >= maxPoll) clearInterval(timer);
    }, interval);
  }

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
      // v1.4：识别 Pinia / Vuex 实例并 patch（Pinia 优先，互斥识别）
      try {
        if (isPiniaInstance(plugin)) {
          patchPinia(plugin as Record<string, unknown>, appId);
        } else if (isVuexStore(plugin)) {
          patchVuex(plugin as Record<string, unknown>, appId);
        }
      } catch {
        // 识别/patch 失败不阻断 app.use 返回
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
    // v1.4：$pinia 兜底（与 $router 兜底块同层级，同属 patchAppUse 函数体最外层作用域）
    if (globalProperties?.$pinia && isPiniaInstance(globalProperties.$pinia)) {
      try {
        patchPinia(globalProperties.$pinia as Record<string, unknown>, appId);
      } catch {
        // patch 失败不影响 app 初始化
      }
    }
    // v1.4：$store 兜底（Vuex），Pinia 优先互斥
    if (
      globalProperties?.$store &&
      !isPiniaInstance(globalProperties.$store) &&
      isVuexStore(globalProperties.$store)
    ) {
      try {
        patchVuex(globalProperties.$store as Record<string, unknown>, appId);
      } catch {
        // patch 失败不影响 app 初始化
      }
    }
  }

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

  // --- v1.4 Pinia patch ---

  // 识别 Pinia 2.x 实例：install 函数 + 私有 _s（Map）+ _p（plugins 数组）
  function isPiniaInstance(p: unknown): boolean {
    if (!p || typeof p !== 'object') return false;
    const obj = p as Record<string, unknown>;
    return !!(
      typeof obj.install === 'function' &&
      obj._s &&
      typeof (obj._s as { forEach?: unknown }).forEach === 'function' &&
      Array.isArray(obj._p)
    );
  }

  // Vuex 4 Store 识别：dispatch + commit + subscribe + Vuex 4 私有字段 _modulesNamespaceMap + replaceState
  // 调用方需先经 isPiniaInstance 判定为 false 后再调用本函数（patchAppUse 中已通过 if/else if 保证互斥）
  function isVuexStore(p: unknown): boolean {
    if (!p || typeof p !== 'object') return false;
    const obj = p as Record<string, unknown>;
    if (typeof obj.dispatch !== 'function') return false;
    if (typeof obj.commit !== 'function') return false;
    if (typeof obj.subscribe !== 'function') return false;
    if (typeof obj.replaceState !== 'function') return false;
    return obj._modulesNamespaceMap !== undefined;
  }

  // 推断 Pinia 插件名称：优先取 plugin.name / plugin.install.name；
  // 仅当 toString 结果不含 "function" 且不含 "=>" 时（即非匿名函数 / 箭头函数源码片段）才采用截断后的字符串
  function inferPiniaPluginName(plugin: unknown): string | undefined {
    if (!plugin) return undefined;
    const obj = plugin as Record<string, unknown>;
    const direct = typeof obj.name === 'string' ? obj.name : '';
    if (direct) return direct;
    const installName =
      typeof obj.install === 'function' && typeof (obj.install as { name?: unknown }).name === 'string'
        ? ((obj.install as { name: string }).name)
        : '';
    if (installName) return installName;
    try {
      const str = typeof obj.toString === 'function' ? String(obj.toString()).slice(0, 40) : '';
      if (str && !str.includes('function') && !str.includes('=>')) return str;
    } catch {
      // toString 失败时回退为 undefined
    }
    return undefined;
  }

  function buildPiniaErrorDetail(
    err: unknown,
    store: Record<string, unknown>,
    actionName: string,
    args: unknown,
    appId: string | undefined,
  ): Record<string, unknown> {
    const redactedArgs = redactValue(args, SHIELD_REDACT_FIELDS);
    const summary = buildStateSummary((store as { $state?: unknown }).$state);
    return {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack ?? '' : '',
      source: 'pinia',
      context: {
        appId,
        storeId: typeof store.$id === 'string' ? (store.$id as string) : '',
        actionName,
        args: redactedArgs,
        ...summary,
      },
    };
  }

  function buildPiniaPluginErrorDetail(
    err: unknown,
    plugin: unknown,
    appId: string,
  ): Record<string, unknown> {
    const pluginName = inferPiniaPluginName(plugin);
    return {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack ?? '' : '',
      source: 'pinia-plugin',
      context: {
        appId,
        ...(pluginName !== undefined ? { pluginName } : {}),
      },
    };
  }

  function registerOnAction(store: Record<string, unknown>): void {
    if (!store || store.__shield_patched__ === true) return;
    store.__shield_patched__ = true;
    const onActionFn = store.$onAction;
    if (typeof onActionFn !== 'function') return;
    try {
      (onActionFn as (cb: (ctx: Record<string, unknown>) => void) => void).call(
        store,
        ({ name, args, onError }: Record<string, unknown>) => {
          if (typeof onError !== 'function') return;
          (onError as (cb: (err: unknown) => void) => void)((err: unknown) => {
            if (isShieldEmitted(err)) return;
            markShieldEmitted(err);
            const appId =
              typeof store.__shield_app_id__ === 'string'
                ? (store.__shield_app_id__ as string)
                : undefined;
            emitRuntime(
              'pinia-error',
              buildPiniaErrorDetail(err, store, name as string, args, appId),
              'error',
            );
          });
        },
      );
    } catch {
      // $onAction 注册失败时静默跳过，不阻断 Pinia 主流程
    }
  }

  function patchPinia(pinia: Record<string, unknown>, appId: string): void {
    if (!pinia || pinia.__shield_patched__ === true) return;
    pinia.__shield_patched__ = true;

    // 1) 保存原始 use 引用并包装：捕获用户插件 install 抛错
    const originalUse =
      typeof pinia.use === 'function'
        ? (pinia.use as (plugin: unknown, ...args: unknown[]) => unknown).bind(pinia)
        : null;
    if (originalUse) {
      pinia.use = function shieldWrappedPiniaUse(plugin: unknown, ...args: unknown[]): unknown {
        try {
          return originalUse(plugin, ...args);
        } catch (err) {
          // 守卫避免与 shieldPlugin 自身抛错链路重复发射
          if (!isShieldEmitted(err)) {
            markShieldEmitted(err);
            emitRuntime('pinia-plugin-error', buildPiniaPluginErrorDetail(err, plugin, appId), 'error');
          }
          throw err;
        }
      };
    }

    // 2) 注册 shield 内部插件，必须经原始 use 调用（避免再次经包装层）
    //    在每个 store 初始化时设置 __shield_app_id__ 并注册 $onAction onError
    //    注：__shield_app_id__ 首次写入即生效，store 一旦被 __shield_patched__ 守卫早返后不会被二次覆盖
    if (originalUse) {
      try {
        originalUse((context: Record<string, unknown>) => {
          const store = context.store as Record<string, unknown> | undefined;
          if (!store) return;
          store.__shield_app_id__ = appId;
          registerOnAction(store);
        });
      } catch (err) {
        // 主链路失败时落盘一次，不再二次抛出
        if (!isShieldEmitted(err)) {
          markShieldEmitted(err);
          emitRuntime('pinia-plugin-error', buildPiniaPluginErrorDetail(err, null, appId), 'error');
        }
      }
    }

    // 3) 兜底：补登已注册但未走插件初始化的 store，逐 store try/catch 隔离单点失败
    const stores = pinia._s as { forEach?: (cb: (store: unknown) => void) => void } | undefined;
    if (stores && typeof stores.forEach === 'function') {
      try {
        stores.forEach((store: unknown) => {
          try {
            if (store && typeof store === 'object') {
              (store as Record<string, unknown>).__shield_app_id__ = appId;
              registerOnAction(store as Record<string, unknown>);
            }
          } catch {
            // 单个 store 补登失败静默跳过，不影响其他 store
          }
        });
      } catch {
        // forEach 自身异常（_s 私有 API 变更）静默跳过
      }
    }
  }

  // --- v1.4 Vuex patch ---

  // commit 包装错误子类型解析：T4 实现，基于 detectStrictViolation 分流。
  // 签名与 T3 v1 保持稳定，调用方 commit 包装无需感知实现替换。
  function resolveCommitErrorSubType(
    store: Record<string, unknown>,
    err: unknown,
    ctx: { lastMutation: { type: string; payload: unknown } | null; prevStateKeys: string[] | null },
  ): 'vuex-error' | 'vuex-strict-violation' {
    return detectStrictViolation(store, err, ctx) ? 'vuex-strict-violation' : 'vuex-error';
  }

  /**
   * 检测 Vuex strict mode 违规。
   * 主路径：基于 store.strict === true && store._committing === false 的结构特征（不依赖 console 文本解析）。
   * 兜底：message 正则匹配（防止 _committing 字段被未来 Vuex 版本重命名导致漏报）。
   */
  function detectStrictViolation(
    store: Record<string, unknown>,
    err: unknown,
    _ctx: { lastMutation: { type: string; payload: unknown } | null; prevStateKeys: string[] | null },
  ): boolean {
    void _ctx;
    if (!(err instanceof Error)) return false;
    // 前置门控：仅在 store.strict === true 时启用 strict 识别
    if (store?.strict !== true) return false;
    // 主路径（结构特征）：_committing === false 表示当前不在 mutation 上下文 → 判定 strict 违规命中
    if ((store as { _committing?: unknown })._committing === false) return true;
    // 辅助兜底：message 正则识别 strict 抛错固定语义（Vuex 4 源码英文硬编码，不受 i18n 影响）
    const STRICT_MSG = /do not mutate vuex store state outside mutation handlers/i;
    if (STRICT_MSG.test(err.message)) return true;
    return false;
  }

  /**
   * 推导 strict 违规对应的 mutatedKeyPath（best-effort 字段）。
   * 语义：记录「最近一次 mutation.type」（含 modulePath，如 `user/setProfile`），
   * 而非真正被违规修改的 state key path（精确定位需 Proxy 包装 state，本期不实现）。
   * 因此该字段供排障时作为「上下文线索」使用，不应作为唯一定位依据。
   */
  function inferMutatedKeyPath(
    ctx: { lastMutation: { type: string; payload: unknown } | null },
    store: Record<string, unknown>,
    mutationType: string,
  ): string {
    void store;
    // 分支 1：本次 commit 调用传入的 type 优先（commit 包装内通常恒为非空字符串）
    if (mutationType) return mutationType;
    // 分支 2：上下文中由 store.subscribe 记录的最近一次 mutation.type
    if (ctx.lastMutation?.type) return ctx.lastMutation.type;
    // 兜底分支：理论上不可达（commit 包装入口的 mutationType 为字符串入参），
    // 保留 'unknown' 作为类型完备性兜底，确保函数始终返回 string。
    return 'unknown';
  }

  function buildVuexErrorDetail(
    err: unknown,
    store: Record<string, unknown>,
    type: unknown,
    payload: unknown,
    // 'subscribe' 本任务不产生，保留类型兼容性（供 T4 / 后续阶段扩展）
    stage: 'action' | 'mutation' | 'subscribeAction' | 'subscribe',
    appId: string,
  ): Record<string, unknown> {
    // modulePath 防御：type 在异常路径下可能非 string（如对象形态 { type: 'foo/bar', ... }）
    const safeType =
      typeof type === 'string'
        ? type
        : typeof (type as { type?: unknown })?.type === 'string'
          ? ((type as { type: string }).type)
          : '';
    const modulePath = safeType.includes('/')
      ? safeType.split('/').slice(0, -1).join('/')
      : '';
    return {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack ?? '' : '',
      // 与现网 source 命名风格对齐（参见 vue-error-handler / vue-router 等），统一 kebab-case
      source: 'vuex-store-patch',
      context: {
        appId,
        modulePath,
        type: safeType,
        // redactValue 在 fields 为空时按 T1 契约返回原值
        payload: redactValue(payload, SHIELD_REDACT_FIELDS),
        stage,
        // buildStateSummary 返回字段以设计 §2.2 ContextStateSummary 为准：
        // { stateKeys, stateSizeBytes, stateTruncated, stateUnserializable? }
        ...buildStateSummary((store as { state?: unknown }).state),
      },
    };
  }

  function patchVuex(store: Record<string, unknown>, appId: string): void {
    if (!store || store.__shield_patched__ === true) return;
    store.__shield_patched__ = true;

    // T4 strict 识别需要的上下文（lastMutation 记录最近一次 mutation；prevStateKeys 记录 mutation 后的顶层 keys）
    const ctx: {
      lastMutation: { type: string; payload: unknown } | null;
      prevStateKeys: string[] | null;
    } = { lastMutation: null, prevStateKeys: null };

    // 1) 监听 mutation 事件以刷新 ctx（subscribe 本身不产生 emit）
    const subscribeFn = store.subscribe;
    if (typeof subscribeFn === 'function') {
      try {
        (subscribeFn as (
          cb: (mutation: { type: string; payload: unknown }, state: unknown) => void,
        ) => void).call(store, (mutation, state) => {
          ctx.lastMutation = {
            type: typeof mutation?.type === 'string' ? mutation.type : '',
            payload: mutation?.payload,
          };
          try {
            ctx.prevStateKeys = Object.keys((state as Record<string, unknown>) || {});
          } catch {
            ctx.prevStateKeys = null;
          }
        });
      } catch {
        // subscribe 注册失败不阻断后续 dispatch / commit 包装
      }
    }

    // 2) 包装 dispatch：归一化形参；同步抛错与异步 reject 双链路均上报
    const originalDispatch = (store.dispatch as (typeOrAction: unknown, payload?: unknown) => unknown).bind(store);
    store.dispatch = function shieldWrappedDispatch(typeOrAction: unknown, payload?: unknown): unknown {
      const normalized = normalizeVuexArgs(typeOrAction, payload);
      try {
        const result = originalDispatch(typeOrAction, payload);
        if (result && typeof (result as Promise<unknown>).then === 'function' && typeof (result as Promise<unknown>).catch === 'function') {
          return (result as Promise<unknown>).catch((err: unknown) => {
            if (!isShieldEmitted(err)) {
              markShieldEmitted(err);
              emitRuntime(
                'vuex-error',
                buildVuexErrorDetail(err, store, normalized.type, normalized.payload, 'action', appId),
                'error',
              );
            }
            throw err;
          });
        }
        return result;
      } catch (err) {
        // 同步分支：首次必然 emit，不前置 isShieldEmitted
        markShieldEmitted(err);
        emitRuntime(
          'vuex-error',
          buildVuexErrorDetail(err, store, normalized.type, normalized.payload, 'action', appId),
          'error',
        );
        throw err;
      }
    };

    // 3) 包装 commit：归一化形参；通过 resolveCommitErrorSubType 抽象函数预留 T4 strict 分流点
    const originalCommit = (store.commit as (typeOrMutation: unknown, payload?: unknown) => unknown).bind(store);
    store.commit = function shieldWrappedCommit(typeOrMutation: unknown, payload?: unknown): unknown {
      const normalized = normalizeVuexArgs(typeOrMutation, payload);
      try {
        return originalCommit(typeOrMutation, payload);
      } catch (err) {
        // SHIELD_T4_HOOK：strict 分流接入点
        if (!isShieldEmitted(err)) {
          markShieldEmitted(err);
          const subType = resolveCommitErrorSubType(store, err, ctx);
          if (subType === 'vuex-strict-violation') {
            // strict 违规：detail 不携带 stage（语义上 strict 违规并非「mutation 阶段」抛错，
            // 而是 mutation 外修改 state 被 watcher 捕获），并补充 mutatedKeyPath（best-effort）。
            // 传入 'mutation' 占位实参后立即 delete，不修改 buildVuexErrorDetail 签名。
            const detail = buildVuexErrorDetail(err, store, normalized.type, normalized.payload, 'mutation', appId);
            const context = detail.context as Record<string, unknown>;
            delete context.stage;
            context.mutatedKeyPath = inferMutatedKeyPath(
              ctx,
              store,
              typeof normalized.type === 'string' ? normalized.type : '',
            );
            emitRuntime('vuex-strict-violation', detail, 'error');
          } else {
            const detail = buildVuexErrorDetail(err, store, normalized.type, normalized.payload, 'mutation', appId);
            emitRuntime('vuex-error', detail, 'error');
          }
        }
        throw err;
      }
    };

    // 4) subscribeAction({ error })：异步 action 错误链路
    const subscribeActionFn = store.subscribeAction;
    if (typeof subscribeActionFn === 'function') {
      try {
        (subscribeActionFn as (cb: Record<string, unknown>) => void).call(store, {
          error: (
            { action }: { action: { type: string; payload: unknown } },
            error: unknown,
          ): void => {
            if (isShieldEmitted(error)) return;
            markShieldEmitted(error);
            emitRuntime(
              'vuex-error',
              buildVuexErrorDetail(error, store, action?.type, action?.payload, 'subscribeAction', appId),
              'error',
            );
          },
        });
      } catch {
        // subscribeAction 注册失败不阻断后续 patch
      }
    }
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

  function getComponentName(instance: unknown): string {
    const typed = instance as Record<string, unknown> | undefined;
    if (!typed) return '';
    const type = typed.type as Record<string, unknown> | undefined;
    const name = typed.name || typed.__name || type?.name || type?.__name;
    return typeof name === 'string' ? name : '';
  }

  patchVue();

  // --- React 错误捕获（实验性，默认关闭）---
  if (enableReactPatch) {
    function patchReact(): void {
      const React = window.React;
      const ReactDOM = window.ReactDOM;
      if (!React || !ReactDOM) return;
      try {
        const Component = (React as Record<string, unknown>).Component as new (...args: unknown[]) => unknown;
        if (!Component) return;
        const originalRender = (Component.prototype as Record<string, unknown>).render as (() => unknown) | undefined;
        if (!originalRender) return;
        (Component.prototype as Record<string, unknown>).render = function render(): unknown {
          try {
            return originalRender.call(this);
          } catch (err) {
            emitRuntime(
              'react-render-error',
              {
                message: err instanceof Error ? err.message : String(err),
                stack: err instanceof Error ? err.stack || '' : '',
                source: 'react-component-render',
              },
              'error',
            );
            throw err;
          }
        };
      } catch {
        // React patch 失败不影响主流程
      }
    }
    patchReact();
  }
})();
