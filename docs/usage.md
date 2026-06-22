# legacy-shield 使用指南

本文档面向需要在公司内部 Web / H5 业务系统中落地 `legacy-shield` 的开发者，覆盖环境准备、各子命令详解与常见问题排查。

## 环境准备

1. **Node.js**：确认已安装 Node.js >= 20.19.0。

   ```bash
   node --version
   ```

2. **pnpm**：项目使用 pnpm 管理依赖。

   ```bash
   pnpm --version
   ```

3. **浏览器二进制**：`shield` 依赖 Playwright 启动 Chromium。首次使用前执行：

   ```bash
   pnpm exec playwright install chromium
   ```

4. **构建产物**：所有命令均依赖 `dist/cli.js`，运行前确保已构建：

   ```bash
   pnpm build
   ```

5. **目标老项目要求**：
   - 存在 `package.json`；
   - 存在 `src/` 目录；
   - dev server 可访问（`shield` 命令需要）。

## shield 命令详解

`shield` 启动一个本地代理和浏览器实例，将目标老项目的流量通过代理转发，同时注入监控脚本收集运行时错误、网络请求与用户行为。

### 基础用法

```bash
node ./dist/cli.js shield \
  --project /path/to/legacy \
  --target http://localhost:8080 \
  --headless false \
  --proxy-port 9876
```

### 工作流程

1. 校验 `--project` 指向的目录是否包含 `package.json` 与 `src/`；
2. 在指定端口启动 HTTP 代理，自动转发到 `--target`；
3. 启动浏览器，通过代理访问 `--target` + `--start-page`；
4. 注入 `inject.iife.js` 监控脚本，采集 `window.onerror`、console 输出、网络请求、点击等行为；若目标页面使用 Vue 3，还会自动采集运行时渲染错误（`vue-render-error`）、运行时警告（`vue-warn`）以及 Vue Router 4 导航错误（`vue-router-error`，含守卫抛错与懒加载失败）；
5. 日志实时写入 `<project>/.runtime-log-ignore/{runtime,network,behavior}/<date>.jsonl`；
6. 收到 `SIGINT` / `SIGTERM` 后优雅退出，关闭浏览器与代理，并打印摘要。

### 常用参数

| 参数 | 说明 |
|---|---|
| `--target <url>` | 目标 dev server URL，必须是 HTTP(S) 地址。 |
| `--proxy-port <port>` | 代理端口。若被占用，自动尝试 `port+1`，最多 10 次。 |
| `--headless true/false` | `false` 会打开可见浏览器窗口，便于人工操作。 |
| `--no-body` | 不记录请求/响应 body，可减少日志体积与隐私风险。 |
| `--insecure` | 访问 HTTPS 目标时忽略证书错误。 |
| `--redact-body-fields` | 对 JSON body 中敏感字段脱敏，如 `password`、`token`。 |
| `--enable-react-patch` | 实验性：捕获 React 渲染错误。 |

### 典型场景

- **本地调试**：`--headless false` 打开浏览器，人工复现问题后停止 shield。  
- **无人值守**：`--headless true` 配合 `--start-page` 自动访问指定页面，适合 CI 或定时任务。  
- **隐私保护**：`--no-body --redact-body-fields token,phone,idCard`。

### Vue 3 监控说明

`shield` 对 Vue 3 的监控能力包括：

- **运行时渲染错误**：组件 `render` 函数抛错会被记录为 `vue-render-error`；
- **运行时警告**：`prop` 类型不匹配等 Vue 警告会被记录为 `vue-warn`；
- **Vue Router 4 错误**：`router.onError`、导航守卫抛错、异步路由组件加载失败均会被记录为 `vue-router-error`。

> **注意**：当前版本不支持 Vue 2。若老项目使用 Vue 2，请使用其他针对性的监控方案。

## quality 命令详解

`quality` 对业务系统执行提交前质量检查，包含两个部分：

1. **内置 code-quality**：运行 ESLint、类型检查（复用业务系统已有配置）；
2. **custom-rules**：运行 `legacy-shield` 内置的 AST 自定义规则扫描。

从 v1.2 开始，`code-quality` 已作为内部子模块集成到 `legacy-shield`，不再需要单独安装或配置 `CODE_QUALITY_ROOT`。

### 基础用法

```bash
node ./dist/cli.js quality --project /path/to/legacy
```

### 跳过步骤

若业务系统没有类型检查或 ESLint 配置，可使用 `--skip`：

```bash
node ./dist/cli.js quality --project /path/to/legacy --skip type-check --skip lint
```

### 指定文件

只对变更文件扫描，可配合 `--base` 使用：

```bash
node ./dist/cli.js quality \
  --project /path/to/legacy \
  --base main \
  --target src/pages/index.vue \
  --target src/utils/helper.ts
```

### 禁用规则

```bash
node ./dist/cli.js quality --project /path/to/legacy --disable-rule SHIELD-001
```

### 输出

结果写入 `<project>/.runtime-log-ignore/quality/<date>.jsonl`，可通过 `report` 或 `api` 查看汇总。

### v1.3 新增：H5 / Web 平台识别与运行时监控

v1.3 将 `quality` 扩展为业务系统开发阶段护航入口，新增以下能力：

- **平台识别**：根据 `package.json` 依赖、`viewport` meta、`manifest.json` 自动推断 `web` 或 `h5`，也可通过 `--platform` 显式覆盖。
- **内存泄漏监控**：`--enable-memory-monitor` 使用 Playwright 打开页面并测量 JS Heap 增长与使用率。
- **资源加载监控**：`--enable-resource-monitor` 使用 Playwright 收集页面资源加载耗时与体积。
- **结构化日志**：所有 v1.3 监控结果写入 `<project>/.legacy-shield/logs/<sessionId>.ndjson`，默认保留 30 天。

#### H5 / Web 监控示例

```bash
# Web 项目：启用内存与资源监控
node ./dist/cli.js quality \
  --project /path/to/web-app \
  --platform web \
  --enable-memory-monitor \
  --enable-resource-monitor \
  --start-page / \
  --skip type-check \
  --skip lint \
  --skip test

# H5 项目：仅启用内存监控
node ./dist/cli.js quality \
  --project /path/to/h5-app \
  --platform h5 \
  --enable-memory-monitor \
  --start-page / \
  --skip type-check \
  --skip lint \
  --skip test
```

#### 内存泄漏监控示例

```bash
node ./dist/cli.js quality \
  --project /path/to/legacy \
  --platform web \
  --enable-memory-monitor \
  --memory-threshold-percent 30 \
  --start-page /
```

判定逻辑：页面打开后等待 5 秒，若 JS Heap 增长率或最终使用率超过 `--memory-threshold-percent`，则记录为 `warn`。

#### 资源加载监控示例

```bash
node ./dist/cli.js quality \
  --project /path/to/legacy \
  --platform web \
  --enable-resource-monitor \
  --resource-duration-threshold-ms 10000 \
  --resource-size-threshold-bytes 1048576 \
  --resource-ignore-pattern '^data:' \
  --start-page /
```

判定逻辑：页面 `networkidle` 后收集所有 `PerformanceResourceTiming`，标记超过长耗时阈值或体积阈值的资源。

#### 结构化日志路径与保留策略

- 默认路径：`<project>/.legacy-shield/logs/<sessionId>.ndjson`
- 自定义路径：`--log-dir /path/to/logs`
- 默认保留天数：`--structured-log-retention-days 30`
- 清理范围：仅删除以 `shield_` 开头、`.ndjson` 结尾且超过保留天数的文件，不会误删用户文件。

单条日志 Schema 示例：

```json
{
  "timestamp": "2026-06-21T10:00:00.000Z",
  "sessionId": "shield_xxx",
  "level": "warn",
  "category": "static-rule",
  "ruleId": "SHIELD-005",
  "riskType": "memory-leak",
  "message": "发现未配对的 addEventListener（事件: resize），可能存在内存泄漏",
  "sourceLocation": {
    "filePath": "/path/to/legacy/src/app.js",
    "line": 10,
    "column": 1
  },
  "context": {
    "target": "window",
    "event": "resize"
  }
}
```

### v1.2 目录结构说明

从 v1.2 开始，`quality` 子命令涉及的内部路径统一基于 `legacy-shield` 项目根目录：

- `lib/code-quality/`：`code-quality` 内部子模块源码与配置文件；
- `tests/code-quality-generated/`：`quality` 自动生成的单测落盘目录（已纳入 `.gitignore`，请勿提交）；
- 业务系统日志仍写入 `<project>/.runtime-log-ignore/quality/`。

> **兼容性提示**：若您之前通过 `CODE_QUALITY_ROOT` 指定过外部 code-quality 路径，v1.2 会忽略该环境变量并打印一次性废弃提示，随后继续使用内置模块。

## report 命令详解

`report` 读取当天的运行日志与质量日志，生成 JSON 或 Markdown 报告。

### 基础用法

```bash
# Markdown 报告
node ./dist/cli.js report --project /path/to/legacy --format md

# JSON 报告，指定日期
node ./dist/cli.js report --project /path/to/legacy --format json --date 2026-06-18
```

### 报告内容

- 关键指标摘要（运行时错误数、网络异常数、行为事件数等）
- TOP 10 高频错误
- 网络异常分析
- 用户行为时间线
- 代码质量摘要
- 建议与下一步

### 自定义输出路径

```bash
node ./dist/cli.js report \
  --project /path/to/legacy \
  --format md \
  --out /tmp/shield-report.md
```

## api 命令详解

`api` 启动本地 REST 服务，将日志与分析结果以 JSON 形式暴露给外部工具。

### 基础用法

```bash
node ./dist/cli.js api --project /path/to/legacy --port 3456 --cors
```

### 服务管理

- 启动成功后会打印访问地址；
- 按 `Ctrl+C` 或发送 `SIGTERM` 即可优雅关闭；
- 不带 `--cors` 时仅允许同源访问，适合本地脚本调用；
- 带 `--cors` 时允许浏览器/AI 插件跨域访问。

### 常用端点

详见 [api.md](api.md)。

## 常见问题排查

### 1. `shield` 启动时报“路径不存在”

确认 `--project` 指向的是老项目根目录，且存在 `package.json` 与 `src/`。

### 2. `shield` 启动时报 Chromium 找不到

执行：

```bash
pnpm exec playwright install chromium
```

或设置 `PLAYWRIGHT_CHROMIUM_CHANNEL=chrome` 使用系统 Chrome。

### 3. 代理端口被占用

`shield` 会自动尝试 `port+1`，最多 10 次。也可手动指定其他端口：

```bash
--proxy-port 9988
```

### 4. 日志目录过大

- 使用 `--no-body` 不采集 body；
- 使用 `--log-retention-days 3` 缩短保留天数；
- 避免长时间录制静态资源请求（可过滤 `static-resource` 类型日志）。

### 5. `quality` 类型检查失败

若老项目无 TypeScript 配置，使用 `--skip type-check` 跳过。

### 6. `report` 为空报告

确认当天是否有日志生成。日志文件名格式为 `<date>.jsonl`，`date` 默认使用本地日期。

### 7. API 返回 CORS 错误

启动 `api` 时加上 `--cors`。

### 8. 如何验证 1 小时日志体积

使用项目提供的脚本：

```bash
bash scripts/benchmark-1h.sh
```

当日所有 `.jsonl` 文件总大小小于 500MB 会输出 `PASS`，否则会输出 `FAIL`。
