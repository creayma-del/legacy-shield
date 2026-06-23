import type { Visitor } from '@babel/traverse';

export type LogLevel = 'error' | 'warn' | 'info';

export type RuntimeSubType =
  | 'js-error'
  | 'promise-rejection'
  | 'resource-error'
  | 'console-error'
  | 'console-warn'
  | 'console-info'
  | 'console-log'
  | 'vue-render-error'
  | 'vue-warn'
  | 'vue-router-error'
  | 'react-render-error'
  | 'pinia-error'
  | 'pinia-plugin-error'
  | 'vuex-error'
  | 'vuex-strict-violation';

export type BehaviorSubType =
  | 'click'
  | 'input'
  | 'change'
  | 'submit'
  | 'keydown'
  | 'keyup'
  | 'scroll'
  | 'route-change'
  | 'visibility-change';

export type NetworkSubType = 'xhr' | 'fetch' | 'static-resource' | 'proxy-error' | 'unknown';

export type QualitySubType = 'code-quality' | 'custom-rule';

export interface RuntimeLog {
  type: 'runtime';
  subType: RuntimeSubType;
  sessionId: string;
  errorId?: string;
  timestamp: string;
  level: LogLevel;
  url: string;
  userAgent: string;
  message: string;
  stack?: string;
  source?: string;
  line?: number;
  column?: number;
  failureText?: string;
  context?: Record<string, unknown>;
}

export interface NetworkRequestRecord {
  headers: Record<string, string | string[] | undefined>;
  redactedHeaders: string[];
  body: string | null;
  bodySize: number;
  bodyTruncated: boolean;
  bodyEncoding?: 'utf8' | 'base64' | null;
}

export interface NetworkResponseRecord {
  status: number;
  statusText: string;
  headers: Record<string, string | string[] | undefined>;
  redactedHeaders: string[];
  body: string | null;
  bodySize: number;
  bodyTruncated: boolean;
  bodyEncoding?: 'utf8' | 'base64' | null;
}

export interface NetworkLog {
  type: 'network';
  subType: NetworkSubType;
  sessionId: string;
  timestamp: string;
  level: LogLevel;
  requestId: string;
  method: string;
  url: string;
  request: NetworkRequestRecord;
  response: NetworkResponseRecord;
  durationMs: number;
  pageUrl: string | null;
}

export interface BehaviorTarget {
  tagName: string;
  selector: string | null;
  text?: string;
  className?: string;
  id?: string;
}

export interface BehaviorLog {
  type: 'behavior';
  subType: BehaviorSubType;
  sessionId: string;
  timestamp: string;
  level: 'info';
  sequence: number;
  pageUrl: string;
  target: BehaviorTarget | null;
  payload: Record<string, unknown>;
  coordinates: { x: number; y: number } | null;
}

export interface QualityLog {
  type: 'quality';
  subType: QualitySubType;
  sessionId: string;
  timestamp: string;
  level: LogLevel;
  command?: string;
  code?: number;
  stdout?: string;
  stderr?: string;
  summary?: Record<string, unknown> | CodeQualitySummary | CustomRulesResult['summary'];
  customRuleHits?: RuleHit[];
}

export type ShieldLog = RuntimeLog | NetworkLog | BehaviorLog | QualityLog;

export type RiskType = 'memory-leak' | 'resource-load';

export interface RuleHit {
  ruleId: string;
  ruleName: string;
  filePath: string;
  line: number;
  column: number;
  message: string;
  severity: 'error' | 'warning';
  riskType?: RiskType;
  context?: Record<string, unknown>;
}

export interface StaticRiskItem {
  ruleId: string;
  ruleName: string;
  filePath: string;
  line: number;
  column: number;
  message: string;
  severity: 'error' | 'warning';
  riskType: RiskType;
  context?: Record<string, unknown>;
}

export interface ShieldRule {
  id: string;
  name: string;
  severity: 'error' | 'warning';
  description: string;
  visitor: (hits: RuleHit[], filePath: string) => Visitor;
}

export interface CustomRulesResult {
  hits: RuleHit[];
  summary: {
    total: number;
    errors: number;
    warnings: number;
    files: number;
  };
}

export interface ScanOptions {
  include?: string[];
  exclude?: string[];
}

export interface CodeQualitySummary {
  exitCode: number;
  testStatus: 'passed' | 'failed' | 'unknown';
  eslintIssueCount: number;
  typeCheckStatus: 'passed' | 'failed' | 'skipped' | 'unknown';
}

export interface CodeQualityResult {
  command: string;
  code: number;
  stdout: string;
  stderr: string;
  legacyRoot: string;
  executedAt: string;
  summary: CodeQualitySummary;
}

export interface RunCodeQualityOptions {
  targets?: string[];
  base?: string;
  skipList?: string[];
}

export interface Logger {
  logRuntime(
    subType: RuntimeSubType,
    detail: Partial<Omit<RuntimeLog, 'type' | 'subType' | 'sessionId' | 'timestamp' | 'level'>>,
    level?: LogLevel,
  ): void;
  logNetwork(detail: Partial<Omit<NetworkLog, 'type' | 'sessionId' | 'timestamp'>>): void;
  logBehavior(detail: Partial<Omit<BehaviorLog, 'type' | 'sessionId' | 'timestamp' | 'level'>>): void;
  logQuality(detail: Partial<Omit<QualityLog, 'type' | 'sessionId' | 'timestamp'>>): void;
  close(): Promise<void>;
}

export interface StartProxyOptions {
  target: string;
  port: number;
  logger: Logger;
  noBody?: boolean;
  insecure?: boolean;
  redactBodyFields?: string[];
}

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

export interface StructuredLogEntry {
  timestamp: string;
  sessionId: string;
  level: 'error' | 'warn' | 'info';
  category: 'quality' | 'static-rule' | 'runtime-memory' | 'runtime-resource' | 'platform';
  ruleId?: string;
  riskType?: RiskType;
  message: string;
  sourceLocation?: {
    filePath: string;
    line: number;
    column: number;
  };
  context?: Record<string, unknown>;
}

export interface StructuredLogger {
  log(entry: StructuredLogEntry): void;
  close(): Promise<void>;
}

export interface StartBrowserOptions {
  proxyUrl?: string;
  startPage: string;
  headless: boolean;
  logger: Logger;
  sessionId: string;
  enableReactPatch?: boolean;
  skipInject?: boolean;
  skipProxy?: boolean;
  viewport?: { width: number; height: number };
  userAgent?: string;
  redactBodyFields?: string[];
}

export interface AnalyzerOptions {
  date?: string;
  networkIssueThresholdMs?: number;
}

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

export type ReportFormat = 'md' | 'json';

export interface ReportOptions {
  project: string;
  date: string;
  format: ReportFormat;
  out?: string;
}

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

export interface ApiOptions {
  projectPath: string;
  port: number;
  cors?: boolean;
}

export interface FixPromptResult {
  errorId: string;
  date: string;
  prompt: string;
}

export interface ShieldCommandOptions {
  project: string;
  target: string;
  proxyPort: number;
  startPage: string;
  headless: boolean;
  noBody: boolean;
  insecure: boolean;
  redactBodyFields: string[];
  sessionId: string;
  logRetentionDays: number;
  enableReactPatch: boolean;
}

export interface QualityCommandOptions {
  project: string;
  targets?: string[];
  base?: string;
  skip?: string[];
  disabledRules?: string[];
  logRetentionDays: number;
  platform?: PlatformType;
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

export interface ReportCommandOptions {
  project: string;
  date: string;
  format: ReportFormat;
  out?: string;
}

export interface ApiCommandOptions {
  project: string;
  port: number;
  cors?: boolean;
}

export interface GraphOptions {
  /** 目标项目根路径（必填） */
  project: string;
  /** 输出目录（未传时默认 <project>/.legacy-shield/knowledge-graph/） */
  out?: string;
  /** 并发扫描数（默认 8） */
  concurrency?: number;
  /** 强制全量重建，忽略缓存 */
  fresh?: boolean;
  /** 输出格式（默认 'both'） */
  format?: 'json' | 'md' | 'both';
  /** hub 文件入度阈值（默认 10） */
  hubThreshold?: number;
}

export type GraphResult = {
  /** 项目根目录 */
  projectRoot: string;
  /** 是否为 monorepo */
  isMonorepo: boolean;
  /** 子包列表（monorepo 场景，单包为空数组） */
  packages: string[];
  /** 输出目录绝对路径 */
  outputPath: string;
  /** 节点总数 */
  nodeCount: number;
  /** 边总数 */
  edgeCount: number;
  /** 循环依赖数量 */
  cycleCount: number;
  /** 执行耗时（毫秒） */
  durationMs: number;
};

export interface ShieldEmitEvent {
  type: string;
  payload: Record<string, unknown>;
}

/**
 * v1.4 SSOT：参与 errorId / topErrors / /suggest 聚合的 RuntimeSubType 单一事实源。
 * logger.ts `isErrorSubType`、analyzer.ts `TOP_ERROR_SUB_TYPES`、api.ts `generateFixPrompt`
 * 三处共用此常量，避免多处白名单漂移。后续新增需要参与 errorId 聚合的子类型时只需修改此处。
 */
export const ERROR_RUNTIME_SUB_TYPES = [
  'js-error',
  'promise-rejection',
  'vue-render-error',
  'vue-router-error',
  'react-render-error',
  // v1.4 新增
  'pinia-error',
  'pinia-plugin-error',
  'vuex-error',
  'vuex-strict-violation',
] as const satisfies readonly RuntimeSubType[];
