# legacy-shield v1.3 详细执行计划

> 文档版本：v1.3
> 对应需求文档：[requirements-v1.3.md](requirements-v1.3.md)
> 对应设计文档：[design-v1.3.md](design-v1.3.md)
> 对应阶段 Spec：[phases/phase-v1.3-spec.md](phases/phase-v1.3-spec.md)
> 状态：已通过
> 编制日期：2026-06-21
> 评审记录：见文档末尾 §7

---

## 1. 版本总体进度

| 任务 | 名称 | 优先级 | 依赖 | 预计工作量 |
|---|---|---|---|---|
| T1 | H5/Web 项目检测入口与配置适配 | P0 | 无 | 中 |
| T2 | 代码静态质量规则扩展 | P1 | T1 | 中 |
| T3 | 内存泄漏静态分析 | P0 | T1、T2 | 高 |
| T4 | 内存泄漏运行时采集 | P0 | T1、T3 | 高 |
| T5 | 资源加载长耗时静态分析 | P1 | T1、T2 | 中 |
| T6 | 资源加载长耗时运行时采集 | P0 | T1、T4、T5 | 高 |
| T7 | 结构化日志输出与文件持久化 | P0 | T2、T3、T4、T5、T6 | 中 |
| T8 | 文档更新与全量验收 | P1 | T7 | 低 |

---

## 2. 任务详细说明

### 任务 T1：H5/Web 项目检测入口与配置适配

**目标**：

实现 `lib/platform.ts`，支持显式指定与自动推断项目平台类型，并将平台信息传入后续监控流程。

**实现步骤**：

1. 创建 `lib/platform.ts`，实现 `detectPlatform` 函数：
   - 显式参数 `explicit` 优先；
   - 自动推断逻辑：按 design-v1.3.md §2.1 的 P1-P4 优先级读取 `package.json`、扫描入口 HTML 的 viewport meta、检查 `manifest.json`；
   - 默认回退为 `web`。
2. 扩展 `cli.ts` 中 `quality` 子命令参数：新增 `--platform <type>`，由 `lib/cli/quality.ts` 的 `runQuality` 透传。
3. 扩展 `QualityCommandOptions` 类型，新增 `platform` 字段。
4. 调整 `lib/utils.ts` 中的 `assertLegacyProject(projectPath, options?)`，增加 `allowNoSrc?: boolean` 可选参数；在 `lib/cli/quality.ts` 的 `runQuality` 中，先调用 `detectPlatform`，再根据其推断结果（或用户显式 `--platform`）调用 `assertLegacyProject(project, { allowNoSrc: true })`，跳过 `src/` 目录强制检查。
5. 在 `lib/cli/quality.ts` 的 `runQuality` 中调用 `detectPlatform`，并将平台信息封装为 `category: 'platform'` 的 `StructuredLogEntry` 后调用 `logger.logStructured(entry)`。
6. 新增 `lib/utils.ts` 的 `generateSessionId()` 函数（格式 `shield_<timestamp>_<randomSuffix>`），并在 `runQuality` 中生成本次会话 ID，透传给 logger 与运行时采集模块。
7. 为 H5/Web 场景新增测试夹具与单元测试。

**验收标准**：

- [ ] `detectPlatform({ projectPath, explicit: 'h5' })` 返回 `h5`。
- [ ] 对无显式参数的 Web 项目自动推断为 `web`。
- [ ] 对典型 H5 项目（如含 `uni-app` 依赖）自动推断为 `h5`。
- [ ] `pnpm typecheck` 通过。

**风险与应对**：

| 风险 | 应对措施 |
|---|---|
| 自动推断误识别 | 提供 `--platform` 显式覆盖；在结构化日志中记录推断依据 |

---

### 任务 T2：代码静态质量规则扩展

**目标**：

在现有 custom-rules 框架中新增与内存、资源相关的 4 条静态规则。

**实现步骤**：

1. 创建 `lib/custom-rules/rules/no-leaked-listener.ts`：
   - 检测 `addEventListener` 调用后未在同级/组件卸载作用域内调用 `removeEventListener`。
   - 在顶层 `RuleHit.riskType` 中记录 `'memory-leak'`。
2. 创建 `lib/custom-rules/rules/no-uncleared-timer.ts`：
   - 检测 `setInterval` / `setTimeout` 返回值未在作用域内被 `clearInterval` / `clearTimeout`。
   - 在顶层 `RuleHit.riskType` 中记录 `'memory-leak'`.
3. 创建 `lib/custom-rules/rules/no-large-resource.ts`：
   - 检测代码中引用的静态资源路径；
   - 仅处理可解析的相对文件路径（相对于当前源文件或项目根目录）；
   - 忽略 URL（以 `http://`、`https://`、`//`、`data:` 开头）、webpack alias 与构建后路径；
   - 对可解析路径通过 `fs.statSync` 判断实际体积是否超过 1024KB；
   - 在顶层 `RuleHit.riskType` 中记录 `'resource-load'`，在 `RuleHit.context` 中记录原始资源路径。
4. 创建 `lib/custom-rules/rules/no-sync-script.ts`：
   - 扩展 `lib/custom-rules/scanner.ts` 支持 `.html` 文件扫描；
   - 扫描入口 `.html` 文件，检测 `<head>` 中不含 `async`/`defer` 的同步 `<script>` 标签；
   - 在顶层 `RuleHit.riskType` 中记录 `'resource-load'`.
5. 扩展 `RuleHit` 类型：新增 `riskType?: 'memory-leak' | 'resource-load'` 与 `context?: Record<string, unknown>` 字段（详见 design-v1.3.md §2.2）。
6. 在 `lib/custom-rules/rules/index.ts` 中注册新规则。
7. 新增规则单元测试。

**验收标准**：

- [ ] 4 条新规则均可被 `runCustomRules` 执行。
- [ ] 各规则对典型坏代码能正确命中。
- [ ] `--disable-rule <rule-id>` 可禁用指定规则。
- [ ] 全量 `pnpm test` 通过。

**风险与应对**：

| 风险 | 应对措施 |
|---|---|
| 规则误报 | 默认 severity 为 warning；根据测试反馈迭代调整 |

---

### 任务 T3：内存泄漏静态分析

**目标**：

实现内存泄漏风险点的静态扫描规则，为运行时采集提供风险清单。

**实现步骤**：

1. 在 `no-leaked-listener` 与 `no-uncleared-timer` 规则基础上，抽象公共 helper：
   - `trackScopeCleanup`：追踪作用域内资源注册与清理配对关系。
2. 规则命中时在顶层 `RuleHit.riskType` 中记录 `'memory-leak'`。
3. 在 `lib/custom-rules/index.ts` 中聚合所有 `riskType === 'memory-leak'` 的命中项。
4. 输出内存泄漏风险列表，作为 T4 运行时采集的可选重点关注上下文。

**验收标准**：

- [ ] 可输出内存泄漏风险点列表（文件、行号、列号、风险类型）。
- [ ] 风险列表可被 T4 运行时采集模块读取。

**风险与应对**：

| 风险 | 应对措施 |
|---|---|
| 静态分析无法覆盖动态注册场景 | 与运行时采集互补，静态分析输出风险点，运行时验证 |

---

### 任务 T4：内存泄漏运行时采集

**目标**：

基于 Playwright 在浏览器中执行页面交互，采集 JS Heap 增长曲线，识别疑似内存泄漏。

**实现步骤**：

1. 创建 `lib/runtime-monitor/memory-collector.ts`：
   - 通过 `startBrowser` 启动浏览器；`proxyUrl` 为可选，业务页面无需代理时不构造 `proxyUrl`，并向 `startBrowser` 显式传入 `skipProxy: true`，禁止设置空字符串或本地 noop 代理；
   - `--start-page` 为自动推断的 dev server 时，按 design-v1.3.md §4.1 的 dev server 启动细节启动并等待就绪，具体实现与边界异常处理在 T4 任务 Spec 中细化；
   - H5 场景下设置移动端 viewport（375×812）与移动 UA；
   - 注入采集脚本，使用 `performance.memory` 或 `performance.measureUserAgentSpecificMemory()` 读取堆内存；
   - 每轮采样前通过 CDP `HeapProfiler.collectGarbage` 触发 GC，减少误报；
   - 执行预定义交互序列（打开/关闭弹窗、切换路由、滚动列表）；
   - 若连续多轮增长超过 30%，标记为疑似泄漏。
2. 创建 `lib/runtime-monitor/index.ts`，暴露 `runMemoryMonitor` 入口。
3. 在 `lib/cli/quality.ts` 的 `runQuality` 中，当 `--enable-memory-monitor` 启用时调用 `runMemoryMonitor`，可选传入 T3 生成的风险清单。
4. 将采集结果通过 `logger.logStructured` 写入 NDJSON 日志。
5. 新增集成测试，使用测试夹具页面验证采集逻辑。

**验收标准**：

- [ ] `--enable-memory-monitor` 启用后，可输出内存采样数据。
- [ ] 对已知内存泄漏夹具页面，可正确标记 `suspectedLeak: true`。
- [ ] 单元测试：mock `startBrowser` 抛错，验证运行时监控降级并记录 error 日志，不中断 quality 流程。
- [ ] 集成测试：在已安装 Playwright 环境下验证正常采集链路。

**风险与应对**：

| 风险 | 应对措施 |
|---|---|
| Playwright 环境缺失 | 捕获异常并记录 error；提示安装 chromium |
| 交互序列与业务页面不匹配 | 支持 `--start-page` 自定义起始页；后续版本支持自定义交互脚本 |

---

### 任务 T5：资源加载长耗时静态分析

**目标**：

实现资源加载风险的静态扫描规则，为运行时采集提供风险清单。

**实现步骤**：

1. 在 `no-large-resource` 与 `no-sync-script` 规则基础上，扩展输出字段：
   - 在顶层 `RuleHit.riskType` 中记录 `'resource-load'`.
2. 在 `lib/custom-rules/index.ts` 中聚合所有 `riskType === 'resource-load'` 的命中项。
3. 输出资源加载风险列表，作为 T6 运行时采集的可选重点关注上下文。

**验收标准**：

- [ ] 可输出资源加载风险点列表（文件、行号、风险类型、建议）。
- [ ] 风险列表可被 T6 运行时采集模块读取。

---

### 任务 T6：资源加载长耗时运行时采集

**目标**：

基于 Playwright 在浏览器中采集资源加载耗时，识别长耗时/大体积资源。

**实现步骤**：

1. 创建 `lib/runtime-monitor/resource-collector.ts`：
   - 通过 `startBrowser` 启动浏览器；`proxyUrl` 为可选，业务页面无需代理时不构造 `proxyUrl`，并向 `startBrowser` 显式传入 `skipProxy: true`；
   - `--start-page` 为自动推断的 dev server 时，按 design-v1.3.md §4.1 的 dev server 启动细节启动并等待就绪，具体实现与边界异常处理在 T6 任务 Spec 中细化；
   - H5 场景下设置移动端 viewport 与移动 UA；
   - 注入 PerformanceObserver 脚本，监听 `resource` 类型；
   - 收集 `duration`、`transferSize`、`initiatorType`；
   - 过滤 shield 自身请求、data URI、统计脚本；
   - 对 `duration > 10000ms` 或 `transferSize > 1024KB` 的资源标记为 slowResources。
2. 在 `lib/runtime-monitor/index.ts` 中暴露 `runResourceMonitor` 入口。
3. 在 `lib/cli/quality.ts` 的 `runQuality` 中，当 `--enable-resource-monitor` 启用时调用 `runResourceMonitor`，可选传入 T5 生成的风险清单。
4. 将采集结果通过 `logger.logStructured` 写入 NDJSON 日志。
5. 新增集成测试。

**验收标准**：

- [ ] `--enable-resource-monitor` 启用后，可输出资源加载列表与 slowResources 列表。
- [ ] 对包含大体积/长耗时资源的测试夹具，可正确命中。
- [ ] 单元测试：mock `startBrowser` 抛错，验证运行时监控降级并记录 error 日志，不中断 quality 流程。
- [ ] 集成测试：在已安装 Playwright 环境下验证正常采集链路。

---

### 任务 T7：结构化日志输出与文件持久化

**目标**：

将 v1.3 监控结果以统一 NDJSON 格式写入本地文件。

**实现步骤**：

1. 扩展 `lib/types.ts` 与 `lib/logger.ts`：
   - 新增 `StructuredLogEntry` 类型；
   - 扩展 `Logger` 接口，新增 `logStructured` 方法；
   - 更新 `createLogger` 工厂函数，返回的实例同时支持 v1.2 `QualityLog` 与 v1.3 `StructuredLog` 双轨输出。
2. 扩展 `lib/logger.ts`：
   - 创建 `.legacy-shield/logs/` 目录；
   - 按 session 创建 `<sessionId>.ndjson` 文件；
   - 实现 `logStructured` 写入方法；
   - 在 `close()` 时关闭文件流；
   - 实现日志保留策略（默认 30 天，基于 `mtime` 清理）。
3. 扩展 `cli.ts` 中 `quality` 子命令参数：新增 `--log-dir` 与 `--structured-log-retention-days`；`--log-retention-days` 保持对 v1.2 `QualityLog` 的控制权，默认 7 天，行为与 v1.2 一致。
4. 在 `lib/cli/quality.ts` 的 `runQuality` 中，将平台信息、静态规则命中、运行时采集结果均写入结构化日志。
5. 新增单元测试验证日志文件创建、字段完整性与清理逻辑。

**验收标准**：

- [ ] 执行 `quality` 后，`<project>/.legacy-shield/logs/<sessionId>.ndjson` 文件存在。
- [ ] 日志每行均为合法 JSON，包含 `timestamp`、`sessionId`、`level`、`category`、`message` 字段。
- [ ] `--log-retention-days` 控制 v1.2 `QualityLog`（`<project>/.runtime-log-ignore/quality/`）保留天数，默认 7 天可覆盖。
- [ ] `--structured-log-retention-days` 控制 `--log-dir` 目录下结构化日志保留天数，默认 30 天可覆盖。
- [ ] 原有 `QualityLog` 行为不受影响。

**风险与应对**：

| 风险 | 应对措施 |
|---|---|
| 日志文件过大 | 按 session 分文件；默认 30 天清理；后续可扩展采样/压缩 |

---

### 任务 T8：文档更新与全量验收

**目标**：

更新用户文档，完成全量测试与验收。

**实现步骤**：

1. 更新 `README.md`：
   - 说明 v1.3 新增定位与能力；
   - 新增 `quality` 子命令参数说明。
2. 更新 `docs/usage.md`：
   - 补充 H5/Web 监控示例；
   - 补充内存/资源监控示例；
   - 说明结构化日志路径与格式。
3. 更新 `docs/api.md`（如受影响）。
4. 不修改已归档的 Phase 1-5 及 v1.1、v1.2 Spec 文档。
5. 运行 `pnpm typecheck`、`pnpm build`、`pnpm test`。
6. 生成 `docs/specs/acceptance-report-v1.3.md`。
7. 调用测试验收专家评审。

**验收标准**：

- [ ] 文档与实现一致，无错别字。
- [ ] `pnpm typecheck` 通过。
- [ ] `pnpm build` 通过。
- [ ] `pnpm test` 全量通过。
- [ ] 验收报告通过专家评审。

---

## 3. 依赖与资源

### 3.1 外部依赖

- 不引入新的核心依赖；
- 运行时采集复用项目已有 `playwright`；
- 静态规则扩展复用 `@babel/parser`、`@babel/traverse`。

### 3.2 关键角色

| 角色 | 任务 |
|---|---|
| SOLO Coder | 协调文档、调度专家、最终交付 |
| 开发专家 | 完成 T1-T7 代码实现 |
| 测试验收专家 | 验收 T8 |

---

## 4. 里程碑

| 里程碑 | 时间 | 交付物 |
|---|---|---|
| M1 需求对齐完成 | 2026-06-21 | 会议纪要 |
| M2 需求分解批准 | 2026-06-21 | requirements-decomposition-v1.3.md |
| M3 设计文档评审通过 | 待定 | design-v1.3.md |
| M4 执行计划评审通过 | 待定 | execution-plan-v1.3.md |
| M5 阶段 Spec 及任务 Spec 评审通过 | 待定 | phase-v1.3-spec.md、phase-v1.3-t{n}-spec.md |
| M6 开发完成 | 待定 | T1-T7 代码与文档 |
| M7 测试验收通过 | 待定 | acceptance-report-v1.3.md |
| M8 归档 | 待定 | phase-v1.3-spec.md 状态改为「已完成，已归档」 |

---

## 5. 任务 Spec 拆解说明

- 每个任务在计划评审通过后，必须拆解为独立的任务 Spec。
- 任务 Spec 文件命名：`docs/specs/phases/phase-v1.3-t{n}-spec.md`。
- 阶段 Spec 文件 `docs/specs/phases/phase-v1.3-spec.md` 由 SOLO Coder 在执行计划评审通过后创建，并与任务 Spec 一起评审。
- 所有任务 Spec 评审通过后，阶段 Spec 才视为整体通过，方可进入代码开发阶段。

---

## 6. 变更控制

- 任何对 v1.3 范围的变更必须走新版本流程（v1.4 或补丁流程）。
- 已归档的 Phase 1-5 及 v1.1、v1.2 文档禁止修改。
- 开发过程中如发现 Spec 缺陷，需暂停开发，升级 Spec 并重新评审。

---

## 7. 评审记录

| 评审日期 | 评审结论 | 评审人 | 主要意见 |
|---|---|---|---|
| 2026-06-21 | 通过 | 用户确认 / SOLO Coder | 设计文档与执行计划已按需求对齐会议结论修订；riskType 统一为 RuleHit 顶层字段；结构化日志路径统一为 <project>/.legacy-shield/logs；lib/quality.ts 保持 v1.2 code-quality 适配层，由 lib/cli/quality.ts 编排；可进入阶段 Spec 与任务 Spec 阶段 |
