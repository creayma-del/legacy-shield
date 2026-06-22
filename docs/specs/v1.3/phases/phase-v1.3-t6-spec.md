# T6：资源加载长耗时运行时采集

> 版本：v1.3
> 任务编号：T6
> 对应阶段 Spec：[phases/phase-v1.3-spec.md](phase-v1.3-spec.md)
> 对应设计文档：[design-v1.3.md](../design-v1.3.md)
> 对应执行计划：[execution-plan-v1.3.md](../execution-plan-v1.3.md)
> 依赖任务：T1、T4、T5
> 状态：已完成，已归档
> 评审记录：见本文档末尾

---

## 1. 任务目标

基于 Playwright 在浏览器中采集资源加载耗时，识别长耗时/大体积资源，并将结果写入结构化日志。

---

## 2. 对应需求与验收标准

| 需求编号 | 需求描述 | 本任务验收标准 |
|---|---|---|
| REQ-1.3-5 | 新增资源加载长耗时检测 | `--enable-resource-monitor` 启用后输出资源加载列表与 slowResources 列表 |
| REQ-1.3-2 | 监控结果以 NDJSON 结构化日志持久化 | 资源采集结果以 `category: 'runtime-resource'` 写入结构化日志 |
| REQ-1.3-10 | 所有指标不阻断发版或合并 | 运行时监控失败记录 error 日志，不中断 `quality` 流程 |

---

## 3. 实现步骤

### 3.1 创建 `lib/runtime-monitor/resource-collector.ts`

- 实现 `collectResourceMetrics(options, logger, sessionId)` 函数，返回 `ResourceMonitorResult`。
- 通过 `startBrowser` 启动 headless Chromium：
  - `proxyUrl` 为可选；未提供时向 `startBrowser` 传入 `skipProxy: true`。
  - H5 场景下设置移动端 viewport（375×812）与移动 UA（默认 iPhone Safari UA，可配置覆盖）。
  - 传入 `skipInject: true`，避免 shield 自身请求污染资源监控结果。
- 注入 PerformanceObserver 脚本：
  - 监听 `resource` 类型事件。
  - 收集 `duration`、`transferSize`、`encodedBodySize`、`initiatorType`。
- 过滤逻辑：
  - 默认排除 shield 自身请求（URL 含 `__shield`、`inject.iife.js`）。
  - 排除 data URI。
  - 排除常见统计/埋点域名（如 `google-analytics`、`umeng`、`sentry` 等）。
  - 支持 `--resource-ignore-pattern` 扩展。
- 体积判定降级：
  - 跨域资源若无 `Timing-Allow-Origin`，`transferSize` 可能为 0，此时降级使用 `encodedBodySize`。
  - 若两者均为 0，则仅按 `duration` 判定，并在 `context` 中标记 `sizeEstimated: false`。
- 标记 `slowResources`：
  - `duration > durationThresholdMs`（默认 10000ms）或 `transferSize > sizeThresholdBytes`（默认 1024KB）。
  - `reason` 字段为 `'duration'`、`'size'` 或 `'both'`。
- 等待页面资源加载稳定（默认 `waitForIdleMs: 2000`）后返回结果。

### 3.2 处理 `--start-page` 自动推断

- 复用 T4 中实现的 dev server 自动启动与 `file://` 回退逻辑。
- 若 T4 已将启动逻辑抽取为公共 helper（如 `resolveStartPage`），本任务直接复用。

### 3.3 扩展 `lib/runtime-monitor/index.ts`

- 暴露 `runResourceMonitor(options, logger, sessionId, riskList?)` 入口。
- 内部调用 `collectResourceMetrics`。
- 捕获 `startBrowser` 或采集过程异常，记录 error 日志并返回空结果，不向上抛错。

### 3.4 在 `runQuality` 中集成

- 当 `--enable-resource-monitor` 启用时，调用 `runResourceMonitor`。
- 可选传入 T5 生成的 `resourceRiskList`。
- 将返回结果通过 `logger.logStructured` 写入结构化日志，`category: 'runtime-resource'`。
- 在终端摘要中输出资源监控状态（成功/失败/未启用）。

### 3.5 新增集成测试

- 构造包含大体积/长耗时资源的测试夹具页面，验证 `slowResources` 命中。
- mock `startBrowser` 抛错，验证运行时监控降级并记录 error 日志，不中断 quality 流程。

---

## 4. 测试计划

### 4.1 单元测试

- mock `startBrowser` 返回受控 `BrowserHandle`，验证 `collectResourceMetrics` 的过滤逻辑、阈值判定、`reason` 字段。
- 验证跨域资源 `transferSize` 为 0 时降级到 `encodedBodySize`，并在 `context` 中标记 `sizeEstimated`。
- 验证 `--resource-ignore-pattern` 可扩展默认排除规则。
- 验证 `runResourceMonitor` 在 `startBrowser` 抛错时返回空结果并记录 error 日志。

### 4.2 集成测试 / 端到端测试

- 在已安装 Playwright 环境下，使用测试夹具页面验证正常采集链路。
- 对包含大体积/长耗时资源的夹具，验证 `slowResources` 正确命中。

### 4.3 回归测试

- 未启用 `--enable-resource-monitor` 时，`quality` 子命令不启动浏览器，行为与 v1.2 一致。
- 运行时监控失败不影响 `quality` 退出码。

---

## 5. 风险与依赖

| 风险 / 依赖 | 影响 | 应对措施 |
|---|---|---|
| 依赖 T1 | 平台识别决定 viewport/UA 与 `allowNoSrc` | 等待 T1 完成 |
| 依赖 T5 | 静态风险清单作为可选上下文传入 | 等待 T5 完成；T6 独立基于实际指标判断 |
| 依赖 T4 | dev server 启动逻辑可能在 T4 中实现 | 复用 T4 公共 helper 或保持一致实现 |
| Playwright 环境缺失 | 运行时采集无法执行 | 捕获异常并记录 error；提示用户安装 chromium |
| 跨域资源体积不可读 | 误判或漏判 | 按 `duration` 兜底，并在 `context` 中标记 `sizeEstimated: false` |

---

## 6. 变更范围

- 本任务不修改 `lib/browser.ts` 核心启动逻辑，仅通过新增 `StartBrowserOptions` 参数控制隔离。
- 本任务不实现内存运行时采集（由 T4 处理）。
- 本任务不实现结构化日志底层写入（由 T7 处理）。

---

## 7. 评审记录

> 评审日期：2026-06-21
> 评审结论：通过
> 评审人：SPEC 动态评审团

### P0 阻塞缺陷

| 编号 | 问题描述 | 位置 | 修订建议 |
|---|---|---|---|
| - | - | - | - |

### P1 重要问题

| 编号 | 问题描述 | 位置 | 修订建议 |
|---|---|---|---|
| - | - | - | - |

### P2 优化项

| 编号 | 问题描述 | 位置 | 处理建议 |
|---|---|---|---|
| - | - | - | - |
