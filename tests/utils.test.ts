import { describe, it, expect } from 'vitest';
import {
  assertLegacyProject,
  today,
  generateId,
  safeJsonParse,
  truncateBody,
  redactHeaders,
  redactBody,
  classifyNetworkSubType,
} from '../lib/utils.js';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('utils', () => {
  it('assertLegacyProject throws on missing path', () => {
    expect(() => assertLegacyProject('/nonexistent')).toThrow('路径不存在');
  });

  it('assertLegacyProject passes on valid project', () => {
    const dir = mkdtempSync(join(tmpdir(), 'legacy-'));
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'package.json'), '{}');
    expect(() => assertLegacyProject(dir)).not.toThrow();
    rmSync(dir, { recursive: true, force: true });
  });

  it('today returns YYYY-MM-DD format', () => {
    const t = today();
    expect(t).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('generateId returns uuid v4', () => {
    expect(generateId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('safeJsonParse returns null on invalid json', () => {
    expect(safeJsonParse('not json')).toBeNull();
  });

  it('safeJsonParse parses valid json', () => {
    expect(safeJsonParse<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });

  it('truncateBody truncates large body', () => {
    const { body, truncated } = truncateBody('a'.repeat(70000));
    expect(truncated).toBe(true);
    expect(body.length).toBe(64 * 1024);
  });

  it('redactHeaders masks cookie and authorization', () => {
    const { headers, redactedHeaders } = redactHeaders({ Cookie: 'x', Authorization: 'Bearer y', 'Content-Type': 'json' });
    expect(headers.Cookie).toBe('[REDACTED]');
    expect(headers.Authorization).toBe('[REDACTED]');
    expect(redactedHeaders).toContain('Cookie');
    expect(redactedHeaders).toContain('Authorization');
  });

  it('redactBody masks nested sensitive fields', () => {
    const body = { user: { password: 'secret', name: 'Tom' }, token: 'abc' };
    const result = redactBody(body) as { user: { password: string; name: string }; token: string };
    expect(result.user.password).toBe('[REDACTED]');
    expect(result.user.name).toBe('Tom');
    expect(result.token).toBe('[REDACTED]');
  });

  it('redactBody masks sensitive fields in JSON string', () => {
    const body = JSON.stringify({ user: { password: 'secret', name: 'Tom' }, token: 'abc' });
    const result = redactBody(body) as string;
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain('secret');
    expect(result).toContain('Tom');
  });

  it('classifyNetworkSubType detects fetch marker', () => {
    const req = { headers: { 'x-shield-request-type': 'fetch' } };
    expect(classifyNetworkSubType(req, '/api')).toBe('fetch');
  });

  it('classifyNetworkSubType detects static resource', () => {
    const req = { headers: {} };
    expect(classifyNetworkSubType(req, '/app.js')).toBe('static-resource');
  });

  it('classifyNetworkSubType returns unknown when url is empty', () => {
    expect(classifyNetworkSubType({ headers: {} }, '')).toBe('unknown');
  });

  it('classifyNetworkSubType returns unknown for unclassified request', () => {
    expect(classifyNetworkSubType({ headers: {} }, '/api/users')).toBe('unknown');
  });
});
