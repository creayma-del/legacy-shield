# legacy-shield v1.3 设计文档：业务系统开发阶段护航

> 版本：v1.3
> 对应需求文档：[requirements-v1.3.md](requirements-v1.3.md)
> 对应需求分解文档：[requirements-decomposition-v1.3.md](requirements-decomposition-v1.3.md)
> 对应会议纪要：[meetings/requirements-alignment-v1.3-20260621.md](meetings/requirements-alignment-v1.3-20260621.md)
> 状态：已完成，已归档
> 编制日期：2026-06-21
> 评审记录：见文档末尾 §9

---

## 1. 总体架构

v1.3 在 v1.2 已集成的 code-quality 静态检查能力基础上，将项目定位从“老项目代码质量”扩展为“公司内部业务系统开发阶段护航”。核心变化包括：

- 监控对象从“老项目”扩展为 Web 端与移动端 H5 业务系统；
- 在现有 `quality` 子命令中增加 H5 识别、内存泄漏检测、资源加载长耗时检测等能力；
- 新增 `runtime-monitor` 模块，基于项目已有的 Playwright/browser 能力进行运行时数据采集；
- 将监控结果以结构化 NDJSON 日志形式持久化到本地，为后续 AI 分析或人工排查提供完整上下文。

### 1.1 模块关系

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

### 1.2 新增/调整文件清单

```
lib/
├── platform.ts                    # 新增：H5/Web 项目识别
├── runtime-monitor/
│   ├── index.ts                   # 新增：运行时采集入口与编排
│   ├── memory-collector.ts        # 新增：内存泄漏运行时采集
│   └── resource-collector.ts      # 新增：资源加载长耗时运行时采集
├── custom-rules/
│   ├── scanner.ts                 # 扩展：支持 .html 文件扫描
│   └── rules/
│       ├── no-leaked-listener.ts  # 新增：未清理事件监听
│       ├── no-uncleared-timer.ts  # 新增：未清理定时器
│       ├── no-large-resource.ts   # 新增：大体积资源引用
│       └── no-sync-script.ts      # 新增：同步脚本阻塞
├── logger.ts                      # 扩展：支持按 session 写入 NDJSON 日志
├── cli/quality.ts                 # 扩展：透传 v1.3 新增参数
└── utils.ts                       # 扩展：新增 generateSessionId()

cli.ts                               # 扩展：quality 子命令参数定义
```

### 1.3 不在范围内

以下事项已在需求对齐会议中明确排除，v1.3 不予实现：

- Node.js 后端服务监控。
- 微信小程序、支付宝小程序等小程序端监控。
- 桌面端应用（Electron 等）监控。
- 线上运行时错误采集与告警。
- 依赖安全漏洞、许可证风险检测。
- 公司级强制 ESLint/Prettier/TypeScript 规范统一。
- 在线数据看板、实时 Dashboard、服务端日志聚合。
- 阻断发版、合并门禁或 CI 失败策略。

---

## 2. 模块详细设计

### 2.1 H5/Web 项目识别（lib/platform.ts）

**职责**：判断目标项目是 Web 端还是移动端 H5，为后续静态规则与运行时采集提供平台上下文。

**项目目录假设**：

- v1.3 识别以 `package.json` 存在为前提（沿用 `assertLegacyProject` 对 `package.json` 的校验）。
- Web/H5 项目不一定包含 `src/` 目录，因此需调整 `lib/utils.ts` 中的 `assertLegacyProject(projectPath, options?)`：
  - 增加 `allowNoSrc?: boolean` 可选参数；
  - 在 `lib/cli/quality.ts` 的 `runQuality` 中，仅当启用 v1.3 路径（用户显式传入 `--platform` 或传入其他 v1.3 新参数）时，才调用 `detectPlatform` 并传入 `allowNoSrc: true`，跳过 `src/` 目录强制检查；
  - 未启用 v1.3 路径时，保持 v1.2 原有 `assertLegacyProject(project)` 校验逻辑（含 `src/` 目录强制检查），确保行为完全一致。

**识别策略**：

1. **显式指定优先**：通过 CLI 参数 `--platform h5` 或 `--platform web` 显式指定；
2. **自动推断**：未显式指定时，按以下优先级推断，并在日志中记录推断依据与置信度：
   - **P1**：读取 `package.json` 的 `dependencies` / `devDependencies`：
     - 若显式依赖以下包名或包名前缀，判定为 `h5`：
       - `cordova`
       - `@dcloudio/uni-app`、`uni-app`
       - `@tarojs/taro`、`taro`（非仅 `@tarojs/components` 等 UI 库）
       - `@ionic/vue`、`@ionic/react`、`@ionic/angular`、`ionic`
       - `phonegap`
     - 若显式依赖以下包名或包名前缀，判定为 `web`：
       - `next`、`nuxt`、`gatsby`
       - `react-router-dom`（且存在服务端路由配置或 `pages/` 路由目录）
   - **P2**：扫描入口 HTML 文件（优先 `index.html`，其次 `public/index.html`，最后 `src/index.html`）：
     - 检查 `<meta name="viewport">` 的 `content` 是否同时包含 `width=device-width` 与 `initial-scale`，且存在 `maximum-scale`、`user-scalable=no` 等移动端常见属性，判定为 `h5`（置信度低，仅作为辅助依据）；
     - 仅包含 `width=device-width` 与 `initial-scale` 判定为 `web`（置信度低）；
   - **P3**：检查项目根目录是否存在 `manifest.json`（PWA/Web App Manifest），存在则作为 `web` 的辅助参考，不单独作为 H5 判定依据；
   - **P4**：默认回退为 `web`。

> 说明：
> - `project.config.json` 主要用于微信小程序，不能代表 H5，不纳入判定。
> - viewport meta 推断容易误识别响应式 Web 页面，因此仅作为低置信度辅助依据；用户可通过 `--platform` 显式覆盖。
> - 所有推断依据（命中策略、包名、viewport 内容）写入 `category: 'platform'` 的结构化日志 `context` 中，便于追溯。

**对外接口**：

```ts
export type PlatformType = 'web' | 'h5';

export interface DetectPlatformOptions {
  projectPath: string;
  explicit?: PlatformType;
}

export interface DetectPlatformResult {
  platform: PlatformType;
  context: {
    inferred: boolean;
    explicit: boolean;
    strategy?: string;
    packageName?: string;
    viewportContent?: string;
    [key: string]: unknown;
  };
}

export async function detectPlatform(options: DetectPlatformOptions): Promise<DetectPlatformResult>;
```

### 2.2 静态质量规则扩展（lib/custom-rules/rules/）

**扩展原则**：优先补充与内存、资源相关的规则；新增规则默认启用，可通过 `--disable-rule <rule-id>` 禁用。

| 规则 ID | 名称 | 触发场景 | 严重级别 | riskType |
|---|---|---|---|---|
| `no-leaked-listener` | 未清理事件监听 | `addEventListener` 未在对应作用域内移除 | warning | `memory-leak` |
| `no-uncleared-timer` | 未清理定时器 | `setInterval` / `setTimeout` 未清理 | warning | `memory-leak` |
| `no-large-resource` | 大体积资源引用 | 引用超过阈值（默认 1024KB）的静态资源路径 | warning | `resource-load` |
| `no-sync-script` | 同步脚本阻塞 | 在入口 `.html` 文件的 `<head>` 中，`<script>` 标签不含 `async`、`defer`、`type="module"` 属性 | warning | `resource-load` |

> **兼容性要求**：v1.3 新增规则必须全部为 `warning` 级别，默认不影响 `quality` 子命令退出码。如需在未来引入 `error` 级别规则，必须新增独立 `--strict` 开关，且默认关闭。

**规则实现**：

- 沿用现有 `ShieldRule` 接口，通过 `@babel/traverse` 访问 AST；
- HTML 相关规则通过扩展 `lib/custom-rules/scanner.ts` 支持 `.html` 文件扫描，接口定义见下文「HTML 规则接口」；
- 扩展 `RuleHit` 类型，新增 `riskType?: 'memory-leak' | 'resource-load'` 与 `context?: Record<string, unknown>` 字段，用于聚合风险清单与传递运行时采集上下文。

```ts
export interface RuleHit {
  ruleId: string;
  ruleName: string;
  filePath: string;
  line: number;
  column: number;
  message: string;
  severity: 'error' | 'warning';
  riskType?: 'memory-leak' | 'resource-load'; // 顶层字段，用于聚合风险清单
  context?: Record<string, unknown>;          // 附加信息，如原始资源路径
}

export type StaticRiskItem = Pick<RuleHit, 'ruleId' | 'filePath' | 'line' | 'column' | 'riskType' | 'message' | 'severity'>;
```

**HTML 规则接口**

为支持对 `.html` 入口文件的扫描，新增独立的 HTML 规则接口与注册表，避免与基于 AST 的 `ShieldRule` 混淆：

```ts
export interface ShieldHtmlRule {
  id: string;
  name: string;
  severity: 'error' | 'warning';
  description: string;
  match: (html: string, filePath: string) => RuleHit[];
}
```

`lib/custom-rules/scanner.ts` 的扩展要点：

- `DEFAULT_INCLUDE` 增加 `.html`；
- 对 `.html` 文件直接读取字符串，不再调用 Babel 解析；
- 调用 `HTML_RULE_IMPLEMENTATIONS` 注册表中的规则，每条规则通过正则匹配返回 `RuleHit[]`；
- 行号/列号通过 `html.slice(0, match.index).split('\n')` 计算：行号为数组长度，列号为 `match.index - html.lastIndexOf('\n', match.index - 1)`。

### 2.3 运行时采集模块（lib/runtime-monitor/）

#### 2.3.1 设计原则

- **复用现有能力**：运行时采集基于 `lib/browser.ts` 中的 Playwright 启动逻辑，不重复实现浏览器启动与代理；
- **按需启用**：通过 `--enable-memory-monitor` 和 `--enable-resource-monitor` 参数分别启用；
- **开发阶段执行**：运行时采集在本地开发服务器或指定页面上执行，不上线；
- **结果互补**：静态分析输出“风险点”，运行时采集输出“实际指标”，两者共同写入结构化日志；
- **静态风险清单作为可选上下文**：运行时采集独立基于实际指标判断，静态风险清单仅作为“重点关注清单/上下文”可选传入，不作为运行时采集的必要输入；
- **隔离 shield 自身注入脚本**：现有 `startBrowser` 默认注入 `inject.iife.js`、监听 `pageerror` / `requestfailed` 并建立代理，会引入额外事件监听与网络请求，污染内存/资源监控结果。运行时监控复用 `startBrowser` 时，通过新增 `StartBrowserOptions` 可选参数控制：
  - `skipInject?: boolean`：跳过 `inject.iife.js` 注入与 `__shield_emit__` 暴露；
  - `skipProxy?: boolean`：跳过代理配置（`proxy` 不传入）；
  - `proxyUrl?: string`：代理服务器地址；无需代理时应与 `skipProxy: true` 配合，禁止传入空字符串或本地 noop 代理；
  - `viewport?: ViewportSize`：自定义视口；
  - `userAgent?: string`：自定义 UA；
  - `launchArgs?: string[]`：额外浏览器启动参数；
  - `enableCdpSession?: boolean`：是否创建 CDP Session 以调用 `HeapProfiler.collectGarbage`。
  当 `skipInject` / `skipProxy` 为 `true` 时，`startBrowser` 不再注册 shield 自身的事件监听与页面脚本，仅返回干净的 `BrowserHandle`。

#### 2.3.2 内存泄漏运行时采集（memory-collector.ts）

**职责**：在浏览器中执行页面交互脚本，采集 JS Heap 增长曲线，识别疑似内存泄漏。

**实现方式**：

1. 通过 `startBrowser` 启动 headless Chromium，访问项目开发服务器或本地 HTML；
   - `proxyUrl` 可选：业务页面无需代理时 `skipProxy: true`，不传入 `proxy` 配置；
   - H5 场景下，通过 `startBrowser` 的 `viewport` / `userAgent` 参数设置移动端 viewport（如 375×812）与移动 UA（默认 iPhone Safari UA，可通过配置覆盖）；
   - 启用 CDP Session（`enableCdpSession: true`）以调用 `HeapProfiler.collectGarbage`；
   - 通过 `launchArgs` 传入 `--js-flags=--expose-gc` 作为降级方案。
2. 注入采集脚本，使用 `performance.memory`（Chrome 专有）或 `performance.measureUserAgentSpecificMemory()` 获取堆内存；
   - 每轮采样前优先通过 CDP `HeapProfiler.collectGarbage` 触发 GC；
   - 若 CDP Session 创建失败或 `collectGarbage` 调用失败，降级到 `--expose-gc` + `window.gc()`；
   - 若 `measureUserAgentSpecificMemory()` 因权限/兼容性失败，降级到 `performance.memory`；
   - 所有降级路径均记录 `warn` 级别结构化日志，不中断采集流程。
3. 执行预定义交互序列（如反复打开/关闭弹窗、切换路由、滚动列表）；默认交互序列在 T4 任务 Spec 中细化，v1.3 预留 `--interaction-script` 自定义脚本接口但不实现；
4. 记录每次交互后的堆内存值，计算增长斜率；
5. 若连续多次增长超过阈值（默认 30%），标记为疑似内存泄漏。

**对外接口**：

```ts
export interface MemoryMonitorOptions {
  startPage: string;
  headless?: boolean;
  proxyUrl?: string;          // 可选；未提供时运行时采集模块将向 startBrowser 传入 skipProxy: true，不启用代理
  platform?: 'web' | 'h5';
  riskList?: StaticRiskItem[];
  interactionScript?: string; // 可选自定义交互脚本路径（v1.3 预留接口，默认序列在任务 Spec 中定义）
  thresholdPercent?: number;  // 默认 30
  rounds?: number;            // 默认 10
}

export interface MemoryMonitorResult {
  samples: Array<{ round: number; heapUsedMB: number; timestamp: string }>;
  suspectedLeak: boolean;
  growthRate: number;
  maxHeapUsedMB: number;
}

export async function collectMemoryMetrics(
  options: MemoryMonitorOptions,
  logger: Logger,
  sessionId: string,
): Promise<MemoryMonitorResult>;
```

#### 2.3.3 资源加载长耗时运行时采集（resource-collector.ts）

**职责**：通过 PerformanceObserver / Resource Timing API 采集页面资源加载耗时，识别长耗时资源。

**实现方式**：

1. 在页面加载后注入脚本，监听 `resource` 类型的 PerformanceObserver；
2. 收集所有资源（script、stylesheet、image、xhr、fetch 等）的 `duration`、`transferSize`、`encodedBodySize`、`initiatorType`；
   - 过滤 shield 自身请求、data URI、统计/埋点脚本；默认排除规则包括：URL 包含 `__shield`、`inject.iife.js`、常见统计域名（如 `google-analytics`、`umeng`、`sentry` 等）；支持 `--resource-ignore-pattern` 扩展；
   - 跨域资源若无 `Timing-Allow-Origin` 头，`transferSize` 可能为 0，此时降级使用 `encodedBodySize` 作为体积参考；若两者均为 0，则仅按 `duration` 判定，并在 `context` 中标记 `sizeEstimated: false`。
3. 对 `duration` 超过阈值（默认 10000ms）或体积超过阈值（默认 1024KB）的资源标记为长耗时/大体积；
4. H5 场景下，通过 `startBrowser` 的 `viewport` / `userAgent` 参数设置移动端 viewport（如 375×812）与移动 UA，以模拟 H5 网络环境；
5. 将结果以结构化形式返回。

**对外接口**：

```ts
export interface ResourceMonitorOptions {
  startPage: string;
  headless?: boolean;
  proxyUrl?: string;            // 可选；未提供时运行时采集模块将向 startBrowser 传入 skipProxy: true，不启用代理
  platform?: 'web' | 'h5';
  riskList?: StaticRiskItem[];
  durationThresholdMs?: number; // 默认 10000
  sizeThresholdBytes?: number;  // 默认 1024 * 1024
  waitForIdleMs?: number;       // 默认 2000
  resourceIgnorePatterns?: string[]; // 默认排除 shield 自身请求、data URI、常见统计域名
}

export interface ResourceMonitorResult {
  resources: Array<{
    name: string;
    initiatorType: string;
    durationMs: number;
    transferSize: number;
    startTime: number;
  }>;
  slowResources: Array<{
    name: string;
    durationMs: number;
    reason: 'duration' | 'size' | 'both';
  }>;
}

export async function collectResourceMetrics(
  options: ResourceMonitorOptions,
  logger: Logger,
  sessionId: string,
): Promise<ResourceMonitorResult>;
```

### 2.4 结构化日志输出与持久化（lib/logger.ts）

**设计目标**：将 v1.3 新增的监控结果以统一的 NDJSON 格式写入本地文件，保留完整上下文。

**日志双路径说明**：

- **v1.2 原有 `QualityLog`**：路径为 `<project>/.runtime-log-ignore/quality/<YYYY-MM-DD>.jsonl`，保留天数默认 7，由 `--log-retention-days` 控制，用于记录 code-quality 与 custom-rules 的原始输出。v1.3 保持该路径、格式与默认保留天数不变。
- **v1.3 新增 `StructuredLog`**：路径为 `<project>/.legacy-shield/logs/<sessionId>.ndjson`，保留天数默认 30，由 `--structured-log-retention-days` 控制，用于记录平台信息、静态规则命中、运行时采集结果等结构化上下文。

**日志路径**：

- 默认：`<project>/.legacy-shield/logs/<sessionId>.ndjson`
- 可配置：`--log-dir <path>`，最终文件路径为 `<logDir>/<sessionId>.ndjson`
- 保留策略：默认保留最近 30 天，可通过 `--structured-log-retention-days <days>` 覆盖；清理仅作用于 `--log-dir` 目录下匹配 `shield_*.ndjson` 模式的文件；清理基于文件 `mtime`，在每次启用 v1.3 路径的 `quality` 命令启动时触发。

**`sessionId` 生成规则**：

- 新增 `lib/utils.ts` 的 `generateSessionId()` 函数；
- 格式：`shield_<timestamp>_<randomSuffix>`；
- `quality` 子命令使用该格式作为本次监控会话 ID；`shield` 子命令保持现有 `generateId()` 行为不变，避免影响已有会话。

**日志 Schema**：

```ts
export interface StructuredLogEntry {
  timestamp: string;   // ISO 8601
  sessionId: string;
  level: 'error' | 'warn' | 'info';
  category: 'quality' | 'static-rule' | 'runtime-memory' | 'runtime-resource' | 'platform';
  ruleId?: string;
  riskType?: 'memory-leak' | 'resource-load';
  message: string;
  sourceLocation?: {
    filePath: string;
    line: number;
    column: number;
  };
  context?: Record<string, unknown>;
}
```

**日志样例**：

```json
{"timestamp":"2026-06-21T10:30:00.000Z","sessionId":"shield_1718958600000_ab12","level":"info","category":"platform","message":"Detected platform: h5","context":{"inferred":true,"explicit":false}}
{"timestamp":"2026-06-21T10:30:01.000Z","sessionId":"shield_1718958600000_ab12","level":"warn","category":"static-rule","ruleId":"no-leaked-listener","riskType":"memory-leak","message":"Event listener 'scroll' may not be removed","sourceLocation":{"filePath":"/path/to/project/src/App.vue","line":42,"column":10},"context":{}}
```

**实现方式**：

- 新增 `StructuredLogger` 类，内部维护一个可写流；
- 每次 `logStructured(entry)` 将 entry 序列化为 NDJSON 行写入；
- 在 `quality` 子命令结束时统一 `close()`；
- 保留 v1.2 原有 `QualityLog` 行为，新增结构化日志作为补充输出。

---

## 3. 数据流与状态变更

### 3.1 quality 子命令执行流程

```
1. 解析 CLI 参数
2. 判断是否启用 v1.3 路径：
   - 启用条件：用户显式传入 `--platform`、或传入 `--enable-memory-monitor`、或传入 `--enable-resource-monitor`、或传入 `--log-dir`、或传入 `--structured-log-retention-days`。
   - 未启用 v1.3 路径时：调用原有 `assertLegacyProject(project)`（保持 v1.2 校验逻辑，含 `src/` 目录强制检查），创建 QualityLog，跳转至步骤 5。
3. detectPlatform({ projectPath, explicit: options.platform })
4. 调用 `assertLegacyProject(project, { allowNoSrc: true })`：跳过 `src/` 目录强制检查；`package.json` 存在性校验保持不变；创建包含 QualityLog 与 StructuredLogger 的双轨 Logger。
5. 执行 code-quality 静态检查（v1.2 能力，通过 lib/quality.ts）
6. 执行 custom-rules 静态规则（含新增内存/资源规则），生成风险清单
7. 若启用内存监控：以静态风险清单作为可选上下文，调用 `collectMemoryMetrics(...)` → 写入结构化日志
8. 若启用资源监控：以静态风险清单作为可选上下文，调用 `collectResourceMetrics(...)` → 写入结构化日志
9. 输出终端摘要：平台类型、静态规则命中数、内存监控状态、资源监控状态；仅在创建 StructuredLogger 时输出结构化日志路径
10. 关闭 Logger
11. 返回退出码（v1.3 新增规则不影响退出码；仅当 v1.2 code-quality 检查失败时返回非 0）
```

> 说明：上述流程在 `lib/cli/quality.ts` 的 `runQuality` 中实现编排，`lib/quality.ts` 继续作为 v1.2 code-quality 的适配层，职责保持不变。

### 3.2 结构化日志写入流程

```
各监控模块产生原始结果
  -> StructuredLogger.logStructured(entry)
    -> JSON.stringify(entry) + '\n'
      -> 写入 <project>/.legacy-shield/logs/<sessionId>.ndjson
```

---

## 4. 接口设计

### 4.1 CLI 参数扩展

在 `cli.ts` 的 `quality` 子命令 Commander 参数定义中新增，由 `lib/cli/quality.ts` 的 `runQuality` 透传/消费：

| 参数 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `--platform <type>` | `'web' \| 'h5'` | 自动推断 | 显式指定项目平台类型 |
| `--enable-memory-monitor` | boolean | false | 启用内存泄漏运行时采集 |
| `--enable-resource-monitor` | boolean | false | 启用资源加载长耗时运行时采集 |
| `--start-page <url>` | string | 自动推断 | 运行时采集的起始页面 |
| `--memory-threshold-percent <n>` | number | 30 | 内存泄漏判定阈值（百分比） |
| `--resource-duration-threshold-ms <n>` | number | 10000 | 资源长耗时判定阈值（毫秒） |
| `--resource-size-threshold-bytes <n>` | number | 1048576 | 资源大体积判定阈值（字节） |
| `--resource-ignore-pattern <pattern>` | string[] | 内置默认 | 资源采集忽略模式，CLI 可多次传入，内部聚合为 `resourceIgnorePatterns` 数组 |
| `--log-dir <path>` | string | `<project>/.legacy-shield/logs` | 结构化日志输出目录 |
| `--log-retention-days <days>` | number | 7 | v1.2 QualityLog 保留天数，行为与 v1.2 一致 |
| `--structured-log-retention-days <days>` | number | 30 | 结构化日志保留天数（作用于 `--log-dir` 指定目录） |

**`--start-page` 自动推断规则**：

1. 若用户显式传入 `--start-page`，直接使用；
2. 若 `package.json` 中存在 `scripts.dev`，优先启动 dev server 并取 `http://localhost:<port>/`；dev server 优先于 `file://` 方案，因为 H5 项目通常需要 dev server 转译；
3. 若项目根目录存在 `index.html`，使用 `file:///<project>/index.html`；
4. 否则抛错，要求用户显式指定 `--start-page`。

**dev server 启动细节**：

- 端口解析：使用正则 `--(?:port|p)\s+(\d+)` 与 `--(?:port|p)=(\d+)` 从 `scripts.dev` 中提取端口；未解析到时按 `[3000, 5173, 8080, 8000]` 顺序探测可用端口。
- 就绪判定：启动子进程后，以 500ms 间隔轮询 `http://localhost:<port>`，返回 2xx 即认为就绪，默认最长等待 30 秒。
- 子进程清理：在 `quality` 命令正常结束或异常退出时，通过 `childProcess.kill()` 终止 dev server；若 5 秒内未退出，则发送 `SIGKILL`。
- 超时/失败：若端口探测与就绪判定均失败，抛出错误并提示用户显式指定 `--start-page`。

> 说明：更细粒度的交互脚本与自定义 dev server 命令在任务 Spec 中细化。

### 4.2 内部 API 扩展

#### `QualityCommandOptions` 扩展

```ts
export interface QualityCommandOptions {
  project: string;
  targets?: string[];
  base?: string;
  skip?: string[];
  disabledRules?: string[];
  logRetentionDays: number; // v1.2 已有，控制 QualityLog
  // v1.3 新增
  platform?: 'web' | 'h5';
  enableMemoryMonitor?: boolean;
  enableResourceMonitor?: boolean;
  startPage?: string;
  memoryThresholdPercent?: number;
  resourceDurationThresholdMs?: number;
  resourceSizeThresholdBytes?: number;
  resourceIgnorePatterns?: string[];
  logDir?: string;
  structuredLogRetentionDays?: number;
}
```

#### `StructuredLogEntry` 与 `Logger` 扩展

`StructuredLogEntry` 类型定义见 §2.4。

```ts
export interface Logger {
  // 原有方法保留
  logRuntime(...): void;
  logNetwork(...): void;
  logBehavior(...): void;
  logQuality(...): void;
  // v1.3 新增
  logStructured(entry: StructuredLogEntry): void;
  close(): Promise<void>;
}
```

- `lib/logger.ts` 的 `createLogger` 工厂函数返回的 `Logger` 实例需同时支持 v1.2 `QualityLog` 与 v1.3 `StructuredLog` 双轨输出。

---

## 5. 依赖与集成

### 5.1 外部依赖

v1.3 不引入新的核心依赖：

- 静态规则扩展复用现有 `@babel/parser`、`@babel/traverse`；
- 运行时采集复用现有 `playwright`（已通过 `lib/browser.ts` 引入）；
- 日志持久化复用 Node.js 内置 `fs` 模块。

### 5.2 与现有系统的集成点

| 集成点 | 说明 |
|---|---|
| `cli.ts` | 新增 `quality` 子命令 CLI 参数定义 |
| `lib/cli/quality.ts` | `runQuality` 透传/消费新参数，编排 platform / code-quality / custom-rules / runtime-monitor / logger |
| `lib/quality.ts` | v1.2 code-quality 适配层，职责不变 |
| `lib/browser.ts` | 运行时采集复用浏览器启动能力；新增 `skipInject`、`skipProxy`、`viewport`、`userAgent`、`launchArgs`、`enableCdpSession` 等可选参数 |
| `lib/custom-rules/` | 新增内存/资源相关规则，扩展 HTML 扫描 |
| `lib/logger.ts` | 扩展结构化日志输出 |
| `lib/utils.ts` | 新增 `generateSessionId()` |

### 5.3 兼容性考虑

- 所有新增参数均有默认值，不传入时行为与 v1.2 一致；
- `--enable-memory-monitor` / `--enable-resource-monitor` 默认关闭，不影响现有用户；
- `--platform` 默认自动推断，返回 `web` 时行为与 v1.2 一致；
- `QualityLog` 结构、输出路径与保留天数（默认 7 天）保持不变；`--log-retention-days` 仍控制 QualityLog；
- 新增 `--structured-log-retention-days` 控制 `--log-dir` 指定目录；
- 结构化日志作为新增输出，不影响原有分析流程；
- v1.3 新增静态规则默认 severity 为 warning，不影响 `quality` 子命令退出码。

---

## 6. 非功能性设计

### 6.1 性能

- 静态规则扫描沿用现有文件遍历，新增规则不会显著增加耗时；
- 运行时采集为可选功能，仅在用户显式启用时执行；
- 内存/资源采集脚本在页面内以轻量级 PerformanceObserver 方式运行，避免长时间阻塞主线程。

### 6.2 可维护性

- `runtime-monitor` 模块按采集对象拆分为 `memory-collector.ts` 和 `resource-collector.ts`；
- 新增静态规则每个规则独立文件，沿用 `ShieldRule` 接口；
- 结构化日志 Schema 明确、字段稳定，便于后续 AI 工具消费。

### 6.3 可观测性

- 所有新增监控结果均写入结构化日志；
- 终端摘要新增内存/资源监控状态提示；
- 日志文件路径在摘要中输出，便于用户查找。

---

## 7. 风险与回滚方案

| 风险 | 影响 | 应对措施 / 回滚方案 |
|---|---|---|
| H5 自动推断误识别 | 后续规则与采集策略不匹配 | 提供 `--platform` 显式覆盖；在日志中记录推断依据 |
| Playwright 浏览器未安装 | 运行时采集失败 | 采集失败时记录 error 级别日志，不中断整个 quality 流程；提示用户运行 `npx playwright install chromium` |
| 运行时采集脚本与业务代码冲突 | 页面异常或数据不准确 | 采集脚本使用独立命名空间，避免污染 `window`；失败时降级为仅输出静态分析结果 |
| 结构化日志文件过大 | 磁盘占用增加 | 按 session 分文件；默认 30 天清理；支持 `--structured-log-retention-days` 配置 |
| 新增静态规则误报 | 报告噪音增加 | 规则默认 severity 为 warning；支持 `--disable-rule` 禁用；迭代中根据反馈调整规则 |
| v1.2 quality 行为回归 | 现有用户受影响 | 所有新增参数默认关闭；全量回归测试覆盖 |

---

## 8. 验收标准

1. `lib/platform.ts` 可正确识别 Web/H5 项目，支持显式覆盖。
2. 新增 4 条静态规则（no-leaked-listener、no-uncleared-timer、no-large-resource、no-sync-script）可正常运行并命中预期场景，且默认 severity 为 warning。
3. `--enable-memory-monitor` 启用后，可输出内存采样数据与疑似泄漏结论。
4. `--enable-resource-monitor` 启用后，可输出资源加载耗时与长耗时资源列表。
5. 结构化日志以 NDJSON 格式写入 `<project>/.legacy-shield/logs/<sessionId>.ndjson`，字段符合 Schema。
6. 终端摘要必须输出：平台类型、静态规则命中数、内存监控状态、资源监控状态；仅在创建 StructuredLogger 时输出结构化日志路径。
7. 未启用任何 v1.3 新参数时，`quality` 子命令行为与 v1.2 完全一致（包括退出码）。
8. `pnpm typecheck`、`pnpm build`、`pnpm test` 全量通过。

---

## 9. 评审记录

| 评审日期 | 评审结论 | 评审人 | 主要意见 |
|---|---|---|---|
| 2026-06-21 | 不通过 | SPEC 动态评审团 | 缺少 requirements-v1.3.md；缺少“不在范围内”章节；lib/quality.ts 职责边界与 v1.2 实现存在歧义；H5/Web 项目目录假设未明确；startBrowser 复用未说明隔离方案；proxyUrl 必填且未明确无代理场景；riskType 字段位置需与执行计划统一；结构化日志路径需与需求分解文档统一 |
| 2026-06-21 | 通过 | 用户确认 / SOLO Coder | 已创建 requirements-v1.3.md；已补充“不在范围内”章节；lib/quality.ts 保持 v1.2 code-quality 适配层，由 lib/cli/quality.ts 编排；H5/Web 目录假设与识别策略已明确；startBrowser 增加 skipInject/skipProxy 等隔离参数；proxyUrl 改为可选；riskType 统一为 RuleHit 顶层字段；结构化日志路径统一为 <project>/.legacy-shield/logs |
| 2026-06-21 | 补充说明 | SOLO Coder | 在阶段 Spec 评审中发现 §3.1 流程与 §8 验收标准 #7 存在内部歧义：未启用任何 v1.3 新参数时是否创建 StructuredLogger。明确为：未启用 v1.3 新参数时仅创建原有 QualityLog，行为与 v1.2 完全一致；启用任一 v1.3 新参数时创建双轨 Logger；§8 #6 同步明确终端摘要仅在创建 StructuredLogger 时输出日志路径。该补充为对已通过设计的细化澄清，不改变范围与接口。|
| 2026-06-21 | 补充说明 | SOLO Coder | 在阶段 Spec 评审中发现 §2.1 `detectPlatform` 返回类型无法携带推断依据，导致 T1 平台日志无法写入 `context`。将返回类型从 `Promise<PlatformType>` 调整为 `Promise<DetectPlatformResult>`，其中 `DetectPlatformResult` 包含 `platform` 与 `context`（含 `inferred`、`explicit`、`strategy`、`packageName`、`viewportContent` 等）。该补充为对已通过设计的细化澄清，不改变范围与接口。|
| 2026-06-21 | 补充说明 | SOLO Coder | 在阶段 Spec 评审中发现 §2.1/§3.1 与 §8 验收标准 #7 存在逻辑冲突：`detectPlatform` 默认回退为 `web` 会导致 `allowNoSrc` 恒成立，破坏 v1.2 兼容性。明确为：仅当启用 v1.3 路径（显式 `--platform` 或传入 `--enable-memory-monitor`/`--enable-resource-monitor`/`--log-dir`/`--structured-log-retention-days`）时才调用 `detectPlatform` 并启用 `allowNoSrc: true`；否则保持 v1.2 原有 `assertLegacyProject(project)` 校验逻辑。该补充为对已通过设计的细化澄清，不改变范围与接口。|
| 2026-06-21 | 补充说明 | SOLO Coder | 在阶段 Spec 评审中发现 §2.4 结构化日志保留策略清理范围过大，存在误删用户文件风险。明确为：清理仅作用于 `--log-dir` 目录下匹配 `shield_*.ndjson` 模式的文件。该补充为对已通过设计的细化澄清，不改变范围与接口。
