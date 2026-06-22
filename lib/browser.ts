import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { StartBrowserOptions } from './types.js';

export interface BrowserHandle {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

const RESOURCE_ERROR_DEDUP_MS = 1000;

export async function startBrowser(options: StartBrowserOptions): Promise<BrowserHandle> {
  const {
    proxyUrl,
    startPage,
    headless,
    logger,
    sessionId,
    enableReactPatch = false,
    skipInject = false,
    skipProxy = false,
    viewport = { width: 1440, height: 900 },
    userAgent = 'legacy-shield/1.0',
    redactBodyFields,
  } = options;

  let browser: Browser;
  try {
    browser = await chromium.launch({
      headless,
      proxy: skipProxy ? undefined : { server: proxyUrl ?? 'direct://' },
      channel: (process.env.PLAYWRIGHT_CHROMIUM_CHANNEL as 'chrome' | undefined) || undefined,
    });
  } catch (err) {
    throw new Error(
      `浏览器启动失败: ${err instanceof Error ? err.message : String(err)}。请运行: npx playwright install chromium`,
    );
  }

  const context = await browser.newContext({
    viewport,
    userAgent,
  });
  const page = await context.newPage();

  await page.addInitScript({
    content: `window.__SHIELD_SESSION_ID__ = ${JSON.stringify(sessionId)};`,
  });
  if (enableReactPatch) {
    await page.addInitScript({
      content: `window.__SHIELD_ENABLE_REACT_PATCH__ = ${JSON.stringify(enableReactPatch)};`,
    });
  }
  if (redactBodyFields?.length) {
    await page.addInitScript({
      content: `window.__SHIELD_REDACT_FIELDS__ = ${JSON.stringify(redactBodyFields)};`,
    });
  }

  const recentResourceErrors = new Map<string, number>();

  await page.exposeFunction(
    '__shield_emit__',
    (event: { type: string; subType: string; detail: Record<string, unknown>; level?: string }) => {
      if (event.type === 'runtime') {
        logger.logRuntime(event.subType as never, event.detail, event.level as never);
      } else if (event.type === 'behavior') {
        logger.logBehavior(event.detail);
      }
    },
  );

  if (!skipInject) {
    const injectScriptPath = fileURLToPath(new URL('inject.iife.js', import.meta.url));
    const injectScriptContent = readFileSync(injectScriptPath, 'utf8');
    await page.addInitScript({ content: injectScriptContent });
  }

  page.on('pageerror', (err) => {
    logger.logRuntime(
      'js-error',
      {
        message: err.message,
        stack: err.stack,
        source: 'browser-pageerror',
        url: startPage,
        context: { note: '兜底来源，可能已在 inject.iife.js 中重复记录，analyzer 层需按 errorId + 1 秒窗口去重' },
      },
      'error',
    );
  });

  page.on('requestfailed', (req) => {
    const url = req.url();
    const now = Date.now();
    const last = recentResourceErrors.get(url);
    if (last && now - last < RESOURCE_ERROR_DEDUP_MS) return;
    recentResourceErrors.set(url, now);
    logger.logRuntime(
      'resource-error',
      {
        url,
        failureText: req.failure()?.errorText || '',
        source: 'browser-requestfailed',
      },
      'error',
    );
  });

  await page.goto(startPage, { timeout: 30000 });
  return { browser, context, page };
}
