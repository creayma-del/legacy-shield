# legacy-shield 阶段 2 详细 Spec：核心监控链路实现

> 文档版本：v1.0
> 对应需求文档：[requirements.md](../requirements.md)
> 对应设计文档：[design.md](../design.md)
> 对应执行计划：[execution-plan.md](../execution-plan.md) 阶段 2
> 状态：已完成 / 已归档（冻结，不再修改）

---

## 1. 阶段目标

实现 legacy-shield 的核心运行时监控链路，包括统一日志写入、HTTP 反向代理、浏览器注入脚本、Playwright 浏览器监控、shield 子命令编排以及 CLI 主入口。阶段结束时，用户可以通过 `node cli.js shield` 启动一个完整的监控会话，实时采集 runtime/network/behavior 日志并写入老项目的 `.runtime-log-ignore/` 目录。

### 1.1 阶段交付物

| 交付物 | 路径 | 说明 |
|---|---|---|
| 日志模块 | `lib/logger.js` | JSONL 日志写入服务 |
| 代理模块 | `lib/proxy.js` | HTTP 反向代理，采集请求/响应日志 |
| 注入脚本 | `lib/inject.iife.js` | 浏览器运行时监控 IIFE |
| 浏览器模块 | `lib/browser.js` | Playwright 启动与事件转发 |
| shield 子命令 | `lib/cli/shield.js` | shield 子命令编排 |
| CLI 主入口 | `cli.js` | commander 注册所有子命令 |
| 集成测试 | `tests/shield.integration.test.js` | shield 命令端到端测试 |

### 1.2 阶段边界

- **范围内**：运行时错误捕获、网络请求/响应日志、用户行为追踪、shield 命令端到端可用。
- **范围外**：自定义规则扫描、code-quality 调用、报告生成、API 服务。

---

## 2. 任务 2.1：实现 `lib/logger.js`

### 2.1 目标

提供统一的 JSONL 日志写入服务，支持 runtime、network、behavior、quality 四种类型，按天滚动文件，进程退出时 flush。

### 2.2 输入

- 老项目根路径 `projectPath`。
- 会话 ID `sessionId`。
- 保留天数 `retentionDays`（默认 7）。

### 2.3 输出

导出 `createLogger(projectPath, sessionId, retentionDays = 7)` 工厂函数，返回 logger 对象。

### 2.4 接口定义

```js
export function createLogger(projectPath, sessionId) {
  // 返回对象：
  return {
    logRuntime(subType, detail, level),
    logNetwork(detail),
    logBehavior(detail),
    logQuality(detail),
    close()
  };
}
```

### 2.5 日志目录结构

```
<legacy>/.runtime-log-ignore/
├── runtime/YYYY-MM-DD.jsonl
├── network/YYYY-MM-DD.jsonl
├── behavior/YYYY-MM-DD.jsonl
└── quality/YYYY-MM-DD.jsonl
```

### 2.6 `errorId` 生成规则

取堆栈首帧（通常为 stack 第二行，去除列号与临时 hash 后）与 `subType`、`url` 一起做 SHA-256 哈希，取前 16 位。

```js
function generateErrorId(subType, stack, url) {
  const lines = (stack || '').split('\n').map(l => l.trim()).filter(Boolean);
  const firstFrame = lines[1] || lines[0] || '';
  const normalizedFrame = firstFrame
    .replace(/:\d+$/, '')
    .replace(/\?v=[a-z0-9]+/gi, '');
  return createHash('sha256')
    .update(`${subType}|${normalizedFrame}|${url || ''}`)
    .digest('hex')
    .slice(0, 16);
}
```

### 2.7 实现步骤

1. 基于 `lib/utils.js` 的 `ensureDir` 创建日志目录。
2. 调用 `cleanupExpiredLogs(baseDir, retentionDays)` 清理过期 `.jsonl` 日志文件。
3. 为每种日志类型维护一个 `WriteStream`，按 `today()` 生成的日期命名文件。
4. 实现 `log(type, detail, level)`：合并公共字段（type、sessionId、timestamp、level）与 detail，运行时日志自动计算 errorId，写入对应流；如果 detail 中包含 `sessionId`，logger 强制覆盖为传入的 `sessionId`。
5. 实现 `close()`：遍历所有流调用 `end()`。
6. 监听流 `error` 事件，打印警告但不阻塞主流程。
7. 注册 `process.on('beforeExit')` 或依赖调用方在退出前调用 `close()`。

### 2.8 错误处理

- 目录创建失败：抛出错误，由调用方处理。
- 流写入失败：控制台告警，不抛异常。
- 磁盘满：打印警告，继续运行。

### 2.9 验收标准

- [ ] 调用 `logger.logRuntime()` 后文件中有对应 JSONL 行。
- [ ] 调用 `logger.close()` 后文件流正确关闭。
- [ ] 多类型日志分别写入不同子目录。
- [ ] 同一 session 的同类型日志写入同一日期文件。
- [ ] 运行时日志包含 `errorId` 字段。
- [ ] 流错误不阻塞主流程。
- [ ] 启动时清理超过保留天数的过期日志文件。

### 2.10 测试用例

```js
// tests/logger.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createLogger } from '../lib/logger.js';
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('logger', () => {
  let dir;
  let logger;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'shield-logs-'));
    logger = createLogger(dir, 'session-1');
  });

  afterEach(() => {
    logger.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes runtime log to dated file', () => {
    logger.logRuntime('js-error', { message: 'boom', stack: 'Error: boom\n  at app.js:10:5', url: 'http://localhost/' });
    logger.close();
    const files = readdirSync(join(dir, 'runtime'));
    expect(files.length).toBe(1);
    const line = readFileSync(join(dir, 'runtime', files[0]), 'utf8').trim();
    const record = JSON.parse(line);
    expect(record.type).toBe('runtime');
    expect(record.subType).toBe('js-error');
    expect(record.sessionId).toBe('session-1');
    expect(record.errorId).toMatch(/^[0-9a-f]{16}$/);
  });

  it('writes network log', () => {
    logger.logNetwork({ method: 'GET', url: 'http://localhost/api', request: {}, response: { status: 200 } });
    logger.close();
    const files = readdirSync(join(dir, 'network'));
    expect(files.length).toBe(1);
  });

  it('writes behavior log', () => {
    logger.logBehavior({ subType: 'click', target: { tagName: 'BUTTON' } });
    logger.close();
    const files = readdirSync(join(dir, 'behavior'));
    expect(files.length).toBe(1);
  });
});
```

---

## 3. 任务 2.2：实现 `lib/proxy.js`

### 3.1 目标

实现本地 HTTP 反向代理，采集老项目发出的 HTTP 请求和收到的响应，记录到 network 日志。

### 3.2 输入

- `target`：目标 dev server URL。
- `port`：代理监听端口。
- `logger`：`createLogger` 返回的 logger 实例。
- `noBody`：是否跳过 body 采集（默认 false）。
- `insecure`：是否关闭 HTTPS 证书校验（默认 false）。
- `redactBodyFields`：body 脱敏字段数组（默认 `['password','token','phone','idCard']`）。

### 3.3 输出

导出 `startProxy(options)`，返回 `{ server, proxy, url }`。其中 `url` 必须使用**实际监听端口**，当原 `port` 被占用并自动递增后，`url` 应反映最终端口。

### 3.4 接口定义

```js
export function startProxy({
  target,
  port,
  logger,
  noBody = false,
  insecure = false,
  redactBodyFields = ['password', 'token', 'phone', 'idCard']
}) {
  // 返回 { server, proxy, url }
  // url = `http://localhost:${actualPort}`
}
```

### 3.5 关键实现要求

1. 使用 `http-proxy` 创建代理服务器。
2. 使用原生 `http.createServer` 监听端口。
3. 在 `req.on('end')` 中调用 `proxy.web`，并通过 `buffer` 选项传入已读取的请求 body，避免 POST/PUT body 丢失。
4. 拦截 `res.write` 和 `res.end` 采集响应 body；由于 chunk 可能是 string，需先统一转为 Buffer 再收集，避免 `Buffer.concat` 报错。
5. 请求结束后写入 network 日志。
6. `url` 字段记录完整 URL（含 scheme、host）。
7. `level` 字段根据 status 判定：`>=500` 为 error，`>=400` 为 warn，其余为 info。
8. 定义 `BODY_LIMIT = 64 * 1024` 和 `totalSize(chunks)` 辅助函数。

### 3.6 Body 处理策略

- 默认保存前 64KB（`BODY_LIMIT = 64 * 1024`）。
- 超过阈值记录 `bodyTruncated: true`，保存前 64KB。
- `--no-body` 时 `body` 为 `null`，仅记录 `bodySize`。
- 二进制内容（根据 `Content-Type` 判断，如 `image/*`、`application/octet-stream`、`font/*` 等）转为 base64 并标记 `bodyEncoding: 'base64'`。

### 3.7 敏感信息处理

- Header 脱敏：Cookie、Authorization、X-Api-Key、X-Auth-Token 记录为 `[REDACTED]`。
- Body 脱敏：根据 `redactBodyFields` 递归脱敏匹配字段。

### 3.8 端口占用处理

如果 `port` 被占用，自动尝试 `port + 1`，最多尝试 10 次。监听成功后，根据 `server.address().port` 重新计算 `url = \`http://localhost:${actualPort}\`` 并返回。如果全部失败，抛出错误。

### 3.9 实现步骤

1. 解析 `target` URL。
2. 定义 `BODY_LIMIT`、`totalSize(chunks)`、`toBuffer(chunk)`、`isBinaryContentType(contentType)`、`formatBody(buffer, contentType)` 辅助函数。
3. 创建 `httpProxy` 实例。
4. 创建 HTTP server，处理每个请求：
   - 记录开始时间 `startTime`。
   - 生成 `requestId`。
   - 读取请求 body chunks，push 前调用 `toBuffer(chunk)` 统一转为 Buffer。
   - `req.on('end')` 中：
     - 拦截 `res.write` / `res.end`，chunk 同样先 `toBuffer`。
     - 调用 `proxy.web(req, res, { buffer })`。
     - 在 `res.end` 中根据 `Content-Type` 调用 `formatBody` 处理 body，写入 network 日志。
5. 实现端口自动递增监听。
6. 返回 `{ server, proxy, url }`。

### 3.10 错误处理

- 代理转发错误：记录 `proxy-error` 类型的 network 日志。
- 端口全部占用：抛出错误 `无法启动代理，端口 ${startPort} 至 ${endPort} 均被占用`。
- 响应写入拦截失败：不影响原始响应。

### 3.11 验收标准

- [ ] 启动代理后，curl 请求能正常转发到 target。
- [ ] POST/PUT 请求 body 能正确到达 target。
- [ ] 网络日志写入 `<legacy>/.runtime-log-ignore/network/YYYY-MM-DD.jsonl`。
- [ ] 日志中包含 method、完整 url、status、durationMs。
- [ ] body 超过 64KB 时 `bodyTruncated` 标记为 true。
- [ ] Cookie / Authorization Header 记录为 `[REDACTED]`。
- [ ] 网络日志包含 `redactedHeaders` 字段。
- [ ] 网络日志包含 `level` 字段。
- [ ] `--redact-body-fields password` 时 body 中 password 字段被脱敏。
- [ ] 端口被占用时自动尝试下一个端口（最多 10 次）。

### 3.12 测试用例

```js
// tests/proxy.test.js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startProxy } from '../lib/proxy.js';
import { createLogger } from '../lib/logger.js';
import http from 'node:http';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('proxy', () => {
  let targetServer;
  let targetPort;
  let logDir;
  let logger;
  let proxy;

  beforeAll(async () => {
    logDir = mkdtempSync(join(tmpdir(), 'shield-proxy-'));
    logger = createLogger(logDir, 'session-proxy');

    targetServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ method: req.method, path: req.url, body }));
      });
    });
    await new Promise(r => targetServer.listen(0, r));
    targetPort = targetServer.address().port;

    proxy = startProxy({ target: `http://localhost:${targetPort}`, port: 19876, logger });
    await new Promise(r => proxy.server.once('listening', r));
  });

  afterAll(async () => {
    proxy.proxy.close();
    proxy.server.close();
    targetServer.close();
    logger.close();
    rmSync(logDir, { recursive: true, force: true });
  });

  it('forwards GET and logs network', async () => {
    const res = await fetch(`${proxy.url}/hello`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.path).toBe('/hello');

    logger.close();
    const files = readdirSync(join(logDir, 'network'));
    const line = readFileSync(join(logDir, 'network', files[0]), 'utf8').split('\n').find(Boolean);
    const record = JSON.parse(line);
    expect(record.method).toBe('GET');
    expect(record.url).toMatch(/http:\/\/localhost:\d+\/hello/);
    expect(record.durationMs).toBeGreaterThanOrEqual(0);
    expect(record.level).toBe('info');
  });

  it('forwards POST body', async () => {
    await fetch(`${proxy.url}/post`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ foo: 'bar' })
    });
    logger.close();
    const files = readdirSync(join(logDir, 'network'));
    const lines = readFileSync(join(logDir, 'network', files[0]), 'utf8').split('\n').filter(Boolean);
    const record = JSON.parse(lines[lines.length - 1]);
    expect(record.method).toBe('POST');
    expect(record.request.body).toContain('foo');
    expect(record.response.body).toContain('bar');
  });
});
```

---

## 4. 任务 2.3：实现 `lib/inject.iife.js`

### 4.1 目标

实现浏览器可执行的 IIFE 脚本，捕获运行时错误、用户行为、console 输出和路由变化，并通过 `window.__shield_emit__` 发送事件。

### 4.2 输入

- 页面加载时由 Playwright 通过 `page.addInitScript` 注入。
- 可选全局变量 `window.__SHIELD_SESSION_ID__`。
- 可选全局变量 `window.__SHIELD_ENABLE_REACT_PATCH__`（默认 false）：控制是否启用 React.Component 包装。

### 4.3 输出

- 向 `window.__shield_emit__` 发送事件。
- 不返回值，不依赖页面脚本。

### 4.4 捕获事件清单

| 类型 | subType | 触发条件 |
|---|---|---|
| runtime | js-error | `window.addEventListener('error')` |
| runtime | promise-rejection | `window.addEventListener('unhandledrejection')` |
| runtime | resource-error | `error` 事件 target 为 HTMLScriptElement/Link/Image |
| runtime | console-error | `console.error` 调用 |
| runtime | console-warn | `console.warn` 调用 |
| runtime | console-info | `console.info` 调用 |
| runtime | console-log | `console.log` 调用 |
| runtime | vue-render-error | Vue `app.config.errorHandler` |
| runtime | react-render-error | React 错误兜底 + Component 包装 |
| behavior | click | `document.addEventListener('click')` |
| behavior | input | `document.addEventListener('input')` |
| behavior | change | `document.addEventListener('change')` |
| behavior | submit | `document.addEventListener('submit')` |
| behavior | keydown | `document.addEventListener('keydown')` |
| behavior | keyup | `document.addEventListener('keyup')` |
| behavior | scroll | `window.addEventListener('scroll')`（200ms 节流） |
| behavior | route-change | pushState/replaceState/popstate/hashchange |
| behavior | visibility-change | `visibilitychange` |

### 4.5 数据结构

运行时事件：

```js
{
  type: 'runtime',
  subType: 'js-error',
  sessionId,
  timestamp: new Date().toISOString(),
  level: 'error',
  url: location.href,
  userAgent: navigator.userAgent,
  message,
  stack,
  source,
  line,
  column,
  context: {}
}
```

行为事件：

```js
{
  type: 'behavior',
  subType: 'click',
  sessionId,
  sequence,
  timestamp: new Date().toISOString(),
  level: 'info',
  pageUrl: location.href,
  target: { tagName, selector, text, className, id },
  payload: { x, y },
  coordinates: { x, y }
}
```

### 4.6 隐私保护

- `input` 事件只记录 `valueLength`，不记录明文。
- `type="password"` 时 `valueLength` 为 0。
- 不采集 `mousemove`、`keypress` 等高频事件。

### 4.7 Vue 错误捕获

- 探测 `window.__VUE__` 或 `window.Vue`。
- 轮询最多 20 次（每次 500ms），在 `load` 事件后也尝试 patch。
- Patch `app.config.errorHandler`，记录 `componentName`、`props` 键名、`info`。

### 4.8 React 错误捕获（实验性，默认关闭）

- 探测 `window.React` 和 `window.ReactDOM`。
- 仅当页面 URL 包含 `?__shield_enable_react_patch=1` 或 shield 启动参数 `--enable-react-patch` 时，才包装 `React.Component` 捕获类组件渲染错误。
- 默认仅通过全局 `error` 事件中包含 React 堆栈的异常进行兜底识别。
- 原因：全局包装 `React.Component` 会改变 React 运行时的原型链，可能引入副作用，违背“零侵入”原则；因此作为可选实验功能。

### 4.9 fetch 标记

拦截 `window.fetch`，添加请求头 `X-Shield-Request-Type: fetch`，辅助 proxy 分类 subType。

### 4.10 实现步骤

1. 创建 `lib/inject.iife.js`。
2. 实现 IIFE，避免污染全局命名空间（仅暴露 `__shield_emit__` 接收函数由 Playwright 注入）。
3. 实现错误捕获：
   - `window.addEventListener('error')` 中区分 `js-error` 与 `resource-error`（target 为 `HTMLScriptElement`/`HTMLLinkElement`/`HTMLImageElement` 时）。
   - `window.addEventListener('unhandledrejection')` 捕获未处理 Promise 拒绝。
4. 实现 console 捕获：`console.error` 级别为 `error`，`console.warn` 级别为 `warn`，`console.info`/`console.log` 级别为 `info`。
5. 实现行为捕获、路由捕获、visibilitychange 捕获。
6. 实现 Vue/React patch 逻辑。
7. 实现 fetch 标记。
8. 在浏览器控制台手动验证。

### 4.11 验收标准

- [ ] 注入脚本可在浏览器控制台手动验证。
- [ ] 点击页面元素后能通过 `__shield_emit__` 收到 behavior 事件。
- [ ] `console.error` 能被捕获，且 level 为 `error`。
- [ ] `console.warn` 能被捕获，且 level 为 `warn`。
- [ ] Vue 组件渲染错误能被捕获。
- [ ] React 组件渲染错误能被捕获。
- [ ] 资源加载失败（script/image/link）能被捕获为 `resource-error`。
- [ ] 路由变化（含 hashchange）能被捕获。
- [ ] `input` 事件不记录明文。

### 4.12 测试用例

由于 `inject.iife.js` 是浏览器脚本，单元测试通过 Playwright 或 jsdom 执行：

```js
// tests/inject.test.js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('inject.iife.js', () => {
  let browser;
  let page;
  const injectScript = readFileSync(resolve('lib/inject.iife.js'), 'utf8');

  beforeAll(async () => {
    browser = await chromium.launch();
    page = await browser.newPage();
  });

  afterAll(async () => {
    await browser.close();
  });

  it('captures click behavior', async () => {
    const events = [];
    await page.exposeFunction('__shield_emit__', ev => events.push(ev));
    await page.addInitScript(injectScript);
    await page.setContent('<button id="btn">Click</button>');
    await page.click('#btn');
    await page.waitForTimeout(100);
    const clickEvents = events.filter(e => e.type === 'behavior' && e.subType === 'click');
    expect(clickEvents.length).toBeGreaterThanOrEqual(1);
    expect(clickEvents[0].target.id).toBe('btn');
  });

  it('captures console.error', async () => {
    const events = [];
    await page.exposeFunction('__shield_emit__', ev => events.push(ev));
    await page.addInitScript(injectScript);
    await page.evaluate(() => console.error('test error'));
    await page.waitForTimeout(100);
    const errors = events.filter(e => e.type === 'runtime' && e.subType === 'console-error');
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0].detail.message).toContain('test error');
  });
});
```

---

## 5. 任务 2.4：实现 `lib/browser.js`

### 5.1 目标

启动 Playwright 浏览器并注入监控脚本，将运行时错误和行为事件转发到 logger。

### 5.2 输入

- `proxyUrl`：Skill 代理地址。
- `startPage`：启动后访问的完整页面 URL。
- `headless`：是否无头模式（默认 true）。
- `logger`：logger 实例。
- `sessionId`：会话 ID，注入到页面供 `inject.iife.js` 读取。
- `enableReactPatch`：是否启用 React.Component 包装（默认 false）。

### 5.3 输出

导出 `startBrowser(options)`，返回 `{ browser, context, page }`。

### 5.4 接口定义

```js
export async function startBrowser({ proxyUrl, startPage, headless = true, logger, sessionId }) {
  // 返回 { browser, context, page }
}
```

### 5.5 关键实现要求

1. 使用 `chromium.launch` 启动浏览器，配置代理指向 Skill 代理。
2. 通过 `page.addInitScript({ content: ... })` 注入 `window.__SHIELD_SESSION_ID__`。
3. 通过 `page.addInitScript` 注入 `lib/inject.iife.js`。
4. 通过 `page.exposeFunction` 暴露 `__shield_emit__`。
5. 监听 `page.on('pageerror')` 和 `page.on('requestfailed')`，均明确传入 `level: 'error'`。
6. **不监听 `page.on('console')`**，console 由 inject.iife.js 唯一采集。
7. `requestfailed` 作为 `resource-error` 的兜底：若该 URL 在 1 秒内已被 inject.iife.js 的 `resource-error` 记录，则跳过，避免重复。
8. 仅转发运行时错误到 logger，不重复采集网络日志。
9. 仅监控启动时创建的单个 `page`。
10. 注入脚本路径在 ESM 环境下使用 `fileURLToPath(import.meta.url)` 解析。

### 5.6 错误处理

- 浏览器启动失败：如果 Chromium 未安装，提示运行 `npx playwright install chromium`。
- 启动超时（30s）：报错退出。
- 页面崩溃：记录 runtime 日志 `js-error`，source 为 `browser-pageerror`。

### 5.7 实现步骤

1. 读取 `lib/inject.iife.js` 文件路径。
2. 启动 Chromium，配置代理。
3. 创建 context 和 page。
4. 通过 `page.addInitScript({ content: ... })` 注入 `window.__SHIELD_SESSION_ID__` 和 `window.__SHIELD_ENABLE_REACT_PATCH__ = enableReactPatch`。
5. 注入 `lib/inject.iife.js`。
6. 暴露 `__shield_emit__`，根据事件类型调用 `logger.logRuntime` 或 `logger.logBehavior`。
7. 监听 `pageerror` 和 `requestfailed`，传入 `level: 'error'`；`requestfailed` 通过最近 1 秒内已记录的 `resource-error` URL 去重。
8. 访问 `startPage`。
9. 返回 `{ browser, context, page }`。

### 5.8 验收标准

- [ ] 能成功启动浏览器并访问 target。
- [ ] 页面错误能被记录到 runtime 日志。
- [ ] 页面点击能被记录到 behavior 日志。
- [ ] 关闭 Skill 时浏览器正确退出。
- [ ] 不重复产生 network 日志。
- [ ] `js-error` 不重复采集（inject.iife.js 优先，pageerror 作为兜底）。

### 5.9 测试用例

```js
// tests/browser.test.js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startBrowser } from '../lib/browser.js';
import { createLogger } from '../lib/logger.js';
import { startProxy } from '../lib/proxy.js';
import http from 'node:http';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('browser', () => {
  let targetServer;
  let targetPort;
  let logDir;
  let logger;
  let proxy;
  let browserHandle;

  beforeAll(async () => {
    logDir = mkdtempSync(join(tmpdir(), 'shield-browser-'));
    logger = createLogger(logDir, 'session-browser');
    targetServer = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<button id="btn">Click</button><script>console.error("err")</script>');
    });
    await new Promise(r => targetServer.listen(0, r));
    targetPort = targetServer.address().port;
    proxy = startProxy({ target: `http://localhost:${targetPort}`, port: 29876, logger });
    await new Promise(r => proxy.server.once('listening', r));
  });

  afterAll(async () => {
    if (browserHandle) {
      await browserHandle.browser.close();
    }
    proxy.proxy.close();
    proxy.server.close();
    targetServer.close();
    logger.close();
    rmSync(logDir, { recursive: true, force: true });
  });

  it('records page error and click', async () => {
    browserHandle = await startBrowser({ proxyUrl: proxy.url, startPage: proxy.url, headless: true, logger });
    await browserHandle.page.click('#btn');
    await browserHandle.page.waitForTimeout(500);
    await browserHandle.browser.close();
    logger.close();

    const runtimeFiles = readdirSync(join(logDir, 'runtime'));
    const runtimeLines = readFileSync(join(logDir, 'runtime', runtimeFiles[0]), 'utf8').split('\n').filter(Boolean).map(JSON.parse);
    expect(runtimeLines.some(l => l.subType === 'console-error')).toBe(true);

    const behaviorFiles = readdirSync(join(logDir, 'behavior'));
    const behaviorLines = readFileSync(join(logDir, 'behavior', behaviorFiles[0]), 'utf8').split('\n').filter(Boolean).map(JSON.parse);
    expect(behaviorLines.some(l => l.subType === 'click')).toBe(true);
  });
});
```

---

## 6. 任务 2.5：实现 `lib/cli/shield.js`

### 6.1 目标

实现 `shield` 子命令的 orchestrator，串联 proxy、browser、logger 的启动与退出。

### 6.2 输入

命令行参数：

- `--project <legacy-root>`（必填）
- `--target <dev-server-url>`（必填）
- `--proxy-port <port>`（默认 9876）
- `--start-page <path>`（默认 `/`，与 `--target` 组合成完整 URL）
- `--headless <true|false>`（默认 true，字符串 `'false'` 会被转为布尔 `false`）
- `--no-body`
- `--insecure`
- `--redact-body-fields <fields>`（默认 `password,token,phone,idCard`）
- `--session-id <uuid>`（默认自动生成）
- `--log-retention-days <days>`（默认 7，清理过期日志）
- `--enable-react-patch`（实验性；启用 React.Component 包装以捕获渲染错误）

### 6.3 输出

- 启动监控会话。
- 在进程退出时打印日志摘要。
- 返回退出码 0（正常退出）或 1（异常退出）。

### 6.4 执行流程

1. 解析命令行参数。
2. 参数类型转换：
   - `headlessBool = headless !== 'false'`。
   - `noBody = options.body === false`（commander 将 `--no-body` 解析为 `options.body = false`）。
   - `redactBodyFields = options.redactBodyFields.split(',').map(s => s.trim())`。
   - `retentionDays = parseInt(options.logRetentionDays, 10)`。
   - `proxyPort = parseInt(options.proxyPort, 10)`。
3. 调用 `assertLegacyProject(project)` 校验老项目路径。
4. 创建 `<legacy>/.runtime-log-ignore/{runtime,network,behavior}/`，并在该目录下创建 `.gitignore` 内容为 `*`。
5. 生成或复用 `sessionId`。
6. 创建 logger，传入 `retentionDays`。
7. 启动 proxy：`startProxy({ target, port: proxyPort, logger, noBody, insecure, redactBodyFields })`，取回实际监听的 `url`（含实际端口）。
8. 将 `--start-page` 与 `--target` 组合为完整 URL：`startUrl = new URL(startPage, target).href`。
9. 启动 browser，访问 `startUrl`，传入 `sessionId`、`proxyUrl`（使用 proxy 返回的实际 URL）和 `enableReactPatch`。
10. 监听 `SIGINT` / `SIGTERM`：
    - 关闭 browser。
    - 关闭 proxy。
    - 调用 `logger.close()`。
    - 打印日志摘要（各类型日志行数、文件路径）。
    - 进程退出。

### 6.5 日志摘要格式

```
[legacy-shield] 监控会话结束
- sessionId: <uuid>
- runtime 日志: <n> 条 -> <path>
- network 日志: <n> 条 -> <path>
- behavior 日志: <n> 条 -> <path>
```

### 6.6 错误处理

- 老项目路径非法：清晰错误提示并退出码 1。
- 代理启动失败：退出码 1。
- 浏览器启动失败：退出码 1，提示安装 Chromium。

### 6.7 验收标准

- [ ] `node cli.js shield --project <legacy> --target http://localhost:8080` 能正常运行。
- [ ] 按 Ctrl+C 后代理和浏览器都正确关闭。
- [ ] 日志文件中有内容生成。
- [ ] 退出时打印日志摘要。

### 6.8 测试用例

见 8.1 集成测试。

---

## 7. 任务 2.6：串联 CLI 主入口 `cli.js`

### 7.1 目标

提供统一的 CLI 入口，注册 shield/quality/report/api 子命令。

### 7.2 输入

- `lib/cli/shield.js`
- `lib/cli/quality.js`（阶段 3 实现，阶段 2 先占位）
- `lib/cli/report.js`（阶段 4 实现，阶段 2 先占位）
- `lib/cli/api.js`（阶段 4 实现，阶段 2 先占位）

### 7.3 输出

`/Users/creayma/personal/legacy-shield/cli.js`：

```js
#!/usr/bin/env node
import { Command } from 'commander';
import { runShield } from './lib/cli/shield.js';
import { runQuality } from './lib/cli/quality.js';
import { runReport } from './lib/cli/report.js';
import { runApi } from './lib/cli/api.js';

const program = new Command();

program
  .name('legacy-shield')
  .description('非侵入式老项目护航工具')
  .version('0.1.0');

program
  .command('shield')
  .description('启动运行时监控')
  .requiredOption('--project <path>', '老项目根路径')
  .requiredOption('--target <url>', '目标 dev server URL')
  .option('--proxy-port <port>', '代理端口', '9876')
  .option('--start-page <path>', '启动页面', '/')
  .option('--headless <bool>', '是否无头模式', 'true')
  .option('--no-body', '不采集 body')
  .option('--insecure', '关闭 HTTPS 证书校验')
  .option('--redact-body-fields <fields>', 'body 脱敏字段', 'password,token,phone,idCard')
  .option('--session-id <uuid>', '会话 ID')
  .option('--log-retention-days <days>', '日志保留天数', '7')
  .option('--enable-react-patch', '实验性：启用 React 渲染错误捕获')
  .action(runShield);

program
  .command('quality')
  .description('执行提交前质量检查')
  .requiredOption('--project <path>')
  .option('--target <file>', '指定文件', (v, p) => { p.push(v); return p; }, [])
  .option('--base <ref>', 'git diff 基准')
  .option('--skip <step>', '跳过步骤', (v, p) => { p.push(v); return p; }, [])
  .option('--disable-rule <rule-id>', '禁用自定义规则', (v, p) => { p.push(v); return p; }, [])
  .option('--log-retention-days <days>', '日志保留天数', '7')
  .action(runQuality);

program
  .command('report')
  .description('生成分析报告')
  .requiredOption('--project <path>')
  .option('--date <date>', '日期')
  .option('--format <format>', '输出格式', 'md')
  .option('--out <path>', '输出路径')
  .action(runReport);

program
  .command('api')
  .description('启动 REST API 服务')
  .requiredOption('--project <path>')
  .option('--port <port>', '端口', '3456')
  .option('--cors', '启用 CORS')
  .action(runApi);

program.parseAsync(process.argv).catch(err => {
  console.error(err.message);
  process.exit(1);
});
```

### 7.4 实现步骤

1. 创建 `cli.js`。
2. 使用 commander 注册四个子命令。
3. 实现全局错误处理。
4. 确保 `cli.js` 可执行（`chmod +x cli.js`）。

### 7.5 验收标准

- [ ] `node cli.js --help` 显示所有子命令。
- [ ] `node cli.js shield --help` 显示 shield 参数。
- [ ] `node cli.js shield --project <legacy> --target <url>` 能启动监控。

### 7.6 测试用例

```bash
# TC-2.6-001：help 输出包含所有子命令
node /Users/creayma/personal/legacy-shield/cli.js --help | grep -E "shield|quality|report|api"

# TC-2.6-002：shield help 输出包含 --project 和 --target
node /Users/creayma/personal/legacy-shield/cli.js shield --help | grep -E "project|target"
```

---

## 8. 任务 2.7：监控链路集成测试

### 8.1 目标

验证 shield 命令端到端可用。

### 8.2 测试环境

- 启动一个简单 HTTP server 作为老项目 target。
- 运行 `node cli.js shield --project <legacy> --target <server>`。
- 在浏览器中触发点击、console.error、网络请求。
- 停止 shield。
- 检查 `.runtime-log-ignore/` 下日志是否完整。

### 8.3 测试步骤

1. 创建临时老项目目录，包含 `package.json` 和 `src/`。
2. 启动目标 HTTP server，返回包含按钮和 console.error 的页面。
3. 以子进程方式运行 `node cli.js shield --project <dir> --target <server> --headless true`。
4. 等待 2 秒让页面加载完成。
5. 通过 Playwright 或子进程信号控制触发点击（可在 inject.iife.js 中自动触发测试模式，或集成测试直接调用 browser 模块）。
6. 发送 SIGINT 给 shield 进程。
7. 等待进程退出。
8. 读取日志文件，验证 runtime/network/behavior 日志内容。

### 8.4 验收标准

- [ ] runtime 日志包含错误。
- [ ] network 日志包含请求。
- [ ] behavior 日志包含点击事件。
- [ ] 进程正常退出，退出码 0。

### 8.5 测试用例

```js
// tests/shield.integration.test.js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('shield integration', () => {
  let legacyDir;
  let targetServer;
  let targetPort;
  let shieldProcess;

  beforeAll(async () => {
    legacyDir = mkdtempSync(join(tmpdir(), 'shield-legacy-'));
    mkdirSync(join(legacyDir, 'src'));
    writeFileSync(join(legacyDir, 'package.json'), JSON.stringify({ name: 'fake-legacy' }));

    targetServer = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <button id="btn">Click</button>
        <script>
          document.getElementById('btn').addEventListener('click', () => console.error('clicked error'));
          console.error('page error');
        </script>
      `);
    });
    await new Promise(r => targetServer.listen(0, r));
    targetPort = targetServer.address().port;

    shieldProcess = spawn('node', [
      '/Users/creayma/personal/legacy-shield/cli.js', 'shield',
      '--project', legacyDir,
      '--target', `http://localhost:${targetPort}`,
      '--headless', 'true',
      '--proxy-port', '39876'
    ], { stdio: 'pipe' });

    // 等待 shield 输出“监控会话”或代理就绪标志，最多 10 秒
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('shield startup timeout')), 10000);
      shieldProcess.stdout.on('data', data => {
        if (String(data).includes('监控会话')) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
  });

  afterAll(async () => {
    if (shieldProcess && !shieldProcess.killed) {
      shieldProcess.kill('SIGINT');
      await new Promise(r => shieldProcess.on('exit', r));
    }
    targetServer.close();
    rmSync(legacyDir, { recursive: true, force: true });
  });

  it('collects runtime and behavior logs', async () => {
    // 页面加载后会执行 console.error('page error')，因此 runtime 日志应包含 console-error
    // behavior 日志可能为空（无点击），但至少目录和文件已创建
    await new Promise(r => setTimeout(r, 1000));
    shieldProcess.kill('SIGINT');
    await new Promise(r => shieldProcess.on('exit', r));

    const runtimeDir = join(legacyDir, '.runtime-log-ignore', 'runtime');
    const behaviorDir = join(legacyDir, '.runtime-log-ignore', 'behavior');
    expect(existsSync(runtimeDir)).toBe(true);
    expect(existsSync(behaviorDir)).toBe(true);

    const runtimeFiles = readdirSync(runtimeDir);
    expect(runtimeFiles.length).toBeGreaterThan(0);
    const runtimeLines = readFileSync(join(runtimeDir, runtimeFiles[0]), 'utf8')
      .split('\n').filter(Boolean).map(JSON.parse);
    expect(runtimeLines.some(l => l.subType === 'console-error')).toBe(true);
  });
});
```

---

## 9. 阶段 2 集成验收

### 9.1 验收清单

- [ ] `lib/logger.js` 实现并按类型写入日志（任务 2.1）。
- [ ] `lib/proxy.js` 能转发请求并记录 network 日志（任务 2.2）。
- [ ] `lib/inject.iife.js` 能捕获错误和行为事件（任务 2.3）。
- [ ] `lib/browser.js` 能启动浏览器并转发事件（任务 2.4）。
- [ ] `lib/cli/shield.js` 能编排完整 shield 流程（任务 2.5）。
- [ ] `cli.js` 注册所有子命令并支持 help（任务 2.6）。
- [ ] shield 集成测试通过（任务 2.7）。

### 9.2 阶段出口条件

以下全部满足后，方可进入阶段 3：

1. `pnpm test` 在阶段 2 范围内全部通过。
2. `node cli.js shield --project <legacy> --target <url>` 能正常运行并生成日志。
3. 网络日志、运行时日志、行为日志均非空。

### 9.3 阶段交付验证命令

```bash
cd /Users/creayma/personal/legacy-shield
pnpm test
node cli.js --help
node cli.js shield --help
```

---

## 10. 风险与应对

| 风险 | 影响 | 应对措施 |
|---|---|---|
| Playwright Chromium 未安装 | 高 | 测试/运行前执行 `npx playwright install chromium` |
| 代理 body 读取引入延迟 | 中 | 提供 `--no-body` 模式；文档说明 <5ms 指标仅适用于 headers-only 模式 |
| inject.iife.js 与页面脚本冲突 | 中 | 使用 IIFE 隔离；避免覆盖原生对象 |
| pageerror 与 inject.iife.js 重复采集 | 低 | analyzer 层按 errorId + 1 秒窗口去重 |

---

## 11. 依赖关系

- **前置依赖**：阶段 1（项目骨架、utils.js、依赖安装）。
- **后续依赖**：阶段 3（quality 子命令复用监控链路中的 logger），阶段 4（report/api 读取阶段 2 生成的日志）。
