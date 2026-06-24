import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runKnowledgeGraph } from '../../lib/knowledge-graph/index.js';
import { loadAliasConfig } from '../../lib/knowledge-graph/config-loader.js';
import type { GraphOptions } from '../../lib/types.js';
import { generateLargeProject } from './fixtures/generate-large-project.js';

// 性能基线测试对应 T12 任务 Spec §3.5 / AC-9
// 5000 文件全量扫描 < 30 秒（SSD，并发数=8）
// 增量扫描 < 5 秒（90% 文件命中缓存）

const PERF_TIMEOUT = 120_000; // 生成 5000 文件 + 扫描可能较慢，给足超时

function makeOptions(project: string, out: string, fresh: boolean): GraphOptions {
  return {
    project,
    out,
    concurrency: 8,
    fresh,
    format: 'json', // 性能测试仅关注扫描耗时，不需要 Markdown 输出
    hubThreshold: 10,
  };
}

describe('performance baseline (5000 files)', () => {
  let projectDir: string;
  let tempOutDir: string;

  beforeAll(() => {
    // 生成合成项目（幂等：已存在则跳过）
    projectDir = generateLargeProject();

    // 验证项目已生成
    if (!existsSync(join(projectDir, 'package.json'))) {
      throw new Error('合成项目生成失败：package.json 不存在');
    }

    // 使用项目内的 .legacy-shield 目录作为输出（与默认行为一致）
    tempOutDir = join(projectDir, '.legacy-shield', 'knowledge-graph');
  }, PERF_TIMEOUT);

  it(
    'TC-PERF-1: 5000 文件全量扫描在 30 秒内完成（fresh=true）',
    async () => {
      const result = await runKnowledgeGraph(makeOptions(projectDir, tempOutDir, true));

      // AC-9 硬性断言：< 30 秒
      expect(result.durationMs).toBeLessThan(30_000);

      // 验证节点数接近 5000（部分文件可能因解析失败被跳过，但应接近）
      expect(result.nodeCount).toBeGreaterThan(4000);

      // 验证边数 > 0（依赖关系被正确收集）
      expect(result.edgeCount).toBeGreaterThan(0);

      // 记录实际耗时供验收报告引用
      console.log(`[TC-PERF-1] 全量扫描：${result.nodeCount} 节点、${result.edgeCount} 边、耗时 ${result.durationMs}ms`);
    },
    PERF_TIMEOUT,
  );

  it(
    'TC-PERF-2: 增量扫描在 5 秒内完成（fresh=false，缓存命中）',
    async () => {
      // 前置条件：TC-PERF-1 已生成缓存，此处复用
      // 清除输出目录但保留缓存文件
      const cacheFile = join(tempOutDir, '.cache.json');
      if (!existsSync(cacheFile)) {
        throw new Error('前置缓存不存在：请确保 TC-PERF-1 已执行');
      }

      const result = await runKnowledgeGraph(makeOptions(projectDir, tempOutDir, false));

      // 增量扫描目标：< 5 秒（90% 文件命中缓存）
      expect(result.durationMs).toBeLessThan(5_000);

      // 节点数应与全量扫描一致
      expect(result.nodeCount).toBeGreaterThan(4000);

      console.log(`[TC-PERF-2] 增量扫描：${result.nodeCount} 节点、${result.edgeCount} 边、耗时 ${result.durationMs}ms`);
    },
    PERF_TIMEOUT,
  );

  it('TC-PERF-3: 缓存文件生成验证', () => {
    const cacheFile = join(tempOutDir, '.cache.json');
    expect(existsSync(cacheFile)).toBe(true);

    const cache = JSON.parse(readFileSync(cacheFile, 'utf8'));
    expect(cache.version).toBeDefined();
    expect(cache.aliasHash).toBeDefined();
    expect(cache.entries).toBeDefined();
    expect(Object.keys(cache.entries).length).toBeGreaterThan(4000);

    console.log(`[TC-PERF-3] 缓存条目数：${Object.keys(cache.entries).length}`);
  });
});

// T8: 配置解析性能测试
describe('config parsing performance', () => {
  it('TC-PERF-4: 单次 loadAliasConfig 解析 < 500ms（单来源 + 三来源）', () => {
    // 1. 单来源：webpack-alias-project 夹具
    const webpackFixture = join(__dirname, 'fixtures/webpack-alias-project');
    const start1 = Date.now();
    loadAliasConfig(webpackFixture);
    const elapsed1 = Date.now() - start1;
    expect(elapsed1).toBeLessThan(500);
    console.log(`[TC-PERF-4] 单来源（webpack）配置解析耗时：${elapsed1}ms`);

    // 2. 三来源：临时目录（tsconfig + vite + webpack）
    const tempDir = mkdtempSync(join(tmpdir(), 'perf-config-'));
    mkdirSync(join(tempDir, 'src', 'utils'), { recursive: true });
    writeFileSync(join(tempDir, 'src', 'utils', 'helper.ts'), 'export const helper = 1;');
    writeFileSync(
      join(tempDir, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/*'] } } }),
    );
    writeFileSync(
      join(tempDir, 'vite.config.ts'),
      `import path from 'node:path';\nexport default { resolve: { alias: { '@': path.resolve(__dirname, 'src') } } };`,
    );
    writeFileSync(
      join(tempDir, 'webpack.config.js'),
      `const path = require('path');\nmodule.exports = { resolve: { alias: { '@': path.resolve(__dirname, 'src') } } };`,
    );

    const start2 = Date.now();
    loadAliasConfig(tempDir);
    const elapsed2 = Date.now() - start2;
    expect(elapsed2).toBeLessThan(500);
    console.log(`[TC-PERF-4] 三来源（tsconfig + vite + webpack）配置解析耗时：${elapsed2}ms`);

    rmSync(tempDir, { recursive: true, force: true });
  });
});
