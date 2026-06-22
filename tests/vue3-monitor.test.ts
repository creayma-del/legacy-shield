import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { readFileSync, existsSync } from 'node:fs';
import http, { type Server } from 'node:http';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';

interface RuntimeLog {
  type: string;
  subType: string;
  level: string;
  sessionId: string;
  message?: string;
  source?: string;
  context?: Record<string, unknown>;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function hasPlaywrightChromium(): boolean {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

async function startFixtureServer(fixturePath: string): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', `http://127.0.0.1`);
      const targetPath = join(fixturePath, url.pathname);
      if (!existsSync(targetPath) || targetPath.indexOf(fixturePath) !== 0) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      const content = readFileSync(targetPath);
      const ext = targetPath.split('.').pop();
      const contentType =
        ext === 'js' ? 'application/javascript' :
        ext === 'html' ? 'text/html' :
        ext === 'css' ? 'text/css' :
        'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    });

    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('unexpected server address'));
        return;
      }
      resolve({ server, port: address.port });
    });
  });
}

async function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe('vue3 monitor', () => {
  let browser: Browser;
  let fixtureDir: string;

  beforeAll(async () => {
    fixtureDir = resolve('tests/fixtures/vue3');

    const cliPath = resolve('dist/cli.js');
    if (!existsSync(cliPath)) {
      execSync('pnpm build', { stdio: 'inherit' });
    }

    if (!hasPlaywrightChromium() && !process.env.PLAYWRIGHT_CHROMIUM_CHANNEL) {
      process.env.PLAYWRIGHT_CHROMIUM_CHANNEL = 'chrome';
    }

    browser = await chromium.launch({
      headless: true,
      channel: (process.env.PLAYWRIGHT_CHROMIUM_CHANNEL as 'chrome' | undefined) || undefined,
    });
  }, 60000);

  afterAll(async () => {
    if (browser) {
      await browser.close();
    }
  });

  async function runFixture(
    pageName: string,
    action?: (page: Page) => Promise<void>,
  ): Promise<RuntimeLog[]> {
    const sessionId = generateId();
    const { server, port } = await startFixtureServer(fixtureDir);
    const logs: RuntimeLog[] = [];
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on('console', (msg) => {
      // eslint-disable-next-line no-console
      console.log(`[page console] ${pageName}:`, msg.text());
    });

    await page.exposeFunction('__shield_emit__', (event: { type: string; subType: string; detail: Record<string, unknown>; level?: string }) => {
      logs.push({
        type: event.type,
        subType: event.subType,
        level: event.level || 'info',
        sessionId: (event.detail.sessionId as string) || 'unknown',
        message: event.detail.message as string,
        source: event.detail.source as string,
        context: event.detail.context as Record<string, unknown>,
      });
    });
    await page.addInitScript({
      content: `window.__SHIELD_SESSION_ID__ = ${JSON.stringify(sessionId)};`,
    });
    await page.addInitScript({
      content: `window.__SHIELD_ENABLE_REACT_PATCH__ = false;`,
    });

    const injectScriptPath = resolve('dist/lib/inject.iife.js');
    const injectScriptContent = readFileSync(injectScriptPath, 'utf8');
    await page.addInitScript({ content: injectScriptContent });

    try {
      await page.goto(`http://127.0.0.1:${port}/${pageName}`, { timeout: 30000 });
      if (action) {
        await action(page);
      }
      // 等待 Vue 模块加载、错误处理与日志发射
      await page.waitForTimeout(3000);
      const debug = await page.evaluate(() => {
        const w = window as unknown as Record<string, unknown>;
        const vue = w.Vue as Record<string, unknown> | undefined;
        const createApp = vue?.createApp as ((options: unknown) => Record<string, unknown>) | undefined;
        let appPatched = false;
        try {
          const testApp = createApp?.({ render: () => null });
          appPatched = !!testApp?.__shield_patched__;
        } catch {
          // ignore
        }
        return {
          shieldInjected: !!w.__SHIELD_INJECTED__,
          hasVue: !!vue,
          vuePatched: !!vue?.__shield_patched__,
          appPatched,
          emitExists: typeof w.__shield_emit__ === 'function',
        };
      });
      // eslint-disable-next-line no-console
      console.log(`[vue3-monitor debug] ${pageName}:`, debug);
      return logs;
    } finally {
      await page.close();
      await context.close();
      await closeServer(server);
    }
  }

  it('captures initial Vue 3 app render error', async () => {
    const logs = await runFixture('vue-render-error.html');
    const errorLogs = logs.filter((l) => l.subType === 'vue-render-error');
    expect(errorLogs.length).toBeGreaterThan(0);
    expect(errorLogs[0].level).toBe('error');
    expect(errorLogs[0].message).toContain('initial render error');
  });

  it('captures dynamically created Vue 3 app error', async () => {
    const logs = await runFixture('vue-dynamic-app.html', async (page) => {
      await page.click('#create');
      await page.waitForTimeout(300);
    });
    const errorLogs = logs.filter((l) => l.subType === 'vue-render-error');
    expect(errorLogs.length).toBeGreaterThan(0);
    expect(errorLogs[0].level).toBe('error');
    expect(errorLogs[0].message).toContain('dynamic app render error');
  });

  it('captures Vue 3 runtime warning', async () => {
    const logs = await runFixture('vue-warn.html');
    const warnLogs = logs.filter((l) => l.subType === 'vue-warn');
    expect(warnLogs.length).toBeGreaterThan(0);
    expect(warnLogs[0].level).toBe('warn');
  });

  it('captures router onError', async () => {
    const logs = await runFixture('vue-router-error.html');
    const errorLogs = logs.filter((l) => l.subType === 'vue-router-error');
    expect(errorLogs.length).toBeGreaterThan(0);
    expect(errorLogs[0].level).toBe('error');
    expect(errorLogs[0].message).toContain('navigation rejected');
  });

  it('captures guard thrown error', async () => {
    const logs = await runFixture('vue-router-guard.html');
    const errorLogs = logs.filter((l) => l.subType === 'vue-router-error');
    expect(errorLogs.length).toBeGreaterThan(0);
    expect(errorLogs[0].level).toBe('error');
    expect(errorLogs[0].message).toContain('guard thrown error');
  });

  it('captures lazy route component failure', async () => {
    const logs = await runFixture('vue-router-lazy.html');
    const errorLogs = logs.filter((l) => l.subType === 'vue-router-error');
    expect(errorLogs.length).toBeGreaterThan(0);
    expect(errorLogs[0].level).toBe('error');
    expect(errorLogs[0].message).toContain('lazy load failed');
  });

  it('does not break plain page console capture', async () => {
    const logs = await runFixture('plain.html', async (page) => {
      await page.click('#btn');
      await page.waitForTimeout(200);
    });
    const consoleLogs = logs.filter((l) => l.subType === 'console-error');
    expect(consoleLogs.length).toBeGreaterThan(0);
    expect(consoleLogs[0].message).toContain('plain error');
    expect(logs.some((l) => l.subType === 'vue-render-error' || l.subType === 'vue-router-error')).toBe(false);
  });
});
