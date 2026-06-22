import { join } from 'node:path';
import type {
  AnalysisResult,
  AnalysisSummary,
  AnalyzerOptions,
  BehaviorLog,
  BehaviorTimelineItem,
  NetworkIssue,
  NetworkLog,
  QualityAnalysisSummary,
  QualityLog,
  QualitySubType,
  RuntimeLog,
  TopError,
} from './types.js';
import { ERROR_RUNTIME_SUB_TYPES } from './types.js';
import { today, readJsonlWithWarnings, hasShape } from './utils.js';

const DEFAULT_NETWORK_ISSUE_THRESHOLD_MS = 5000;
const TOP_ERRORS_LIMIT = 10;

type ErrorBucket = {
  representative: RuntimeLog;
  samples: RuntimeLog[];
  total: number;
};

function parseTimestamp(ts: string): number {
  return new Date(ts).getTime();
}

function isRuntimeLog(log: unknown): log is RuntimeLog {
  return (
    hasShape(log, ['type', 'subType', 'sessionId', 'timestamp', 'level', 'url', 'userAgent', 'message']) &&
    (log as Record<string, unknown>).type === 'runtime'
  );
}

function isNetworkLog(log: unknown): log is NetworkLog {
  return (
    hasShape(log, ['type', 'subType', 'sessionId', 'timestamp', 'level', 'requestId', 'method', 'url', 'durationMs']) &&
    (log as Record<string, unknown>).type === 'network'
  );
}

function isBehaviorLog(log: unknown): log is BehaviorLog {
  return (
    hasShape(log, ['type', 'subType', 'sessionId', 'timestamp', 'level', 'sequence', 'pageUrl', 'target', 'payload']) &&
    (log as Record<string, unknown>).type === 'behavior'
  );
}

function isQualityLog(log: unknown): log is QualityLog {
  return (
    hasShape(log, ['type', 'subType', 'sessionId', 'timestamp', 'level']) &&
    (log as Record<string, unknown>).type === 'quality'
  );
}

function getLatestQualityLog<T extends QualitySubType>(
  qualityLogs: QualityLog[],
  subType: T,
): QualityLog | undefined {
  const sorted = [...qualityLogs].sort(
    (a, b) => parseTimestamp(a.timestamp) - parseTimestamp(b.timestamp),
  );
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].subType === subType) return sorted[i];
  }
  return undefined;
}

// v1.4：复用 types.ts 中的 SSOT 常量，保证 logger / analyzer / api 三处白名单单一事实源
const TOP_ERROR_SUB_TYPES = new Set<string>(ERROR_RUNTIME_SUB_TYPES);

function dedupeJsErrors(runtimeLogs: RuntimeLog[]): TopError[] {
  const buckets = new Map<string, ErrorBucket>();
  for (const log of runtimeLogs) {
    if (!TOP_ERROR_SUB_TYPES.has(log.subType) || !log.errorId) continue;
    const second = Math.floor(parseTimestamp(log.timestamp) / 1000);
    const key = `${log.errorId}|${second}`;
    const existing = buckets.get(key);
    if (!existing) {
      buckets.set(key, { representative: log, samples: [log], total: 1 });
    } else {
      existing.total += 1;
      existing.samples.push(log);
      existing.samples.sort(
        (a, b) => parseTimestamp(a.timestamp) - parseTimestamp(b.timestamp),
      );
      if (existing.samples.length > 3) {
        existing.samples = existing.samples.slice(existing.samples.length - 3);
      }
      if (log.source !== 'browser-pageerror') {
        existing.representative = log;
      }
    }
  }
  return Array.from(buckets.values()).map((b) => ({
    errorId: b.representative.errorId ?? '',
    subType: b.representative.subType,
    message: b.representative.message,
    source: b.representative.source,
    url: b.representative.url,
    count: b.total,
    firstAt: b.samples[0].timestamp,
    lastAt: b.samples[b.samples.length - 1].timestamp,
    samples: b.samples,
  }));
}

function dedupeScroll(behaviorLogs: BehaviorLog[]): BehaviorLog[] {
  const groups = new Map<number, BehaviorLog>();
  const others: BehaviorLog[] = [];
  for (const log of behaviorLogs) {
    if (log.subType !== 'scroll') {
      others.push(log);
      continue;
    }
    const key = Math.floor(parseTimestamp(log.timestamp) / 1000);
    groups.set(key, log);
  }
  return others.concat(Array.from(groups.values()));
}

function buildSummary(
  runtimeLogs: RuntimeLog[],
  networkLogs: NetworkLog[],
  behaviorLogs: BehaviorLog[],
  qualityLogs: QualityLog[],
  networkIssueThresholdMs: number,
): AnalysisSummary {
  const runtimeErrorCount = runtimeLogs.filter((l) => l.level === 'error').length;
  const runtimeWarningCount = runtimeLogs.filter((l) => l.level === 'warn').length;
  const networkCount = networkLogs.length;
  const networkIssueCount = networkLogs.filter(
    (l) =>
      l.level === 'warn' ||
      l.level === 'error' ||
      (l.response?.status ?? 0) >= 400 ||
      (l.durationMs ?? 0) > networkIssueThresholdMs,
  ).length;
  const behaviorCount = behaviorLogs.length;

  const latestCodeQuality = getLatestQualityLog(qualityLogs, 'code-quality');
  let eslintIssueCount = 0;
  let testStatus: 'passed' | 'failed' | 'unknown' = 'unknown';
  if (latestCodeQuality && typeof latestCodeQuality.summary === 'object' && latestCodeQuality.summary !== null) {
    const rawEslint = (latestCodeQuality.summary as Record<string, unknown>).eslintIssueCount;
    eslintIssueCount = typeof rawEslint === 'number' ? rawEslint : 0;
    const rawTestStatus = (latestCodeQuality.summary as Record<string, unknown>).testStatus;
    testStatus =
      rawTestStatus === 'passed' || rawTestStatus === 'failed'
        ? rawTestStatus
        : 'unknown';
  }

  const latestCustomRule = getLatestQualityLog(qualityLogs, 'custom-rule');
  let customRuleHitCount = 0;
  if (
    latestCustomRule &&
    Array.isArray(latestCustomRule.customRuleHits)
  ) {
    customRuleHitCount = latestCustomRule.customRuleHits.length;
  }

  return {
    runtimeErrorCount,
    runtimeWarningCount,
    networkCount,
    networkIssueCount,
    behaviorCount,
    eslintIssueCount,
    testStatus,
    customRuleHitCount,
  };
}

function buildTopErrors(runtimeLogs: RuntimeLog[]): TopError[] {
  const deduped = dedupeJsErrors(runtimeLogs);
  deduped.sort((a, b) => b.count - a.count);
  return deduped.slice(0, TOP_ERRORS_LIMIT);
}

function buildNetworkIssues(
  networkLogs: NetworkLog[],
  networkIssueThresholdMs: number,
): NetworkIssue[] {
  return networkLogs
    .filter(
      (l) =>
        l.level === 'warn' ||
        l.level === 'error' ||
        (l.durationMs ?? 0) > networkIssueThresholdMs ||
        (l.response?.status ?? 0) >= 400,
    )
    .map((l) => ({
      requestId: l.requestId ?? '',
      method: l.method ?? '',
      url: l.url ?? '',
      status: l.response?.status ?? 0,
      durationMs: l.durationMs ?? 0,
      level: l.level,
      timestamp: l.timestamp,
    }))
    .sort((a, b) => parseTimestamp(a.timestamp) - parseTimestamp(b.timestamp));
}

function buildBehaviorTimeline(behaviorLogs: BehaviorLog[]): BehaviorTimelineItem[] {
  const deduped = dedupeScroll(behaviorLogs);
  return deduped
    .map((l) => ({
      sequence: l.sequence,
      subType: l.subType,
      timestamp: l.timestamp,
      pageUrl: l.pageUrl,
      target: l.target,
      payload: l.payload,
    }))
    .sort((a, b) => {
      const tsDiff = parseTimestamp(a.timestamp) - parseTimestamp(b.timestamp);
      if (tsDiff !== 0) return tsDiff;
      return a.sequence - b.sequence;
    });
}

function buildQualitySummary(qualityLogs: QualityLog[]): QualityAnalysisSummary {
  const latestCodeQuality = getLatestQualityLog(qualityLogs, 'code-quality');
  const latestCustomRule = getLatestQualityLog(qualityLogs, 'custom-rule');

  let codeQualityExitCode: number | undefined;
  let codeQualityCommand: string | undefined;
  if (latestCodeQuality) {
    if (typeof latestCodeQuality.code === 'number') {
      codeQualityExitCode = latestCodeQuality.code;
    }
    if (typeof latestCodeQuality.command === 'string') {
      codeQualityCommand = latestCodeQuality.command;
    }
  }

  let customRuleHitCount = 0;
  let customRuleErrors = 0;
  let customRuleWarnings = 0;
  if (
    latestCustomRule &&
    Array.isArray(latestCustomRule.customRuleHits)
  ) {
    for (const hit of latestCustomRule.customRuleHits) {
      customRuleHitCount += 1;
      if (hit.severity === 'error') customRuleErrors += 1;
      if (hit.severity === 'warning') customRuleWarnings += 1;
    }
  }

  return {
    codeQualityExitCode,
    codeQualityCommand,
    customRuleHitCount,
    customRuleErrors,
    customRuleWarnings,
  };
}

export async function analyzeLogs(
  logDir: string,
  options: AnalyzerOptions = {},
): Promise<AnalysisResult> {
  const date = options.date ?? today();
  const networkIssueThresholdMs =
    options.networkIssueThresholdMs ?? DEFAULT_NETWORK_ISSUE_THRESHOLD_MS;

  const runtimeFile = join(logDir, 'runtime', `${date}.jsonl`);
  const networkFile = join(logDir, 'network', `${date}.jsonl`);
  const behaviorFile = join(logDir, 'behavior', `${date}.jsonl`);
  const qualityFile = join(logDir, 'quality', `${date}.jsonl`);

  const runtimeRaw = readJsonlWithWarnings(runtimeFile);
  const networkRaw = readJsonlWithWarnings(networkFile);
  const behaviorRaw = readJsonlWithWarnings(behaviorFile);
  const qualityRaw = readJsonlWithWarnings(qualityFile);

  const runtimeLogs = runtimeRaw.filter(isRuntimeLog);
  const networkLogs = networkRaw.filter(isNetworkLog);
  const behaviorLogs = behaviorRaw.filter(isBehaviorLog);
  const qualityLogs = qualityRaw.filter(isQualityLog);

  const summary = buildSummary(
    runtimeLogs,
    networkLogs,
    behaviorLogs,
    qualityLogs,
    networkIssueThresholdMs,
  );

  return {
    summary,
    topErrors: buildTopErrors(runtimeLogs),
    networkIssues: buildNetworkIssues(networkLogs, networkIssueThresholdMs),
    behaviorTimeline: buildBehaviorTimeline(behaviorLogs),
    qualitySummary: buildQualitySummary(qualityLogs),
  };
}
