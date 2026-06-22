# legacy-shield 详细执行计划

> 文档版本：v1.0
> 对应需求文档：requirements.md
> 对应设计文档：design.md
> 评审状态：第四次评审通过
> 评审时间：2026-06-17

## 1. 项目总体进度

| 阶段 | 名称 | 预计任务数 | 优先级 | 依赖 |
|---|---|---|---|---|
| 阶段 1 | 项目骨架与依赖初始化 | 5 | P0 | 无 |
| 阶段 2 | 核心监控链路实现 | 7 | P0 | 阶段 1 |
| 阶段 3 | 质量保障与自定义规则 | 5 | P1 | 阶段 1 |
| 阶段 4 | 分析、报告与 AI 接口 | 6 | P1/P2 | 阶段 1、阶段 2、阶段 3 |
| 阶段 5 | 集成测试与验收 | 4 | P0 | 阶段 2-4 |

---

## 2. 阶段 1：项目骨架与依赖初始化

### 任务 1.1：创建项目目录结构

**目标**：建立 `legacy-shield` 的标准目录树。

**目录结构**：
```
legacy-shield/
├── bin/
│   └── cli.js              # 可执行入口（可选）
├── lib/
│   ├── cli/                # 子命令实现
│   │   ├── shield.js
│   │   ├── quality.js
│   │   ├── report.js
│   │   └── api.js
│   ├── proxy.js
│   ├── browser.js
│   ├── logger.js
│   ├── quality.js
│   ├── analyzer.js
│   ├── reporter.js
│   ├── api.js
│   ├── inject.iife.js      # 页面注入脚本（浏览器可执行 IIFE）
│   ├── utils.js            # 通用工具
│   └── custom-rules/
│       ├── index.js
│       ├── scanner.js
│       └── rules/
│           ├── no-dangerous-apis.js
│           ├── no-large-loops.js
│           ├── no-expensive-watcher.js
│           └── no-sync-storage-in-loop.js
├── docs/
│   └── specs/              # 已创建的需求/设计/计划文档
├── tests/                  # 自身单元测试（后续补充）
├── cli.js                  # 主入口
├── package.json
├── .gitignore
└── README.md               # 使用说明
```

**验收标准**：
- [ ] 所有目录创建完成
- [ ] `cli.js` 可执行
- [ ] `package.json` 配置正确

---

### 任务 1.2：编写 package.json

**目标**：定义项目元信息、脚本、依赖和引擎约束。

**关键配置**：
```json
{
  "name": "legacy-shield",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "非侵入式老项目护航工具：运行时监控、提交前质量保障、项目状态分析与 AI 接口",
  "bin": {
    "legacy-shield": "./cli.js"
  },
  "engines": {
    "node": ">=20.19.0"
  },
  "packageManager": "pnpm@10.33.4",
  "scripts": {
    "shield": "node ./cli.js shield",
    "quality": "node ./cli.js quality",
    "report": "node ./cli.js report",
    "api": "node ./cli.js api"
  },
  "dependencies": {
    "commander": "^11.0.0",
    "http-proxy": "^1.18.1",
    "playwright": "^1.44.0"
  },
  "devDependencies": {
    "@babel/parser": "^7.29.0",
    "@babel/traverse": "^7.29.0",
    "@vue/compiler-sfc": "^3.5.0"
  }
}

**依赖说明**：
- 不使用 `uuid`：Node.js 20+ 内置 `crypto.randomUUID()`
- 不使用 `dayjs`：日期格式化优先使用原生 `Intl.DateTimeFormat` 或 `toISOString()`
```

**验收标准**：
- [ ] `package.json` 包含全部必要字段
- [ ] `engines.node` 约束 >= 20.19.0
- [ ] 依赖版本与 code-quality 不冲突

---

### 任务 1.3：初始化 git 与 .gitignore

**目标**：初始化版本控制并忽略不应提交的文件。

**.gitignore 内容**：
```
node_modules/
*.log
.DS_Store
.vscode/
.idea/
/test-results/
/playwright-report/
/playwright/.cache/
```

**验收标准**：
- [ ] `.gitignore` 创建
- [ ] `node_modules` 被忽略

---

### 任务 1.4：安装项目依赖

**目标**：完成 `pnpm install`。

**命令**：
```bash
cd /Users/creayma/personal/legacy-shield
pnpm install
```

**可能阻塞点**：
- Playwright 需要下载 Chromium 二进制，可能耗时较长
- 如果下载失败，需要配置 `PLAYWRIGHT_DOWNLOAD_HOST` 或手动 `npx playwright install chromium`

**验收标准**：
- [ ] `pnpm install` 成功退出
- [ ] `node_modules/.bin/playwright` 存在
- [ ] 可运行 `node -e "import('playwright').then(()=>console.log('ok'))"`

---

### 任务 1.5：实现通用工具模块 `lib/utils.js`

**目标**：提供全项目复用的基础函数。

**函数清单**：
| 函数 | 说明 |
|---|---|
| `assertLegacyProject(path)` | 校验路径存在、包含 package.json 和 src/ |
| `ensureDir(dir)` | 递归创建目录 |
| `today()` | 返回 YYYY-MM-DD 格式的本地日期 |
| `generateId()` | 生成唯一 ID（基于 `crypto.randomUUID`） |
| `readJsonl(filePath)` | 读取 JSONL 文件为对象数组 |
| `safeJsonParse(str)` | 安全 JSON 解析，失败返回 null |
| `truncateBody(body, maxSize)` | 截断 body 内容 |
| `redactHeaders(headers)` | 返回 `{ headers, redactedHeaders }`，headers 已脱敏，redactedHeaders 列出被脱敏的字段名 |
| `redactBody(body, fields)` | 脱敏 body 中的敏感字段，默认字段：password、token、phone、idCard |
| `classifyNetworkSubType(req, url)` | 判定网络请求 subType（xhr/fetch/static-resource） |

**验收标准**：
- [ ] 所有工具函数有基本单元测试或至少手动验证
- [ ] `assertLegacyProject` 对非法路径抛出清晰错误

---

### 任务 1.6：初始化单元测试框架

**目标**：为 legacy-shield 自身代码建立单元测试能力。

**详细要求**：
- 使用 Vitest 作为测试框架（与 code-quality 技术栈一致）
- 在 `tests/` 目录下编写首批单元测试
- 优先覆盖 `lib/utils.js`、`lib/logger.js`、`lib/analyzer.js`、`lib/custom-rules`

**验收标准**：
- [ ] `pnpm test` 命令可运行
- [ ] 至少覆盖 50% 的核心工具函数
- [ ] CI/本地提交前可执行单元测试

---

## 3. 阶段 2：核心监控链路实现

### 任务 2.1：实现 `lib/logger.js`

**目标**：统一的 JSONL 日志写入服务。

**详细要求**：
- 支持 4 种日志类型：runtime、network、behavior、quality
- 按天滚动文件
- 同一 session 写入同一日期文件
- 进程退出时 flush
- 提供 `createLogger(projectPath, sessionId)` 工厂函数

**验收标准**：
- [ ] 调用 `logger.logRuntime()` 后文件中有对应 JSONL 行
- [ ] 调用 `logger.close()` 后文件流正确关闭
- [ ] 多类型日志分别写入不同子目录

---

### 任务 2.2：实现 `lib/proxy.js`

**目标**：本地 HTTP 反向代理，采集请求/响应日志。

**详细要求**：
- 监听指定端口，转发到 `target`
- 记录 request headers/body、response status/headers/body、durationMs
- body 默认截断 64KB
- 使用 `http-proxy` 的 `buffer` 选项，确保 POST/PUT body 不丢失
- 异步写入日志，不阻塞响应
- 支持 `--no-body` 跳过 body 采集
- 对 Cookie、Authorization 等敏感 Header 默认脱敏
- 支持 `--redact-body-fields` 对 body 敏感字段脱敏
- 支持 `--insecure` 适配本地 https + 自签名证书场景
- 网络日志 `url` 记录完整 URL（含 scheme、host）
- 网络日志包含 `level` 字段（根据 status 判定）

**验收标准**：
- [ ] 启动代理后，curl 请求能正常转发到 target
- [ ] POST/PUT 请求 body 能正确到达 target
- [ ] 网络日志写入 `<legacy>/.runtime-log-ignore/network/YYYY-MM-DD.jsonl`
- [ ] 日志中包含 method、完整 url、status、durationMs
- [ ] body 超过 64KB 时 truncated 标记为 true
- [ ] Cookie / Authorization Header 记录为 `[REDACTED]`
- [ ] 网络日志包含 `redactedHeaders` 字段
- [ ] 网络日志包含 `level` 字段
- [ ] `--redact-body-fields password` 时 body 中 password 字段被脱敏

---

### 任务 2.3：实现 `lib/inject.iife.js`

**目标**：页面运行时监控脚本（浏览器可执行 IIFE）。

**详细要求**：
- 捕获 error、unhandledrejection
- 捕获 Vue 3 渲染错误（patch `app.config.errorHandler`）
- 捕获 click、input、change、submit、keydown、keyup
- 捕获 scroll（200ms 节流）
- 捕获 route change（pushState/replaceState/popstate/hashchange）
- 捕获 visibilitychange
- 捕获 console.error/warn/info/log
- 通过 `window.__shield_emit__` 发送事件
- 对 fetch 请求添加辅助标记，便于 proxy 分类 subType
- 不记录敏感信息明文

**验收标准**：
- [ ] 注入脚本可在浏览器控制台手动验证
- [ ] 点击页面元素后能通过 `__shield_emit__` 收到 behavior 事件
- [ ] console.error 能被捕获
- [ ] Vue 组件渲染错误能被捕获
- [ ] 路由变化（含 hashchange）能被捕获

---

### 任务 2.4：实现 `lib/browser.js`

**目标**：启动 Playwright 浏览器并注入监控脚本。

**详细要求**：
- 启动 Chromium，配置代理指向 Skill 代理
- 通过 `page.addInitScript` 注入 `lib/inject.iife.js`
- 通过 `page.exposeFunction` 暴露 `__shield_emit__`
- 监听 page.on('pageerror')、page.on('requestfailed')
- 仅转发运行时错误到 logger，不重复采集网络日志
- 仅监控启动时创建的单个 `page`

**验收标准**：
- [ ] 能成功启动浏览器并访问 target
- [ ] 页面错误能被记录到 runtime 日志
- [ ] 页面点击能被记录到 behavior 日志
- [ ] 关闭 Skill 时浏览器正确退出
- [ ] 不重复产生 network 日志
- [ ] `js-error` 不重复采集（inject.iife.js 优先，pageerror 作为兜底）

---

### 任务 2.5：实现 `lib/cli/shield.js`

**目标**：`shield` 子命令的 orchestrator。

**详细要求**：
- 解析命令行参数
- 校验老项目路径
- 创建日志目录
- 生成 sessionId
- 按顺序启动 proxy 和 browser
- 监听 SIGINT/SIGTERM 优雅退出
- 退出时打印日志摘要

**验收标准**：
- [ ] `node cli.js shield --project <legacy> --target http://localhost:8080` 能正常运行
- [ ] 按 Ctrl+C 后代理和浏览器都正确关闭
- [ ] 日志文件中有内容生成

---

### 任务 2.6：串联 CLI 主入口 `cli.js`

**目标**：提供统一的 CLI 入口。

**详细要求**：
- 使用 commander 注册 shield/quality/report/api 子命令
- 每个子命令调用对应 `lib/cli/*.js`
- 全局错误处理

**验收标准**：
- [ ] `node cli.js --help` 显示所有子命令
- [ ] `node cli.js shield --help` 显示 shield 参数

---

### 任务 2.7：监控链路集成测试

**目标**：验证 shield 命令端到端可用。

**测试步骤**：
1. 启动一个简单 HTTP server 作为老项目 target
2. 运行 `node cli.js shield --project <legacy> --target <server>`
3. 在浏览器中触发点击、console.error、网络请求
4. 停止 shield
5. 检查 `.runtime-log-ignore/` 下日志是否完整

**验收标准**：
- [ ] runtime 日志包含错误
- [ ] network 日志包含请求
- [ ] behavior 日志包含点击事件

---

## 4. 阶段 3：质量保障与自定义规则

### 任务 3.1：实现 `lib/quality.js`

**目标**：调用 code-quality 执行提交前质量检查。

**详细要求**：
- 通过子进程调用 `/Users/creayma/personal/code-quality/cli.js`
- 支持 `--target` 指定文件，调用 `module` 子命令
- 支持 `--base` 指定 git ref，调用 `diff` 子命令
- 无 `--target`/`--base` 时调用 `all` 子命令
- 支持 `--skip` 参数透传
- 支持 `CODE_QUALITY_ROOT` 环境变量覆盖默认路径
- 捕获 stdout/stderr 和退出码
- 将结果写入 quality 日志

**验收标准**：
- [ ] 调用 `node cli.js quality --project <legacy>` 能执行 code-quality `all`
- [ ] `node cli.js quality --target src/foo.js` 调用 code-quality `module`
- [ ] `node cli.js quality --base origin/main` 调用 code-quality `diff`
- [ ] code-quality 结果写入 `<legacy>/.runtime-log-ignore/quality/YYYY-MM-DD.jsonl`
- [ ] `--skip type-check` 等参数正确透传

---

### 任务 3.2：实现 `lib/custom-rules/scanner.js`

**目标**：AST 扫描器基础框架。

**详细要求**：
- 支持 `.js`、`.jsx`、`.ts`、`.tsx` 文件（使用 @babel/parser）
- 支持 `.vue` 文件（使用 @vue/compiler-sfc 提取 script）
- 遍历文件树，排除 node_modules/dist
- 返回统一的 hit 结构：`{ ruleId, filePath, line, column, message, severity }`

**验收标准**：
- [ ] 能扫描老项目 src 下所有支持扩展名文件
- [ ] 能正确解析 Vue SFC 的 script 部分
- [ ] 返回结果包含 filePath 和 line

---

### 任务 3.3：实现 4 条 MVP 自定义规则

**目标**：覆盖常见安全和性能反模式。

**规则清单**：

#### SHIELD-001 no-dangerous-apis
- 检测 `eval(...)`
- 检测 `new Function(...)`
- 检测 `element.innerHTML = ...`
- 检测 `document.write(...)`

#### SHIELD-002 no-large-loops
- 检测 `for`/`while` 循环体中无 `break`
- 且循环变量涉及数组长度（如 `i < arr.length`）

#### SHIELD-003 no-expensive-watcher
- 检测 Vue `watch` 第一个参数为对象字面量或深层属性链
- 或监听数组但未使用 `shallow: true`

#### SHIELD-004 no-sync-storage-in-loop
- 检测循环体内部调用 `localStorage.getItem/setItem/removeItem`

**验收标准**：
- [ ] 每条规则能在测试代码中命中预期模式
- [ ] 每条规则不会误报常见合法写法
- [ ] 结果统一写入 quality 日志

---

### 任务 3.4：实现 `lib/cli/quality.js`

**目标**：`quality` 子命令 orchestrator。

**详细要求**：
- 解析命令行参数（`--project`、`--target`、`--base`、`--skip`）
- 调用 code-quality（根据参数选择 `all`/`module`/`diff`）
- 调用自定义规则扫描
- 汇总输出到控制台和 quality 日志

**验收标准**：
- [ ] `node cli.js quality --project <legacy>` 同时执行 code-quality 和自定义规则
- [ ] `node cli.js quality --project <legacy> --target src/foo.js` 为指定文件生成测试
- [ ] `node cli.js quality --project <legacy> --base origin/main` 基于 diff 生成测试
- [ ] 失败时返回非零退出码

---

### 任务 3.5：质量保障集成测试

**目标**：验证 quality 命令端到端可用。

**测试步骤**：
1. 准备一个包含故意问题的小老项目
2. 运行 `node cli.js quality --project <legacy>`
3. 检查控制台输出和 quality 日志

**验收标准**：
- [ ] code-quality 输出被正确捕获
- [ ] 自定义规则能命中测试代码中的问题
- [ ] 最终退出码正确

---

## 5. 阶段 4：分析、报告与 AI 接口

### 任务 4.1：实现 `lib/analyzer.js`

**目标**：日志分析引擎。

**详细要求**：
- 读取 runtime/network/behavior/quality 日志
- 按日期聚合
- 错误聚类：`errorId`（基于 subType + stack 首帧 + url）
- `js-error` 去重：`errorId + 1 秒窗口`，优先保留 inject.iife.js 来源
- 网络异常：`status >= 400` 或 `durationMs > threshold`
- 行为时间线：按 sequence/timestamp 排序
- 质量汇总：统计 ESLint 问题、测试状态、自定义规则命中

**验收标准**：
- [ ] 能读取并解析 JSONL 日志
- [ ] 输出 summary、topErrors、networkIssues、behaviorTimeline、qualitySummary
- [ ] 相同错误在 1 秒内只统计一次
- [ ] 分析结果结构稳定

---

### 任务 4.2：实现 `lib/reporter.js` Markdown 报告

**目标**：生成人类可读的 Markdown 报告。

**报告章节**：
1. 项目概览
2. 关键指标摘要表
3. TOP 10 高频错误
4. 网络异常分析
5. 用户行为时间线
6. 代码质量摘要
7. 建议与下一步

**验收标准**：
- [ ] `node cli.js report --format md` 生成完整 Markdown 文件
- [ ] 报告内容正确反映日志分析结果
- [ ] 报告写入 `<legacy>/.runtime-log-ignore/reports/`

---

### 任务 4.3：实现 `lib/reporter.js` JSON 报告

**目标**：生成 AI 友好的 JSON 报告。

**JSON 结构**：
```json
{
  "meta": { "project", "date", "generatedAt" },
  "summary": {
    "runtimeErrorCount",
    "runtimeWarningCount",
    "networkCount",
    "networkIssueCount",
    "behaviorCount",
    "eslintIssueCount",
    "testStatus",
    "customRuleHitCount"
  },
  "topErrors": [...],
  "networkIssues": [...],
  "behaviorTimeline": [...],
  "qualitySummary": {...}
}
```

**验收标准**：
- [ ] `node cli.js report --format json` 输出合法 JSON
- [ ] 字段结构与 design.md 一致

---

### 任务 4.4：实现 `lib/api.js`

**目标**：REST API 服务。

**端点实现清单**：
- [ ] `GET /health`
- [ ] `GET /logs`
- [ ] `GET /report`
- [ ] `GET /errors/top`
- [ ] `POST /suggest`
- [ ] `GET /timeline`

**验收标准**：
- [ ] 服务能正常启动并监听端口
- [ ] 每个端点返回预期格式
- [ ] 支持 CORS（可选 `--cors`）

---

### 任务 4.5：实现 `lib/cli/report.js` 和 `lib/cli/api.js`

**目标**：两个子命令的 orchestrator。

**report 子命令要求**：
- 解析 `--date`、`--format`、`--out`
- 调用 analyzer 和 reporter
- 输出到文件或 stdout

**api 子命令要求**：
- 解析 `--port`、`--cors`
- 调用 api server
- 保持进程运行

**验收标准**：
- [ ] `node cli.js report --project <legacy> --format md` 成功
- [ ] `node cli.js api --project <legacy> --port 3456` 成功

---

### 任务 4.6：AI 接口测试

**目标**：验证 API 各端点可用。

**测试步骤**：
1. 启动 api 服务
2. 用 curl 调用 `/health`、`/logs`、`/report`、`/errors/top`
3. 验证返回格式

**验收标准**：
- [ ] 所有端点返回 200
- [ ] JSON 字段完整

---

## 6. 阶段 5：集成测试与验收

### 任务 5.1：端到端场景测试

**目标**：用真实老项目验证完整流程。

**测试场景**：
1. 对 `/Users/creayma/work/sichuan/event` 运行 `shield`
2. 在浏览器中操作老项目
3. 停止 shield
4. 运行 `report --format md`
5. 运行 `quality`
6. 运行 `api` 并调用接口

**验收标准**：
- [ ] shield 采集到日志
- [ ] report 生成可读报告
- [ ] quality 执行通过或正确报错
- [ ] api 接口返回正确数据

---

### 任务 5.2：边界情况测试

**测试项**：
- [ ] 老项目路径不存在时的错误提示
- [ ] 代理端口被占用时的自动重试
- [ ] 浏览器启动失败时的错误提示
- [ ] 无日志时 report 命令的行为
- [ ] 大 body 请求时的 truncated 标记
- [ ] 进程信号中断时的优雅退出

---

### 任务 5.3：性能基线测试

**测试项**：
- [ ] 代理转发延迟 < 5ms（不含 body 采集）
- [ ] 单次事件处理耗时 < 1ms
- [ ] 1 小时运行后日志文件大小可接受

---

### 任务 5.4：文档完善

**目标**：补充用户文档。

**文档清单**：
- [ ] `README.md` 使用说明
- [ ] `docs/usage.md` 详细使用指南
- [ ] `docs/api.md` API 文档
- [ ] `docs/custom-rules.md` 自定义规则开发指南

---

## 7. 里程碑定义

| 里程碑 | 完成标准 | 关联阶段 |
|---|---|---|
| M1 项目可运行 | package.json 完成，依赖安装成功，CLI --help 可用 | 阶段 1 |
| M2 监控可用 | shield 命令能采集 error/network/behavior 日志 | 阶段 2 |
| M3 质量可用 | quality 命令能执行 code-quality + 自定义规则 | 阶段 3 |
| M4 分析可用 | report 和 api 命令可用，能输出 md/json | 阶段 4 |
| M5 验收通过 | 在真实老项目上完整跑通 shield → report → quality → api | 阶段 5 |

---

## 8. 风险与应对

| 风险 | 影响 | 应对措施 |
|---|---|---|
| Playwright Chromium 下载失败 | 高 | 配置镜像；提供手动安装脚本 |
| code-quality 路径不一致 | 中 | 支持 `CODE_QUALITY_ROOT` 环境变量 |
| 老项目 ESLint 配置复杂 | 中 | 复用 code-quality 已兼容的能力 |
| 老项目使用非标准技术栈 | 中 | 先做 Vue3+JS 老项目，其他栈后续支持 |
| 日志文件过大 | 中 | body 截断、按天滚动、默认保留 7 天自动清理 |
| 用户误将日志提交到 git | 低 | 在 legacy-shield 使用文档中提醒开发者，自行在老项目 `.gitignore` 中添加 `.runtime-log-ignore/` |
| LLM 配置缺失导致测试生成失败 | 中 | 文档说明需先配置 `.local-llm-config.js` 或对应环境变量；失败时给出清晰提示 |

---

## 9. 后续迭代方向

1. **WebSocket 监控**：补充 WebSocket 消息采集
2. **性能指标采集**：FP/FCP/LCP/CLS 等 Web Vitals
3. **截图回放**：关键错误发生时自动截图
4. **AI 自动修复**：结合 LLM 直接生成补丁
5. **多项目支持**：按项目隔离 tests/ 和日志
6. **增强日志清理策略**：按项目/按大小清理，支持配置化 retention 策略
