import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { analyzeLogs } from '../lib/analyzer.js';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('analyzer', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'shield-analyzer-'));
    const base = join(dir, '.runtime-log-ignore');
    ['runtime', 'network', 'behavior', 'quality'].forEach((t) =>
      mkdirSync(join(base, t), { recursive: true }),
    );
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('aggregates runtime errors', async () => {
    const date = '2026-06-17';
    const base = join(dir, '.runtime-log-ignore');
    writeFileSync(
      join(base, 'runtime', `${date}.jsonl`),
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
        JSON.stringify({
          type: 'runtime',
          subType: 'js-error',
          errorId: 'e1',
          sessionId: 's1',
          timestamp: '2026-06-17T10:00:00.500Z',
          level: 'error',
          message: 'x',
          url: '/',
          userAgent: 'test',
        }),
        JSON.stringify({
          type: 'runtime',
          subType: 'console-error',
          sessionId: 's1',
          timestamp: '2026-06-17T10:00:01.000Z',
          level: 'error',
          message: 'y',
          url: '/',
          userAgent: 'test',
        }),
      ].join('\n'),
    );

    const result = await analyzeLogs(base, { date });
    expect(result.summary.runtimeErrorCount).toBe(3);
    expect(result.topErrors.length).toBe(1);
    expect(result.topErrors[0].count).toBe(2);
  });

  it('aggregates vue-render-error and vue-router-error into top errors', async () => {
    const date = '2026-06-17';
    const base = join(dir, '.runtime-log-ignore');
    writeFileSync(
      join(base, 'runtime', `${date}.jsonl`),
      [
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
          source: 'vue-error-handler',
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
          source: 'vue-router',
        }),
      ].join('\n'),
    );

    const result = await analyzeLogs(base, { date });
    expect(result.topErrors.length).toBe(2);
    expect(result.topErrors.find((e) => e.subType === 'vue-render-error')?.count).toBe(1);
    expect(result.topErrors.find((e) => e.subType === 'vue-router-error')?.count).toBe(1);
  });

  it('detects network issues', async () => {
    const date = '2026-06-17';
    const base = join(dir, '.runtime-log-ignore');
    writeFileSync(
      join(base, 'network', `${date}.jsonl`),
      [
        JSON.stringify({
          type: 'network',
          subType: 'xhr',
          sessionId: 's1',
          timestamp: '2026-06-17T10:00:00.000Z',
          level: 'info',
          durationMs: 100,
          method: 'GET',
          url: '/',
          requestId: 'req-1',
          pageUrl: '/',
          request: {
            headers: {},
            redactedHeaders: [],
            body: null,
            bodySize: 0,
            bodyTruncated: false,
          },
          response: {
            status: 200,
            statusText: 'OK',
            headers: {},
            redactedHeaders: [],
            body: null,
            bodySize: 0,
            bodyTruncated: false,
          },
        }),
        JSON.stringify({
          type: 'network',
          subType: 'xhr',
          sessionId: 's1',
          timestamp: '2026-06-17T10:00:01.000Z',
          level: 'error',
          durationMs: 200,
          method: 'POST',
          url: '/api',
          requestId: 'req-2',
          pageUrl: '/',
          request: {
            headers: {},
            redactedHeaders: [],
            body: null,
            bodySize: 0,
            bodyTruncated: false,
          },
          response: {
            status: 500,
            statusText: 'Internal Server Error',
            headers: {},
            redactedHeaders: [],
            body: null,
            bodySize: 0,
            bodyTruncated: false,
          },
        }),
      ].join('\n'),
    );

    const result = await analyzeLogs(base, { date });
    expect(result.summary.networkIssueCount).toBe(1);
    expect(result.networkIssues.length).toBe(1);
  });

  it('detects slow network requests', async () => {
    const date = '2026-06-17';
    const base = join(dir, '.runtime-log-ignore');
    writeFileSync(
      join(base, 'network', `${date}.jsonl`),
      [
        JSON.stringify({
          type: 'network',
          subType: 'xhr',
          sessionId: 's1',
          timestamp: '2026-06-17T10:00:00.000Z',
          level: 'info',
          durationMs: 6000,
          method: 'GET',
          url: '/slow',
          requestId: 'req-3',
          pageUrl: '/',
          request: {
            headers: {},
            redactedHeaders: [],
            body: null,
            bodySize: 0,
            bodyTruncated: false,
          },
          response: {
            status: 200,
            statusText: 'OK',
            headers: {},
            redactedHeaders: [],
            body: null,
            bodySize: 0,
            bodyTruncated: false,
          },
        }),
      ].join('\n'),
    );

    const result = await analyzeLogs(base, { date, networkIssueThresholdMs: 5000 });
    expect(result.summary.networkIssueCount).toBe(1);
    expect(result.networkIssues.length).toBe(1);
  });

  it('returns empty result when log files are missing', async () => {
    const base = join(dir, '.runtime-log-ignore');
    const result = await analyzeLogs(base, { date: '2026-06-17' });
    expect(result.summary.runtimeErrorCount).toBe(0);
    expect(result.topErrors.length).toBe(0);
    expect(result.networkIssues.length).toBe(0);
    expect(result.behaviorTimeline.length).toBe(0);
    expect(result.qualitySummary.customRuleHitCount).toBe(0);
  });

  it('skips malformed jsonl lines with console.warn', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const date = '2026-06-17';
    const base = join(dir, '.runtime-log-ignore');
    writeFileSync(
      join(base, 'runtime', `${date}.jsonl`),
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
        'not-a-json',
        JSON.stringify({
          type: 'runtime',
          subType: 'js-error',
          errorId: 'e1',
          sessionId: 's1',
          timestamp: '2026-06-17T10:00:02.000Z',
          level: 'error',
          message: 'x',
          url: '/',
          userAgent: 'test',
        }),
      ].join('\n'),
    );

    const result = await analyzeLogs(base, { date });
    expect(result.summary.runtimeErrorCount).toBe(2);
    expect(result.topErrors.length).toBe(2);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[legacy-shield] 跳过无效日志行'),
    );
    warnSpy.mockRestore();
  });

  it('prefers non-browser-pageerror representative in top errors', async () => {
    const date = '2026-06-17';
    const base = join(dir, '.runtime-log-ignore');
    writeFileSync(
      join(base, 'runtime', `${date}.jsonl`),
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
          source: 'browser-pageerror',
        }),
        JSON.stringify({
          type: 'runtime',
          subType: 'js-error',
          errorId: 'e1',
          sessionId: 's1',
          timestamp: '2026-06-17T10:00:00.200Z',
          level: 'error',
          message: 'x',
          url: '/',
          userAgent: 'test',
          source: 'inject.iife.js',
          stack: 'at foo',
        }),
      ].join('\n'),
    );

    const result = await analyzeLogs(base, { date });
    expect(result.topErrors.length).toBe(1);
    expect(result.topErrors[0].source).toBe('inject.iife.js');
    expect(result.topErrors[0].samples[1].stack).toBe('at foo');
  });

  it('aggregates custom rule summary from quality logs', async () => {
    const date = '2026-06-17';
    const base = join(dir, '.runtime-log-ignore');
    writeFileSync(
      join(base, 'quality', `${date}.jsonl`),
      [
        JSON.stringify({
          type: 'quality',
          subType: 'custom-rule',
          sessionId: 's1',
          timestamp: '2026-06-17T10:00:00.000Z',
          level: 'error',
          customRuleHits: [
            {
              ruleId: 'SHIELD-001',
              ruleName: 'no-dangerous-apis',
              filePath: '/x',
              line: 1,
              column: 1,
              message: 'dangerous',
              severity: 'error',
            },
            {
              ruleId: 'SHIELD-002',
              ruleName: 'no-large-loops',
              filePath: '/x',
              line: 2,
              column: 1,
              message: 'large loop',
              severity: 'warning',
            },
          ],
        }),
      ].join('\n'),
    );

    const result = await analyzeLogs(base, { date });
    expect(result.qualitySummary.customRuleHitCount).toBe(2);
    expect(result.qualitySummary.customRuleErrors).toBe(1);
    expect(result.qualitySummary.customRuleWarnings).toBe(1);
  });

  it('aggregates v1.4 new subtypes (pinia/vuex) in topErrors with errorId-based dedupe', async () => {
    const date = '2026-06-17';
    const base = join(dir, '.runtime-log-ignore');
    const subTypes = ['pinia-error', 'pinia-plugin-error', 'vuex-error', 'vuex-strict-violation'] as const;
    const lines: string[] = [];
    subTypes.forEach((subType, idx) => {
      const baseSecond = `2026-06-17T10:00:0${idx}.000Z`;
      const dupSecond = `2026-06-17T10:00:0${idx}.500Z`;
      const errorId = `${subType}-eid`;
      lines.push(
        JSON.stringify({
          type: 'runtime',
          subType,
          errorId,
          sessionId: 's1',
          timestamp: baseSecond,
          level: 'error',
          message: `${subType} sample`,
          url: '/',
          userAgent: 'test',
        }),
        JSON.stringify({
          type: 'runtime',
          subType,
          errorId,
          sessionId: 's1',
          timestamp: dupSecond,
          level: 'error',
          message: `${subType} sample`,
          url: '/',
          userAgent: 'test',
        }),
      );
    });
    writeFileSync(join(base, 'runtime', `${date}.jsonl`), lines.join('\n'));

    const result = await analyzeLogs(base, { date });
    // 每个新子类型至少形成一条聚合，且同 1 秒窗口内 errorId 一致的两条被合并到 count >= 2
    for (const subType of subTypes) {
      const entry = result.topErrors.find((e) => e.subType === subType);
      expect(entry).toBeDefined();
      expect(entry!.errorId).toBe(`${subType}-eid`);
      expect(entry!.count).toBeGreaterThanOrEqual(2);
    }
  });

  it('dedupes scroll events within the same second', async () => {
    const date = '2026-06-17';
    const base = join(dir, '.runtime-log-ignore');
    writeFileSync(
      join(base, 'behavior', `${date}.jsonl`),
      [
        JSON.stringify({
          type: 'behavior',
          subType: 'scroll',
          sessionId: 's1',
          timestamp: '2026-06-17T10:00:00.100Z',
          level: 'info',
          sequence: 1,
          pageUrl: '/',
          target: null,
          payload: { scrollTop: 100 },
          coordinates: null,
        }),
        JSON.stringify({
          type: 'behavior',
          subType: 'scroll',
          sessionId: 's1',
          timestamp: '2026-06-17T10:00:00.800Z',
          level: 'info',
          sequence: 2,
          pageUrl: '/',
          target: null,
          payload: { scrollTop: 200 },
          coordinates: null,
        }),
        JSON.stringify({
          type: 'behavior',
          subType: 'click',
          sessionId: 's1',
          timestamp: '2026-06-17T10:00:01.000Z',
          level: 'info',
          sequence: 3,
          pageUrl: '/',
          target: { tagName: 'BUTTON', selector: '#btn' },
          payload: {},
          coordinates: null,
        }),
      ].join('\n'),
    );

    const result = await analyzeLogs(base, { date });
    expect(result.behaviorTimeline.length).toBe(2);
    expect(result.behaviorTimeline.find((i) => i.subType === 'scroll')?.payload).toEqual({
      scrollTop: 200,
    });
  });
});
