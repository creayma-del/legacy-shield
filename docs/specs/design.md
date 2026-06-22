# legacy-shield 详细设计方案

> 文档版本：v1.0
> 对应需求文档：requirements.md
> 评审状态：第四次评审通过
> 评审时间：2026-06-17

## 1. 总体架构

### 1.1 架构分层

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           legacy-shield CLI                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │  shield  │  │ quality  │  │  report  │  │   api    │  │  custom  │  │
│  │  子命令  │  │  子命令  │  │  子命令  │  │  子命令  │  │  规则    │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘  │
│       │             │             │             │             │        │
│       └─────────────┴─────────────┴─────────────┴─────────────┘        │
│                                    │                                     │
│                         lib/orchestrator.js                            │
│                                    │                                     │
└────────────────────────────────────┼────────────────────────────────────┘
                                     │
       ┌─────────────────────────────┼─────────────────────────────┐
       │                             │                             │
       ▼                             ▼                             ▼
┌──────────────┐          ┌──────────────────┐          ┌──────────────┐
│ lib/proxy.js │          │  lib/browser.js  │          │ lib/quality.js│
│  请求代理    │          │  浏览器运行时监控 │          │ 质量保障调用  │
└──────┬───────┘          └────────┬─────────┘          └──────┬───────┘
       │                           │                           │
       │     ┌─────────────────────┘                           │
       │     │                                                   │
       ▼     ▼                                                   ▼
┌─────────────────────────────────────┐          ┌─────────────────────────┐
│         lib/logger.js               │          │    lib/custom-rules/    │
│   统一 JSONL 日志写入服务            │          │    AST 自定义规则扫描     │
└─────────────────────────────────────┘          └─────────────────────────┘
       │
       │ JSONL 日志
       ▼
┌─────────────────────────────────────┐
│   <legacy>/.runtime-log-ignore/     │
│   ├── runtime/YYYY-MM-DD.jsonl      │
│   ├── network/YYYY-MM-DD.jsonl      │
│   ├── behavior/YYYY-MM-DD.jsonl     │
│   ├── quality/YYYY-MM-DD.jsonl      │
│   └── reports/                      │
└─────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────────┐
│                     lib/analyzer.js + lib/reporter.js            │
│                     日志分析 + 报告生成                           │
└─────────────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────────┐
│                     lib/api.js                                   │
│                     REST API 服务                                │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 核心设计原则

1. **零侵入**：所有功能通过外部代理、独立浏览器实例、运行时注入脚本实现
2. **可复用**：提交前质量保障直接调用 code-quality
3. **可扩展**：自定义规则、报告格式、API 端点均支持插件化扩展
4. **双格式**：所有输出同时支持人类可读（Markdown）和 AI 可读（JSON）

---

## 2. 模块详细设计

### 2.1 CLI 入口 `cli.js`

使用 `commander` 实现四个子命令：

#### 2.1.1 `shield` 子命令

```bash
node cli.js shield \
  --project <legacy-root> \
  --target <dev-server-url> \
  [--proxy-port 9876] \
  [--start-page /] \
  [--headless false] \
  [--no-body] \
  [--insecure] \
  [--redact-body-fields password,token,phone,idCard] \
  [--session-id <uuid>]
```

**执行流程**：
1. 校验老项目路径存在且包含 `package.json` 和 `src/`
2. 创建 `<legacy>/.runtime-log-ignore/{runtime,network,behavior}/`
3. 生成或复用 `sessionId`
4. 启动 `lib/proxy.js` 监听 `--proxy-port`
5. 启动 `lib/browser.js`，配置浏览器走本地代理，访问 `--target`
6. 保持进程运行，监听 SIGINT/SIGTERM 优雅退出
7. 退出前 flush 日志、关闭浏览器、关闭代理

#### 2.1.2 `quality` 子命令

```bash
node cli.js quality \
  --project <legacy-root> \
  [--target <file1> [--target <file2> ...]] \
  [--base <git-ref>] \
  [--skip type-check] \
  [--skip lint] \
  [--skip test]
```

**模式说明**：
- 默认模式：调用 code-quality 的 `all` 子命令，执行全量 type-check + lint + test
- `--target` 模式：调用 code-quality 的 `module` 子命令，为指定文件生成并运行测试
- `--base` 模式：调用 code-quality 的 `diff` 子命令，基于 git diff 生成并运行测试

**执行流程**：
1. 根据参数选择调用 code-quality 的 `all` / `module` / `diff` 子命令
2. 执行 legacy-shield 自定义规则扫描
3. 汇总结果写入 `<legacy>/.runtime-log-ignore/quality/YYYY-MM-DD.jsonl`

**调用矩阵**：
| 用户参数 | 调用 code-quality 命令 |
|---|---|
| 无 `--target` / `--base` | `all --project <legacy-root>` |
| `--target a.js --target b.js` | `module --project <legacy-root> --target a.js --target b.js` |
| `--base origin/main` | `diff --project <legacy-root> --base origin/main` |

#### 2.1.3 `report` 子命令

```bash
node cli.js report \
  --project <legacy-root> \
  [--date YYYY-MM-DD] \
  [--format md|json] \
  [--out <file-path>]
```

**执行流程**：
1. 读取指定日期或全部日志
2. 调用 `lib/analyzer.js` 分析
3. 调用 `lib/reporter.js` 生成报告
4. 输出到 `--out` 或默认路径

#### 2.1.4 `api` 子命令

```bash
node cli.js api \
  --project <legacy-root> \
  [--port 3456] \
  [--cors]
```

**执行流程**：
1. 启动 Express/Koa/原生 HTTP 服务
2. 挂载 REST API 路由
3. 保持进程运行

---

### 2.2 代理模块 `lib/proxy.js`

#### 2.2.1 实现方式

使用原生 Node `http` + `http-proxy` 实现反向代理。网络日志的唯一真实来源为 `lib/proxy.js`，`lib/browser.js` 不再重复采集网络请求。

```js
import http from 'node:http';
import httpProxy from 'http-proxy';
import { redactHeaders, redactBody, truncateBody, classifyNetworkSubType } from './utils.js';

const BODY_LIMIT = 64 * 1024;

function totalSize(chunks) {
  return chunks.reduce((sum, chunk) => sum + Buffer.byteLength(chunk), 0);
}

function toBuffer(chunk) {
  return Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8');
}

function isBinaryContentType(contentType) {
  if (!contentType) return false;
  const ct = String(contentType).toLowerCase();
  return ct.startsWith('image/') || ct.startsWith('audio/') || ct.startsWith('video/') ||
    ct.includes('application/octet-stream') || ct.includes('application/pdf') ||
    ct.includes('font/') || ct.includes('/woff');
}

function formatBody(buffer, contentType) {
  if (isBinaryContentType(contentType)) {
    const truncated = buffer.length > BODY_LIMIT ? buffer.subarray(0, BODY_LIMIT) : buffer;
    return { body: truncated.toString('base64'), encoding: 'base64', truncated: buffer.length > BODY_LIMIT };
  }
  const { body, truncated } = truncateBody(buffer, BODY_LIMIT);
  return { body, encoding: 'utf8', truncated };
}

export function startProxy({ target, port, logger, noBody = false, insecure = false, redactBodyFields = [] }) {
  const targetUrl = new URL(target);
  const proxy = httpProxy.createProxyServer({
    target,
    changeOrigin: true,
    secure: !insecure,        // 本地 https + 自签名证书时可通过 --insecure 关闭校验
    ws: false                 // MVP 不代理 WebSocket
  });

  const server = http.createServer((req, res) => {
    const startTime = Date.now();
    const requestId = generateId();
    const requestBodyChunks = [];
    const responseBodyChunks = [];

    // 先完整读取请求 body，再调用 proxy.web 转发
    // 这会导致请求引入一次性延迟；大 body 场景下与 NFR-005 的 <5ms 目标存在冲突
    req.on('data', chunk => requestBodyChunks.push(toBuffer(chunk)));
    req.on('end', () => {
      const requestBodyBuffer = Buffer.concat(requestBodyChunks);

      // 拦截响应数据
      const originalWrite = res.write.bind(res);
      const originalEnd = res.end.bind(res);
      res.write = (chunk, ...args) => {
        responseBodyChunks.push(toBuffer(chunk));
        return originalWrite(chunk, ...args);
      };
      res.end = (chunk, ...args) => {
        if (chunk) responseBodyChunks.push(toBuffer(chunk));
        const durationMs = Date.now() - startTime;
        const subType = classifyNetworkSubType(req, req.url);
        const status = res.statusCode;
        const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
        const requestHeaders = redactHeaders(req.headers);
        const responseHeaders = redactHeaders(res.getHeaders());

        const requestBodyInfo = noBody ? { body: null, encoding: null, truncated: false } :
          formatBody(requestBodyBuffer, req.headers['content-type']);
        const responseBodyInfo = noBody ? { body: null, encoding: null, truncated: false } :
          formatBody(Buffer.concat(responseBodyChunks), res.getHeader('content-type'));

        logger.logNetwork({
          requestId,
          subType,
          level,
          method: req.method,
          url: buildFullUrl(targetUrl, req),
          request: {
            headers: requestHeaders.headers,
            redactedHeaders: requestHeaders.redactedHeaders,
            body: noBody ? null : redactBody(requestBodyInfo.body, redactBodyFields),
            bodySize: requestBodyBuffer.length,
            bodyTruncated: requestBodyInfo.truncated,
            bodyEncoding: requestBodyInfo.encoding
          },
          response: {
            status,
            statusText: res.statusMessage,
            headers: responseHeaders.headers,
            redactedHeaders: responseHeaders.redactedHeaders,
            body: noBody ? null : redactBody(responseBodyInfo.body, redactBodyFields),
            bodySize: Buffer.concat(responseBodyChunks).length,
            bodyTruncated: responseBodyInfo.truncated,
            bodyEncoding: responseBodyInfo.encoding
          },
          durationMs,
          pageUrl: req.headers.referer || null
        });
        return originalEnd(chunk, ...args);
      };

      proxy.web(req, res, {
        buffer: requestBodyBuffer.length > 0 ? requestBodyBuffer : undefined
      }, (err) => {
        logger.logNetwork({
          requestId,
          subType: 'proxy-error',
          level: 'error',
          error: err.message,
          url: buildFullUrl(targetUrl, req),
          timestamp: new Date().toISOString()
        });
      });
    });
  });

  server.listen(port);
  return { server, proxy, url: `http://localhost:${port}` };
}

function buildFullUrl(targetUrl, req) {
  return `${targetUrl.protocol}//${req.headers.host || targetUrl.host}${req.url}`;
}
```

**关键修正点**：
- 通过 `http-proxy` 的 `buffer` 选项将已读取的请求 body 重新注入转发流，避免 POST/PUT body 丢失
- 请求 body 的采集会引入全量缓冲延迟，与 NFR-005 的 `< 5ms` 目标在 body 大流量场景下存在冲突；该指标仅适用于 headers-only 或 `--no-body` 模式
- 网络日志仅由 `proxy.js` 产生，`browser.js` 不再采集网络请求

#### 2.2.2 Body 处理策略

- 默认保存前 64KB
- 超过阈值记录 `bodyTruncated: true`，并保存前 64KB + 摘要 hash
- 二进制内容转为 base64 并标记 `encoding: 'base64'`
- `--no-body` 时只记录 headers 和 size

#### 2.2.3 WebSocket 支持（MVP 可选）

MVP 先支持 HTTP/HTTPS。WebSocket 支持作为后续增强，通过 `proxy.on('upgrade', ...)` 实现。

---

### 2.3 浏览器运行时监控 `lib/browser.js`

#### 2.3.1 Playwright 启动配置

```js
import { chromium } from 'playwright';

export async function startBrowser({ proxyUrl, startPage, headless, logger, sessionId }) {
  const browser = await chromium.launch({
    headless,
    proxy: { server: proxyUrl }
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: 'legacy-shield/1.0'
  });
  const page = await context.newPage();

  // 注入 sessionId，供 inject.iife.js 读取
  await page.addInitScript({ content: `window.__SHIELD_SESSION_ID__ = ${JSON.stringify(sessionId || 'unknown')};` });

  // 注入运行时监控脚本（浏览器 IIFE 脚本）
  await page.addInitScript({ path: fileURLToPath(new URL('inject.iife.js', import.meta.url)) });

  // 暴露接收函数
  await page.exposeFunction('__shield_emit__', (event) => {
    if (event.type === 'runtime') logger.logRuntime(event.subType, event.detail, event.level);
    if (event.type === 'behavior') logger.logBehavior(event.detail);
  });

  // 监听页面级事件（仅作为注入脚本未生效时的兜底，不采集网络日志；console 由 inject.iife.js 唯一采集）
  page.on('pageerror', err => logger.logRuntime('js-error', {
    message: err.message,
    stack: err.stack,
    source: 'browser-pageerror',
    level: 'error',
    context: { note: '兜底来源，可能已在 inject.iife.js 中重复记录，analyzer 层需按 errorId + 1 秒窗口去重' }
  }));
  page.on('requestfailed', req => logger.logRuntime('resource-error', {
    url: req.url(),
    failureText: req.failure()?.errorText,
    level: 'error'
  }));

  await page.goto(startPage);
  return { browser, context, page };
}
```

**关键说明**：
- `inject.iife.js` 是浏览器可执行脚本，与 Skill 的 Node ESM 模块隔离
- `browser.js` 仅监听运行时错误，不采集网络请求；网络日志唯一来源为 `proxy.js`
- 仅监控启动时创建的单个 `page`，新标签页不在监控范围内

#### 2.3.2 页面注入脚本 `lib/inject.iife.js`

该文件为浏览器可执行的 IIFE 脚本，与 Skill 的 Node ESM 模块隔离。开发阶段可维护为 `lib/inject.js`（纯 JS 函数），构建步骤生成 `lib/inject.iife.js`；MVP 中也可直接手写 IIFE。

```js
(function () {
  if (window.__SHIELD_INJECTED__) return;
  window.__SHIELD_INJECTED__ = true;

  const sessionId = window.__SHIELD_SESSION_ID__ || 'unknown';
  let sequence = 0;

  const emit = (type, detail, level = 'info') => {
    if (window.__shield_emit__) {
      window.__shield_emit__({ type, subType: detail?.subType, detail, level });
    }
  };

  const runtime = (subType, detail) => {
    let level = 'error';
    if (subType === 'console-warn') level = 'warn';
    else if (subType.startsWith('console-')) level = 'info';
    emit('runtime', { subType, ...detail }, level);
  };

  // 错误捕获
  window.addEventListener('error', (e) => {
    const target = e.target;
    if (target && (target instanceof HTMLScriptElement || target instanceof HTMLLinkElement || target instanceof HTMLImageElement)) {
      runtime('resource-error', {
        message: `资源加载失败: ${target.src || target.href || target.currentSrc || ''}`,
        source: target.src || target.href || target.currentSrc || null,
        tagName: target.tagName,
        url: location.href,
        userAgent: navigator.userAgent
      });
      return;
    }
    runtime('js-error', {
      message: e.message,
      stack: e.error?.stack,
      source: e.filename,
      line: e.lineno,
      column: e.colno,
      url: location.href,
      userAgent: navigator.userAgent
    });
  });

  window.addEventListener('unhandledrejection', (e) => {
    runtime('promise-rejection', {
      message: e.reason?.message || String(e.reason),
      stack: e.reason?.stack,
      url: location.href,
      userAgent: navigator.userAgent
    });
  });

  // Vue 3 渲染错误捕获（探测全局 app）
  const patchVueErrorHandler = () => {
    // 常见暴露方式：window.__VUE__、window.Vue（Vue 2/3 全局构建）
    const vueApp = window.__VUE__ || (window.Vue && window.Vue.config ? window.Vue : null);
    if (vueApp && vueApp.config) {
      const original = vueApp.config.errorHandler;
      vueApp.config.errorHandler = (err, vm, info) => {
        runtime('vue-render-error', {
          message: err.message,
          stack: err.stack,
          componentName: vm?.$options?.name || vm?.$options?._componentTag || null,
          props: vm?.$props ? Object.keys(vm.$props) : null,
          info,
          url: location.href,
          userAgent: navigator.userAgent
        });
        if (original) original(err, vm, info);
      };
      return true;
    }
    return false;
  };
  // 异步加载的 Vue 应用可能未立即出现，轮询探测
  let vuePatchAttempts = 0;
  const tryPatchVue = () => {
    if (patchVueErrorHandler() || vuePatchAttempts++ > 20) return;
    setTimeout(tryPatchVue, 500);
  };
  setTimeout(tryPatchVue, 0);
  window.addEventListener('load', tryPatchVue);

  // React 渲染错误捕获
  const patchReactErrorHandler = () => {
    const React = window.React;
    const ReactDOM = window.ReactDOM;
    if (!React || !React.Component) return false;

    // 方式 1：全局错误兜底（无法拿到组件名）
    window.addEventListener('error', (e) => {
      const stack = e.error?.stack || '';
      if (stack.includes(' at ') && (stack.includes('/node_modules/react') || stack.includes('React'))) {
        runtime('react-render-error', {
          message: e.message,
          stack,
          componentName: null,
          url: location.href,
          userAgent: navigator.userAgent
        });
      }
    });

    // 方式 2：尝试包装 React.Component，让类组件渲染错误能被捕获
    const OriginalComponent = React.Component;
    React.Component = class ShieldComponent extends OriginalComponent {
      constructor(props) {
        super(props);
        this.state = { __shieldError__: null };
      }
      componentDidCatch(err, info) {
        runtime('react-render-error', {
          message: err.message,
          stack: err.stack,
          componentName: this.constructor?.displayName || this.constructor?.name || null,
          info: info?.componentStack ? info.componentStack.slice(0, 500) : null,
          url: location.href,
          userAgent: navigator.userAgent
        });
        if (super.componentDidCatch) super.componentDidCatch(err, info);
      }
      static getDerivedStateFromError(err) {
        return { __shieldError__: err.message };
      }
    };
    Object.setPrototypeOf(React.Component, OriginalComponent);
    return true;
  };
  setTimeout(patchReactErrorHandler, 0);
  window.addEventListener('load', patchReactErrorHandler);

  // 用户行为
  const getSelector = (el) => {
    if (!el) return null;
    if (el.id) return `#${el.id}`;
    if (el.className) return `.${el.className.split(' ').join('.')}`;
    return el.tagName?.toLowerCase() || null;
  };

  const behavior = (subType, target, payload) => {
    emit('behavior', {
      sequence: ++sequence,
      subType,
      sessionId,
      pageUrl: location.href,
      timestamp: new Date().toISOString(),
      target: target ? {
        tagName: target.tagName,
        selector: getSelector(target),
        text: target.innerText?.slice(0, 100),
        className: target.className,
        id: target.id
      } : null,
      payload,
      coordinates: payload?.x != null ? { x: payload.x, y: payload.y } : null
    });
  };

  document.addEventListener('click', (e) => behavior('click', e.target, { x: e.clientX, y: e.clientY }));
  document.addEventListener('input', (e) => {
    const isPassword = e.target.type === 'password';
    behavior('input', e.target, {
      inputType: e.target.type,
      valueLength: isPassword ? 0 : e.target.value?.length
    });
  }, true);
  document.addEventListener('change', (e) => behavior('change', e.target, { inputType: e.target.type }));
  document.addEventListener('submit', (e) => behavior('submit', e.target, {}));
  document.addEventListener('keydown', (e) => behavior('keydown', e.target, { key: e.key }));
  document.addEventListener('keyup', (e) => behavior('keyup', e.target, { key: e.key }));

  // scroll 节流 200ms
  let scrollTimer = null;
  window.addEventListener('scroll', () => {
    if (scrollTimer) return;
    scrollTimer = setTimeout(() => {
      scrollTimer = null;
      behavior('scroll', null, { scrollTop: window.scrollY });
    }, 200);
  }, { passive: true });

  // 路由变化
  const originalPushState = history.pushState;
  history.pushState = function (...args) {
    originalPushState.apply(this, args);
    behavior('route-change', null, { route: location.pathname + location.search, mechanism: 'pushState' });
  };
  const originalReplaceState = history.replaceState;
  history.replaceState = function (...args) {
    originalReplaceState.apply(this, args);
    behavior('route-change', null, { route: location.pathname + location.search, mechanism: 'replaceState' });
  };
  window.addEventListener('popstate', () => behavior('route-change', null, { route: location.pathname + location.search, mechanism: 'popstate' }));
  window.addEventListener('hashchange', () => behavior('route-change', null, { route: location.hash, mechanism: 'hashchange' }));

  // 页面可见性
  document.addEventListener('visibilitychange', () => {
    behavior('visibility-change', null, { visible: !document.hidden });
  });

  // console 捕获：由注入脚本作为唯一来源，browser.js 不再监听 console
  ['error', 'warn', 'info', 'log'].forEach((level) => {
    const original = console[level];
    console[level] = function (...args) {
      runtime(`console-${level}`, { message: args.map(String).join(' '), url: location.href });
      return original.apply(this, args);
    };
  });

  // fetch 标记辅助网络日志分类
  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    try {
      const req = new Request(...args);
      req.headers.set('X-Shield-Request-Type', 'fetch');
      return originalFetch.call(this, req);
    } catch {
      return originalFetch.apply(this, args);
    }
  };
})();
```

#### 2.3.3 隐私保护

- `input` 事件不记录明文，只记录长度
- `type="password"` 长度也不记录
- 表单字段值不采集

---

### 2.4 日志模块 `lib/logger.js`

#### 2.4.1 日志格式

所有日志统一为 JSONL。采用扁平字段结构，与 requirements.md 中的 schema 保持一致：

**运行时日志**：
```json
{
  "type": "runtime",
  "subType": "js-error",
  "sessionId": "uuid",
  "errorId": "hash-of-error",
  "timestamp": "2026-06-17T10:00:00.000Z",
  "level": "error",
  "url": "当前页面 URL",
  "userAgent": "浏览器 UA",
  "message": "错误消息",
  "stack": "堆栈信息",
  "source": "发生错误的源文件",
  "line": 123,
  "column": 45,
  "context": { ... }
}
```

**网络日志**、**行为日志**、**质量日志**同样采用顶层字段展开，不再嵌套 `payload`。

#### 2.4.2 目录与滚动策略

```
<legacy>/.runtime-log-ignore/
├── runtime/
│   └── 2026-06-17.jsonl
├── network/
│   └── 2026-06-17.jsonl
├── behavior/
│   └── 2026-06-17.jsonl
├── quality/
│   └── 2026-06-17.jsonl
└── reports/
    ├── summary-2026-06-17.md
    └── summary-2026-06-17.json
```

- 按 UTC+8 或本地时间滚动
- 文件名 `YYYY-MM-DD.jsonl`
- 同一天多次启动追加写入

#### 2.4.3 写入接口

```js
import { createHash } from 'node:crypto';

export function createLogger(projectPath, sessionId) {
  const baseDir = resolve(projectPath, '.runtime-log-ignore');
  ensureDir(baseDir);

  const streams = new Map();
  const getStream = (type) => {
    if (!streams.has(type)) {
      const dir = join(baseDir, type);
      ensureDir(dir);
      const file = join(dir, `${today()}.jsonl`);
      const stream = createWriteStream(file, { flags: 'a' });
      // 监听流错误，按设计 7.3 不阻塞主流程
      stream.on('error', (err) => {
        console.error(`[legacy-shield] 日志写入失败 (${type}):`, err.message);
      });
      streams.set(type, stream);
    }
    return streams.get(type);
  };

  const generateErrorId = (subType, stack, url) => {
    // 堆栈首帧通常是第二行（第一行为错误消息行）
    const lines = (stack || '').split('\n').map(l => l.trim()).filter(Boolean);
    const firstFrame = lines[1] || lines[0] || '';
    // 归一化：去除列号、临时路径抖动等
    const normalizedFrame = firstFrame
      .replace(/:\d+$/, '')           // 去除列号
      .replace(/\?v=[a-z0-9]+/gi, ''); // 去除 query hash
    return createHash('sha256')
      .update(`${subType}|${normalizedFrame}|${url || ''}`)
      .digest('hex')
      .slice(0, 16);
  };

  const log = (type, detail, level = 'info') => {
    const stream = getStream(type);
    const record = {
      type,
      sessionId,
      timestamp: new Date().toISOString(),
      level,
      ...detail
    };
    if (type === 'runtime' && detail.subType && !record.errorId) {
      record.errorId = generateErrorId(detail.subType, detail.stack, detail.url);
    }
    const line = JSON.stringify(record) + '\n';
    stream.write(line);
  };

  return {
    logRuntime: (subType, detail, level) => log('runtime', { subType, ...detail }, level),
    logNetwork: (detail) => log('network', detail),
    logBehavior: (detail) => log('behavior', detail),
    logQuality: (detail) => log('quality', detail),
    close: () => { for (const s of streams.values()) s.end(); }
  };
}
```

**关键说明**：
- 流错误监听已加上，磁盘满时打印警告不阻塞主流程
- `errorId` 由 logger 统一生成，保证运行时日志每条都有稳定哈希
- 所有日志字段扁平化，与需求文档 schema 对齐

#### 2.4.4 日志清理策略

为满足 [requirements.md NFR-017](../requirements.md#L374) 的日志保留要求，`createLogger` 在初始化时按默认保留天数（7 天）清理过期日志文件。

```js
function cleanupExpiredLogs(baseDir, retentionDays = 7) {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  for (const type of ['runtime', 'network', 'behavior', 'quality']) {
    const dir = join(baseDir, type);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      const filePath = join(dir, file);
      const stat = statSync(filePath);
      if (stat.mtimeMs < cutoff) {
        unlinkSync(filePath);
      }
    }
  }
}
```

- `shield`/`quality` 子命令支持 `--log-retention-days` 参数覆盖默认值。
- 仅删除过期 `.jsonl` 日志文件，不删除 `reports/` 下的报告文件。

---

### 2.5 质量保障模块 `lib/quality.js`

#### 2.5.1 复用 code-quality

```js
const CODE_QUALITY_ROOT = process.env.CODE_QUALITY_ROOT || '/Users/creayma/personal/code-quality';

export async function runCodeQuality(legacyRoot, options = {}) {
  const { targets = [], base, skipList = [] } = options;
  let command = 'all';
  const args = ['--project', legacyRoot];

  if (targets.length > 0) {
    command = 'module';
    for (const t of targets) args.push('--target', t);
  } else if (base) {
    command = 'diff';
    args.push('--base', base);
  }

  for (const s of skipList) args.push('--skip', s);

  return new Promise((resolve) => {
    const child = spawn('node', [`${CODE_QUALITY_ROOT}/cli.js`, command, ...args], {
      stdio: 'pipe',
      cwd: CODE_QUALITY_ROOT
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => stdout += d);
    child.stderr.on('data', d => stderr += d);
    child.on('exit', (code) => resolve({ command, code, stdout, stderr }));
  });
}
```

#### 2.5.2 自定义规则扫描

自定义规则模块 `lib/custom-rules/index.js`：

```js
import { scanFiles } from './scanner.js';

const RULES = [
  { id: 'SHIELD-001', name: 'no-dangerous-apis', severity: 'error' },
  { id: 'SHIELD-002', name: 'no-large-loops', severity: 'warning' },
  { id: 'SHIELD-003', name: 'no-expensive-watcher', severity: 'warning' },
  { id: 'SHIELD-004', name: 'no-sync-storage-in-loop', severity: 'warning' }
];

export async function runCustomRules(legacyRoot, options = {}) {
  const results = [];
  for (const rule of RULES) {
    if (options.disabled?.includes(rule.id)) continue;
    const hits = await scanFiles(legacyRoot, rule.name);
    results.push({ rule, hits });
  }
  return results;
}
```

---

### 2.6 自定义规则扫描器 `lib/custom-rules/scanner.js`

使用 `@babel/parser` 解析 JS，使用 `@vue/compiler-sfc` 解析 Vue SFC：

```js
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import { parse as parseSFC } from '@vue/compiler-sfc';

// @babel/traverse 的 ESM 导出在不同版本中不一致，做兼容性处理
const traverse = _traverse.default || _traverse;

export async function scanFile(filePath, ruleName) {
  const code = await readFile(filePath, 'utf8');
  let ast;
  if (filePath.endsWith('.vue')) {
    const { descriptor } = parseSFC(code);
    const script = descriptor.script?.content || descriptor.scriptSetup?.content;
    if (!script) return [];
    ast = parse(script, { sourceType: 'module', plugins: ['jsx'] });
  } else {
    ast = parse(code, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
  }

  const hits = [];
  const rule = RULE_IMPLEMENTATIONS[ruleName];
  traverse(ast, rule.visitor(hits, filePath));
  return hits;
}
```

---

### 2.7 分析与报告模块

#### 2.7.1 `lib/analyzer.js`

核心分析函数：

```js
export function analyzeLogs(logDir, options = {}) {
  const date = options.date || today();
  const runtimeLogs = readJsonl(join(logDir, 'runtime', `${date}.jsonl`));
  const networkLogs = readJsonl(join(logDir, 'network', `${date}.jsonl`));
  const behaviorLogs = readJsonl(join(logDir, 'behavior', `${date}.jsonl`));
  const qualityLogs = readJsonl(join(logDir, 'quality', `${date}.jsonl`));

  return {
    summary: buildSummary(runtimeLogs, networkLogs, behaviorLogs, qualityLogs),
    topErrors: aggregateErrors(runtimeLogs),
    networkIssues: analyzeNetwork(networkLogs),
    behaviorTimeline: buildTimeline(behaviorLogs),
    qualitySummary: summarizeQuality(qualityLogs)
  };
}
```

**错误去重策略**：
- `aggregateErrors` 对 `js-error` 按 `errorId + 1 秒时间窗口` 去重
- 优先保留 `source !== 'browser-pageerror'` 的记录（即来自 `inject.iife.js` 的优先）
- 去重后的错误才用于 TOP N 统计、首次/最近时间计算和 `/suggest` 查询

#### 2.7.2 `lib/reporter.js`

生成 Markdown 和 JSON 报告：

```js
export function generateMarkdownReport(analysis, options = {}) {
  return `
# legacy-shield 运行报告

- 项目：${options.project}
- 分析日期：${options.date}
- 生成时间：${new Date().toISOString()}

## 概览

| 指标 | 数值 |
|---|---|
| 运行时错误 | ${analysis.summary.runtimeErrorCount} |
| 运行时警告 | ${analysis.summary.runtimeWarningCount} |
| 网络请求 | ${analysis.summary.networkCount} |
| 网络异常 | ${analysis.summary.networkIssueCount} |
| 用户行为事件 | ${analysis.summary.behaviorCount} |
| ESLint 问题 | ${analysis.summary.eslintIssueCount} |
| 测试状态 | ${analysis.summary.testStatus} |
| 自定义规则命中 | ${analysis.summary.customRuleHitCount} |

## TOP 10 高频错误

${renderTopErrors(analysis.topErrors)}

## 网络异常

${renderNetworkIssues(analysis.networkIssues)}

## 用户行为时间线

${renderTimeline(analysis.behaviorTimeline)}

## 质量检查

${renderQuality(analysis.qualitySummary)}
  `.trim();
}
```

---

### 2.8 AI 智能体接口 `lib/api.js`

使用原生 Node `http` 实现轻量 REST 服务：

```js
import { createServer } from 'node:http';
import { join } from 'node:path';
import { analyzeLogs } from './analyzer.js';
import { generateMarkdownReport, generateJsonReport } from './reporter.js';
import { readJsonl } from './utils.js';

export function startApiServer({ projectPath, port = 3456, cors = false }) {
  const logDir = join(projectPath, '.runtime-log-ignore');

  const setCorsHeaders = (res) => {
    if (!cors) return;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    setCorsHeaders(res);

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    try {
      if (url.pathname === '/health') {
        res.end(JSON.stringify({ ok: true, project: projectPath }));
        return;
      }

      if (url.pathname === '/logs') {
        const type = url.searchParams.get('type') || 'runtime';
        const date = url.searchParams.get('date') || today();
        const logs = readJsonl(join(logDir, type, `${date}.jsonl`));
        res.end(JSON.stringify({ type, date, count: logs.length, logs }));
        return;
      }

      if (url.pathname === '/report') {
        const format = url.searchParams.get('format') || 'json';
        const date = url.searchParams.get('date') || today();
        const analysis = analyzeLogs(logDir, { date });
        const report = format === 'md'
          ? generateMarkdownReport(analysis, { project: projectPath, date })
          : generateJsonReport(analysis, { project: projectPath, date });
        res.end(JSON.stringify({ format, date, report }));
        return;
      }

      if (url.pathname === '/errors/top') {
        const limit = parseInt(url.searchParams.get('limit') || '10', 10);
        const date = url.searchParams.get('date') || today();
        const analysis = analyzeLogs(logDir, { date });
        res.end(JSON.stringify({ date, limit, errors: analysis.topErrors.slice(0, limit) }));
        return;
      }

      if (url.pathname === '/timeline') {
        const date = url.searchParams.get('date') || today();
        const analysis = analyzeLogs(logDir, { date });
        res.end(JSON.stringify({ date, count: analysis.behaviorTimeline.length, timeline: analysis.behaviorTimeline }));
        return;
      }

      if (url.pathname === '/suggest' && req.method === 'POST') {
        const body = await readBody(req);
        let payload;
        try {
          payload = JSON.parse(body);
        } catch (parseErr) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'invalid json', detail: parseErr.message }));
          return;
        }
        const { errorId } = payload;
        if (!errorId) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'missing errorId' }));
          return;
        }
        const date = url.searchParams.get('date') || today();
        const prompt = generateFixPrompt(errorId, logDir, date);
        if (prompt === null) {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: 'errorId not found', errorId }));
          return;
        }
        res.end(JSON.stringify({ errorId, date, prompt }));
        return;
      }

      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'not found' }));
    } catch (err) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: 'internal error', detail: err.message }));
    }
  });

  server.listen(port);
  return server;
}

// 辅助函数
async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function generateFixPrompt(errorId, logDir, date) {
  const runtimeLogs = readJsonl(join(logDir, 'runtime', `${date}.jsonl`));
  const error = runtimeLogs.find(l => l.errorId === errorId);
  if (!error) return null;
  return `请根据以下运行时错误信息，分析根因并给出修复建议：\n\n错误类型：${error.subType}\n错误消息：${error.message}\n发生页面：${error.url}\n堆栈信息：\n${error.stack || '无'}\n\n请给出：1）可能的原因；2）定位思路；3）建议的代码修复方向。`;
}
```

---

## 3. 数据流设计

### 3.1 shield 命令数据流

```
用户执行 node cli.js shield
        │
        ▼
校验老项目路径
        │
        ▼
创建 .runtime-log-ignore 目录
        │
        ▼
生成 sessionId
        │
        ├──────────────────┐
        ▼                  ▼
  启动 proxy          启动 browser
  监听 9876           配置代理=9876
        │                  │
        │                  ▼
        │            访问 target
        │                  │
        │                  ▼
        │            注入 inject.js
        │                  │
        │                  ▼
        │            监听 error/console/behavior
        │                  │
        │     代理层采集 network
        │                  │
        └──────────────────┘
                  │
                  ▼
        统一写入 logger
                  │
                  ▼
        .runtime-log-ignore/{runtime,network,behavior}/
```

### 3.2 quality 命令数据流

```
用户执行 node cli.js quality
        │
        ▼
调用 code-quality/cli.js all --project <legacy>
        │
        ▼
执行 legacy-shield 自定义规则扫描
        │
        ▼
汇总结果写入 .runtime-log-ignore/quality/
```

### 3.3 report/api 命令数据流

```
读取 .runtime-log-ignore/ 下日志
        │
        ▼
analyzer.js 聚合分析
        │
        ▼
reporter.js 生成 md/json
        │
        ▼
CLI report 输出到文件 / API 返回 HTTP 响应
```

---

## 4. 安全设计

### 4.1 数据脱敏

- 输入框值：只记录长度，不记录明文
- 密码框：完全不记录
- Cookie/Authorization Header：默认过滤，记录为 `[REDACTED]`
- 手机号/身份证：正则脱敏（可选开启）

### 4.2 日志隔离

- 所有日志写入 `<legacy>/.runtime-log-ignore/`
- 不进入 Skill 自身目录
- 不进入老项目源码目录

### 4.3 权限最小化

- 浏览器以普通用户权限启动
- 不请求系统级权限
- 不修改系统代理设置

---

## 5. 性能设计

### 5.1 代理性能

- body 读取采用流式 + 截断
- 日志写入异步，不阻塞响应
- 请求 ID 使用 Node 内置 `crypto.randomUUID()`，无需额外依赖

### 5.2 浏览器注入脚本性能

- 事件监听使用事件委托
- scroll 事件节流 200ms
- 不采集高频 mousemove
- 注入脚本体积 < 5KB

### 5.3 日志文件性能

- 按天滚动，避免单文件过大
- 使用文件流追加写入
- 进程退出时 flush

---

## 6. 扩展性设计

### 6.1 自定义规则扩展

新增规则只需在 `lib/custom-rules/rules/` 下添加文件并在 `index.js` 注册：

```js
// lib/custom-rules/rules/no-console-time.js
export default {
  id: 'SHIELD-005',
  name: 'no-console-time',
  severity: 'warning',
  description: '生产代码中不应保留 console.time',
  visitor: (hits, filePath) => ({
    CallExpression(path) {
      if (path.node.callee.object?.name === 'console' && path.node.callee.property?.name === 'time') {
        hits.push({ filePath, line: path.node.loc.start.line, message: '发现 console.time' });
      }
    }
  })
};
```

### 6.2 报告模板扩展

`lib/reporter.js` 支持传入自定义模板函数。

### 6.3 API 端点扩展

`lib/api.js` 采用路由表注册，新增端点只需在路由表中添加 handler。

---

## 7. 错误处理与降级

### 7.1 代理启动失败
- 如果端口被占用，自动尝试 `port + 1`，最多尝试 10 次
- 如果全部失败，报错退出

### 7.2 浏览器启动失败
- 如果 Chromium 未安装，提示运行 `npx playwright install chromium`
- 如果启动超时（30s），报错退出

### 7.3 日志写入失败
- 磁盘满时打印警告，不阻塞主流程
- 写入失败时缓存到内存，重试 3 次

### 7.4 code-quality 调用失败
- 如果 code-quality 未安装依赖，提示用户先 `pnpm install`
- 如果 code-quality 路径不存在，提示配置 `CODE_QUALITY_ROOT`

---

## 8. 与 code-quality 的集成边界

| legacy-shield 职责 | code-quality 职责 |
|---|---|
| 启动浏览器/代理监控 | 类型检查、ESLint、Vitest |
| 运行时日志采集 | 提交前质量校验 |
| 自定义 AST 规则扫描 | 已有 ESLint 规则 |
| 报告生成与 AI 接口 | 测试用例自动生成 |

集成方式：legacy-shield 通过子进程调用 `/Users/creayma/personal/code-quality/cli.js`，不直接引用 code-quality 内部模块。
