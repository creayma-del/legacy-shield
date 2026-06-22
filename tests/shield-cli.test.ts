import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { existsSync, readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync, execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import http, { type Server } from 'node:http';
import { startBrowser } from '../lib/browser.js';
import type { Logger } from '../lib/types.js';

function hasPlaywrightChromium(): boolean {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

function createNoopLogger(): Logger {
  return {
    logRuntime: () => {},
    logNetwork: () => {},
    logBehavior: () => {},
    logQuality: () => {},
    close: async () => {},
  };
}

async function startStaticServer(dir: string): Promise<{ server: Server; port: number }> {
  return new Promise((resolveFn, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', `http://127.0.0.1`);
      const targetPath = join(dir, url.pathname);
      if (!existsSync(targetPath) || targetPath.indexOf(dir) !== 0) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      const content = readFileSync(targetPath);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(content);
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('unexpected server address'));
        return;
      }
      resolveFn({ server, port: address.port });
    });
  });
}

async function closeServer(server: Server): Promise<void> {
  return new Promise((resolveFn) => server.close(() => resolveFn()));
}

const chromiumAvailable = hasPlaywrightChromium() || !!process.env.PLAYWRIGHT_CHROMIUM_CHANNEL;

describe('shield CLI - redact-body-fields end-to-end injection (TC-11b)', () => {
  let browser: Browser | undefined;
  let tmpDir: string;
  let server: Server;
  let port: number;

  beforeAll(async () => {
    const cliPath = resolve('dist/cli.js');
    if (!existsSync(cliPath)) {
      execSync('pnpm build', { stdio: 'inherit' });
    }
    tmpDir = mkdtempSync(join(tmpdir(), 'shield-cli-test-'));
    writeFileSync(join(tmpDir, 'index.html'), '<!DOCTYPE html><html><body>shield cli test</body></html>');
    ({ server, port } = await startStaticServer(tmpDir));

    if (chromiumAvailable) {
      if (!hasPlaywrightChromium() && !process.env.PLAYWRIGHT_CHROMIUM_CHANNEL) {
        process.env.PLAYWRIGHT_CHROMIUM_CHANNEL = 'chrome';
      }
      browser = await chromium.launch({
        headless: true,
        channel: (process.env.PLAYWRIGHT_CHROMIUM_CHANNEL as 'chrome' | undefined) || undefined,
      });
    }
  }, 60000);

  afterAll(async () => {
    if (browser) {
      await browser.close();
    }
    await closeServer(server);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  (chromiumAvailable ? it : it.skip)('forwards --redact-body-fields to window.__SHIELD_REDACT_FIELDS__ via startBrowser', async () => {
    const handle = await startBrowser({
      startPage: `http://127.0.0.1:${port}/index.html`,
      headless: true,
      logger: createNoopLogger(),
      sessionId: 'shield-cli-test-with',
      skipProxy: true,
      skipInject: true, // 仅校验注入字段透传，不需要 inject.iife
      redactBodyFields: ['password', 'token'],
    });
    try {
      const fields = await handle.page.evaluate(() =>
        (window as unknown as { __SHIELD_REDACT_FIELDS__?: unknown }).__SHIELD_REDACT_FIELDS__,
      );
      expect(fields).toEqual(['password', 'token']);
    } finally {
      await handle.browser.close();
    }
  });

  (chromiumAvailable ? it : it.skip)('leaves window.__SHIELD_REDACT_FIELDS__ undefined when redactBodyFields is not provided', async () => {
    const handle = await startBrowser({
      startPage: `http://127.0.0.1:${port}/index.html`,
      headless: true,
      logger: createNoopLogger(),
      sessionId: 'shield-cli-test-without',
      skipProxy: true,
      skipInject: true,
      // 不传 redactBodyFields
    });
    try {
      const fields = await handle.page.evaluate(() =>
        (window as unknown as { __SHIELD_REDACT_FIELDS__?: unknown }).__SHIELD_REDACT_FIELDS__,
      );
      expect(fields).toBeUndefined();
    } finally {
      await handle.browser.close();
    }
  });
});

describe('shield CLI - help text regression (TC-16)', () => {
  beforeAll(() => {
    const cliPath = resolve('dist/cli.js');
    if (!existsSync(cliPath)) {
      execSync('pnpm build', { stdio: 'inherit' });
    }
  });

  it('does not expose enable-pinia / enable-vuex / disable-store options in shield --help', () => {
    const cliPath = resolve('dist/cli.js');
    const help = execFileSync('node', [cliPath, 'shield', '--help'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(help).not.toMatch(/--enable-pinia\b/);
    expect(help).not.toMatch(/--enable-vuex\b/);
    expect(help).not.toMatch(/--disable-store\b/);
  });
});
