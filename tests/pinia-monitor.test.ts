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
  detail?: Record<string, unknown>;
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

const chromiumAvailable = hasPlaywrightChromium() || !!process.env.PLAYWRIGHT_CHROMIUM_CHANNEL;
const describeIfChromium = chromiumAvailable ? describe : describe.skip;

describeIfChromium('pinia monitor', () => {
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
    options?: { redactFields?: string[] },
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
        detail: event.detail,
      });
    });
    await page.addInitScript({
      content: `window.__SHIELD_SESSION_ID__ = ${JSON.stringify(sessionId)};`,
    });
    await page.addInitScript({
      content: `window.__SHIELD_ENABLE_REACT_PATCH__ = false;`,
    });
    if (options?.redactFields?.length) {
      // 模拟 browser.ts 真实注入链路：在 inject.iife 之前写入脱敏字段名单
      await page.addInitScript({
        content: `window.__SHIELD_REDACT_FIELDS__ = ${JSON.stringify(options.redactFields)};`,
      });
    }

    const injectScriptPath = resolve('dist/lib/inject.iife.js');
    const injectScriptContent = readFileSync(injectScriptPath, 'utf8');
    await page.addInitScript({ content: injectScriptContent });

    try {
      await page.goto(`http://127.0.0.1:${port}/${pageName}`, { timeout: 30000 });
      if (action) {
        await action(page);
      }
      await page.waitForTimeout(3000);
      return logs;
    } finally {
      await page.close();
      await context.close();
      await closeServer(server);
    }
  }

  it('TC-1: captures pinia sync action error', async () => {
    const logs = await runFixture('vue-pinia-error.html', async (page) => {
      await page.click('#trigger-sync');
      await page.waitForTimeout(500);
    });
    const piniaErrors = logs.filter((l) => l.subType === 'pinia-error');
    expect(piniaErrors.length).toBeGreaterThan(0);
    const first = piniaErrors[0];
    expect(first.level).toBe('error');
    const ctx = first.context as Record<string, unknown>;
    expect(ctx.storeId).toBe('user');
    expect(ctx.actionName).toBe('causeSyncError');
    expect(Array.isArray(ctx.stateKeys)).toBe(true);
    expect(ctx.stateKeys).toEqual(expect.arrayContaining(['name', 'age']));
    // detail.stack 字段存在（允许空字符串）
    expect(first.detail).toBeDefined();
    expect('stack' in (first.detail as Record<string, unknown>)).toBe(true);
  });

  it('TC-2: captures pinia async action error', async () => {
    const logs = await runFixture('vue-pinia-error.html', async (page) => {
      await page.click('#trigger-async');
      await page.waitForTimeout(500);
    });
    const piniaErrors = logs.filter((l) => l.subType === 'pinia-error');
    expect(piniaErrors.length).toBeGreaterThan(0);
    const first = piniaErrors[0];
    const ctx = first.context as Record<string, unknown>;
    expect(ctx.storeId).toBe('user');
    expect(ctx.actionName).toBe('causeAsyncError');
    expect(ctx.stateKeys).toEqual(expect.arrayContaining(['name', 'age']));
    expect('stack' in (first.detail as Record<string, unknown>)).toBe(true);
  });

  // TC-3 设计意图：通过包装 pinia.use(plugin) 在插件 install 阶段抛错时落盘 pinia-plugin-error。
  // 实际 Pinia 2.x 中 `pinia.use(plugin)` 只把插件 push 到内部数组，插件的 install 是在
  // store 首次实例化时由 Pinia 在 store 工厂内部遍历调用，错误会冒泡到 `useXxxStore()` 调用点。
  // v1.6 已通过 _p 数组包装补强：patchPinia 遍历 pinia._p 数组，逐个包装 plugin function
  // （含 function 形态与对象 install 形态）为 try/catch，使 plugin install 阶段抛错能被
  // shield 捕获并落盘为 pinia-plugin-error。
  it('TC-3: captures pinia plugin install error', async () => {
    const logs = await runFixture('vue-pinia-plugin-error.html', async (page) => {
      await page.evaluate(() => {
        const pinia = (window as unknown as { Pinia: { defineStore: (id: string, opts: unknown) => () => unknown } }).Pinia;
        const useFooStore = pinia.defineStore('foo', { state: () => ({ n: 0 }) });
        try {
          useFooStore();
        } catch {
          // plugin install 抛错由 shield _p 数组包装捕获并落盘为 pinia-plugin-error
        }
      });
      await page.waitForTimeout(500);
    });
    const pluginErrors = logs.filter((l) => l.subType === 'pinia-plugin-error');
    expect(pluginErrors.length).toBeGreaterThan(0);
    const first = pluginErrors[0];
    expect(first.level).toBe('error');
    const ctx = first.context as Record<string, unknown>;
    // pluginName 字段可选；存在时类型应为 string，不存在则为 undefined
    expect(['string', 'undefined']).toContain(typeof ctx.pluginName);
  });

  it('TC-11: redacts password field in pinia action args', async () => {
    const logs = await runFixture(
      'vue-pinia-error.html',
      async (page) => {
        await page.click('#trigger-password');
        await page.waitForTimeout(500);
      },
      { redactFields: ['password', 'token'] },
    );
    const piniaErrors = logs.filter((l) => l.subType === 'pinia-error');
    expect(piniaErrors.length).toBeGreaterThan(0);
    const first = piniaErrors[0];
    const ctx = first.context as Record<string, unknown>;
    const args = ctx.args as unknown[];
    expect(Array.isArray(args)).toBe(true);
    expect(args.length).toBeGreaterThan(0);
    const firstArg = args[0] as Record<string, unknown>;
    expect(firstArg.password).toBe('[REDACTED]');
  });

  it('TC-11a: redacts token field inside array args', async () => {
    const logs = await runFixture(
      'vue-pinia-error.html',
      async (page) => {
        await page.click('#trigger-token-array');
        await page.waitForTimeout(500);
      },
      { redactFields: ['password', 'token'] },
    );
    const piniaErrors = logs.filter((l) => l.subType === 'pinia-error');
    expect(piniaErrors.length).toBeGreaterThan(0);
    const first = piniaErrors[0];
    const ctx = first.context as Record<string, unknown>;
    const args = ctx.args as unknown[];
    expect(Array.isArray(args)).toBe(true);
    expect(args.length).toBeGreaterThan(0);
    // args[0] 是数组 [{ token: 'secret-token' }]
    const firstArg = args[0] as unknown[];
    expect(Array.isArray(firstArg)).toBe(true);
    const inner = firstArg[0] as Record<string, unknown>;
    expect(inner.token).toBe('[REDACTED]');
  });

  it('TC-15: captures dynamically registered store action error', async () => {
    const logs = await runFixture('vue-pinia-error.html', async (page) => {
      await page.click('#trigger-dynamic');
      await page.waitForTimeout(500);
    });
    const piniaErrors = logs.filter((l) => l.subType === 'pinia-error');
    expect(piniaErrors.length).toBeGreaterThan(0);
    // 动态注册的 store id === 'order'
    const orderError = piniaErrors.find((l) => {
      const ctx = l.context as Record<string, unknown> | undefined;
      return ctx?.storeId === 'order';
    });
    expect(orderError).toBeDefined();
    expect((orderError!.context as Record<string, unknown>).actionName).toBe('failOnDemand');
  });

  // TC-RES-21：pinia._p 为 undefined / 非数组时静默跳过 plugin 包装（T1 异常路径验证）
  it('TC-RES-21: pinia._p 不存在时静默跳过', async () => {
    const logs = await runFixture('vue-pinia-error.html', async (page) => {
      await page.evaluate(() => {
        const vue = (window as unknown as {
          Vue: { createApp: (opts: unknown) => { use: (plugin: unknown) => void; mount: (el: Element) => unknown } };
        }).Vue;
        const app = vue.createApp({});
        // mock 对象有 install 和 _s 但 _p 为 undefined（非数组）
        const mockPinia = {
          install: () => {},
          _s: new Map(),
          _p: undefined,
        };
        // shield patched use 应识别 _p 非数组后静默跳过，不抛异常
        app.use(mockPinia);
        app.mount(document.createElement('div'));
      });
      await page.waitForTimeout(500);
    });
    // 不应产生 pinia-plugin-error（_p 为 undefined 时跳过 plugin 包装）
    const pluginErrors = logs.filter((l) => l.subType === 'pinia-plugin-error');
    expect(pluginErrors.length).toBe(0);
  });
});
