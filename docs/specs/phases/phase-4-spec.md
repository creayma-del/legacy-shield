# legacy-shield 阶段 4 详细 Spec：分析、报告与 AI 接口

> 文档版本：v1.0
> 对应需求文档：[requirements.md](../requirements.md)
> 对应设计文档：[design.md](../design.md)
> 对应执行计划：[execution-plan.md](../execution-plan.md) 阶段 4
> 状态：已完成，已归档（冻结，不再修改）

---

## 1. 阶段目标

实现 legacy-shield 的日志分析引擎、Markdown/JSON 报告生成器、REST API 服务，以及对应的 CLI 子命令（report/api）。阶段结束时，用户可以通过 `node ./dist/cli.js report` 生成离线报告，通过 `node ./dist/cli.js api` 启动 AI 友好的数据接口。

> 说明：本阶段所有源码文件使用 `.ts` 后缀；构建后输出到 `dist/`，CLI 运行时通过 `node ./dist/cli.js report|api` 调用。运行示例命令前需先执行 `pnpm build`。
>
> 测试文件遵循 Node ESM 扩展名约定，导入编译后的 `.js` 路径（如 `from '../lib/analyzer.js'`）；Vitest 会解析到对应的 `.ts` 源码，无需手动改为 `.ts`。

### 1.1 阶段交付物

| 交付物 | 路径 | 说明 |
|---|---|---|
| 分析引擎 | `lib/analyzer.ts` | 日志读取、聚合、错误去重、质量汇总 |
| 报告生成器 | `lib/reporter.ts` | Markdown / JSON 报告生成 |
| REST API | `lib/api.ts` | HTTP 服务与端点实现 |
| report 子命令 | `lib/cli/report.ts` | report 子命令编排 |
| api 子命令 | `lib/cli/api.ts` | api 子命令编排 |
| 集成测试 | `tests/analyzer.test.ts`、`tests/reporter.test.ts`、`tests/api.test.ts` | 分析、报告与 API 测试 |

### 1.2 阶段边界

- **范围内**：日志分析、报告生成、REST API、report/api 子命令。
- **范围外**：实时监控、自定义规则扫描。

---

## 2. 任务 4.1：实现 `lib/analyzer.ts`

### 2.1 目标

读取 runtime/network/behavior/quality 日志，进行聚合分析，输出 summary、topErrors、networkIssues、behaviorTimeline、qualitySummary。

### 2.2 输入

```ts
export interface AnalyzerOptions {
  date?: string;
  networkIssueThresholdMs?: number;
}

export async function analyzeLogs(
  logDir: string,
  options: AnalyzerOptions = {},
): Promise<AnalysisResult>
```

- `logDir`：日志根目录（`<legacy>/.runtime-log-ignore`）。
- `options.date`：分析日期，默认 `today()`（使用本地时区生成 `YYYY-MM-DD`）。
- `options.networkIssueThresholdMs`：网络慢请求阈值（默认 `5000` 毫秒）。

### 2.3 输出类型

```ts
export interface AnalysisSummary {
  runtimeErrorCount: number;
  runtimeWarningCount: number;
  networkCount: number;
  networkIssueCount: number;
  behaviorCount: number;
  eslintIssueCount: number;
  testStatus: 'passed' | 'failed' | 'unknown';
  customRuleHitCount: number;
}

export interface TopError {
  errorId: string;
  subType: string;
  message: string;
  source?: string;
  url?: string;
  count: number;
  firstAt: string;
  lastAt: string;
  samples: RuntimeLog[];
}

export interface NetworkIssue {
  requestId: string;
  method: string;
  url: string;
  status: number;
  durationMs: number;
  level: LogLevel;
  timestamp: string;
}

export interface BehaviorTimelineItem {
  sequence: number;
  subType: BehaviorSubType;
  timestamp: string;
  pageUrl: string;
  target: BehaviorTarget | null;
  payload: Record<string, unknown>;
}

> 行为时间线面向时序展示，故意省略 `BehaviorLog` 中的 `sessionId`、`level`、`coordinates`，仅保留最核心的序列、类型、时间、页面、目标与 payload。

export interface QualityAnalysisSummary {
  codeQualityExitCode?: number;
  codeQualityCommand?: string;
  customRuleHitCount: number;
  customRuleErrors: number;
  customRuleWarnings: number;
}

export interface AnalysisResult {
  summary: AnalysisSummary;
  topErrors: TopError[];
  networkIssues: NetworkIssue[];
  behaviorTimeline: BehaviorTimelineItem[];
  qualitySummary: QualityAnalysisSummary;
}
```

> 类型说明：上述接口需同步写入 `lib/types.ts`。

### 2.4 实现步骤

1. 读取四种日志文件（`runtime/YYYY-MM-DD.jsonl`、`network/YYYY-MM-DD.jsonl`、`behavior/YYYY-MM-DD.jsonl`、`quality/YYYY-MM-DD.jsonl`）。
   - 日志文件缺失时，视为该类型空数组。
   - 使用 `node:fs.readFileSync` 逐行读取；每行通过 `JSON.parse` 解析。单条 JSON 解析失败时，通过 `console.warn` 输出警告（格式：`[legacy-shield] 跳过无效日志行: <filePath>:<lineNumber>`）并跳过，继续处理后续行。此处不直接使用 `lib/utils.ts` 中的 `readJsonl`，以保证警告输出可控。
2. 构建 `summary`：
   - `runtimeErrorCount`：`runtime` 日志中 `level === 'error'` 的数量。
   - `runtimeWarningCount`：`runtime` 日志中 `level === 'warn'` 的数量。
   - `networkCount`：`network` 日志总数。
   - `networkIssueCount`：`network` 日志中满足以下任一条件的数量：
     - `level` 为 `warn` 或 `error`；
     - `(log.response?.status ?? 0) >= 400`（`response` 或 `response.status` 缺失时视为 0，不参与此条件）；
     - `durationMs > networkIssueThresholdMs`（`durationMs` 缺失时视为 0）。
   - `behaviorCount`：`behavior` 日志总数。
   - `eslintIssueCount`：从 quality 日志中解析。按 `timestamp` 升序排列，取最近一条 `subType === 'code-quality'` 记录；若该记录存在且 `summary` 为对象，则取 `summary.eslintIssueCount`（非数值时视为 0），否则为 0。
   - `testStatus`：从 quality 日志中解析。按 `timestamp` 升序排列，取最近一条 `subType === 'code-quality'` 记录；若该记录存在且 `summary` 为对象，则取 `summary.testStatus`（非 `'passed' | 'failed' | 'unknown'` 时视为 `'unknown'`），否则为 `'unknown'`。
   - `customRuleHitCount`：自定义规则命中总数。按 `timestamp` 升序排列，取最近一条 `subType === 'custom-rule'` 记录；若该记录存在且 `customRuleHits` 为数组，则取其 `length`，否则为 0。
3. `topErrors`：
   - 仅对 `subType === 'js-error'` 的 runtime 日志进行聚合。
   - 按 `errorId + 1 秒时间窗口` 去重：以 `errorId` 与 `timestamp` 所在秒数作为分桶 key。
   - 同一桶内优先保留 `source !== 'browser-pageerror'` 的记录（即优先使用 inject.iife 采集到的更完整上下文）。
   - 按 `count` 降序排列，取 TOP N（默认 10）。
   - 记录 `firstAt`（桶内最早时间）、`lastAt`（桶内最晚时间）、错误样本 `samples`（保留时间最近的最多 3 条原始 runtime 日志）。样本收集规则：每条符合 `js-error` 条件的原始日志都加入对应桶的样本列表，按 `timestamp` 升序排列，保留最新的 3 条；当同一桶的代表记录被替换时，已收集的样本仍然保留。
4. `networkIssues`：
   - 筛选满足以下任一条件的记录：
     - `level` 为 `warn` 或 `error`；
     - `durationMs > networkIssueThresholdMs`（`durationMs` 缺失时视为 0）；
     - `(log.response?.status ?? 0) >= 400`（`response` 或 `response.status` 缺失时视为 0）。
   - 输出对象的 `status` 由 `log.response.status` 派生，`durationMs` 使用日志原值；缺失字段均以 `0` 填充。
   - 按 `timestamp` 升序排序。
5. `behaviorTimeline`：
   - 去除重复高频 scroll：同一秒内的 `scroll` 事件仅保留最后一条。
   - 去重后按 `timestamp` 升序排序；若 `timestamp` 相同，则按 `sequence` 升序。
6. `qualitySummary`：
   - `codeQualityExitCode`：按 `timestamp` 升序排列，取最近一条 `subType === 'code-quality'` 的 `code`。
   - `codeQualityCommand`：按 `timestamp` 升序排列，取最近一条 `subType === 'code-quality'` 的 `command`。
   - `customRuleHitCount`、`customRuleErrors`、`customRuleWarnings`：按 `timestamp` 升序排列，取最近一条 `subType === 'custom-rule'` 记录；若该记录存在且 `customRuleHits` 为数组，则汇总其中 `severity === 'error'` 与 `severity === 'warning'` 的数量，否则三者均为 0。

### 2.5 错误去重策略

```ts
interface ErrorBucket {
  representative: RuntimeLog;
  samples: RuntimeLog[];
  total: number;
}

function dedupeJsErrors(runtimeLogs: RuntimeLog[]) {
  const buckets = new Map<string, ErrorBucket>();
  for (const log of runtimeLogs) {
    if (log.subType !== 'js-error' || !log.errorId) continue;
    const second = Math.floor(new Date(log.timestamp).getTime() / 1000);
    const key = `${log.errorId}|${second}`;
    const existing = buckets.get(key);
    if (!existing) {
      buckets.set(key, { representative: log, samples: [log], total: 1 });
    } else {
      existing.total += 1;
      existing.samples.push(log);
      // 保留最新的最多 3 条样本
      existing.samples.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      if (existing.samples.length > 3) {
        existing.samples = existing.samples.slice(existing.samples.length - 3);
      }
      // 同一桶内优先保留非 browser-pageerror 来源的记录
      if (log.source !== 'browser-pageerror') {
        existing.representative = log;
      }
    }
  }
  return Array.from(buckets.values()).map(b => ({
    ...b.representative,
    count: b.total,
    firstAt: b.samples[0].timestamp,
    lastAt: b.samples[b.samples.length - 1].timestamp,
    samples: b.samples,
  }));
}

function dedupeScroll(behaviorLogs: BehaviorLog[]) {
  // 同一秒内的 scroll 只保留最后一条
  const groups = new Map<number, BehaviorLog>();
  for (const log of behaviorLogs) {
    if (log.subType !== 'scroll') continue;
    const key = Math.floor(new Date(log.timestamp).getTime() / 1000);
    groups.set(key, log);
  }
  return behaviorLogs.filter(log => log.subType !== 'scroll').concat(Array.from(groups.values()));
}
```

### 2.6 验收标准

- [ ] 能读取并解析 JSONL 日志。
- [ ] 输出 summary、topErrors、networkIssues、behaviorTimeline、qualitySummary。
- [ ] 相同错误在 1 秒内只统计一次。
- [ ] 分析结果结构稳定。

### 2.7 测试用例

```ts
// tests/analyzer.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { analyzeLogs } from '../lib/analyzer.js';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('analyzer', () => {
  let dir;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'shield-analyzer-'));
    const base = join(dir, '.runtime-log-ignore');
    ['runtime', 'network', 'behavior', 'quality'].forEach(t => mkdirSync(join(base, t), { recursive: true }));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('aggregates runtime errors', async () => {
    const date = '2026-06-17';
    const base = join(dir, '.runtime-log-ignore');
    writeFileSync(join(base, 'runtime', `${date}.jsonl`), [
      JSON.stringify({ type: 'runtime', subType: 'js-error', errorId: 'e1', sessionId: 's1', timestamp: '2026-06-17T10:00:00.000Z', level: 'error', message: 'x', url: '/', userAgent: 'test' }),
      JSON.stringify({ type: 'runtime', subType: 'js-error', errorId: 'e1', sessionId: 's1', timestamp: '2026-06-17T10:00:00.500Z', level: 'error', message: 'x', url: '/', userAgent: 'test' }),
      JSON.stringify({ type: 'runtime', subType: 'console-error', sessionId: 's1', timestamp: '2026-06-17T10:00:01.000Z', level: 'error', message: 'y', url: '/', userAgent: 'test' })
    ].join('\n'));

    const result = await analyzeLogs(base, { date });
    expect(result.summary.runtimeErrorCount).toBe(3);
    expect(result.topErrors.length).toBe(1);
    expect(result.topErrors[0].count).toBe(2);
  });

  it('detects network issues', async () => {
    const date = '2026-06-17';
    const base = join(dir, '.runtime-log-ignore');
    writeFileSync(join(base, 'network', `${date}.jsonl`), [
      JSON.stringify({ type: 'network', level: 'info', durationMs: 100, method: 'GET', url: '/', requestId: 'req-1', response: { status: 200, statusText: 'OK', headers: {}, redactedHeaders: [], body: null, bodySize: 0, bodyTruncated: false } }),
      JSON.stringify({ type: 'network', level: 'error', durationMs: 200, method: 'POST', url: '/api', requestId: 'req-2', response: { status: 500, statusText: 'Internal Server Error', headers: {}, redactedHeaders: [], body: null, bodySize: 0, bodyTruncated: false } })
    ].join('\n'));

    const result = await analyzeLogs(base, { date });
    expect(result.summary.networkIssueCount).toBe(1);
    expect(result.networkIssues.length).toBe(1);
  });

  it('detects slow network requests', async () => {
    const date = '2026-06-17';
    const base = join(dir, '.runtime-log-ignore');
    writeFileSync(join(base, 'network', `${date}.jsonl`), [
      JSON.stringify({ type: 'network', level: 'info', durationMs: 6000, method: 'GET', url: '/slow', requestId: 'req-3', response: { status: 200, statusText: 'OK', headers: {}, redactedHeaders: [], body: null, bodySize: 0, bodyTruncated: false } })
    ].join('\n'));

    const result = await analyzeLogs(base, { date, networkIssueThresholdMs: 5000 });
    expect(result.summary.networkIssueCount).toBe(1);
    expect(result.networkIssues.length).toBe(1);
  });

  it('returns empty result when log files are missing', async () => {
    const base = join(dir, '.runtime-log-ignore');
    const result = await analyzeLogs(base, { date: '2026-06-17' });
    expect(result.summary.runtimeErrorCount).toBe(0);
    expect(result.topErrors.length).toBe(0);
    expect(result.networkIssues.length).toBe(0);
    expect(result.behaviorTimeline.length).toBe(0);
    expect(result.qualitySummary.customRuleHitCount).toBe(0);
  });

  it('skips malformed jsonl lines with console.warn', async () => {
    const date = '2026-06-17';
    const base = join(dir, '.runtime-log-ignore');
    writeFileSync(join(base, 'runtime', `${date}.jsonl`), [
      JSON.stringify({ type: 'runtime', subType: 'js-error', errorId: 'e1', sessionId: 's1', timestamp: '2026-06-17T10:00:00.000Z', level: 'error', message: 'x', url: '/', userAgent: 'test' }),
      'not-a-json',
      JSON.stringify({ type: 'runtime', subType: 'js-error', errorId: 'e1', sessionId: 's1', timestamp: '2026-06-17T10:00:02.000Z', level: 'error', message: 'x', url: '/', userAgent: 'test' })
    ].join('\n'));

    const result = await analyzeLogs(base, { date });
    expect(result.summary.runtimeErrorCount).toBe(2);
    expect(result.topErrors.length).toBe(2);
  });

  it('prefers non-browser-pageerror representative in top errors', async () => {
    const date = '2026-06-17';
    const base = join(dir, '.runtime-log-ignore');
    writeFileSync(join(base, 'runtime', `${date}.jsonl`), [
      JSON.stringify({ type: 'runtime', subType: 'js-error', errorId: 'e1', sessionId: 's1', timestamp: '2026-06-17T10:00:00.000Z', level: 'error', message: 'x', url: '/', userAgent: 'test', source: 'browser-pageerror' }),
      JSON.stringify({ type: 'runtime', subType: 'js-error', errorId: 'e1', sessionId: 's1', timestamp: '2026-06-17T10:00:00.200Z', level: 'error', message: 'x', url: '/', userAgent: 'test', source: 'inject.iife.js', stack: 'at foo' })
    ].join('\n'));

    const result = await analyzeLogs(base, { date });
    expect(result.topErrors.length).toBe(1);
    expect(result.topErrors[0].source).toBe('inject.iife.js');
    expect(result.topErrors[0].stack).toBe('at foo');
  });

  it('aggregates custom rule summary from quality logs', async () => {
    const date = '2026-06-17';
    const base = join(dir, '.runtime-log-ignore');
    writeFileSync(join(base, 'quality', `${date}.jsonl`), [
      JSON.stringify({
        type: 'quality',
        subType: 'custom-rule',
        sessionId: 's1',
        timestamp: '2026-06-17T10:00:00.000Z',
        level: 'error',
        customRuleHits: [
          { ruleId: 'SHIELD-001', ruleName: 'no-dangerous-apis', filePath: '/x', line: 1, column: 1, message: 'dangerous', severity: 'error' },
          { ruleId: 'SHIELD-002', ruleName: 'no-large-loops', filePath: '/x', line: 2, column: 1, message: 'large loop', severity: 'warning' }
        ]
      })
    ]);

    const result = await analyzeLogs(base, { date });
    expect(result.qualitySummary.customRuleHitCount).toBe(2);
    expect(result.qualitySummary.customRuleErrors).toBe(1);
    expect(result.qualitySummary.customRuleWarnings).toBe(1);
  });
});
```

---

## 3. 任务 4.2：实现 `lib/reporter.ts` Markdown 报告

### 3.1 目标

生成人类可读的 Markdown 报告。

### 3.2 输入

```ts
export type ReportFormat = 'md' | 'json';

export interface ReportOptions {
  project: string;
  date: string;
  format: ReportFormat;
  out?: string;
}

export function generateMarkdownReport(
  analysis: AnalysisResult,
  options: { project: string; date: string },
): string
```

- `analysis`：`analyzer.ts` 返回的分析结果。
- `options.project`：老项目路径。
- `options.date`：分析日期。

### 3.3 输出

返回 Markdown 字符串。

### 3.4 报告章节

报告必须包含以下 7 个章节，每个章节的最小内容要求如下：

1. **项目概览**
   - 报告标题：`# legacy-shield 运行报告`
   - 项目路径：`options.project`
   - 分析日期：`options.date`
   - 生成时间：`new Date().toISOString()`

2. **关键指标摘要表**
   - 以表格形式展示 `AnalysisSummary` 全部字段：
     - 运行时错误数（`runtimeErrorCount`）
     - 运行时警告数（`runtimeWarningCount`）
     - 网络请求总数（`networkCount`）
     - 网络异常数（`networkIssueCount`）
     - 用户行为事件数（`behaviorCount`）
     - ESLint 问题数（`eslintIssueCount`）
     - 测试状态（`testStatus`）
     - 自定义规则命中数（`customRuleHitCount`）
   - 空状态：当所有指标为 0 / unknown 时仍保留表格，避免报告结构缺失。

3. **TOP 10 高频错误**
   - 表格列名：`errorId`、`subType`、`message`、`count`、`firstAt`、`lastAt`。
   - `samples` 不在 Markdown 表格中展示，但可在表格后列出最近 1 条样本的 `url` 与 `message`。
   - 空状态：若无错误，显示“暂无高频错误”。

4. **网络异常分析**
   - 列表展示 `networkIssues`，每条包含 `method`、`url`、`status`、`durationMs`、`level`、`timestamp`。
   - 空状态：若无异常，显示“暂无网络异常”。

5. **用户行为时间线**
   - 按 `timestamp` 升序的时间线列表，每条包含 `sequence`、`subType`、`timestamp`、`pageUrl`。
   - 空状态：若无行为事件，显示“暂无行为事件”。

6. **代码质量摘要**
   - 展示 `qualitySummary` 中的 `codeQualityExitCode`、`codeQualityCommand`、`customRuleHitCount`、`customRuleErrors`、`customRuleWarnings`。
   - 空状态：若 `codeQualityCommand` 不存在且 `customRuleHitCount === 0`，显示“未检测到质量日志”。

7. **建议与下一步**
   - 根据 `analysis.summary`、`analysis.topErrors` 与 `analysis.qualitySummary` 动态生成：
     - 若 `topErrors.length > 0`，建议排查高频错误。
     - 若 `networkIssueCount > 0`，建议检查慢请求/失败请求。
     - 若 `analysis.qualitySummary.customRuleErrors > 0`，建议修复自定义规则命中项。
   - 若以上均为空，显示“当前日志未发现明显问题，建议持续监控”。

### 3.5 实现步骤

1. 创建 `generateMarkdownReport(analysis, options)` 函数。
2. 按章节渲染 Markdown。
3. 对错误列表使用表格展示。
4. 对网络异常使用列表展示。
5. 对行为时间线使用时间线列表展示。
6. “建议与下一步”根据 `analysis.summary`、`analysis.topErrors` 与 `analysis.qualitySummary` 生成：若 `topErrors.length > 0`，建议排查高频错误；若 `networkIssueCount > 0`，建议检查慢请求/失败请求；若 `analysis.qualitySummary.customRuleErrors > 0`，建议修复自定义规则命中项。

### 3.6 验收标准

- [ ] `node ./dist/cli.js report --format md` 生成完整 Markdown 文件。
- [ ] 报告内容正确反映日志分析结果。
- [ ] 报告写入 `--out` 指定路径或默认路径 `<legacy>/.runtime-log-ignore/reports/summary-YYYY-MM-DD.md`。

### 3.7 测试用例

```ts
// tests/reporter.test.ts
import { describe, it, expect } from 'vitest';
import { generateMarkdownReport } from '../lib/reporter.js';

describe('reporter markdown', () => {
  it('generates markdown with summary table', () => {
    const analysis = {
      summary: { runtimeErrorCount: 5, networkCount: 10, behaviorCount: 3, runtimeWarningCount: 0, networkIssueCount: 0, eslintIssueCount: 0, testStatus: 'unknown', customRuleHitCount: 0 },
      topErrors: [],
      networkIssues: [],
      behaviorTimeline: [],
      qualitySummary: { customRuleHitCount: 0, customRuleErrors: 0, customRuleWarnings: 0 }
    };
    const md = generateMarkdownReport(analysis, { project: '/x', date: '2026-06-17' });
    expect(md).toContain('# legacy-shield 运行报告');
    expect(md).toContain('5');
    expect(md).toContain('2026-06-17');
  });
});
```

---

## 4. 任务 4.3：实现 `lib/reporter.ts` JSON 报告

### 4.1 目标

生成 AI 友好的 JSON 报告。

### 4.2 输入

```ts
export interface JsonReport {
  meta: {
    project: string;
    date: string;
    generatedAt: string;
  };
  summary: AnalysisSummary;
  topErrors: TopError[];
  networkIssues: NetworkIssue[];
  behaviorTimeline: BehaviorTimelineItem[];
  qualitySummary: QualityAnalysisSummary;
}

export function generateJsonReport(
  analysis: AnalysisResult,
  options: { project: string; date: string },
): JsonReport
```

- `analysis`：`analyzer.ts` 返回的分析结果。
- `options`：`{ project, date }`。

### 4.3 输出

返回 `JsonReport` 对象（调用方使用 `JSON.stringify` 序列化）。

### 4.4 实现步骤

1. 创建 `generateJsonReport(analysis, options)` 函数。
2. 构造与 design.md 一致的 JSON 结构。
3. 返回对象。

### 4.5 验收标准

- [ ] `node ./dist/cli.js report --format json` 输出合法 JSON。
- [ ] 字段结构与 design.md 一致。

### 4.6 测试用例

```ts
it('generates valid json report', () => {
  const analysis = {
    summary: { runtimeErrorCount: 1, runtimeWarningCount: 0, networkCount: 0, networkIssueCount: 0, behaviorCount: 0, eslintIssueCount: 0, testStatus: 'unknown', customRuleHitCount: 0 },
    topErrors: [],
    networkIssues: [],
    behaviorTimeline: [],
    qualitySummary: { customRuleHitCount: 0, customRuleErrors: 0, customRuleWarnings: 0 }
  };
  const report = generateJsonReport(analysis, { project: '/x', date: '2026-06-17' });
  expect(report.meta.date).toBe('2026-06-17');
  expect(report.summary.runtimeErrorCount).toBe(1);
});
```

---

## 5. 任务 4.4：实现 `lib/api.ts`

### 5.1 目标

实现 REST API 服务，为 AI 智能体提供标准化数据接口。

### 5.2 输入

```ts
export interface ApiOptions {
  projectPath: string;
  port: number;
  cors?: boolean;
}

export function startApiServer(options: ApiOptions): http.Server
```

- `projectPath`：老项目路径。
- `port`：监听端口（默认 3456）。
- `cors`：是否启用 CORS（默认 false）。

### 5.3 输出

返回 `http.Server` 实例。

### 5.4 端点清单

| 端点 | 方法 | 说明 |
|---|---|---|
| `GET /health` | 健康检查 | 返回服务状态 |
| `GET /logs?type=<runtime\|network\|behavior\|quality>&date=YYYY-MM-DD` | 获取原始日志 | 返回 JSON 数组；`type` 缺省为 `runtime`，`date` 缺省为当天 |
| `GET /report?format=<json\|md>&date=YYYY-MM-DD` | 获取分析报告 | 返回完整报告；`format` 缺省为 `json`，`date` 缺省为当天 |
| `GET /errors/top?limit=N&date=YYYY-MM-DD` | TOP N 错误 | 返回高频错误列表；`limit` 缺省为 10，`date` 缺省为当天 |
| `POST /suggest` | 修复建议 | 传入 `{ errorId }`，返回 prompt；`date` 缺省为当天 |
| `GET /timeline?date=YYYY-MM-DD` | 用户行为时间线 | 返回按时间排序的行为序列；`date` 缺省为当天 |

### 5.5 响应格式

所有响应为 JSON，`Content-Type: application/json; charset=utf-8`。

错误响应：

```json
{ "error": "invalid json", "detail": "..." }
```

### 5.6 实现步骤

1. 使用原生 `node:http` 创建 server，默认绑定 `127.0.0.1`。
2. 解析 URL 和 query。
3. 实现 OPTIONS 预检响应（如果 cors 启用）。
4. 对 `type`、`date`、`format` 等查询参数进行校验，非法值返回 400 JSON。
5. 实现 `readBody` 辅助函数：
   ```ts
   import type { IncomingMessage } from 'node:http';

   class RequestEntityTooLargeError extends Error {}

   async function readBody(req: IncomingMessage, limitBytes = 1024 * 1024): Promise<string> {
     return new Promise((resolve, reject) => {
       const chunks: Buffer[] = [];
       let received = 0;
       req.on('data', (chunk: Buffer) => {
         received += chunk.length;
         if (received > limitBytes) {
           req.pause();
           reject(new RequestEntityTooLargeError('request entity too large'));
           return;
         }
         chunks.push(chunk);
       });
       req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
       req.on('error', reject);
     });
   }
   ```
   - `readBody` 默认限制请求体大小为 1MB。
   - 超过限制时抛出 `RequestEntityTooLargeError`，由 handler 捕获并返回 413 JSON：`{ error: 'request entity too large' }`。
   - 解析 JSON 失败时返回 400 JSON：`{ error: 'invalid json', detail: '...' }`。
6. 实现各端点 handler；JSONL 解析失败时跳过并记录警告，分析异常时返回 500 JSON。
7. 监听端口；端口占用时通过 `server.on('error')` 捕获 `EADDRINUSE` 并抛出友好错误。
8. 返回 server 实例。

### 5.7 端点详细说明

#### 5.7.1 GET /health

```json
{ "ok": true, "project": "/path/to/legacy" }
```

#### 5.7.2 GET /logs

```json
{ "type": "runtime", "date": "2026-06-17", "count": 10, "logs": [...] }
```

`type` 必须是 `runtime`、`network`、`behavior`、`quality` 之一，否则返回 400 JSON：`{ error: 'invalid type', detail: '...' }`。
未指定 `type` 时默认 `runtime`；未指定 `date` 时默认当天。

#### 5.7.3 GET /report

```json
{ "format": "json", "date": "2026-06-17", "report": { ... } }
```

未指定 `format` 时默认 `json`；未指定 `date` 时默认当天。

#### 5.7.4 GET /errors/top

```json
{ "date": "2026-06-17", "limit": 10, "errors": [...] }
```

#### 5.7.5 POST /suggest

请求体：

```json
{ "errorId": "abc123" }
```

Query 参数：

- `date`：可选，指定查询日期（`YYYY-MM-DD`），默认当天。

响应：

```json
{
  "errorId": "abc123",
  "date": "2026-06-17",
  "prompt": "请根据以下运行时错误信息，分析根因并给出修复建议：..."
}
```

实现要点：

- 从 `url.searchParams.get('date')` 读取日期，缺省使用 `today()`。
- `generateFixPrompt(errorId, logDir, date)` 读取 `runtime/<date>.jsonl`，筛选 `subType === 'js-error'` 且 `errorId` 匹配的记录，按 `timestamp` 升序排列后取时间最近的最多 3 条作为样本。
- 代表字段选取规则：以 3 条样本中时间最近的一条作为代表，提取其 `subType`、`message`、`url`、`stack`；`firstAt`/`lastAt` 为这 3 条样本中的最早/最晚时间；若代表记录缺少 `stack`，prompt 中显示“无 stack 信息”。
- 请求体大小限制 1MB，`readBody` 累计超过 1MB 时返回 413 JSON：`{ error: 'request entity too large' }`。
- 若未找到 `subType === 'js-error'` 且 `errorId` 匹配的记录，返回 404 JSON：`{ error: 'errorId not found', errorId }`。
- prompt 模板应包含错误类型、message、url、stack 片段、样本数等上下文。推荐模板如下：

  ```
  请根据以下运行时错误信息，分析根因并给出修复建议：

  错误类型：{subType}
  错误标识：{errorId}
  消息：{message}
  页面 URL：{url}
  Stack 片段：
  {stack}

  最近 {sampleCount} 条样本中，最早发生在 {firstAt}，最晚发生在 {lastAt}。
  请优先检查以上 stack 指向的源码位置，并给出可执行的修复方案。
  ```

```ts
export interface FixPromptResult {
  errorId: string;
  date: string;
  prompt: string;
}
```

#### 5.7.6 GET /timeline

```json
{ "date": "2026-06-17", "count": 20, "timeline": [...] }
```

### 5.8 CORS 支持

如果 `cors` 为 true，响应头包含：

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

### 5.9 验收标准

- [ ] 服务能正常启动并监听端口。
- [ ] 每个端点返回预期格式。
- [ ] 支持 CORS（可选 `--cors`）。
- [ ] 404 和 500 错误返回 JSON。

### 5.10 测试用例

```ts
// tests/api.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startApiServer } from '../lib/api.js';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('api', () => {
  let dir;
  let server;
  let port;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'shield-api-'));
    const base = join(dir, '.runtime-log-ignore');
    ['runtime', 'network', 'behavior', 'quality'].forEach(t => mkdirSync(join(base, t), { recursive: true }));
    writeFileSync(join(base, 'runtime', '2026-06-17.jsonl'), JSON.stringify({ type: 'runtime', subType: 'js-error', errorId: 'e1', sessionId: 's1', timestamp: '2026-06-17T10:00:00.000Z', level: 'error', message: 'x', url: '/', userAgent: 'test' }));
    server = startApiServer({ projectPath: dir, port: 0 });
    await new Promise(r => server.on('listening', r));
    port = server.address().port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  });

  it('GET /health returns ok', async () => {
    const res = await fetch(`http://localhost:${port}/health`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
  });

  it('GET /logs returns runtime logs', async () => {
    const res = await fetch(`http://localhost:${port}/logs?type=runtime&date=2026-06-17`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.count).toBe(1);
  });

  it('GET /errors/top returns errors', async () => {
    const res = await fetch(`http://localhost:${port}/errors/top?limit=10&date=2026-06-17`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.errors.length).toBe(1);
  });

  it('POST /suggest returns prompt with date', async () => {
    const res = await fetch(`http://localhost:${port}/suggest?date=2026-06-17`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ errorId: 'e1' })
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.errorId).toBe('e1');
    expect(data.date).toBe('2026-06-17');
    expect(data.prompt).toContain('错误类型');
  });

  it('GET /logs with invalid type returns 400', async () => {
    const res = await fetch(`http://localhost:${port}/logs?type=invalid&date=2026-06-17`);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('invalid type');
  });

  it('POST /suggest with unknown errorId returns 404', async () => {
    const res = await fetch(`http://localhost:${port}/suggest?date=2026-06-17`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ errorId: 'not-exist' })
    });
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toContain('errorId not found');
  });

  it('POST /suggest with oversized body returns 413', async () => {
    const res = await fetch(`http://localhost:${port}/suggest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'x'.repeat(1024 * 1024 + 1)
    });
    expect(res.status).toBe(413);
    const data = await res.json();
    expect(data.error).toContain('request entity too large');
  });

});
```

---

## 6. 任务 4.5：实现 `lib/cli/report.ts` 和 `lib/cli/api.ts`

### 6.1 目标

实现 report 和 api 子命令的 orchestrator。

### 6.2 report 子命令

#### 6.2.1 输入参数与类型

```ts
export interface ReportCommandOptions {
  project: string;
  date: string;
  format: ReportFormat;
  out?: string;
}
```

- `--project <legacy-root>`（必填）
- `--date <YYYY-MM-DD>`（默认 today()）
- `--format <md|json>`（默认 md）
- `--out <file-path>`（默认 `<legacy>/.runtime-log-ignore/reports/summary-YYYY-MM-DD.<md|json>`）

#### 6.2.2 执行流程

1. 解析参数。
2. 调用 `assertLegacyProject(project)`。
3. 调用 `analyzeLogs(join(project, '.runtime-log-ignore'), { date })`。
4. 根据 format 调用 `generateMarkdownReport` 或 `generateJsonReport`。
5. 确定 `outputPath`：若 `--out` 未指定，默认路径为 `<legacy>/.runtime-log-ignore/reports/summary-YYYY-MM-DD.<md|json>`；若 `--out` 指定，使用该路径（支持相对当前工作目录或绝对路径）。
6. 使用 `mkdirSync(dirname(outputPath), { recursive: true })` 确保父目录存在，再调用 `writeFileSync(outputPath, content, 'utf8')`。
7. 控制台输出报告路径。

#### 6.2.3 验收标准

- [ ] `node ./dist/cli.js report --project <legacy> --format md` 成功。
- [ ] `node ./dist/cli.js report --project <legacy> --format json` 成功。
- [ ] 报告写入默认路径或 `--out` 指定路径。

### 6.3 api 子命令

#### 6.3.1 输入参数与类型

```ts
export interface ApiCommandOptions {
  project: string;
  port: number;
  cors?: boolean;
}
```

- `--project <legacy-root>`（必填）
- `--port <port>`（默认 3456）
- `--cors`（默认 false）

#### 6.3.2 执行流程

```ts
export async function runApi(options: ApiCommandOptions): Promise<void> {
  const { project, port, cors } = options;
  assertLegacyProject(project);
  const server = startApiServer({ projectPath: project, port, cors });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.once('listening', resolve);
  });
  const actualPort = (server.address() as { port: number }).port;
  // eslint-disable-next-line no-console
  console.log(`[legacy-shield] API 服务已启动: http://127.0.0.1:${actualPort}`);

  const shutdown = () => {
    // eslint-disable-next-line no-console
    console.log('\n[legacy-shield] 正在关闭 API 服务...');
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
```

1. 解析参数；`--port` 使用 `Number(options.port)`。
2. 调用 `assertLegacyProject(project)`。
3. 启动 API server，等待 `listening` 事件。
4. 控制台输出实际监听地址（含自动分配后的端口）。
5. 监听 SIGINT/SIGTERM 关闭 server 并退出进程。

#### 6.3.3 验收标准

- [ ] `node ./dist/cli.js api --project <legacy> --port 3456` 成功。
- [ ] 服务保持运行，Ctrl+C 可关闭。

---

## 7. 任务 4.6：AI 接口测试

### 7.1 目标

验证 API 各端点可用。

### 7.2 测试步骤

1. 启动 api 服务。
2. 用 curl 调用 `/health`、`/logs`、`/report`、`/errors/top`。
3. 验证返回格式。

### 7.3 验收标准

- [ ] 所有端点返回 200。
- [ ] JSON 字段完整。
- [ ] 非法参数返回 400，请求体过大返回 413，不存在 errorId 返回 404，分析异常返回 500 等负向场景有测试覆盖。

### 7.4 测试用例

```bash
# TC-4.6-001：健康检查
curl -s http://localhost:3456/health | grep '"ok":true'

# TC-4.6-002：日志接口
curl -s 'http://localhost:3456/logs?type=runtime&date=2026-06-17' | grep '"count"'

# TC-4.6-003：报告接口
curl -s 'http://localhost:3456/report?format=json&date=2026-06-17' | grep '"summary"'

# TC-4.6-004：TOP 错误
curl -s 'http://localhost:3456/errors/top?limit=5&date=2026-06-17' | grep '"errors"'

# TC-4.6-005：修复建议（指定日期）
curl -s -X POST 'http://localhost:3456/suggest?date=2026-06-17' \
  -H 'Content-Type: application/json' \
  -d '{"errorId":"e1"}' | grep '"prompt"'

# TC-4.6-006：非法 type 返回 400
curl -s -o /dev/null -w '%{http_code}' 'http://localhost:3456/logs?type=invalid'
```

---

## 8. 阶段 4 集成验收

### 8.1 验收清单

- [ ] `lib/analyzer.ts` 能正确聚合日志（任务 4.1）。
- [ ] `lib/reporter.ts` 能生成 Markdown 和 JSON 报告（任务 4.2 + 4.3）。
- [ ] `lib/api.ts` 所有端点可用（任务 4.4）。
- [ ] `lib/cli/report.ts` 和 `lib/cli/api.ts` 能正确编排（任务 4.5）。
- [ ] AI 接口测试通过（任务 4.6）。

### 8.2 阶段出口条件

以下全部满足后，方可进入阶段 5：

1. `pnpm test` 在阶段 4 范围内全部通过。
2. `node ./dist/cli.js report --project <legacy>` 能生成报告。
3. `node ./dist/cli.js api --project <legacy>` 能启动服务且端点可用。

### 8.3 阶段交付验证命令

```bash
cd /Users/creayma/personal/legacy-shield
pnpm build
pnpm test -- tests/analyzer.test.ts tests/reporter.test.ts tests/api.test.ts
node ./dist/cli.js report --help
node ./dist/cli.js api --help
```

---

## 9. 风险与应对

| 风险 | 影响 | 应对措施 |
|---|---|---|
| 日志文件不存在导致 report 失败 | 中 | 对缺失日志类型返回空数组，生成空报告 |
| API 端口被占用 | 中 | 提供 `--port` 参数；默认端口 3456；端口占用时抛出友好错误 |
| 大日志文件导致分析慢 | 中 | 按日期过滤；后续优化流式读取 |
| CORS 配置误用导致本地敏感日志泄露 | 中 | 默认关闭，需显式 `--cors` 开启；server 默认绑定 `127.0.0.1` |
| API 暴露运行时错误与网络日志 | 中 | 默认仅本地监听；文档提示勿暴露到公网 |

---

## 10. 依赖关系

- **前置依赖**：阶段 1、阶段 2（生成日志）、阶段 3（生成 quality 日志）。
- **后续依赖**：阶段 5（端到端验收需要 report/api 可用）。
