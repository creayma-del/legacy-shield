# legacy-shield 需求分解文档

> 文档版本：v1.0
> 创建时间：2026-06-17
> 评审状态：第四次评审通过
> 评审时间：2026-06-17
> 项目定位：非侵入式老项目护航工具

## 1. 项目背景与目标

### 1.1 背景
老项目通常存在以下痛点：
- 运行时错误难以及时发现和定位
- 缺乏完整的请求/响应日志记录
- 用户操作行为难以复现
- 代码提交前缺乏自动化质量保障
- 项目状态难以量化分析，AI 智能体缺少标准化数据输入

### 1.2 目标
在不修改老项目源代码、不在老项目安装任何依赖的前提下，为老项目提供：
- 运行时监控与日志采集
- 提交前质量保障
- 项目状态分析与 AI 友好接口

## 2. 功能需求分解

### 2.1 本地开发环境监控系统

#### 2.1.1 实时错误信息捕获与日志记录

**需求编号**：REQ-001
**优先级**：P0
**需求描述**：
在老项目运行时，实时捕获以下错误类型并记录到日志：
- JavaScript 运行时异常（`window.onerror`）
- 未处理的 Promise 拒绝（`unhandledrejection`）
- 资源加载失败（图片、脚本、样式、API）
- `console.error` / `console.warn` 输出
- Vue/React 等框架的渲染错误（如 Vue 的 `app.config.errorHandler`）

**日志字段要求**：
```json
{
  "type": "runtime",
  "subType": "js-error|promise-rejection|resource-error|console-error|console-warn|vue-render-error|react-render-error",
  "sessionId": "uuid",
  "errorId": "根据错误类型、堆栈首帧和 URL 生成的稳定哈希",
  "timestamp": "2026-06-17T10:00:00.000Z",
  "level": "error|warn|info",
  "url": "当前页面 URL",
  "userAgent": "浏览器 UA",
  "message": "错误消息",
  "stack": "堆栈信息",
  "source": "发生错误的源文件",
  "line": 123,
  "column": 45,
  "context": {
    "componentName": "组件名（Vue/React 渲染错误时可选）",
    "props": "组件 props 快照（可选，不包含敏感字段）",
    "route": "当前路由（可选）",
    "framework": "vue|react（可选）"
  }
}
```

**errorId 生成规则**：取堆栈首帧（通常为 stack 第二行，去除列号与临时 hash 后）与 `subType`、`url` 一起做 SHA-256 哈希，取前 16 位。用于错误聚类和 `/suggest` 接口查询。

**验收标准**：
- [ ] 能捕获至少 5 种常见错误类型
- [ ] 每条错误日志包含 message、stack、timestamp、URL
- [ ] 错误日志写入 `<legacy>/.runtime-log-ignore/runtime/YYYY-MM-DD.jsonl`
- [ ] 不修改老项目任何源代码

---

#### 2.1.2 接口请求/响应完整日志采集

**需求编号**：REQ-002
**优先级**：P0
**需求描述**：
通过本地代理方式，完整采集老项目发出的 HTTP 请求和收到的响应，包括：
- 请求方法、URL、Headers、Body
- 响应状态码、Headers、Body
- 请求耗时统计
- 时间戳

**日志字段要求**：
```json
{
  "type": "network",
  "subType": "xhr|fetch|static-resource",
  "sessionId": "uuid",
  "timestamp": "2026-06-17T10:00:00.000Z",
  "level": "info|warn|error",
  "requestId": "唯一请求 ID",
  "method": "GET|POST|PUT|DELETE|...",
  "url": "完整 URL",
  "request": {
    "headers": {},
    "redactedHeaders": ["cookie", "authorization"],
    "body": "请求体（可截断）",
    "bodySize": 1024,
    "bodyTruncated": false
  },
  "response": {
    "status": 200,
    "statusText": "OK",
    "headers": {},
    "body": "响应体（可截断）",
    "bodySize": 2048,
    "bodyTruncated": false
  },
  "durationMs": 156,
  "pageUrl": "发起请求的页面 URL"
}
```

**subType 分类规则（MVP）**：
- `xhr`：请求头含 `X-Requested-With: XMLHttpRequest`
- `fetch`：通过 `window.fetch` 发起（由浏览器注入脚本辅助标记）
- `static-resource`：URL 扩展名为 `.js`、`.css`、`.png`、`.jpg`、`.svg`、`.woff` 等静态资源
- WebSocket 在 MVP 中不采集，标记为后续迭代

**敏感信息处理**：
- `Cookie`、`Authorization` 等 Header 默认记录为 `[REDACTED]`
- body 中的敏感字段可通过 `--redact-body-fields` 配置脱敏

**验收标准**：
- [ ] 能捕获 `XMLHttpRequest` 和 `fetch` 请求
- [ ] 能记录请求和响应的 headers 和 body
- [ ] 能统计请求耗时
- [ ] 网络日志写入 `<legacy>/.runtime-log-ignore/network/YYYY-MM-DD.jsonl`
- [ ] 默认 body 截断阈值 64KB，超过标记 truncated

---

#### 2.1.3 用户操作行为追踪与时间线记录

**需求编号**：REQ-003
**优先级**：P0
**需求描述**：
精确记录用户在老项目页面上的交互序列，包括：
- 点击事件（click）
- 输入事件（input、change）
- 表单提交（submit）
- 键盘事件（keydown、keyup）
- 滚动事件（scroll，节流）
- 路由跳转（pushState、replaceState、popstate、hashchange）
- 页面可见性变化（visibilitychange）

**日志字段要求**：
```json
{
  "type": "behavior",
  "subType": "click|input|change|submit|keydown|keyup|scroll|route-change|visibility-change",
  "sessionId": "uuid",
  "timestamp": "2026-06-17T10:00:00.000Z",
  "level": "info",
  "sequence": 1,
  "pageUrl": "当前页面 URL",
  "target": {
    "tagName": "BUTTON",
    "selector": "#submit-btn",
    "text": "提交",
    "className": "btn btn-primary",
    "id": "submit-btn"
  },
  "payload": {
    "inputType": "text",
    "valueLength": 8,
    "key": "Enter",
    "scrollTop": 500,
    "route": "/detail/123",
    "visible": true
  },
  "coordinates": {
    "x": 120,
    "y": 340
  }
}
```

**隐私与安全要求**：
- 输入框值只记录长度，不记录明文内容（密码类型完全不记录）
- 不采集用户名、手机号、身份证号等敏感字段

**验收标准**：
- [ ] 能记录至少 7 种用户交互事件
- [ ] 每个事件包含时间戳和序列号
- [ ] 能生成完整的时间线
- [ ] 行为日志写入 `<legacy>/.runtime-log-ignore/behavior/YYYY-MM-DD.jsonl`
- [ ] 不记录敏感信息明文

---

### 2.2 代码提交前质量保障机制

#### 2.2.1 自动生成完整测试用例

**需求编号**：REQ-004
**优先级**：P1
**需求描述**：
针对代码变更影响范围，自动生成单元测试用例。支持两种模式：
- 指定文件模式：为特定文件生成测试
- diff 模式：基于 git diff 自动识别变更文件并生成测试

**复用策略**：
直接调用 `/Users/creayma/personal/code-quality/cli.js` 的 `module` 和 `diff` 子命令。

**验收标准**：
- [ ] 支持 `--target` 指定文件生成测试
- [ ] 支持 `--base` 基于 git diff 生成测试
- [ ] 生成的测试文件落入 `code-quality/tests/` 目录
- [ ] 调用 code-quality 的 LLM 能力补全断言

---

#### 2.2.2 执行自动化测试并生成报告

**需求编号**：REQ-005
**优先级**：P1
**需求描述**：
执行生成的自动化测试，确保全部通过。失败时给出详细测试报告。

**复用策略**：
调用 `/Users/creayma/personal/code-quality/cli.js` 的 `all` 子命令中的 vitest 阶段。

**验收标准**：
- [ ] 能运行 vitest 测试
- [ ] 测试失败时返回非零退出码
- [ ] 输出测试摘要（通过数、失败数、时长）
- [ ] 测试结果写入 `<legacy>/.runtime-log-ignore/quality/YYYY-MM-DD.jsonl`

---

#### 2.2.3 集成 ESLint 进行代码校验

**需求编号**：REQ-006
**优先级**：P1
**需求描述**：
对老项目源码执行 ESLint 校验，复用 code-quality 已实现的 ESLint 9 + FlatCompat 兼容能力。

**复用策略**：
调用 `/Users/creayma/personal/code-quality/cli.js` 的 `all` 子命令中的 eslint 阶段。

**验收标准**：
- [ ] 能正确探测老项目 `.eslintrc` 或 `eslint.config.*`
- [ ] 支持 `.eslintrc` 无后缀文件
- [ ] 兼容 `plugin:vue/vue3-essential`、`plugin:prettier/recommended`、`@vue/prettier` 等 extends
- [ ] ESLint 结果写入 `<legacy>/.runtime-log-ignore/quality/YYYY-MM-DD.jsonl`

---

#### 2.2.4 支持扩展自定义校验规则

**需求编号**：REQ-007
**优先级**：P2
**需求描述**：
提供扩展接口，支持安全漏洞检测、性能问题预警等自定义规则。

**MVP 内置规则**：
| 规则 ID | 名称 | 说明 |
|---|---|---|
| SHIELD-001 | no-dangerous-apis | 检测 eval、new Function、innerHTML、document.write |
| SHIELD-002 | no-large-loops | 检测无 break 的大循环 |
| SHIELD-003 | no-expensive-watcher | 检测 Vue watch 监听大对象/数组 |
| SHIELD-004 | no-sync-storage-in-loop | 检测循环内 localStorage 同步读写 |

**验收标准**：
- [ ] 自定义规则扫描 `.js`、`.vue`、`.ts`、`.tsx` 文件
- [ ] 输出规则 ID、文件路径、行号、描述
- [ ] 结果写入 `<legacy>/.runtime-log-ignore/quality/YYYY-MM-DD.jsonl`
- [ ] 规则可配置开启/关闭

---

### 2.3 项目状态分析与辅助系统

#### 2.3.1 项目运行状态报告

**需求编号**：REQ-008
**优先级**：P1
**需求描述**：
不再提供 Web 仪表盘，改为生成离线报告文件，保存到老项目 `.runtime-log-ignore/reports/` 目录。

**报告类型**：
- 运行时摘要报告
- 网络质量报告
- 用户行为时间线报告
- 综合质量报告

**验收标准**：
- [ ] 支持 `--format md` 生成 Markdown 报告
- [ ] 支持 `--format json` 生成 JSON 报告
- [ ] 报告写入 `<legacy>/.runtime-log-ignore/reports/`
- [ ] 报告包含关键指标摘要

---

#### 2.3.2 错误信息智能分析与分类

**需求编号**：REQ-009
**优先级**：P1
**需求描述**：
对错误日志进行智能分析与分类，辅助开发人员定位问题根源。

**分析能力**：
- 按错误类型聚类（TypeError、ReferenceError、NetworkError 等）
- 按堆栈首帧定位源文件
- 按页面 URL 聚类
- 统计 TOP N 高频错误
- 识别错误首次出现时间和最近出现时间
- 标记可能的根因（如某次部署后新增）

**验收标准**：
- [ ] 能按错误类型聚类
- [ ] 能按堆栈定位源文件
- [ ] 输出 TOP 10 高频错误
- [ ] 给出每条错误的首次/最近出现时间

---

#### 2.3.3 为 AI 智能体提供标准化数据接口

**需求编号**：REQ-010
**优先级**：P2
**需求描述**：
为 AI 智能体提供标准化数据接口，支持自动化 bug 修复建议和需求实现方案生成。

**接口形式**：
- CLI：`node cli.js api --project <legacy> --port 3456` 启动本地 HTTP 服务
- 同时支持 `node cli.js report --format json` 直接输出 JSON

**API 端点**：
| 端点 | 方法 | 说明 |
|---|---|---|
| `GET /health` | 健康检查 | 返回服务状态 |
| `GET /logs?type=<runtime|network|behavior|quality>&date=YYYY-MM-DD` | 获取原始日志 | 返回 JSON 数组 |
| `GET /report?format=<json|md>&date=YYYY-MM-DD` | 获取分析报告 | 返回完整报告 |
| `GET /errors/top?limit=N&date=YYYY-MM-DD` | TOP N 错误 | 返回高频错误列表 |
| `POST /suggest` | 修复建议 | 传入 `{ errorId }`，返回针对该错误的修复建议 prompt |
| `GET /timeline?date=YYYY-MM-DD` | 用户行为时间线 | 返回按时间排序的行为序列 |

**验收标准**：
- [ ] API 返回格式为 JSON
- [ ] 数据结构和字段对人类和 AI 都友好
- [ ] 支持按日期过滤
- [ ] 支持错误修复建议 prompt 生成

---

## 3. 非功能性需求

### 3.1 零侵入性
- **NFR-001**：不得修改老项目源代码
- **NFR-002**：不得在老项目 package.json 中添加依赖
- **NFR-003**：不得在老项目中创建除 `.runtime-log-ignore` 以外的文件
- **NFR-004**：不得执行影响老项目运行状态的副作用命令

### 3.2 性能要求
- **NFR-005**：代理层日志写入不得阻塞请求响应，响应延迟增加 < 5ms（不含 body 大流量场景）
- **NFR-006**：浏览器端注入脚本执行时间 < 1ms / 事件
- **NFR-007**：body 采集默认截断 64KB，避免过大日志

### 3.3 兼容性
- **NFR-008**：支持 Vue3 + JavaScript/Webpack 老项目
- **NFR-009**：浏览器支持 Chromium（Playwright）
- **NFR-010**：Node.js >= 20.19.0

### 3.4 可观测性
- **NFR-011**：每个日志条目包含 sessionId 和时间戳
- **NFR-012**：日志按天滚动，避免单文件过大
- **NFR-013**：提供人类可读和机器可读两种输出格式
- **NFR-017**：支持配置日志保留天数（默认 7 天），自动清理过期日志

### 3.5 安全性
- **NFR-014**：不记录用户密码、token、手机号等敏感信息
- **NFR-015**：请求/响应 body 中的敏感字段可配置脱敏
- **NFR-016**：`.runtime-log-ignore` 目录内容不进入 git（建议老项目自行忽略）

---

## 4. 边界与假设

### 4.1 边界
- 本工具仅监控由 Skill 启动的浏览器实例中访问的老项目页面
- 仅监控启动时创建的单个 `page` 及其内部跳转；用户手动打开的新标签页不在监控范围内
- 老项目 dev server 需要提前启动并可访问
- 自定义规则 MVP 只覆盖常见安全和性能反模式
- AI 接口修复建议 prompt 由工具生成，实际修复由外部 AI 智能体执行
- MVP 不采集 WebSocket 流量

### 4.2 假设
- 老项目使用现代浏览器可运行的技术栈
- 开发者本地可以运行 Node.js 20+ 和 Playwright
- 网络环境允许下载 Playwright 浏览器二进制
- code-quality 项目位于 `/Users/creayma/personal/code-quality` 且已完成 `pnpm install`
- 使用 `quality` / `module` / `diff` 的测试生成功能前，code-quality 已配置可用的 LLM（`.local-llm-config.js` 或对应环境变量）

---

## 5. 术语表

| 术语 | 说明 |
|---|---|
| Skill | 可被 Trae/Codex 等 IDE 调用的工具包 |
| 老项目 | 需要被护航的目标项目，本工具不对其做修改 |
| JSONL | 每行一个 JSON 对象的日志格式 |
| CDP | Chrome DevTools Protocol，浏览器调试协议 |
| FlatCompat | ESLint 9 中兼容 legacy config 的适配器 |
