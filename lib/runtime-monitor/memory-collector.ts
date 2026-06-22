import { startBrowser } from '../browser.js';
import { resolveStartPage } from './start-page.js';
import type { Logger, PlatformType, StaticRiskItem, StructuredLogger } from '../types.js';

export interface MemoryMonitorOptions {
  projectPath: string;
  startPage: string;
  headless: boolean;
  logger: Logger;
  structuredLogger: StructuredLogger;
  sessionId: string;
  platform: PlatformType;
  thresholdPercent: number;
  staticRisks?: StaticRiskItem[];
}

export interface MemoryMetrics {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
  usagePercent: number;
  leaked: boolean;
}

export interface MemoryCollectorResult {
  metrics: MemoryMetrics;
  success: boolean;
  error?: string;
}

export async function collectMemoryMetrics(options: MemoryMonitorOptions): Promise<MemoryCollectorResult> {
  const { projectPath, startPage, headless, logger, structuredLogger, sessionId, platform, thresholdPercent, staticRisks } = options;

  let browserHandle: Awaited<ReturnType<typeof startBrowser>> | undefined;
  let devServer: { stop: () => Promise<void> } | undefined;

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

    const client = await browserHandle.context.newCDPSession(browserHandle.page);
    await client.send('Runtime.enable');

    const memoryClient = client as unknown as { send: (method: string, params?: Record<string, unknown>) => Promise<unknown> };
    const initial = await getMemory(memoryClient);

    // 等待 5 秒让页面稳定，并尝试模拟用户交互
    await browserHandle.page.waitForTimeout(5000);

    const final = await getMemory(memoryClient);

    const growthPercent = initial.usedJSHeapSize > 0
      ? ((final.usedJSHeapSize - initial.usedJSHeapSize) / initial.usedJSHeapSize) * 100
      : 0;

    const usagePercent = final.jsHeapSizeLimit > 0
      ? (final.usedJSHeapSize / final.jsHeapSizeLimit) * 100
      : 0;

    const leaked = growthPercent >= thresholdPercent || usagePercent >= thresholdPercent;

    const metrics: MemoryMetrics = {
      usedJSHeapSize: final.usedJSHeapSize,
      totalJSHeapSize: final.totalJSHeapSize,
      jsHeapSizeLimit: final.jsHeapSizeLimit,
      usagePercent: Math.round(usagePercent * 100) / 100,
      leaked,
    };

    structuredLogger.log({
      timestamp: new Date().toISOString(),
      sessionId,
      level: leaked ? 'warn' : 'info',
      category: 'runtime-memory',
      message: `内存监控完成：JS Heap 使用率 ${metrics.usagePercent}%，增长 ${Math.round(growthPercent * 100) / 100}%`,
      context: {
        metrics,
        staticRiskCount: staticRisks?.length ?? 0,
        thresholdPercent,
        startPage: resolved.url,
      },
    });

    return { metrics, success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    structuredLogger.log({
      timestamp: new Date().toISOString(),
      sessionId,
      level: 'error',
      category: 'runtime-memory',
      message: `内存监控失败: ${message}`,
      context: { thresholdPercent },
    });
    return { metrics: { usedJSHeapSize: 0, totalJSHeapSize: 0, jsHeapSizeLimit: 0, usagePercent: 0, leaked: false }, success: false, error: message };
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

async function getMemory(client: { send: (method: string, params?: Record<string, unknown>) => Promise<unknown> }): Promise<{
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}> {
  const result = await client.send('Runtime.evaluate', {
    expression: `
      (function() {
        const mem = performance.memory || {};
        return {
          usedJSHeapSize: mem.usedJSHeapSize || 0,
          totalJSHeapSize: mem.totalJSHeapSize || 0,
          jsHeapSizeLimit: mem.jsHeapSizeLimit || 0,
        };
      })()
    `,
    returnByValue: true,
  });
  const value = (result as { result?: { value?: Record<string, number> } }).result?.value || {};
  return {
    usedJSHeapSize: Number(value.usedJSHeapSize) || 0,
    totalJSHeapSize: Number(value.totalJSHeapSize) || 0,
    jsHeapSizeLimit: Number(value.jsHeapSizeLimit) || 0,
  };
}
