import { describe, it, expect } from 'vitest';
import { startProxy } from '../../lib/proxy.js';
import { createLogger } from '../../lib/logger.js';
import http from 'node:http';
import { mkdtempSync, rmSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { today } from '../../lib/utils.js';

const CLI = resolve(process.cwd(), 'dist/cli.js');

/**
 * 安全关闭 HTTP server 与 proxy 资源。
 */
async function closeResources(
  proxy: Awaited<ReturnType<typeof startProxy>> | undefined,
  targetServer: http.Server | undefined,
): Promise<void> {
  if (proxy) {
    proxy.proxy.close();
    await new Promise<void>((resolve) => proxy.server.close(() => resolve()));
  }
  if (targetServer) {
    await new Promise<void>((resolve) => targetServer.close(() => resolve()));
  }
}

describe('performance', () => {
  it('proxy overhead is under 10ms for empty body', async () => {
    const logDir = mkdtempSync(join(tmpdir(), 'shield-perf-'));
    let proxy: Awaited<ReturnType<typeof startProxy>> | undefined;
    let targetServer: http.Server | undefined;
    let logger: ReturnType<typeof createLogger> | undefined;

    try {
      logger = createLogger(logDir, 'perf');
      targetServer = http.createServer((_req, res) => res.end('ok'));
      await new Promise<void>((r) => targetServer!.listen(0, r));
      const targetPort = (targetServer.address() as { port: number }).port;
      const targetUrl = `http://localhost:${targetPort}`;

      // 先采集直接请求耗时作为基线，避免把本地网络/系统波动计入代理开销
      const directSamples: number[] = [];
      for (let i = 0; i < 20; i++) {
        const t0 = performance.now();
        await fetch(`${targetUrl}/`);
        const t1 = performance.now();
        directSamples.push(t1 - t0);
      }
      const directAvg = directSamples.reduce((a, b) => a + b, 0) / directSamples.length;

      proxy = await startProxy({
        target: targetUrl,
        port: 0,
        logger,
      });

      // warmup
      await fetch(`${proxy.url}/`);

      const proxySamples: number[] = [];
      for (let i = 0; i < 20; i++) {
        const t0 = performance.now();
        await fetch(`${proxy.url}/`);
        const t1 = performance.now();
        proxySamples.push(t1 - t0);
      }
      const proxyAvg = proxySamples.reduce((a, b) => a + b, 0) / proxySamples.length;
      expect(proxyAvg - directAvg).toBeLessThan(10); // 目标 <5ms，包含本地测试波动
    } finally {
      await closeResources(proxy, targetServer);
      await logger?.close();
      rmSync(logDir, { recursive: true, force: true });
    }
  });

  it('truncates large request body at 64KB', async () => {
    const logDir = mkdtempSync(join(tmpdir(), 'shield-perf-body-'));
    let proxy: Awaited<ReturnType<typeof startProxy>> | undefined;
    let targetServer: http.Server | undefined;
    let logger: ReturnType<typeof createLogger> | undefined;

    try {
      logger = createLogger(logDir, 'perf-body');
      targetServer = http.createServer((_req, res) => res.end('ok'));
      await new Promise<void>((r) => targetServer!.listen(0, r));
      const targetPort = (targetServer.address() as { port: number }).port;
      proxy = await startProxy({
        target: `http://localhost:${targetPort}`,
        port: 0,
        logger,
      });

      const bigBody = 'x'.repeat(100 * 1024);
      await fetch(`${proxy.url}/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: bigBody,
      });
      await logger.close();

      const networkDir = join(logDir, '.runtime-log-ignore', 'network');
      const files = readdirSync(networkDir);
      expect(files.length).toBeGreaterThan(0);
      const line = readFileSync(join(networkDir, files[0]), 'utf8').split('\n').find(Boolean);
      expect(line).toBeTruthy();
      const record = JSON.parse(line as string) as { request: { bodyTruncated: boolean } };
      expect(record.request.bodyTruncated).toBe(true);
    } finally {
      await closeResources(proxy, targetServer);
      await logger?.close();
      rmSync(logDir, { recursive: true, force: true });
    }
  });

  it('generates report within 5s for 100k logs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'shield-perf-report-'));
    try {
      const base = join(dir, '.runtime-log-ignore');
      mkdirSync(join(base, 'runtime'), { recursive: true });
      const date = today();
      const lines: string[] = [];
      for (let i = 0; i < 100000; i++) {
        lines.push(
          JSON.stringify({
            type: 'runtime',
            subType: 'js-error',
            errorId: 'e1',
            sessionId: 's1',
            timestamp: '2026-06-17T10:00:00.000Z',
            level: 'error',
            message: 'x',
            url: '/',
            userAgent: 'perf-test',
          }),
        );
      }
      writeFileSync(join(base, 'runtime', `${date}.jsonl`), lines.join('\n'));

      const t0 = performance.now();
      spawnSync('node', [CLI, 'report', '--project', dir, '--format', 'json'], { encoding: 'utf8' });
      const elapsed = performance.now() - t0;

      expect(elapsed).toBeLessThan(5000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
