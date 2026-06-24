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

describeIfChromium('vuex monitor', () => {
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
        detail: event.detail,
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
      await page.waitForTimeout(3000);
      return logs;
    } finally {
      await page.close();
      await context.close();
      await closeServer(server);
    }
  }

  it('TC-4: captures vuex action sync error with stage=action', async () => {
    const logs = await runFixture('vue-vuex-error.html', async (page) => {
      await page.click('#trigger-action-sync');
      await page.waitForTimeout(500);
    });
    const vuexErrors = logs.filter((l) => l.subType === 'vuex-error');
    expect(vuexErrors.length).toBeGreaterThan(0);
    const first = vuexErrors[0];
    expect(first.level).toBe('error');
    const ctx = first.context as Record<string, unknown>;
    expect(ctx.stage).toBe('action');
  });

  it('TC-5: captures vuex action async error', async () => {
    const logs = await runFixture('vue-vuex-error.html', async (page) => {
      await page.click('#trigger-action-async');
      await page.waitForTimeout(500);
    });
    const vuexErrors = logs.filter((l) => l.subType === 'vuex-error');
    expect(vuexErrors.length).toBeGreaterThan(0);
    const ctx = vuexErrors[0].context as Record<string, unknown>;
    // 异步 action 抛错会同时被 dispatch 包装的 .catch 与 subscribeAction.error 触发；
    // inject.iife 通过 __shield_emitted__ 在二者中去重保留先到达的一条，
    // Vuex 4 实际顺序为 subscribeAction 先于 dispatch.catch，故 stage 可能为
    // 'subscribeAction' 或 'action'（视实现链路顺序而定），两者均反映「异步 action 抛错」语义。
    expect(['action', 'subscribeAction']).toContain(ctx.stage);
  });

  it('TC-6: captures vuex mutation error with stage=mutation', async () => {
    const logs = await runFixture('vue-vuex-error.html', async (page) => {
      await page.click('#trigger-mutation');
      await page.waitForTimeout(500);
    });
    const vuexErrors = logs.filter((l) => l.subType === 'vuex-error');
    expect(vuexErrors.length).toBeGreaterThan(0);
    const mutation = vuexErrors.find((l) => {
      const ctx = l.context as Record<string, unknown> | undefined;
      return ctx?.stage === 'mutation';
    });
    expect(mutation).toBeDefined();
  });

  it('TC-7: captures vuex subscribeAction onError with stage=subscribeAction', async () => {
    const logs = await runFixture('vue-vuex-error.html', async (page) => {
      await page.click('#trigger-subscribe-action');
      await page.waitForTimeout(500);
    });
    const vuexErrors = logs.filter((l) => l.subType === 'vuex-error');
    expect(vuexErrors.length).toBeGreaterThan(0);
    const subAction = vuexErrors.find((l) => {
      const ctx = l.context as Record<string, unknown> | undefined;
      return ctx?.stage === 'subscribeAction';
    });
    expect(subAction).toBeDefined();
  });

  // TC-8 / TC-8a1：Vuex 4 strict 模式通过 store._withCommit 内部 watch state，违规由
  // watcher 异步抛错触发；这条抛错路径不会传播回 store.commit 同步包装层。
  // v1.6 已通过 errorHandler 协同补强：patchErrorHandler 中先调用业务 handler，
  // 再调用 tryEmitVuexStrictViolation 识别 strict 违规消息并关联 strict store，
  // emit vuex-strict-violation（source: 'vuex-strict-errorhandler'）。
  it('TC-8: strict violation by mutating state outside mutation', async () => {
    const logs = await runFixture('vue-vuex-strict.html', async (page) => {
      await page.click('#trigger-strict');
      await page.waitForTimeout(1500);
    });
    const strictViolations = logs.filter((l) => l.subType === 'vuex-strict-violation');
    expect(strictViolations.length).toBeGreaterThan(0);
    const first = strictViolations[0];
    expect(first.level).toBe('error');
  });

  it('TC-8a1: strict violation after legal mutation provides non-empty mutatedKeyPath', async () => {
    const logs = await runFixture('vue-vuex-strict.html', async (page) => {
      await page.click('#trigger-strict-after-mutation');
      await page.waitForTimeout(1500);
    });
    const strictViolations = logs.filter((l) => l.subType === 'vuex-strict-violation');
    expect(strictViolations.length).toBeGreaterThan(0);
    const ctx = strictViolations[0].context as Record<string, unknown>;
    expect(typeof ctx.mutatedKeyPath).toBe('string');
    expect((ctx.mutatedKeyPath as string).length).toBeGreaterThan(0);
  });

  it('TC-8b: non-strict store emits no vuex-strict-violation entries', async () => {
    const logs = await runFixture('vue-vuex-error.html', async (page) => {
      // 触发各种错误场景，均不应产生 strict 违规
      await page.click('#trigger-action-sync');
      await page.waitForTimeout(200);
      await page.click('#trigger-action-async');
      await page.waitForTimeout(200);
      await page.click('#trigger-mutation');
      await page.waitForTimeout(200);
    });
    const strictViolations = logs.filter((l) => l.subType === 'vuex-strict-violation');
    expect(strictViolations.length).toBe(0);
  });

  // TC-RES-22：PATCH-T2 直接 watcher 异常路径验证
  // store.strict !== true 时不注册 watcher，state 直接修改不产生 vuex-strict-violation，
  // 但 dispatch/commit 监控仍正常工作。
  it('TC-RES-22: non-strict store 不注册 watcher，state 直接修改不产生 vuex-strict-violation', async () => {
    const logs = await runFixture('vue-vuex-error.html', async (page) => {
      // 1. 验证 store.strict !== true 并直接修改 state（outside mutation handler）
      const strictValue = await page.evaluate(() => {
        const el = document.querySelector('#app') as Element & { __vue_app__?: unknown };
        const app = el.__vue_app__ as {
          config: { globalProperties: { $store: { strict: unknown; state: Record<string, Record<string, unknown>> } } };
        };
        const store = app.config.globalProperties.$store;
        // 直接修改 state（outside mutation handler）
        store.state.user.name = 'hacked';
        return store.strict;
      });
      expect(strictValue).not.toBe(true);
      await page.waitForTimeout(500);

      // 2. 触发 dispatch error，验证 vuex-error 监控仍正常工作
      await page.click('#trigger-action-sync');
      await page.waitForTimeout(500);
    });

    // 不应产生 vuex-strict-violation（store.strict !== true → watcher 未注册）
    const strictViolations = logs.filter((l) => l.subType === 'vuex-strict-violation');
    expect(strictViolations.length).toBe(0);

    // 应产生 vuex-error（dispatch/commit 监控不受影响）
    const vuexErrors = logs.filter((l) => l.subType === 'vuex-error');
    expect(vuexErrors.length).toBeGreaterThan(0);
  });
});
