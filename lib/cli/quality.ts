import { runCodeQuality } from '../quality.js';
import { runCustomRules } from '../custom-rules/index.js';
import { createLogger } from '../logger.js';
import { createStructuredLogger } from '../structured-logger.js';
import { detectPlatform } from '../platform.js';
import { collectMemoryMetrics } from '../runtime-monitor/memory-collector.js';
import { collectResourceMetrics } from '../runtime-monitor/resource-collector.js';
import { extractMemoryLeakRisks, extractResourceLoadRisks } from '../custom-rules/risk-aggregator.js';
import { assertLegacyProject, generateSessionId } from '../utils.js';
import type { QualityCommandOptions, StructuredLogEntry } from '../types.js';

const DEFAULT_MEMORY_THRESHOLD_PERCENT = 30;
const DEFAULT_RESOURCE_DURATION_THRESHOLD_MS = 10000;
const DEFAULT_RESOURCE_SIZE_THRESHOLD_BYTES = 1024 * 1024;

export async function runQuality(options: QualityCommandOptions): Promise<number> {
  const {
    project,
    targets,
    base,
    skip,
    disabledRules,
    logRetentionDays,
    platform: platformExplicit,
    enableMemoryMonitor,
    enableResourceMonitor,
    startPage = '/',
    memoryThresholdPercent = DEFAULT_MEMORY_THRESHOLD_PERCENT,
    resourceDurationThresholdMs = DEFAULT_RESOURCE_DURATION_THRESHOLD_MS,
    resourceSizeThresholdBytes = DEFAULT_RESOURCE_SIZE_THRESHOLD_BYTES,
    resourceIgnorePatterns = [],
    logDir,
    structuredLogRetentionDays = 30,
  } = options;

  const v13Enabled = isV13PathEnabled(options);

  let sessionId = '';
  let platformResult: ReturnType<typeof detectPlatform> | undefined;

  if (v13Enabled) {
    sessionId = generateSessionId();
    platformResult = detectPlatform({ projectPath: project, explicit: platformExplicit });
    assertLegacyProject(project, { allowNoSrc: true });
  } else {
    assertLegacyProject(project);
  }

  const logger = createLogger(project, sessionId || generateSessionId(), logRetentionDays);
  const structuredLogger = v13Enabled
    ? createStructuredLogger({ projectPath: project, sessionId, logDir, retentionDays: structuredLogRetentionDays })
    : undefined;

  let exitCode = 0;

  try {
    if (v13Enabled && platformResult && structuredLogger) {
      const platformEntry: StructuredLogEntry = {
        timestamp: new Date().toISOString(),
        sessionId,
        level: 'info',
        category: 'platform',
        message: `平台识别结果: ${platformResult.platform}`,
        context: platformResult.context,
      };
      structuredLogger.log(platformEntry);
    }

    const codeQualityResult = await runCodeQuality(project, {
      targets,
      base,
      skipList: skip,
    });

    const customRulesResult = await runCustomRules(project, {
      disabled: disabledRules,
    });

    logger.logQuality({
      subType: 'code-quality',
      level: codeQualityResult.code === 0 ? 'info' : 'error',
      command: codeQualityResult.command,
      code: codeQualityResult.code,
      stdout: codeQualityResult.stdout,
      stderr: codeQualityResult.stderr,
      summary: codeQualityResult.summary,
      customRuleHits: [],
    });

    logger.logQuality({
      subType: 'custom-rule',
      level: customRulesResult.summary.errors > 0 ? 'error' : customRulesResult.summary.warnings > 0 ? 'warn' : 'info',
      command: codeQualityResult.command,
      code: codeQualityResult.code,
      stdout: '',
      stderr: '',
      summary: customRulesResult.summary,
      customRuleHits: customRulesResult.hits,
    });

    if (codeQualityResult.code !== 0) exitCode = 1;
    if (customRulesResult.summary.errors > 0) exitCode = 1;

    const memoryRisks = v13Enabled ? extractMemoryLeakRisks(customRulesResult.hits) : [];
    const resourceRisks = v13Enabled ? extractResourceLoadRisks(customRulesResult.hits) : [];

    if (v13Enabled && structuredLogger) {
      for (const hit of customRulesResult.hits) {
        if (!hit.riskType) continue;
        structuredLogger.log({
          timestamp: new Date().toISOString(),
          sessionId,
          level: hit.severity === 'error' ? 'error' : 'warn',
          category: 'static-rule',
          ruleId: hit.ruleId,
          riskType: hit.riskType,
          message: hit.message,
          sourceLocation: {
            filePath: hit.filePath,
            line: hit.line,
            column: hit.column,
          },
          context: hit.context,
        });
      }
    }

    let memoryResult: Awaited<ReturnType<typeof collectMemoryMetrics>> | undefined;
    let resourceResult: Awaited<ReturnType<typeof collectResourceMetrics>> | undefined;

    if (v13Enabled && enableMemoryMonitor && platformResult && structuredLogger) {
      memoryResult = await collectMemoryMetrics({
        projectPath: project,
        startPage,
        headless: true,
        logger,
        structuredLogger,
        sessionId,
        platform: platformResult.platform,
        thresholdPercent: memoryThresholdPercent,
        staticRisks: memoryRisks,
      });
      if (!memoryResult.success) {
        // 运行时采集失败不阻断流程，但记录为 warn
        console.warn(`[legacy-shield] 内存监控失败: ${memoryResult.error}`);
      }
    }

    if (v13Enabled && enableResourceMonitor && platformResult && structuredLogger) {
      resourceResult = await collectResourceMetrics({
        projectPath: project,
        startPage,
        headless: true,
        logger,
        structuredLogger,
        sessionId,
        platform: platformResult.platform,
        durationThresholdMs: resourceDurationThresholdMs,
        sizeThresholdBytes: resourceSizeThresholdBytes,
        ignorePatterns: resourceIgnorePatterns,
        staticRisks: resourceRisks,
      });
      if (!resourceResult.success) {
        console.warn(`[legacy-shield] 资源监控失败: ${resourceResult.error}`);
      }
    }

    printSummary({
      project,
      v13Enabled,
      platform: platformResult?.platform,
      codeQualityCode: codeQualityResult.code,
      customRuleSummary: customRulesResult.summary,
      memoryEnabled: enableMemoryMonitor ?? false,
      memoryResult,
      resourceEnabled: enableResourceMonitor ?? false,
      resourceResult,
      structuredLogPath: structuredLogger ? `${logDir ?? `${project}/.legacy-shield/logs`}/${sessionId}.ndjson` : undefined,
    });
  } catch (err) {
    logger.logQuality({
      subType: 'code-quality',
      level: 'error',
      command: 'all',
      code: 1,
      stdout: '',
      stderr: err instanceof Error ? err.message : String(err),
      summary: {
        exitCode: 1,
        testStatus: 'unknown',
        eslintIssueCount: 0,
        typeCheckStatus: 'unknown',
      },
      customRuleHits: [],
    });
    exitCode = 1;
  } finally {
    await logger.close();
    if (structuredLogger) {
      await structuredLogger.close();
    }
  }

  return exitCode;
}

function isV13PathEnabled(options: QualityCommandOptions): boolean {
  return (
    options.platform !== undefined ||
    options.enableMemoryMonitor === true ||
    options.enableResourceMonitor === true ||
    options.logDir !== undefined ||
    options.structuredLogRetentionDays !== undefined
  );
}

interface SummaryOptions {
  project: string;
  v13Enabled: boolean;
  platform?: string;
  codeQualityCode: number;
  customRuleSummary: { total: number; errors: number; warnings: number };
  memoryEnabled: boolean;
  memoryResult?: { success: boolean; metrics?: { leaked: boolean } };
  resourceEnabled: boolean;
  resourceResult?: { success: boolean; slowResources?: unknown[]; largeResources?: unknown[] };
  structuredLogPath?: string;
}

function printSummary(options: SummaryOptions): void {
  const {
    project,
    v13Enabled,
    platform,
    codeQualityCode,
    customRuleSummary,
    memoryEnabled,
    memoryResult,
    resourceEnabled,
    resourceResult,
    structuredLogPath,
  } = options;

  // eslint-disable-next-line no-console
  console.log('[legacy-shield] quality 摘要');
  if (v13Enabled) {
    // eslint-disable-next-line no-console
    console.log(`- 平台类型: ${platform ?? 'unknown'}`);
  }
  // eslint-disable-next-line no-console
  console.log(`- code-quality 退出码: ${codeQualityCode}`);
  // eslint-disable-next-line no-console
  console.log(`- 自定义规则命中: ${customRuleSummary.total} 条（error ${customRuleSummary.errors}, warning ${customRuleSummary.warnings}）`);
  if (v13Enabled) {
    // eslint-disable-next-line no-console
    console.log(`- 内存监控: ${memoryEnabled ? (memoryResult?.success ? (memoryResult.metrics?.leaked ? '异常' : '正常') : '失败') : '未启用'}`);
    // eslint-disable-next-line no-console
    console.log(`- 资源监控: ${resourceEnabled ? (resourceResult?.success ? `长耗时 ${resourceResult.slowResources?.length ?? 0} / 体积过大 ${resourceResult.largeResources?.length ?? 0}` : '失败') : '未启用'}`);
    if (structuredLogPath) {
      // eslint-disable-next-line no-console
      console.log(`- 结构化日志: ${structuredLogPath}`);
    }
  }
  // eslint-disable-next-line no-console
  console.log(`- QualityLog 目录: ${project}/.runtime-log-ignore/quality/`);
}
