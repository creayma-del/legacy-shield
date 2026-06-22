import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { startProxy } from '../proxy.js';
import { startBrowser } from '../browser.js';
import { createLogger } from '../logger.js';
import { assertLegacyProject, generateId } from '../utils.js';
import type { ShieldCommandOptions } from '../types.js';

export async function runShield(options: ShieldCommandOptions): Promise<void> {
  const {
    project,
    target,
    proxyPort,
    startPage,
    headless,
    noBody,
    insecure,
    redactBodyFields,
    sessionId,
    logRetentionDays,
    enableReactPatch,
  } = options;

  assertLegacyProject(project);

  const resolvedSessionId = sessionId || generateId();
  const logger = createLogger(project, resolvedSessionId, logRetentionDays);

  let proxy: Awaited<ReturnType<typeof startProxy>> | undefined;
  let browserHandle: Awaited<ReturnType<typeof startBrowser>> | undefined;
  let exiting = false;

  async function shutdown(exitCode: number): Promise<void> {
    if (exiting) return;
    exiting = true;

    try {
      if (browserHandle) {
        await browserHandle.browser.close();
      }
    } catch {
      // 忽略关闭错误
    }

    try {
      if (proxy) {
        proxy.proxy.close();
        await new Promise<void>((resolve) => {
          proxy!.server.close(() => resolve());
        });
      }
    } catch {
      // 忽略关闭错误
    }

    await logger.close();
    printSummary(project, resolvedSessionId);
    process.exit(exitCode);
  }

  process.once('SIGINT', () => shutdown(0));
  process.once('SIGTERM', () => shutdown(0));

  // eslint-disable-next-line no-console
  console.log('[legacy-shield] 监控会话启动中...');

  try {
    proxy = await startProxy({
      target,
      port: proxyPort,
      logger,
      noBody,
      insecure,
      redactBodyFields,
    });

    const startUrl = new URL(startPage, target).href;

    browserHandle = await startBrowser({
      proxyUrl: proxy.url,
      startPage: startUrl,
      headless,
      logger,
      sessionId: resolvedSessionId,
      enableReactPatch,
      redactBodyFields,
    });
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    await shutdown(1);
  }
}

function printSummary(project: string, sessionId: string): void {
  const baseDir = join(project, '.runtime-log-ignore');
  const counts: Record<string, number> = {};
  const paths: Record<string, string | null> = {};

  for (const type of ['runtime', 'network', 'behavior']) {
    const result = countLogLines(join(baseDir, type));
    counts[type] = result.count;
    paths[type] = result.path;
  }

  // eslint-disable-next-line no-console
  console.log('[legacy-shield] 监控会话结束');
  // eslint-disable-next-line no-console
  console.log(`- sessionId: ${sessionId}`);
  // eslint-disable-next-line no-console
  console.log(`- runtime 日志: ${counts.runtime} 条 -> ${paths.runtime ?? '无'}`);
  // eslint-disable-next-line no-console
  console.log(`- network 日志: ${counts.network} 条 -> ${paths.network ?? '无'}`);
  // eslint-disable-next-line no-console
  console.log(`- behavior 日志: ${counts.behavior} 条 -> ${paths.behavior ?? '无'}`);
}

function countLogLines(dir: string): { count: number; path: string | null } {
  try {
    const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
    if (files.length === 0) return { count: 0, path: null };
    const filePath = join(dir, files[0]);
    const content = readFileSync(filePath, 'utf8');
    const count = content.split('\n').filter(Boolean).length;
    return { count, path: filePath };
  } catch {
    return { count: 0, path: null };
  }
}
