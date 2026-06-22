# T4：内存泄漏运行时采集

> 版本：v1.3
> 任务编号：T4
> 对应阶段 Spec：[phases/phase-v1.3-spec.md](phase-v1.3-spec.md)
> 对应设计文档：[design-v1.3.md](../design-v1.3.md)
> 对应执行计划：[execution-plan-v1.3.md](../execution-plan-v1.3.md)
> 依赖任务：T1、T3
> 状态：已完成，已归档
> 评审记录：见本文档末尾

---

## 1. 任务目标

基于 Playwright 在浏览器中执行页面交互脚本，采集 JS Heap 增长曲线，识别疑似内存泄漏，并将结果写入结构化日志。

---

## 2. 对应需求与验收标准

| 需求编号 | 需求描述 | 本任务验收标准 |
|---|---|---|
| REQ-1.3-5 | 新增内存泄漏检测 | `--enable-memory-monitor` 启用后输出内存采样数据与疑似泄漏结论 |
| REQ-1.3-2 | 监控结果以 NDJSON 结构化日志持久化 | 内存采样与结论以 `category: 'runtime-memory'` 写入结构化日志 |
| REQ-1.3-10 | 所有指标不阻断发版或合并 | 运行时监控失败记录 error 日志，不中断 `quality` 流程 |

---

## 3. 实现步骤

### 3.1 创建 `lib/runtime-monitor/memory-collector.ts`

- 实现 `collectMemoryMetrics(options, logger, sessionId)` 函数，返回 `MemoryMonitorResult`。
- 通过 `startBrowser` 启动 headless Chromium：
  - `proxyUrl` 为可选；未提供时向 `startBrowser` 传入 `skipProxy: true`，禁止设置空字符串或本地 noop 代理。
  - H5 场景下设置移动端 viewport（375×812）与移动 UA（默认 iPhone Safari UA，可配置覆盖）。
  - 启用 CDP Session（`enableCdpSession: true`）以调用 `HeapProfiler.collectGarbage`。
  - 通过 `launchArgs` 传入 `--js-flags=--expose-gc` 作为降级方案。
  - 传入 `skipInject: true`，避免 shield 自身脚本污染内存监控结果。
- 注入采集脚本读取堆内存：
  - 每轮采样前优先通过 CDP `HeapProfiler.collectGarbage` 触发 GC。
  - CDP 失败时降级到 `--expose-gc` + `window.gc()`。
  - 优先使用 `performance.measureUserAgentSpecificMemory()`，失败时降级到 `performance.memory`。
  - 所有降级路径记录 `warn` 级别结构化日志，不中断采集流程。
- 执行预定义交互序列：
  - 打开/关闭弹窗、切换路由、滚动列表。
  - 默认 10 轮（`rounds` 可配置），每轮等待页面稳定后采样。
- 计算增长斜率；若连续多轮增长超过阈值（默认 30%），`suspectedLeak: true`。

### 3.2 处理 `--start-page` 自动推断

- 若用户显式传入 `--start-page`，直接使用。
- 若 `package.json` 中存在 `scripts.dev`：
  - 使用正则 `--(?:port|p)\s+(\d+)` 与 `--(?:port|p)=(\d+)` 解析端口。
  - 未解析到时按 `[3000, 5173, 8080, 8000]` 顺序探测可用端口。
  - 启动 dev server 子进程，以 500ms 间隔轮询 `http://localhost:<port>`，返回 2xx 即认为就绪，最长等待 30 秒。
  - 命令正常结束或异常退出时，通过 `childProcess.kill()` 终止 dev server；5 秒内未退出则发送 `SIGKILL`。
- 若项目根目录存在 `index.html`，使用 `file:///<project>/index.html`。
- 否则抛错，提示用户显式指定 `--start-page`。

### 3.3 创建 `lib/runtime-monitor/index.ts`

- 暴露 `runMemoryMonitor(options, logger, sessionId, riskList?)` 入口。
- 内部调用 `collectMemoryMetrics`。
- 捕获 `startBrowser` 或采集过程异常，记录 error 日志并返回空结果，不向上抛错。

### 3.4 在 `runQuality` 中集成

- 当 `--enable-memory-monitor` 启用时，调用 `runMemoryMonitor`。
- 可选传入 T3 生成的 `memoryRiskList`。
- 将返回结果通过 `logger.logStructured` 写入结构化日志，`category: 'runtime-memory'`。
- 在终端摘要中输出内存监控状态（成功/失败/未启用）。

### 3.5 新增集成测试

- 使用测试夹具页面验证采集逻辑：
  - 正常页面：`suspectedLeak: false`。
  - 已知泄漏页面（如反复添加未清理监听）：`suspectedLeak: true`。
- mock `startBrowser` 抛错，验证运行时监控降级并记录 error 日志，不中断 quality 流程。

---

## 4. 测试计划

### 4.1 单元测试

- mock `startBrowser` 返回受控 `BrowserHandle`，验证 `collectMemoryMetrics` 的采样轮次、GC 触发、阈值判定逻辑。
- 验证 CDP 失败时降级到 `window.gc()`，再失败时降级到 `performance.memory`。
- 验证 `runMemoryMonitor` 在 `startBrowser` 抛错时返回空结果并记录 error 日志。

### 4.2 集成测试 / 端到端测试

- 在已安装 Playwright 环境下，使用测试夹具页面验证正常采集链路。
- 对已知内存泄漏夹具页面，验证 `suspectedLeak: true`。
- 验证 dev server 自动启动、就绪判定、子进程清理逻辑。

### 4.3 回归测试

- 未启用 `--enable-memory-monitor` 时，`quality` 子命令不启动浏览器，行为与 v1.2 一致。
- 运行时监控失败不影响 `quality` 退出码。

---

## 5. 风险与依赖

| 风险 / 依赖 | 影响 | 应对措施 |
|---|---|---|
| 依赖 T1 | 平台识别决定 viewport/UA 与 `allowNoSrc` | 等待 T1 完成 |
| 依赖 T3 | 静态风险清单作为可选上下文传入 | 等待 T3 完成；T4 独立基于实际指标判断 |
| Playwright 环境缺失 | 运行时采集无法执行 | 捕获异常并记录 error；提示用户安装 chromium |
| 交互序列与业务页面不匹配 | 无法有效触发内存变化 | 支持 `--start-page` 自定义起始页；v1.3 预留 `--interaction-script` 但不实现 |
| Dev server 启动/清理异常 | 子进程残留或就绪超时 | 实现就绪轮询与超时 SIGKILL 清理 |

---

## 6. 变更范围

- 本任务不修改 `lib/browser.ts` 核心启动逻辑，仅通过新增 `StartBrowserOptions` 参数控制隔离。
- 本任务不实现资源运行时采集（由 T6 处理）。
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
