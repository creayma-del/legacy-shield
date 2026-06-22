# legacy-shield

非侵入式公司内部业务系统护航工具：运行时监控、开发阶段质量保障、项目状态分析与 AI 接口。

legacy-shield 不需要修改业务系统源码，即可在本地开发环境中对 Web 端与移动端 H5 项目进行全方位监控：

- 通过代理拦截运行时错误、网络请求与用户行为，生成结构化日志；
- 对业务系统执行 ESLint、类型检查与自定义 AST 规则扫描（含内存泄漏与资源加载风险规则）；
- 通过 Playwright 运行时采集内存泄漏与资源加载长耗时/大体积信息；
- 按日期聚合日志并生成 JSON / Markdown 报告；
- 将监控结果以 NDJSON 结构化日志持久化到本地，为 AI 智能体提供完整上下文；
- 提供本地 REST API，方便 AI 智能体、IDE 插件或 CI 流水线消费监控数据。

## 安装步骤

### 环境要求

- Node.js >= 20.19.0（推荐 LTS）
- pnpm >= 10.33.4
- 目标业务系统需已存在 `package.json`
- 使用 `--platform` 显式指定平台或启用运行时监控时，`src/` 目录不是必须的

### 本地安装

```bash
git clone <legacy-shield 仓库地址>
cd legacy-shield
pnpm install
pnpm build
```

构建产物位于 `dist/` 目录。若后续修改源码，需重新执行 `pnpm build`。

### 作为命令行工具使用

```bash
# 使用本地构建产物
node ./dist/cli.js --help

# 或全局链接（可选）
pnpm link --global
legacy-shield --help
```

## 快速开始

假设老项目位于 `/Users/creayma/work/sichuan/event`，且 dev server 已运行在 `http://localhost:8080`。

### 1. 启动运行时监控（shield）

```bash
node ./dist/cli.js shield \
  --project /Users/creayma/work/sichuan/event \
  --target http://localhost:8080 \
  --headless false \
  --proxy-port 9876
```

- 工具会启动本地 HTTP 代理与无头/有头浏览器；
- 在浏览器中操作老项目，错误、请求、点击等行为会被记录；
- 支持采集 Vue 3 运行时渲染错误、运行时警告以及 Vue Router 4 导航错误与守卫异常；
- 按 `Ctrl+C` 停止，`shield` 会优雅退出并打印日志摘要。

### 2. 生成分析报告（report）

```bash
node ./dist/cli.js report \
  --project /Users/creayma/work/sichuan/event \
  --format md \
  --date $(date +%Y-%m-%d)
```

报告默认输出到老项目的 `.runtime-log-ignore/reports/summary-<date>.md`。

### 3. 执行质量检查（quality）

```bash
node ./dist/cli.js quality \
  --project /Users/creayma/work/sichuan/event \
  --skip type-check
```

`quality` 会调用 `legacy-shield` 内置的 `code-quality` 运行 ESLint、类型检查（可选），并叠加 `legacy-shield` 自定义 AST 规则扫描，将结果写入质量日志。

#### v1.3 新增：H5 / Web 项目监控

```bash
# 显式指定 Web 平台并启用内存泄漏与资源加载监控
node ./dist/cli.js quality \
  --project /Users/creayma/work/sichuan/event \
  --platform web \
  --enable-memory-monitor \
  --enable-resource-monitor \
  --start-page / \
  --skip type-check \
  --skip lint \
  --skip test

# H5 项目示例
node ./dist/cli.js quality \
  --project /Users/creayma/work/sichuan/h5-event \
  --platform h5 \
  --enable-memory-monitor \
  --start-page / \
  --skip type-check \
  --skip lint \
  --skip test
```

v1.3 会额外生成 NDJSON 结构化日志到 `<project>/.legacy-shield/logs/<sessionId>.ndjson`，包含平台识别、静态规则命中、运行时内存/资源采集结果，为 AI 智能体提供完整上下文。

> **v1.2 路径变更说明**：`quality` 自动生成的单测默认落盘到本项目的 `tests/code-quality-generated/` 目录（不再使用原 code-quality 的 `tests/` 目录）。该目录已纳入 `.gitignore`，请勿提交到版本控制。

### 4. 启动 API 服务（api）

```bash
node ./dist/cli.js api \
  --project /Users/creayma/work/sichuan/event \
  --port 3456 \
  --cors
```

常用端点：

```bash
curl -s http://127.0.0.1:3456/health
curl -s "http://127.0.0.1:3456/logs?type=runtime&date=$(date +%Y-%m-%d)"
curl -s "http://127.0.0.1:3456/report?format=json&date=$(date +%Y-%m-%d)"
```

## 支持的框架与平台

`legacy-shield` 监控对象扩展为公司内部 Web 端与移动端 H5 业务系统：

- **Web**：支持 Next.js、Nuxt、Gatsby、React Router 等 Web 项目，默认 viewport 为桌面尺寸。
- **H5**：支持 uni-app、Taro、Ionic、原生 H5 等移动端项目，可通过 `package.json` 依赖、`viewport` meta 或显式 `--platform h5` 识别，默认 viewport 为 iPhone 尺寸。
- **Vue 3**：完整支持运行时渲染错误（`vue-render-error`）、运行时警告（`vue-warn`）以及 Vue Router 4 导航错误（`vue-router-error`），包括守卫抛错与异步路由组件加载失败。
- **Pinia 2.x / Vuex 4（v1.4 新增）**：`shield` 自动识别业务系统注册的 Pinia 与 Vuex 实例并完成零侵入 patch，结构化采集 store 错误：
  - `pinia-error`：Pinia action 同步 / 异步抛错，含 `appId`、`storeId`、`actionName`、`args`（脱敏）、`stateKeys` / `stateSizeBytes` / `stateTruncated` 等上下文；
  - `pinia-plugin-error`：Pinia 插件 install 阶段抛错，含 `appId`、`pluginName?`；
  - `vuex-error`：Vuex action / mutation / subscribe / subscribeAction 抛错，含 `appId`、`modulePath`、`type`、`payload`（脱敏）、`stage`、state 摘要等；
  - `vuex-strict-violation`：基于 Vuex 4 内部结构特征识别 strict mode 违规修改，含 `appId`、`modulePath`、`mutatedKeyPath?`、state 摘要，不依赖 console 文本解析。

  payload / args / state 均经 `--redact-body-fields` 端到端脱敏，state 仅记录 keys 与体积，不落盘完整值。运行时日志样例：

  ```json
  {
    "type": "runtime",
    "subType": "pinia-error",
    "message": "submit failed",
    "context": {
      "appId": "app-1",
      "storeId": "user",
      "actionName": "submit",
      "args": [{ "password": "[REDACTED]" }],
      "stateKeys": ["profile", "token"],
      "stateSizeBytes": 128,
      "stateTruncated": false
    }
  }
  ```

  与 Vue errorHandler / unhandledrejection / console-error 通道共享 `__shield_emitted__` 去重标记，analyzer 层按 `errorId + 1s` 窗口聚合，同一错误不会被重复落盘。当业务系统未引入 Pinia / Vuex 时，inject 脚本静默跳过；无需新增任何 CLI 参数即可启用。
- **React**：实验性支持渲染错误捕获，需通过 `--enable-react-patch` 开启。
- **Vue 2**：当前版本不支持，请使用针对 Vue 2 的其他监控方案。

## 命令参数参考

### `shield`

| 参数 | 说明 | 默认值 |
|---|---|---|
| `--project <path>` | 老项目根路径（必填） | - |
| `--target <url>` | 目标 dev server URL（必填） | - |
| `--proxy-port <port>` | 代理监听端口 | `9876` |
| `--start-page <path>` | 浏览器启动页面 | `/` |
| `--headless <bool>` | 是否无头模式 | `true` |
| `--no-body` | 不采集请求/响应 body | `false` |
| `--insecure` | 关闭 HTTPS 证书校验 | `false` |
| `--redact-body-fields <fields>` | body 脱敏字段 | `password,token,phone,idCard` |
| `--session-id <uuid>` | 自定义会话 ID | 自动生成 |
| `--log-retention-days <days>` | 日志保留天数 | `7` |
| `--enable-react-patch` | 实验性：启用 React 渲染错误捕获 | `false` |

### `quality`

| 参数 | 说明 | 默认值 |
|---|---|---|
| `--project <path>` | 业务系统根路径（必填） | - |
| `--target <file>` | 指定扫描文件，可多次使用 | 全部源码 |
| `--base <ref>` | git diff 基准 | - |
| `--skip <step>` | 跳过步骤（如 `type-check`、`lint`），可多次使用 | - |
| `--disable-rule <rule-id>` | 禁用自定义规则，可多次使用 | - |
| `--log-retention-days <days>` | QualityLog 保留天数 | `7` |
| `--platform <web\|h5>` | 强制指定平台类型；未指定时自动推断 | 自动推断 |
| `--enable-memory-monitor` | 启用内存泄漏运行时监控 | 关闭 |
| `--enable-resource-monitor` | 启用资源加载运行时监控 | 关闭 |
| `--start-page <path>` | 运行时监控启动页面或 dev server 入口 | `/` |
| `--memory-threshold-percent <percent>` | 内存泄漏判定阈值（JS Heap 增长或使用率） | `30` |
| `--resource-duration-threshold-ms <ms>` | 资源加载长耗时阈值 | `10000` |
| `--resource-size-threshold-bytes <bytes>` | 资源体积过大阈值 | `1048576` |
| `--resource-ignore-pattern <pattern>` | 资源忽略正则，可多次使用 | - |
| `--log-dir <path>` | 结构化日志输出目录 | `<project>/.legacy-shield/logs` |
| `--structured-log-retention-days <days>` | 结构化日志保留天数 | `30` |

### `report`

| 参数 | 说明 | 默认值 |
|---|---|---|
| `--project <path>` | 老项目根路径（必填） | - |
| `--date <date>` | 分析日期 | 当天 |
| `--format <md\|json>` | 输出格式 | `md` |
| `--out <path>` | 自定义输出路径 | - |

### `api`

| 参数 | 说明 | 默认值 |
|---|---|---|
| `--project <path>` | 老项目根路径（必填） | - |
| `--port <port>` | 服务端口 | `3456` |
| `--cors` | 启用跨域 | `false` |

## 与 code-quality 的关系

`legacy-shield` 是公司内部业务系统质量保障方案的延伸：

- `code-quality` 专注于**提交前**的静态检查（ESLint、类型检查、单元测试）；
- `legacy-shield` 在此基础上补充了**运行时监控**（错误、网络、行为）、**开发阶段护航**（内存泄漏、资源加载风险）、**自定义 AST 规则**与**AI 可消费的 REST API**。

从 v1.2 开始，`code-quality` 已作为内部子模块集成到 `legacy-shield` 的 `lib/code-quality/` 目录，`quality` 子命令不再依赖外部 `code-quality` 项目或 `CODE_QUALITY_ROOT` 环境变量。它会直接调用内置的 ESLint / TypeScript 配置执行检查，并额外运行 `legacy-shield` 自定义 AST 规则。自定义规则位于 `lib/custom-rules/rules/`，可按项目需求扩展。

从 v1.3 开始，`quality` 新增 H5/Web 平台识别、内存泄漏与资源加载运行时监控、NDJSON 结构化日志输出，覆盖业务系统开发阶段的全方位护航。

## 注意事项

1. **日志目录**：所有运行日志默认写入业务系统的 `.runtime-log-ignore/` 目录，并自动生成 `.gitignore` 忽略全部内容。v1.3 新增的结构化日志默认写入 `<project>/.legacy-shield/logs/`。请勿将这些目录提交到版本控制。
2. **隐私**：`shield` 默认会记录请求 header、body 与用户行为。生产环境或处理敏感数据时，请使用 `--no-body` 和 `--redact-body-fields` 控制采集范围。
3. **Node 版本**：项目要求 Node.js >= 20.19.0，低版本可能出现 `fetch` 全局 API 或 ESM 解析异常。
4. **浏览器依赖**：`shield` 与 `quality --enable-memory-monitor/--enable-resource-monitor` 依赖 Playwright 启动 Chromium。首次使用前请确保已安装浏览器：`pnpm exec playwright install chromium`。
5. **长时运行**：如需验证 1 小时日志体积，可使用 `scripts/benchmark-1h.sh`，目标当日日志总量应小于 500MB。
6. **平台识别**：未指定 `--platform` 时，v1.3 会根据 `package.json` 依赖、`viewport` meta、`manifest.json` 自动推断 `web` 或 `h5`；推断失败时默认按 `web` 处理。

## 文档索引

- [usage.md](docs/usage.md) - 详细使用指南与常见问题排查
- [api.md](docs/api.md) - REST API 文档与 AI 智能体集成示例
- [custom-rules.md](docs/custom-rules.md) - 自定义规则开发指南
