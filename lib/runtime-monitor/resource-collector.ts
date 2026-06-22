import { startBrowser } from '../browser.js';
import { resolveStartPage } from './start-page.js';
import type { Logger, PlatformType, StaticRiskItem, StructuredLogger } from '../types.js';

export interface ResourceMonitorOptions {
  projectPath: string;
  startPage: string;
  headless: boolean;
  logger: Logger;
  structuredLogger: StructuredLogger;
  sessionId: string;
  platform: PlatformType;
  durationThresholdMs: number;
  sizeThresholdBytes: number;
  ignorePatterns?: string[];
  staticRisks?: StaticRiskItem[];
}

export interface ResourceEntry {
  url: string;
  type: string;
  durationMs: number;
  transferSize: number;
  encodedBodySize: number;
  sizeEstimated: boolean;
}

export interface ResourceCollectorResult {
  resources: ResourceEntry[];
  slowResources: ResourceEntry[];
  largeResources: ResourceEntry[];
  success: boolean;
  error?: string;
}

const DEFAULT_IGNORE_PATTERNS = [
  '^data:',
  '^blob:',
  '^chrome-extension:',
  '^webpack://',
  'localhost:[0-9]+/shield-',
];

export async function collectResourceMetrics(options: ResourceMonitorOptions): Promise<ResourceCollectorResult> {
  const {
    projectPath,
    startPage,
    headless,
    logger,
    structuredLogger,
    sessionId,
    platform,
    durationThresholdMs,
    sizeThresholdBytes,
    ignorePatterns = [],
    staticRisks,
  } = options;

  let browserHandle: Awaited<ReturnType<typeof startBrowser>> | undefined;
  let devServer: { stop: () => Promise<void> } | undefined;

  const combinedIgnorePatterns = [...DEFAULT_IGNORE_PATTERNS, ...ignorePatterns];

  try {
    const resolved = await resolveStartPage(projectPath, startPage, { headless });
    devServer = resolved.devServer;

    browserHandle = await startBrowser({
      startPage: resolved.url,
      headless,
      logger,
      sessionId,
      skipInject: true,
      skipProxy: true,
      viewport: platform === 'h5' ? { width: 375, height: 812 } : { width: 1440, height: 900 },
      userAgent: platform === 'h5'
        ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1'
        : 'legacy-shield/1.0',
    });

    // 等待页面资源加载完成
    await browserHandle.page.waitForLoadState('networkidle');
    await browserHandle.page.waitForTimeout(2000);

    const resources = await browserHandle.page.evaluate(() => {
      const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
      return entries.map((entry) => ({
        url: entry.name,
        type: entry.initiatorType,
        durationMs: Math.round(entry.duration * 100) / 100,
        transferSize: entry.transferSize,
        encodedBodySize: entry.encodedBodySize,
      }));
    });

    const mapped: ResourceEntry[] = resources.map((r) => {
      const hasTransferSize = typeof r.transferSize === 'number' && r.transferSize > 0;
      return {
        url: r.url,
        type: r.type,
        durationMs: r.durationMs,
        transferSize: hasTransferSize ? r.transferSize : r.encodedBodySize,
        encodedBodySize: r.encodedBodySize,
        sizeEstimated: !hasTransferSize,
      };
    }).filter((r) => !isIgnored(r.url, combinedIgnorePatterns));

    const slowResources = mapped.filter((r) => r.durationMs >= durationThresholdMs);
    const largeResources = mapped.filter((r) => r.transferSize >= sizeThresholdBytes);

    structuredLogger.log({
      timestamp: new Date().toISOString(),
      sessionId,
      level: slowResources.length > 0 || largeResources.length > 0 ? 'warn' : 'info',
      category: 'runtime-resource',
      message: `资源监控完成：${mapped.length} 个资源，${slowResources.length} 个长耗时，${largeResources.length} 个体积过大`,
      context: {
        total: mapped.length,
        slowCount: slowResources.length,
        largeCount: largeResources.length,
        slowResources,
        largeResources,
        staticRiskCount: staticRisks?.length ?? 0,
        durationThresholdMs,
        sizeThresholdBytes,
        startPage: resolved.url,
      },
    });

    return { resources: mapped, slowResources, largeResources, success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    structuredLogger.log({
      timestamp: new Date().toISOString(),
      sessionId,
      level: 'error',
      category: 'runtime-resource',
      message: `资源监控失败: ${message}`,
      context: { durationThresholdMs, sizeThresholdBytes },
    });
    return { resources: [], slowResources: [], largeResources: [], success: false, error: message };
  } finally {
    if (browserHandle) {
      try {
        await browserHandle.browser.close();
      } catch {
        // ignore
      }
    }
    if (devServer) {
      try {
        await devServer.stop();
      } catch {
        // ignore
      }
    }
  }
}

function isIgnored(url: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    try {
      const regex = new RegExp(pattern, 'i');
      return regex.test(url);
    } catch {
      return url.includes(pattern);
    }
  });
}
