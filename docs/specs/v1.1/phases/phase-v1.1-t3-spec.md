# legacy-shield v1.1 任务 Spec：T3 新增 Vue 3 监控端到端测试

> 版本：v1.1
> 对应阶段 Spec：[phase-v1.1-spec.md](./phase-v1.1-spec.md)
> 对应执行计划：[execution-plan-v1.1.md](../execution-plan-v1.1.md)
> 状态：已通过，可进入代码开发

---

## 1. 目标

通过 Playwright + `shield` CLI 对 v1.1 新增的 Vue 3 监控能力进行端到端覆盖，验证以下场景：

- 初始 Vue 3 app 渲染错误；
- 页面运行期间动态创建的 Vue 3 app 错误；
- Vue 3 运行时警告；
- Vue Router 4 `router.onError` 异步错误；
- Vue Router 4 导航守卫抛错；
- 路由懒加载组件失败；
- 非 Vue 页面无异常回归。

---

## 2. 范围

**包含**：

- `tests/fixtures/vue3/` 目录及静态夹具页面；
- `tests/fixtures/vue3/vendor/` 目录下的 Vue 3 / Vue Router 4 静态文件；
- `tests/vue3-monitor.test.ts` 端到端测试文件。

**与 T1 的边界**：

- `lib/analyzer.ts` 的修改以及 `tests/analyzer.test.ts` 中关于新子类型的统计/TOP 聚合断言由 **T1** 负责；T3 的端到端测试仅验证运行时日志中的 `subType` 与 `level`，不重复覆盖 TOP 聚合算法。

**不包含**：

- 注入脚本本身的实现（T1）；
- 类型与日志级别扩展（T2）。

---

## 3. 依赖

- T1 与 T2 代码已完成并通过各自单元测试；
- `dist/cli.js` 已构建（测试 `beforeAll` 中自动检查并触发 `pnpm build`）；
- Playwright Chromium 已安装。

---

## 4. 测试夹具

### 4.1 目录结构

```
tests/fixtures/vue3/
├── vendor/
│   ├── vue.global.js          # Vue 3 全局构建版本
│   └── vue-router.global.js   # Vue Router 4 全局构建版本
├── vue-render-error.html
├── vue-dynamic-app.html
├── vue-warn.html
├── vue-router-error.html
├── vue-router-guard.html
├── vue-router-lazy.html
└── plain.html
```

> 注：上述目录共包含 7 个 HTML 夹具页面（6 个 Vue 3 相关 + 1 个非 Vue 回归页面）。

### 4.2 静态文件来源策略

- **默认使用本地静态文件**：`tests/fixtures/vue3/vendor/` 必须包含 Vue 3 与 Vue Router 4 全局构建产物；
- **使用开发构建**：`vue-warn` 用例依赖 `app.config.warnHandler` 被调用，只有 Vue 3 开发构建会发出运行时警告。因此 `tests/fixtures/vue3/vendor/` 中必须存放 Vue 3 / Vue Router 4 的开发构建产物（如 `vue.global.js`、`vue-router.global.js`），不得使用生产构建；
- **CI 环境禁止使用 CDN**：测试用例与夹具不得依赖外部网络；
- **本地开发可选回退**：可提供 `tests/fixtures/vue3/vendor/download.sh` 脚本，在文件缺失时从 unpkg 下载开发构建版本，但脚本必须在 `CI=true` 时直接退出并报错。

### 4.3 夹具页面示例

#### `vue-render-error.html`

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Vue Render Error</title>
  <script src="./vendor/vue.global.js"></script>
</head>
<body>
  <div id="app"></div>
  <script>
    const { createApp } = Vue;
    createApp({
      render() {
        throw new Error('intentional render error');
      }
    }).mount('#app');
  </script>
</body>
</html>
```

#### `vue-dynamic-app.html`

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Vue Dynamic App Error</title>
  <script src="./vendor/vue.global.js"></script>
</head>
<body>
  <div id="delayed"></div>
  <script>
    setTimeout(() => {
      const { createApp } = Vue;
      createApp({
        render() {
          throw new Error('intentional dynamic app error');
        }
      }).mount('#delayed');
    }, 500);
  </script>
</body>
</html>
```

#### `vue-warn.html`

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Vue Warn</title>
  <script src="./vendor/vue.global.js"></script>
</head>
<body>
  <div id="app"></div>
  <script>
    const { createApp } = Vue;
    createApp({
      props: {
        count: { type: Number }
      },
      render() {
        return null;
      }
    }, { count: 'not-a-number' }).mount('#app');
  </script>
</body>
</html>
```

#### `vue-router-error.html`

覆盖 `router.onError` 在导航守卫中返回 rejected Promise 的场景。

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Vue Router onError</title>
  <script src="./vendor/vue.global.js"></script>
  <script src="./vendor/vue-router.global.js"></script>
</head>
<body>
  <div id="app"></div>
  <script>
    const { createApp } = Vue;
    const { createRouter, createWebHashHistory } = VueRouter;

    const router = createRouter({
      history: createWebHashHistory(),
      routes: [{ path: '/:path(.*)', component: { render: () => null } }]
    });

    router.beforeEach(() => {
      return Promise.reject(new Error('navigation aborted by guard'));
    });

    createApp({ render: () => null })
      .use(router)
      .mount('#app');

    router.push('/trigger').catch(() => {});
  </script>
</body>
</html>
```

#### `vue-router-guard.html`

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Vue Router Guard Error</title>
  <script src="./vendor/vue.global.js"></script>
  <script src="./vendor/vue-router.global.js"></script>
</head>
<body>
  <div id="app"></div>
  <script>
    const { createApp } = Vue;
    const { createRouter, createWebHashHistory } = VueRouter;

    const router = createRouter({
      history: createWebHashHistory(),
      routes: [{ path: '/:path(.*)', component: { render: () => null } }]
    });

    router.beforeEach(() => {
      throw new Error('intentional guard error');
    });

    createApp({ render: () => null })
      .use(router)
      .mount('#app');

    router.push('/trigger').catch(() => {});
  </script>
</body>
</html>
```

#### `vue-router-lazy.html`

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Vue Router Lazy Load Failure</title>
  <script src="./vendor/vue.global.js"></script>
  <script src="./vendor/vue-router.global.js"></script>
</head>
<body>
  <div id="app"></div>
  <script>
    const { createApp } = Vue;
    const { createRouter, createWebHashHistory } = VueRouter;

    const router = createRouter({
      history: createWebHashHistory(),
      routes: [
        {
          path: '/lazy',
          component: () => Promise.reject(new Error('lazy component load failure'))
        }
      ]
    });

    createApp({ render: () => null })
      .use(router)
      .mount('#app');

    router.push('/lazy').catch(() => {});
  </script>
</body>
</html>
```

#### `plain.html`（非 Vue 回归）

```html
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Plain</title></head>
<body>
  <button id="btn">Click</button>
  <script>
    document.getElementById('btn').addEventListener('click', () => console.error('plain error'));
    setTimeout(() => document.getElementById('btn').click(), 300);
  </script>
</body>
</html>
```

---

## 5. 测试实现

### 5.1 测试文件

`tests/vue3-monitor.test.ts`

### 5.2 基础设施

本测试需要自行管理 shield 子进程、等待日志落盘并在用例结束后清理。推荐在 T3 开发前先将 `tests/e2e/shield.e2e.test.ts` 中的进程管理、日志等待与清理逻辑抽取到 `tests/e2e/helpers.ts`，供 `shield.e2e.test.ts` 与本测试共用；若未抽取，则在本测试文件内自行实现等效逻辑。

关键工具函数（最小实现）：

// `dir` 为 shield `--project` 传入的项目根目录（legacyDir）
async function waitForLogBySessionId(
  dir: string,
  sessionId: string,
  predicate: (log: Record<string, unknown>) => boolean,
  timeoutMs = 15000,
): Promise<Record<string, unknown>> {
  const runtimeDir = join(dir, '.runtime-log-ignore', 'runtime');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(runtimeDir)) {
      const files = readdirSync(runtimeDir).filter((f) => f.endsWith('.jsonl'));
      for (const file of files) {
        const lines = readFileSync(join(runtimeDir, file), 'utf8')
          .split('\n')
          .filter(Boolean);
        for (const line of lines) {
          try {
            const log = JSON.parse(line);
            if (log.sessionId === sessionId && predicate(log)) return log;
          } catch {
            // 忽略解析失败的行
          }
        }
      }
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`未在 ${timeoutMs}ms 内找到符合条件的日志 [sessionId=${sessionId}]`);
}
```

### 5.3 用例列表

| 用例 | 触发方式 | 断言 |
|---|---|---|
| initial app render error | 加载 `vue-render-error.html` | 存在 `subType === 'vue-render-error'`、`level === 'error'`、`context.appId`、`context.info` |
| dynamic createApp error | 加载 `vue-dynamic-app.html` | 存在 `subType === 'vue-render-error'`、`level === 'error'`、`context.appId`、`context.info` |
| runtime warning | 加载 `vue-warn.html` | 存在 `subType === 'vue-warn'`、`level === 'warn'`、`context.appId` |
| router onError | 加载 `vue-router-error.html` | 存在 `subType === 'vue-router-error'`、`level === 'error'`、`context.appId` |
| guard thrown error | 加载 `vue-router-guard.html` | 存在 `subType === 'vue-router-error'`、`level === 'error'`、`context.appId`、`context.to`、`context.from` |
| lazy route component failure | 加载 `vue-router-lazy.html` | 存在 `subType === 'vue-router-error'`、`level === 'error'`、`context.appId` |
| non-Vue page no regression | 加载 `plain.html` | 存在 `subType === 'console-error'` 且 `level === 'error'`，不存在任何 Vue 相关子类型；页面按钮点击行为正常采集 |

### 5.4 测试隔离要求

- 每个用例生成独立 `sessionId`（如 `vue-render-${randomUUID().slice(0, 8)}`），启动 shield 子进程时通过 `--session-id <sessionId>` 传入；
- 每个用例结束后清理 shield 子进程；
- 每个用例使用独立目标页面，避免路由状态互相污染；
- `legacyDir` 可在 `describe` 级别复用，但日志断言必须按 `sessionId` 过滤。

### 5.5 失败重试

由于 Playwright 启动与日志落盘存在异步时延，每个用例配置 `{ retry: 2, timeout: 90000 }`。

---

## 6. 实现步骤

1. 在 `tests/fixtures/vue3/vendor/` 放置 Vue 3 与 Vue Router 4 开发构建产物；
2. 创建上述 7 个夹具 HTML 页面；
3. 创建 `tests/vue3-monitor.test.ts`：
   - 优先复用 `tests/e2e/shield.e2e.test.ts` 中的本地 HTTP 服务与子进程管理模式；推荐将公共逻辑抽取到 `tests/e2e/helpers.ts`（如 `startFixtureServer(fixtureDir, port)`、`runShield(sessionId, targetUrl)`、`waitForLogBySessionId(...)`、`cleanup(process)`），若尚未抽取则在本测试文件内自行实现等效逻辑；
   - HTTP 服务为静态文件服务（如 `http.createServer` + `fs.readFile` 或 `sirv`），使用随机端口，测试结束后关闭服务；
   - 复用或自行实现 shield 子进程管理、日志等待与清理逻辑；
   - 实现 7 个端到端用例。
4. 本地运行 `pnpm test tests/vue3-monitor.test.ts` 验证；
5. 提交前运行全量 `pnpm typecheck && pnpm build && pnpm test`。

---

## 7. 验收标准

- [ ] 7 个夹具页面存在且可在本地通过 HTTP 服务访问；
- [ ] `tests/fixtures/vue3/vendor/` 包含本地 Vue 3 / Vue Router 4 静态文件；
- [ ] 7 个端到端用例全部通过；
- [ ] 每个用例使用独立 `sessionId`；
- [ ] `pnpm test` 全量通过；
- [ ] CI 环境测试不依赖外部 CDN。

---

## 8. 风险与应对

| 风险 | 影响 | 应对措施 |
|---|---|---|
| vendor 文件体积过大 | 仓库膨胀 | 仅保留 Vue 3 / Vue Router 4 开发构建产物（如 `vue.global.js`，未压缩）；必要时使用 git-lfs。不可为了减小体积改用生产构建，否则 `vue-warn` 用例无法触发 |
| Playwright 启动超时 | 测试不稳定 | 用例级别重试 + 90s 超时 |
| 日志落盘延迟导致断言失败 | 偶发失败 | `waitForLogBySessionId` 轮询最长 15s |
| 多个用例共享 `legacyDir` 日志污染 | 断言错误 | 严格按 `sessionId` 过滤 |
| CDN 不可用 | CI 失败 | 本地 vendor 文件 + CI 禁用 CDN |

---

## 9. 评审记录

| 轮次 | 时间 | 结论 | 主要问题 | 修订内容 |
|---|---|---|---|---|
| 1 | - | 待评审 | - | - |
| 最终 | 2026-06-18 | 通过 | 无 P0/P1；P2 用例断言统一性与 helper 规范 | 1. 状态改为「已通过，可进入代码开发」（本 Spec 评审通过即可进入 T3 准备，实际端到端测试执行需等待 T1/T2 代码落地）；<br>2. 用例列表统一补充 `level` 断言；<br>3. 补充 `context.appId` / `context.info` / `context.to` / `context.from` 存在性断言；<br>4. 明确 helper 抽取建议与静态文件服务要求 |
