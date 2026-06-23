import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, utimesSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  scanFilesConcurrent,
  scanWithCache,
  loadCache,
  computeAliasHash,
} from '../../lib/knowledge-graph/scanner.js';
import { createResolver } from '../../lib/knowledge-graph/resolver.js';

const SIMPLE_FIXTURE = join(__dirname, 'fixtures/simple-project');

function collectSimpleFiles(): string[] {
  return [
    join(SIMPLE_FIXTURE, 'src/main.ts'),
    join(SIMPLE_FIXTURE, 'src/utils/format.ts'),
    join(SIMPLE_FIXTURE, 'src/utils/request.ts'),
    join(SIMPLE_FIXTURE, 'src/components/Header.vue'),
  ];
}

describe('scanFilesConcurrent', () => {
  it('TC-SCAN-1: 并发扫描返回类型 Map<string, CollectedFile>', async () => {
    const files = collectSimpleFiles();
    const resolver = createResolver(SIMPLE_FIXTURE);
    const result = await scanFilesConcurrent(files, resolver, 4);
    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(files.length);
    for (const key of result.keys()) {
      expect(files).toContain(key);
    }
  });

  it('TC-SCAN-2: 索引游标（代码中无 shift() 调用）', () => {
    const scannerSource = readFileSync(join(process.cwd(), 'lib/knowledge-graph/scanner.ts'), 'utf8');
    // scanFilesConcurrent 使用 cursor 索引游标，不使用 queue.shift()
    expect(scannerSource).not.toMatch(/\.shift\(\)/);
  });

  it('TC-SCAN-3: 单文件异常隔离（不中断整体扫描）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'scan-err-'));
    const goodFile = join(dir, 'good.ts');
    const badFile = join(dir, 'bad.ts');
    writeFileSync(goodFile, "import { x } from './missing';\n");
    // 写入二进制内容，使 Babel 解析失败
    writeFileSync(badFile, '\xff\xfe\x00\x01invalid binary');
    const resolver = createResolver(dir);
    const result = await scanFilesConcurrent([goodFile, badFile], resolver, 2);
    expect(result.size).toBe(2);
    // bad 文件对应空依赖
    const badEntry = result.get(badFile);
    expect(badEntry).toBeDefined();
    expect(badEntry!.dependencies).toEqual([]);
    expect(badEntry!.exports).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  it('TC-SCAN-11: 并发数可配置（默认 8）', async () => {
    const files = collectSimpleFiles();
    const resolver = createResolver(SIMPLE_FIXTURE);
    // 并发数 1 仍能正常完成
    const result1 = await scanFilesConcurrent(files, resolver, 1);
    expect(result1.size).toBe(files.length);
    // 并发数 8 仍能正常完成
    const result8 = await scanFilesConcurrent(files, resolver, 8);
    expect(result8.size).toBe(files.length);
  });
});

describe('scanWithCache', () => {
  it('TC-SCAN-4: mtime 缓存结构为 Record<string, CacheEntry>', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'scan-cache-struct-'));
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'a.ts'), "export const a = 1;\n");
    const resolver = createResolver(dir);
    const aliasHash = computeAliasHash(null);
    await scanWithCache([join(dir, 'src/a.ts')], resolver, 4, dir, aliasHash, false);
    const cache = await loadCache(dir);
    expect(cache).not.toBeNull();
    // entries 为 Record 类型（对象，非 Map）
    expect(cache!.entries).toBeDefined();
    expect(typeof cache!.entries).toBe('object');
    expect(cache!.entries[join(dir, 'src/a.ts')]).toBeDefined();
    rmSync(dir, { recursive: true, force: true });
  });

  it('TC-SCAN-5: 缓存文件生成于 .legacy-shield/knowledge-graph/.cache.json', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'scan-cache-gen-'));
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'a.ts'), "export const a = 1;\n");
    const resolver = createResolver(dir);
    const aliasHash = computeAliasHash(null);
    await scanWithCache([join(dir, 'src/a.ts')], resolver, 4, dir, aliasHash, false);
    const cachePath = join(dir, '.legacy-shield', 'knowledge-graph', '.cache.json');
    expect(existsSync(cachePath)).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it('TC-SCAN-6: 缓存命中（无文件变更时跳过重新解析）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'scan-cache-hit-'));
    mkdirSync(join(dir, 'src'), { recursive: true });
    const filePath = join(dir, 'src', 'a.ts');
    writeFileSync(filePath, "export const a = 1;\n");
    const resolver = createResolver(dir);
    const aliasHash = computeAliasHash(null);
    // 首次扫描，生成缓存
    const first = await scanWithCache([filePath], resolver, 4, dir, aliasHash, false);
    expect(first.size).toBe(1);
    // 第二次扫描，应命中缓存
    const second = await scanWithCache([filePath], resolver, 4, dir, aliasHash, false);
    expect(second.size).toBe(1);
    // 缓存命中时结果应与首次一致
    expect(second.get(filePath)).toBeDefined();
    rmSync(dir, { recursive: true, force: true });
  });

  it('TC-SCAN-7: 缓存失效（mtime 变更后该文件重新解析）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'scan-cache-mtime-'));
    mkdirSync(join(dir, 'src'), { recursive: true });
    const filePath = join(dir, 'src', 'a.ts');
    writeFileSync(filePath, "export const a = 1;\n");
    const resolver = createResolver(dir);
    const aliasHash = computeAliasHash(null);
    // 首次扫描
    await scanWithCache([filePath], resolver, 4, dir, aliasHash, false);
    // 修改文件内容并更新 mtime
    writeFileSync(filePath, "export const a = 2;\nexport const b = 3;\n");
    const futureTime = Date.now() / 1000 + 10;
    utimesSync(filePath, futureTime, futureTime);
    // 第二次扫描，mtime 变更应触发重新解析
    const second = await scanWithCache([filePath], resolver, 4, dir, aliasHash, false);
    expect(second.size).toBe(1);
    const entry = second.get(filePath);
    expect(entry).toBeDefined();
    // 重新解析后应包含新增的 b 导出
    expect(entry!.exports).toContain('b');
    rmSync(dir, { recursive: true, force: true });
  });

  it('TC-SCAN-8: 缓存失效（aliasHash 变更后全部重建）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'scan-cache-alias-'));
    mkdirSync(join(dir, 'src'), { recursive: true });
    const filePath = join(dir, 'src', 'a.ts');
    writeFileSync(filePath, "export const a = 1;\n");
    const resolver = createResolver(dir);
    const hash1 = 'hash-aaa-111';
    const hash2 = 'hash-bbb-222';
    // 首次扫描，使用 hash1
    await scanWithCache([filePath], resolver, 4, dir, hash1, false);
    const cache1 = await loadCache(dir);
    expect(cache1!.aliasHash).toBe(hash1);
    // 第二次扫描，aliasHash 变更，应全部重建
    await scanWithCache([filePath], resolver, 4, dir, hash2, false);
    const cache2 = await loadCache(dir);
    expect(cache2!.aliasHash).toBe(hash2);
    rmSync(dir, { recursive: true, force: true });
  });

  it('TC-SCAN-9: --fresh 强制重建（忽略缓存）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'scan-cache-fresh-'));
    mkdirSync(join(dir, 'src'), { recursive: true });
    const filePath = join(dir, 'src', 'a.ts');
    writeFileSync(filePath, "export const a = 1;\n");
    const resolver = createResolver(dir);
    const aliasHash = computeAliasHash(null);
    // 首次扫描
    await scanWithCache([filePath], resolver, 4, dir, aliasHash, false);
    // fresh=true 强制重建
    const result = await scanWithCache([filePath], resolver, 4, dir, aliasHash, true);
    expect(result.size).toBe(1);
    expect(result.get(filePath)).toBeDefined();
    rmSync(dir, { recursive: true, force: true });
  });

  it('TC-SCAN-10: 缓存不存在时全量重建', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'scan-cache-none-'));
    mkdirSync(join(dir, 'src'), { recursive: true });
    const filePath = join(dir, 'src', 'a.ts');
    writeFileSync(filePath, "export const a = 1;\n");
    const resolver = createResolver(dir);
    const aliasHash = computeAliasHash(null);
    // 无缓存文件，应全量重建
    expect(existsSync(join(dir, '.legacy-shield', 'knowledge-graph', '.cache.json'))).toBe(false);
    const result = await scanWithCache([filePath], resolver, 4, dir, aliasHash, false);
    expect(result.size).toBe(1);
    // 扫描后缓存文件应生成
    expect(existsSync(join(dir, '.legacy-shield', 'knowledge-graph', '.cache.json'))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('computeAliasHash', () => {
  it('TC-SCAN-12: aliasHash 计算（无 tsconfig 时返回 none）', () => {
    // 无 tsconfig 时返回 'none'
    expect(computeAliasHash(null)).toBe('none');
    // 有 paths 配置时返回 MD5 hash
    const tsconfig1 = {
      compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/*'] } },
    };
    const hash1 = computeAliasHash(tsconfig1);
    expect(hash1).not.toBe('none');
    expect(hash1).toMatch(/^[0-9a-f]{32}$/);
    // 相同配置返回相同 hash
    const tsconfig2 = {
      compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/*'] } },
    };
    expect(computeAliasHash(tsconfig2)).toBe(hash1);
    // 不同配置返回不同 hash
    const tsconfig3 = {
      compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/sub/*'] } },
    };
    expect(computeAliasHash(tsconfig3)).not.toBe(hash1);
  });
});
