# legacy-shield v1.3 Spec：业务系统开发阶段护航

> 版本：v1.3
> 对应需求文档：[requirements-v1.3.md](../requirements-v1.3.md)
> 对应设计文档：[design-v1.3.md](../design-v1.3.md)
> 对应执行计划：[execution-plan-v1.3.md](../execution-plan-v1.3.md)
> 状态：已完成，已归档
> 评审记录：见本文档末尾

---

## 1. 目标

将 legacy-shield 项目定位从“老项目代码质量检查”扩展为“公司内部业务系统开发阶段护航”。v1.3 在 v1.2 已集成的 code-quality 静态检查能力基础上：

- 将监控对象从“老项目”扩展为 Web 端与移动端 H5 业务系统；
- 在现有 `quality` 子命令中增加 H5 识别、内存泄漏检测、资源加载长耗时检测等能力；
- 新增 `runtime-monitor` 模块，基于项目已有的 Playwright/browser 能力进行运行时数据采集；
- 将监控结果以结构化 NDJSON 日志形式持久化到本地，为后续 AI 分析或人工排查提供完整上下文。

**明确不在范围内**：Node.js 后端服务监控；微信小程序、支付宝小程序等小程序端监控；桌面端应用（Electron 等）监控；线上运行时错误采集与告警；依赖安全漏洞、许可证风险检测；公司级强制 ESLint/Prettier/TypeScript 规范统一；在线数据看板、实时 Dashboard、服务端日志聚合；阻断发版、合并门禁或 CI 失败策略。

---

## 2. 交付物清单

| 编号 | 交付物 | 路径 | 说明 |
|---|---|---|---|
| D1 | H5/Web 平台识别模块 | `lib/platform.ts` | 支持显式指定与自动推断 |
| D2 | 静态规则扩展 | `lib/custom-rules/rules/no-leaked-listener.ts`、`no-uncleared-timer.ts`、`no-large-resource.ts`、`no-sync-script.ts` | 内存与资源相关规则 |
| D3 | HTML 扫描扩展 | `lib/custom-rules/scanner.ts` | 支持 `.html` 入口文件扫描 |
| D4 | 内存泄漏运行时采集 | `lib/runtime-monitor/memory-collector.ts` | 基于 Playwright 的堆内存采样 |
| D5 | 资源加载运行时采集 | `lib/runtime-monitor/resource-collector.ts` | 基于 PerformanceObserver 的资源耗时采集 |
| D6 | 运行时采集编排入口 | `lib/runtime-monitor/index.ts` | 暴露 `runMemoryMonitor` / `runResourceMonitor` |
| D7 | 结构化日志持久化 | `lib/logger.ts` | NDJSON 格式，按 session 分文件 |
| D8 | CLI 参数扩展 | `cli.ts`、`lib/cli/quality.ts` | 透传 v1.3 新增参数并编排流程 |
| D9 | 工具函数扩展 | `lib/utils.ts` | 新增 `generateSessionId()` |
| D10 | 测试更新 | `tests/` 相关新增/更新 | 覆盖平台识别、静态规则、运行时采集、结构化日志 |
| D11 | 用户文档更新 | `README.md`、`docs/usage.md`、`docs/api.md` | 补充 v1.3 能力说明与示例 |
| D12 | 验收报告 | `docs/specs/acceptance-report-v1.3.md` | v1.3 验收结论 |

---

## 3. 技术方案

### 3.1 总体策略

v1.3 保持 `quality` 子命令作为唯一 CLI 入口，通过新增参数扩展能力。`lib/cli/quality.ts` 的 `runQuality` 负责编排 platform / code-quality / custom-rules / runtime-monitor / logger 各模块。`lib/quality.ts` 继续作为 v1.2 code-quality 的适配层，职责不变。

模块关系如下：

```
node ./dist/cli.js quality [v1.3 新增参数]
  -> cli.ts                          # 新增/扩展 quality 子命令参数定义
    -> lib/cli/quality.ts            # runQuality：编排 platform / code-quality / custom-rules / runtime-monitor / logger
      -> lib/platform.ts                # 项目类型识别
      -> lib/quality.ts                 # v1.2 code-quality 适配层（职责不变）
      -> lib/custom-rules/index.ts      # 扩展静态规则（内存/资源相关）
      -> lib/runtime-monitor/index.ts   # 运行时采集（内存/资源）
      -> lib/logger.ts                  # 结构化日志输出与持久化
```

### 3.2 H5/Web 项目识别（lib/platform.ts）

- 判断目标项目是 Web 端还是移动端 H5，为后续静态规则与运行时采集提供平台上下文。
- 识别策略：显式指定优先；未指定时按 `package.json` 依赖（P1）→ 入口 HTML viewport meta（P2）→ `manifest.json`（P3）→ 默认 `web`（P4）的优先级推断。
- 调整 `lib/utils.ts` 的 `assertLegacyProject(projectPath, options?)`，增加 `allowNoSrc?: boolean`；在 Web/H5 场景下跳过 `src/` 目录强制检查，`package.json` 存在性校验保持不变。
- 所有推断依据写入 `category: 'platform'` 的结构化日志 `context` 中。

详见 [design-v1.3.md §2.1](../design-v1.3.md#21-h5web-%E9%A1%B9%E7%9B%AE%E8%AF%86%E5%88%ABlibplatformts)。

### 3.3 静态质量规则扩展（lib/custom-rules/）

新增 4 条规则，默认启用且 severity 为 `warning`，可通过 `--disable-rule <rule-id>` 禁用：

| 规则 ID | 名称 | 触发场景 | riskType |
|---|---|---|---|
| `no-leaked-listener` | 未清理事件监听 | `addEventListener` 未在对应作用域内移除 | `memory-leak` |
| `no-uncleared-timer` | 未清理定时器 | `setInterval` / `setTimeout` 未清理 | `memory-leak` |
| `no-large-resource` | 大体积资源引用 | 引用超过 1024KB 的静态资源路径 | `resource-load` |
| `no-sync-script` | 同步脚本阻塞 | 入口 `.html` 的 `<head>` 中同步 `<script>` | `resource-load` |

- 扩展 `RuleHit` 类型，新增 `riskType` 与 `context` 字段。
- 扩展 `lib/custom-rules/scanner.ts` 支持 `.html` 文件扫描，新增 `ShieldHtmlRule` 接口与注册表。

详见 [design-v1.3.md §2.2](../design-v1.3.md#22-%E9%9D%99%E6%80%81%E8%B4%A8%E9%87%8F%E8%A7%84%E5%88%99%E6%89%A9%E5%B1%95libcustom-rulesrules)。

### 3.4 运行时采集模块（lib/runtime-monitor/）

#### 3.4.1 设计原则

- 复用 `lib/browser.ts` 的 Playwright 启动逻辑；通过新增 `StartBrowserOptions` 参数（`skipInject`、`skipProxy`、`viewport`、`userAgent`、`launchArgs`、`enableCdpSession`）隔离 shield 自身脚本，获得干净浏览器上下文。
- 按需启用：通过 `--enable-memory-monitor` 和 `--enable-resource-monitor` 分别启用。
- 运行时采集独立基于实际指标判断，静态风险清单仅作为可选上下文传入。

#### 3.4.2 内存泄漏运行时采集

- 创建 `lib/runtime-monitor/memory-collector.ts`，实现 `collectMemoryMetrics`。
- 通过 `startBrowser` 启动 headless Chromium；H5 场景设置移动端 viewport 与 UA。
- 注入采集脚本，优先使用 CDP `HeapProfiler.collectGarbage` 触发 GC，降级到 `--expose-gc` + `window.gc()` 或 `performance.memory`。
- 执行预定义交互序列，计算堆内存增长斜率；连续多轮增长超过阈值（默认 30%）时标记疑似泄漏。

详见 [design-v1.3.md §2.3.2](../design-v1.3.md#232-%E5%86%85%E5%AD%98%E6%B3%84%E6%BC%8F%E8%BF%90%E8%A1%8C%E6%97%B6%E9%87%87%E9%9B%86memory-collectorts)。

#### 3.4.3 资源加载长耗时运行时采集

- 创建 `lib/runtime-monitor/resource-collector.ts`，实现 `collectResourceMetrics`。
- 注入 PerformanceObserver 脚本，收集资源 `duration`、`transferSize`、`encodedBodySize`、`initiatorType`。
- 过滤 shield 自身请求、data URI、统计/埋点脚本；支持 `--resource-ignore-pattern` 扩展。
- 对 `duration` 超过 10000ms 或体积超过 1024KB 的资源标记为长耗时/大体积。

详见 [design-v1.3.md §2.3.3](../design-v1.3.md#233-%E8%B5%84%E6%BA%90%E5%8A%A0%E8%BD%BD%E9%95%BF%E8%80%97%E6%97%B6%E8%BF%90%E8%A1%8C%E6%97%B6%E9%87%87%E9%9B%86resource-collectorts)。

### 3.5 结构化日志输出与持久化（lib/logger.ts）

- 保留 v1.2 `QualityLog` 路径 `<project>/.runtime-log-ignore/quality/<YYYY-MM-DD>.jsonl`，由 `--log-retention-days` 控制，默认 7 天。
- 新增 `StructuredLog` 路径 `<project>/.legacy-shield/logs/<sessionId>.ndjson`，由 `--structured-log-retention-days` 控制，默认 30 天。
- 清理仅作用于 `--log-dir` 下匹配 `shield_*.ndjson` 模式的文件，基于 `mtime`，在每次启用 v1.3 路径的 `quality` 命令启动时触发。
- `sessionId` 通过 `lib/utils.ts` 的 `generateSessionId()` 生成，格式 `shield_<timestamp>_<randomSuffix>`。
- 日志 Schema 包含 `timestamp`、`sessionId`、`level`、`category`、`ruleId`、`riskType`、`message`、`sourceLocation`、`context` 等字段。
- `Logger` 接口新增 `logStructured(entry)` 与 `close()` 方法；`createLogger` 工厂函数返回双轨输出实例。

详见 [design-v1.3.md §2.4](../design-v1.3.md#24-%E7%BB%93%E6%9E%84%E5%8C%96%E6%97%A5%E5%BF%97%E8%BE%93%E5%87%BA%E4%B8%8E%E6%8C%81%E4%B9%85%E5%8C%96libloggerts)。

### 3.6 CLI 参数与执行流程

在 `cli.ts` 的 `quality` 子命令中新增参数，由 `lib/cli/quality.ts` 透传/消费：

| 参数 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `--platform <type>` | `'web' \| 'h5'` | 自动推断 | 显式指定项目平台类型 |
| `--enable-memory-monitor` | boolean | false | 启用内存泄漏运行时采集 |
| `--enable-resource-monitor` | boolean | false | 启用资源加载长耗时运行时采集 |
| `--start-page <url>` | string | 自动推断 | 运行时采集起始页面 |
| `--memory-threshold-percent <n>` | number | 30 | 内存泄漏判定阈值（百分比） |
| `--resource-duration-threshold-ms <n>` | number | 10000 | 资源长耗时判定阈值（毫秒） |
| `--resource-size-threshold-bytes <n>` | number | 1048576 | 资源大体积判定阈值（字节） |
| `--resource-ignore-pattern <pattern>` | string[] | 内置默认 | 资源采集忽略模式，可多次传入 |
| `--log-dir <path>` | string | `<project>/.legacy-shield/logs` | 结构化日志输出目录 |
| `--log-retention-days <days>` | number | 7 | v1.2 QualityLog 保留天数，行为与 v1.2 一致 |
| `--structured-log-retention-days <days>` | number | 30 | 结构化日志保留天数 |

`quality` 子命令执行流程：
1. 解析 CLI 参数；
2. 判断是否启用 v1.3 路径（用户显式传入 `--platform`、或传入 `--enable-memory-monitor`、或传入 `--enable-resource-monitor`、或传入 `--log-dir`、或传入 `--structured-log-retention-days`）；
3. 未启用 v1.3 路径时：调用原有 `assertLegacyProject(project)`，创建 QualityLog，跳转执行 code-quality 静态检查；
4. 启用 v1.3 路径时：调用 `detectPlatform` → 调用 `assertLegacyProject(project, { allowNoSrc: true })` → 创建 QualityLog + StructuredLogger；
5. 执行 code-quality 静态检查 → custom-rules 静态规则 → 可选内存/资源运行时采集 → 终端摘要 → 关闭 Logger。

详见 [design-v1.3.md §3.1](../design-v1.3.md#31-quality-%E5%AD%90%E5%91%BD%E4%BB%A4%E6%89%A7%E8%A1%8C%E6%B5%81%E7%A8%8B) 与 [§4.1](../design-v1.3.md#41-cli-%E5%8F%82%E6%95%B0%E6%89%A9%E5%B1%95)。

### 3.7 依赖与兼容性

v1.3 不引入新的核心依赖：静态规则复用现有 `@babel/parser`、`@babel/traverse`；运行时采集复用现有 `playwright`；日志持久化复用 Node.js 内置 `fs` 模块。

所有新增参数均有默认值，未传入时行为与 v1.2 一致。新增静态规则默认 severity 为 `warning`，不影响 `quality` 子命令退出码。

---

## 4. 任务拆解与验收标准

| 任务 | 名称 | 优先级 | 依赖 | 核心交付 | 验收标准摘要 |
|---|---|---|---|---|---|
| T1 | H5/Web 项目检测入口与配置适配 | P0 | 无 | `lib/platform.ts`、CLI `--platform`、sessionId 生成 | `detectPlatform` 正确识别/覆盖；`allowNoSrc` 跳过 `src/` 检查；`pnpm typecheck` 通过 |
| T2 | 代码静态质量规则扩展 | P1 | T1 | 4 条新增规则、HTML 扫描扩展、`RuleHit` 扩展 | 规则可被 `runCustomRules` 执行；典型坏代码命中；`--disable-rule` 可用；`pnpm test` 通过 |
| T3 | 内存泄漏静态分析 | P0 | T1、T2 | `memory-leak` 风险清单聚合 | 可输出内存泄漏风险点列表；可被 T4 读取 |
| T4 | 内存泄漏运行时采集 | P0 | T1、T3 | `lib/runtime-monitor/memory-collector.ts` | `--enable-memory-monitor` 输出采样数据；泄漏夹具标记正确；降级不中断流程 |
| T5 | 资源加载长耗时静态分析 | P1 | T1、T2 | `resource-load` 风险清单聚合 | 可输出资源加载风险点列表；可被 T6 读取 |
| T6 | 资源加载长耗时运行时采集 | P0 | T1、T4、T5 | `lib/runtime-monitor/resource-collector.ts` | `--enable-resource-monitor` 输出资源列表与 slowResources；降级不中断流程 |
| T7 | 结构化日志输出与文件持久化 | P0 | T2、T3、T4、T5、T6 | `lib/logger.ts` 结构化日志 | NDJSON 文件存在且字段完整；双路径保留策略分别生效；原有 QualityLog 不受影响 |
| T8 | 文档更新与全量验收 | P1 | T7 | README/usage/api 更新、验收报告 | 文档一致；`pnpm typecheck`/`build`/`test` 全量通过；验收报告通过评审 |

---

## 5. 验收标准

1. `lib/platform.ts` 可正确识别 Web/H5 项目，支持 `--platform` 显式覆盖。
2. 新增 4 条静态规则可正常运行并命中预期场景，默认 severity 为 `warning`。
3. `--enable-memory-monitor` 启用后，可输出内存采样数据与疑似泄漏结论。
4. `--enable-resource-monitor` 启用后，可输出资源加载耗时与长耗时资源列表。
5. 结构化日志以 NDJSON 格式写入 `<project>/.legacy-shield/logs/<sessionId>.ndjson`，字段符合 Schema。
6. 终端摘要必须输出：平台类型、静态规则命中数、内存监控状态、资源监控状态；仅在创建 StructuredLogger 时输出结构化日志路径。
7. 未启用任何 v1.3 新参数时，`quality` 子命令行为与 v1.2 完全一致（包括退出码），不创建结构化日志文件，平台识别结果仅内部使用。
8. `pnpm typecheck`、`pnpm build`、`pnpm test` 全量通过。

---

## 6. 风险与应对

| 风险 | 影响 | 应对措施 / 回滚方案 |
|---|---|---|
| H5 自动推断误识别 | 后续规则与采集策略不匹配 | 提供 `--platform` 显式覆盖；在日志中记录推断依据 |
| Playwright 浏览器未安装 | 运行时采集失败 | 采集失败时记录 error 级别日志，不中断 quality 流程；提示用户运行 `npx playwright install chromium` |
| 运行时采集脚本与业务代码冲突 | 页面异常或数据不准确 | 采集脚本使用独立命名空间；失败时降级为仅输出静态分析结果 |
| 结构化日志文件过大 | 磁盘占用增加 | 按 session 分文件；默认 30 天清理；支持 `--structured-log-retention-days` 配置 |
| 新增静态规则误报 | 报告噪音增加 | 规则默认 severity 为 warning；支持 `--disable-rule` 禁用；迭代中根据反馈调整规则 |
| v1.2 quality 行为回归 | 现有用户受影响 | 所有新增参数默认关闭；全量回归测试覆盖 |

---

## 7. 评审记录

| 轮次 | 时间 | 结论 | 主要问题 | 修订内容 |
|---|---|---|---|---|
| 第一轮 | 2026-06-21 | 不通过 | 1. CLI 参数表遗漏 `--log-retention-days`；<br>2. T1 H5/Web 推断策略缺少 `react-router-dom` 路由条件与 Taro UI-lib 排除；<br>3. T7 回归测试与设计文档流程矛盾；<br>4. T6 H5 viewport 尺寸未明确；<br>5. T8 归档顺序不明确。 | 补全 CLI 参数表；细化 H5/Web 推断条件；统一 v1.2 兼容性表述；补充 viewport 尺寸与归档顺序。 |
| 第二轮 | 2026-06-21 | 不通过 | 1. 阶段 Spec 验收标准 #7 与设计文档 §3.1/§8 存在内部矛盾（未启用 v1.3 参数时是否创建 StructuredLogger）；<br>2. `detectPlatform` 返回类型无法携带推断上下文；<br>3. T4/T6 任务依赖与执行计划不一致。 | 明确未启用 v1.3 参数时仅创建 QualityLog；将 `detectPlatform` 返回类型调整为 `DetectPlatformResult`；统一 T4/T6 依赖为 T1,T3 与 T1,T4,T5。 |
| 第三轮 | 2026-06-21 | 不通过 | 1. `allowNoSrc` 启用条件与 v1.2 兼容性冲突；<br>2. 结构化日志清理范围过大，可能误删用户文件。 | 引入「v1.3 路径」判定：仅启用 v1.3 路径时调用 `detectPlatform` 与 `allowNoSrc: true`；清理范围限定为 `shield_*.ndjson` 文件。 |
| 第四轮 | 2026-06-21 | 通过 | 无 P0/P1 问题；P2 优化项可在开发阶段处理。 | 批准进入代码开发阶段。 |

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
