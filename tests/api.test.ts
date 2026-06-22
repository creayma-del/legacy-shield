import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startApiServer } from '../lib/api.js';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('api', () => {
  let dir: string;
  let server: ReturnType<typeof startApiServer>;
  let port: number;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'shield-api-'));
    const base = join(dir, '.runtime-log-ignore');
    ['runtime', 'network', 'behavior', 'quality'].forEach((t) =>
      mkdirSync(join(base, t), { recursive: true }),
    );
    writeFileSync(
      join(base, 'runtime', '2026-06-17.jsonl'),
      JSON.stringify({
        type: 'runtime',
        subType: 'js-error',
        errorId: 'e1',
        sessionId: 's1',
        timestamp: '2026-06-17T10:00:00.000Z',
        level: 'error',
        message: 'x',
        url: '/',
        userAgent: 'test',
      }),
    );
    server = startApiServer({ projectPath: dir, port: 0 });
    await new Promise<void>((resolve) => server.on('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('unexpected server address');
    }
    port = address.port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  });

  it('GET /health returns ok', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { ok: boolean; project: string };
    expect(data.ok).toBe(true);
  });

  it('GET /logs returns runtime logs', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/logs?type=runtime&date=2026-06-17`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { count: number };
    expect(data.count).toBe(1);
  });

  it('GET /report returns json report', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/report?format=json&date=2026-06-17`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { format: string; report: { summary: unknown } };
    expect(data.format).toBe('json');
    expect(data.report.summary).toBeDefined();
  });

  it('GET /errors/top returns errors', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/errors/top?limit=10&date=2026-06-17`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { errors: unknown[] };
    expect(data.errors.length).toBe(1);
  });

  it('GET /timeline returns timeline', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/timeline?date=2026-06-17`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { count: number; timeline: unknown[] };
    expect(data.count).toBe(0);
    expect(Array.isArray(data.timeline)).toBe(true);
  });

  it('POST /suggest returns prompt with date', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/suggest?date=2026-06-17`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ errorId: 'e1' }),
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { errorId: string; date: string; prompt: string };
    expect(data.errorId).toBe('e1');
    expect(data.date).toBe('2026-06-17');
    expect(data.prompt).toContain('错误类型');
  });

  it('POST /suggest supports vue-render-error and vue-router-error', async () => {
    const runtimeFile = join(dir, '.runtime-log-ignore', 'runtime', '2026-06-17.jsonl');
    writeFileSync(
      runtimeFile,
      `\n${[
        JSON.stringify({
          type: 'runtime',
          subType: 'vue-render-error',
          errorId: 'vue-e1',
          sessionId: 's1',
          timestamp: '2026-06-17T10:00:00.000Z',
          level: 'error',
          message: 'vue render error',
          url: '/vue',
          userAgent: 'test',
        }),
        JSON.stringify({
          type: 'runtime',
          subType: 'vue-router-error',
          errorId: 'router-e1',
          sessionId: 's1',
          timestamp: '2026-06-17T10:00:01.000Z',
          level: 'error',
          message: 'vue router error',
          url: '/vue-router',
          userAgent: 'test',
        }),
      ].join('\n')}`,
      { flag: 'a' },
    );

    const renderRes = await fetch(`http://127.0.0.1:${port}/suggest?date=2026-06-17`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ errorId: 'vue-e1' }),
    });
    expect(renderRes.status).toBe(200);
    const renderData = (await renderRes.json()) as { errorId: string; prompt: string };
    expect(renderData.errorId).toBe('vue-e1');
    expect(renderData.prompt).toContain('vue-render-error');

    const routerRes = await fetch(`http://127.0.0.1:${port}/suggest?date=2026-06-17`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ errorId: 'router-e1' }),
    });
    expect(routerRes.status).toBe(200);
    const routerData = (await routerRes.json()) as { errorId: string; prompt: string };
    expect(routerData.errorId).toBe('router-e1');
    expect(routerData.prompt).toContain('vue-router-error');
  });

  it('GET /logs with invalid type returns 400', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/logs?type=invalid&date=2026-06-17`);
    expect(res.status).toBe(400);
    const data = (await res.json()) as { error: string };
    expect(data.error).toContain('invalid type');
  });

  it('GET /logs with invalid date returns 400', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/logs?type=runtime&date=bad-date`);
    expect(res.status).toBe(400);
    const data = (await res.json()) as { error: string };
    expect(data.error).toContain('invalid date');
  });

  it('POST /suggest with unknown errorId returns 404', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/suggest?date=2026-06-17`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ errorId: 'not-exist' }),
    });
    expect(res.status).toBe(404);
    const data = (await res.json()) as { error: string };
    expect(data.error).toContain('errorId not found');
  });

  it('POST /suggest with oversized body returns 413', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/suggest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'x'.repeat(1024 * 1024 + 1),
    });
    expect(res.status).toBe(413);
    const data = (await res.json()) as { error: string };
    expect(data.error).toContain('request entity too large');
  });

  it('OPTIONS request returns 204 when cors enabled', async () => {
    const corsDir = mkdtempSync(join(tmpdir(), 'shield-api-cors-'));
    const base = join(corsDir, '.runtime-log-ignore');
    ['runtime', 'network', 'behavior', 'quality'].forEach((t) =>
      mkdirSync(join(base, t), { recursive: true }),
    );
    const corsServer = startApiServer({ projectPath: corsDir, port: 0, cors: true });
    await new Promise<void>((resolve) => corsServer.on('listening', resolve));
    const address = corsServer.address();
    if (!address || typeof address === 'string') {
      throw new Error('unexpected server address');
    }
    const corsPort = address.port;
    const res = await fetch(`http://127.0.0.1:${corsPort}/health`, { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    await new Promise<void>((resolve) => corsServer.close(() => resolve()));
    rmSync(corsDir, { recursive: true, force: true });
  });

  it('OPTIONS request returns 404 when cors disabled', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { method: 'OPTIONS' });
    expect(res.status).toBe(404);
    const data = (await res.json()) as { error: string };
    expect(data.error).toContain('not found');
  });

  it('GET /logs filters malformed log lines with warnings', async () => {
    const malformedDir = mkdtempSync(join(tmpdir(), 'shield-api-malformed-'));
    const base = join(malformedDir, '.runtime-log-ignore');
    ['runtime', 'network', 'behavior', 'quality'].forEach((t) =>
      mkdirSync(join(base, t), { recursive: true }),
    );
    writeFileSync(
      join(base, 'runtime', '2026-06-17.jsonl'),
      [
        JSON.stringify({
          type: 'runtime',
          subType: 'js-error',
          errorId: 'e1',
          sessionId: 's1',
          timestamp: '2026-06-17T10:00:00.000Z',
          level: 'error',
          message: 'x',
          url: '/',
          userAgent: 'test',
        }),
        'not-a-json-line',
        JSON.stringify({ type: 'runtime', timestamp: '2026-06-17T10:00:01.000Z' }),
      ].join('\n'),
    );
    const mServer = startApiServer({ projectPath: malformedDir, port: 0 });
    await new Promise<void>((resolve) => mServer.on('listening', resolve));
    const address = mServer.address();
    if (!address || typeof address === 'string') {
      throw new Error('unexpected server address');
    }
    const mPort = address.port;
    const res = await fetch(`http://127.0.0.1:${mPort}/logs?type=runtime&date=2026-06-17`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { count: number };
    // 第一行是完整 runtime 日志，第二行解析失败被跳过，第三行缺少必填字段被 analyzer 过滤
    // /logs 端点不执行类型过滤，因此返回 2 条解析成功的 JSON 记录
    expect(data.count).toBe(2);
    await new Promise<void>((resolve) => mServer.close(() => resolve()));
    rmSync(malformedDir, { recursive: true, force: true });
  });
});

describe('api v1.4 new subtypes', () => {
  let dir: string;
  let server: ReturnType<typeof startApiServer>;
  let port: number;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'shield-api-v14-'));
    const base = join(dir, '.runtime-log-ignore');
    ['runtime', 'network', 'behavior', 'quality'].forEach((t) =>
      mkdirSync(join(base, t), { recursive: true }),
    );
    // 预置 4 个新子类型 + 1 个回归用 js-error，每条带独立 errorId 与不同 1 秒窗口
    const lines = [
      JSON.stringify({
        type: 'runtime',
        subType: 'js-error',
        errorId: 'js-eid-1',
        sessionId: 's1',
        timestamp: '2026-06-17T10:00:00.000Z',
        level: 'error',
        message: 'legacy js error',
        url: '/',
        userAgent: 'test',
        stack: 'at legacy.js:1:1',
      }),
      JSON.stringify({
        type: 'runtime',
        subType: 'pinia-error',
        errorId: 'pinia-eid-1',
        sessionId: 's1',
        timestamp: '2026-06-17T10:00:01.000Z',
        level: 'error',
        message: 'pinia action error',
        url: '/',
        userAgent: 'test',
        stack: 'at user.js:1:1',
      }),
      JSON.stringify({
        type: 'runtime',
        subType: 'pinia-plugin-error',
        errorId: 'pinia-plugin-eid-1',
        sessionId: 's1',
        timestamp: '2026-06-17T10:00:02.000Z',
        level: 'error',
        message: 'pinia plugin install error',
        url: '/',
        userAgent: 'test',
        stack: 'at plugin.js:1:1',
      }),
      JSON.stringify({
        type: 'runtime',
        subType: 'vuex-error',
        errorId: 'vuex-eid-1',
        sessionId: 's1',
        timestamp: '2026-06-17T10:00:03.000Z',
        level: 'error',
        message: 'vuex action error',
        url: '/',
        userAgent: 'test',
        stack: 'at store.js:1:1',
      }),
      JSON.stringify({
        type: 'runtime',
        subType: 'vuex-strict-violation',
        errorId: 'vuex-strict-eid-1',
        sessionId: 's1',
        timestamp: '2026-06-17T10:00:04.000Z',
        level: 'error',
        message: 'vuex strict violation',
        url: '/',
        userAgent: 'test',
        stack: 'at view.js:1:1',
      }),
    ];
    writeFileSync(join(base, 'runtime', '2026-06-17.jsonl'), lines.join('\n'));
    server = startApiServer({ projectPath: dir, port: 0 });
    await new Promise<void>((resolve) => server.on('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('unexpected server address');
    }
    port = address.port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  });

  const NEW_SUB_TYPES = [
    'pinia-error',
    'pinia-plugin-error',
    'vuex-error',
    'vuex-strict-violation',
  ] as const;

  it('GET /logs?type=runtime returns entries for all 4 new subtypes', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/logs?type=runtime&date=2026-06-17`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { count: number; logs: Array<{ subType: string }> };
    for (const subType of NEW_SUB_TYPES) {
      const matched = data.logs.filter((l) => l.subType === subType);
      expect(matched.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('GET /errors/top aggregates the 4 new subtypes', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/errors/top?limit=20&date=2026-06-17`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { errors: Array<{ subType: string }> };
    for (const subType of NEW_SUB_TYPES) {
      const matched = data.errors.filter((e) => e.subType === subType);
      expect(matched.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('GET /report?format=json reflects runtimeErrorCount including the new subtypes', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/report?format=json&date=2026-06-17`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { report: { summary: { runtimeErrorCount: number }; topErrors: Array<{ subType: string }> } };
    // 共 5 条 error 级别 runtime 日志（1 条 js-error + 4 条新子类型）
    expect(data.report.summary.runtimeErrorCount).toBeGreaterThanOrEqual(5);
    for (const subType of NEW_SUB_TYPES) {
      const matched = data.report.topErrors.filter((e) => e.subType === subType);
      expect(matched.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('POST /suggest returns 200 with 错误类型 prompt for pinia-error and vuex-strict-violation', async () => {
    for (const errorId of ['pinia-eid-1', 'vuex-strict-eid-1']) {
      const res = await fetch(`http://127.0.0.1:${port}/suggest?date=2026-06-17`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ errorId }),
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as { errorId: string; prompt: string };
      expect(data.errorId).toBe(errorId);
      expect(data.prompt).toContain('错误类型');
    }
  });

  it('POST /suggest still returns 200 for legacy js-error errorId (regression)', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/suggest?date=2026-06-17`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ errorId: 'js-eid-1' }),
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { errorId: string; prompt: string };
    expect(data.errorId).toBe('js-eid-1');
    expect(data.prompt).toContain('错误类型');
  });
});
