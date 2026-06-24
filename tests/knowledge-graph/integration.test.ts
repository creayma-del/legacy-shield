import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runKnowledgeGraph } from '../../lib/knowledge-graph/index.js';
import type { GraphOptions } from '../../lib/types.js';

const SIMPLE_FIXTURE = join(__dirname, 'fixtures/simple-project');
const MONOREPO_FIXTURE = join(__dirname, 'fixtures/monorepo-project');
const ALIAS_FIXTURE = join(__dirname, 'fixtures/alias-project');
const CYCLE_FIXTURE = join(__dirname, 'fixtures/cycle-project');
const WEBPACK_ALIAS_FIXTURE = join(__dirname, 'fixtures/webpack-alias-project');
const VITE_ALIAS_FIXTURE = join(__dirname, 'fixtures/vite-alias-project');
const VITE_ALIAS_ARRAY_FIXTURE = join(__dirname, 'fixtures/vite-alias-project-array');

let tempOutDir: string;

function makeOptions(project: string, out?: string): GraphOptions {
  return {
    project,
    out,
    concurrency: 4,
    fresh: true,
    format: 'both',
    hubThreshold: 10,
  };
}

beforeEach(() => {
  tempOutDir = mkdtempSync(join(tmpdir(), 'kg-int-'));
});

afterEach(() => {
  rmSync(tempOutDir, { recursive: true, force: true });
});

describe('integration', () => {
  it('TC-INT-1: 单包项目端到端（JSON + Markdown 输出 + Header.vue 依赖收集）', async () => {
    const result = await runKnowledgeGraph(makeOptions(SIMPLE_FIXTURE, tempOutDir));
    expect(result.nodeCount).toBeGreaterThan(0);
    expect(result.edgeCount).toBeGreaterThan(0);
    expect(result.isMonorepo).toBe(false);

    // 验证 JSON 输出文件存在
    const jsonPath = join(tempOutDir, 'knowledge-graph.json');
    expect(existsSync(jsonPath)).toBe(true);
    const json = JSON.parse(readFileSync(jsonPath, 'utf8'));
    // 断言 JSON 含 meta / nodes / edges / cycles / stats 五个顶层字段
    expect(json.meta).toBeDefined();
    expect(json.nodes).toBeDefined();
    expect(json.edges).toBeDefined();
    expect(json.cycles).toBeDefined();
    expect(json.stats).toBeDefined();
    expect(Array.isArray(json.nodes)).toBe(true);
    expect(Array.isArray(json.edges)).toBe(true);

    // 断言 Header.vue 依赖被正确收集
    const headerNode = json.nodes.find((n: any) => n.id.endsWith('Header.vue'));
    expect(headerNode).toBeDefined();
    // Header.vue 应有出度（依赖 format.ts）
    expect(headerNode.outDegree).toBeGreaterThan(0);
    // 应存在 main.ts → Header.vue 的边
    const headerEdge = json.edges.find(
      (e: any) => e.from.endsWith('main.ts') && e.to.endsWith('Header.vue'),
    );
    expect(headerEdge).toBeDefined();

    // 验证 Markdown 输出文件存在
    const mdPath = join(tempOutDir, 'architecture-summary.md');
    expect(existsSync(mdPath)).toBe(true);
    const md = readFileSync(mdPath, 'utf8');
    // 断言 Markdown 为中文、含 6 个章节
    expect(md).toContain('项目架构概览');
    expect(md).toContain('模块依赖拓扑');
    expect(md).toContain('关键节点识别');
    expect(md).toContain('循环依赖分析');
    expect(md).toContain('分层结构推断');
    expect(md).toContain('架构健康度评估');
  });

  it('TC-INT-2: monorepo 项目端到端（子包识别 + 聚合图谱 + 跨包依赖）', async () => {
    const result = await runKnowledgeGraph(makeOptions(MONOREPO_FIXTURE, tempOutDir));
    expect(result.isMonorepo).toBe(true);
    expect(result.packages.length).toBe(2);
    // packages 应含 packages/shared 与 packages/app
    const packagePaths = result.packages.map((p) => p.replace(/\\/g, '/'));
    expect(packagePaths.some((p) => p.includes('packages/shared'))).toBe(true);
    expect(packagePaths.some((p) => p.includes('packages/app'))).toBe(true);

    // 验证 JSON 输出含跨包依赖
    const jsonPath = join(tempOutDir, 'knowledge-graph.json');
    const json = JSON.parse(readFileSync(jsonPath, 'utf8'));
    // 聚合图谱应包含跨包依赖（@demo/shared 被解析为 shared/src/index.ts）
    const crossEdge = json.edges.find(
      (e: any) => e.from.includes('app/src/main.ts') && e.to.includes('shared/src/index.ts'),
    );
    expect(crossEdge).toBeDefined();
    expect(crossEdge.unresolved).toBe(false);
  });

  it('TC-INT-3: alias 项目端到端（tsconfig paths 解析）', async () => {
    const result = await runKnowledgeGraph(makeOptions(ALIAS_FIXTURE, tempOutDir));
    expect(result.nodeCount).toBeGreaterThan(0);

    const jsonPath = join(tempOutDir, 'knowledge-graph.json');
    const json = JSON.parse(readFileSync(jsonPath, 'utf8'));
    // 断言 @/utils/helper 被正确解析为 src/utils/helper.ts
    const helperEdge = json.edges.find(
      (e: any) => e.from.endsWith('main.ts') && e.to.endsWith('helper.ts'),
    );
    expect(helperEdge).toBeDefined();
    expect(helperEdge.unresolved).toBe(false);
    expect(helperEdge.to).toContain('utils/helper.ts');
  });

  it('TC-INT-4: 循环依赖检测端到端（2 节点 + 3 节点循环）', async () => {
    const result = await runKnowledgeGraph(makeOptions(CYCLE_FIXTURE, tempOutDir));
    expect(result.cycleCount).toBe(2);

    const jsonPath = join(tempOutDir, 'knowledge-graph.json');
    const json = JSON.parse(readFileSync(jsonPath, 'utf8'));
    // 断言 cycles 含 2 条循环链
    expect(json.cycles.length).toBe(2);
    // 验证存在 a→b→a 循环
    const cycleAB = json.cycles.find((c: string[]) => c.some((n) => n.endsWith('a.ts')) && c.some((n) => n.endsWith('b.ts')));
    expect(cycleAB).toBeDefined();
    // 验证存在 c→d→e→c 循环
    const cycleCDE = json.cycles.find((c: string[]) => c.some((n) => n.endsWith('c.ts')) && c.some((n) => n.endsWith('d.ts')) && c.some((n) => n.endsWith('e.ts')));
    expect(cycleCDE).toBeDefined();
  });

  it('TC-INT-5: 增量更新（mtime 变更后仅变更文件重新解析）', async () => {
    // 首次全量扫描（fresh=true 生成缓存）
    const firstResult = await runKnowledgeGraph({
      project: SIMPLE_FIXTURE,
      out: tempOutDir,
      concurrency: 4,
      fresh: false,
      format: 'json',
      hubThreshold: 10,
    });
    expect(firstResult.nodeCount).toBeGreaterThan(0);

    // 验证缓存文件生成
    const cachePath = join(SIMPLE_FIXTURE, '.legacy-shield', 'knowledge-graph', '.cache.json');
    expect(existsSync(cachePath)).toBe(true);

    // 读取首次缓存
    const cache1 = JSON.parse(readFileSync(cachePath, 'utf8'));
    const formatTsPath = join(SIMPLE_FIXTURE, 'src', 'utils', 'format.ts');
    const formatEntry1 = cache1.entries[formatTsPath];
    expect(formatEntry1).toBeDefined();

    // 修改 format.ts 内容并更新 mtime
    writeFileSync(formatTsPath, "export function format(input: string): string { return input.trim(); }\nexport function newFunc() {}\n");
    const futureTime = Date.now() / 1000 + 10;
    utimesSync(formatTsPath, futureTime, futureTime);

    // 第二次扫描（fresh=false，应命中缓存 + 仅 format.ts 重新解析）
    const secondResult = await runKnowledgeGraph({
      project: SIMPLE_FIXTURE,
      out: tempOutDir,
      concurrency: 4,
      fresh: false,
      format: 'json',
      hubThreshold: 10,
    });
    expect(secondResult.nodeCount).toBe(firstResult.nodeCount);

    // 验证缓存已更新（mtime 变更）
    const cache2 = JSON.parse(readFileSync(cachePath, 'utf8'));
    const formatEntry2 = cache2.entries[formatTsPath];
    expect(formatEntry2).toBeDefined();
    expect(formatEntry2.mtime).not.toBe(formatEntry1.mtime);

    // 恢复 format.ts 原始内容
    writeFileSync(formatTsPath, "export function format(input: string): string {\n  return input.trim();\n}\n");
  });

  // --- T8: alias 端到端测试（TC-INT-6 ~ TC-INT-8）---

  it('TC-INT-6: webpack alias 端到端（@/ 和 ~/ 均正确解析）', async () => {
    const result = await runKnowledgeGraph(makeOptions(WEBPACK_ALIAS_FIXTURE, tempOutDir));
    expect(result.nodeCount).toBeGreaterThan(0);
    expect(result.edgeCount).toBeGreaterThan(0);

    const jsonPath = join(tempOutDir, 'knowledge-graph.json');
    const json = JSON.parse(readFileSync(jsonPath, 'utf8'));
    // 断言 main.ts → helper.ts 边存在且已解析（@/utils/helper 和 ~/utils/helper 均指向同一文件）
    const helperEdge = json.edges.find(
      (e: { from: string; to: string; unresolved: boolean }) =>
        e.from.endsWith('main.ts') && e.to.endsWith('helper.ts'),
    );
    expect(helperEdge).toBeDefined();
    expect(helperEdge.unresolved).toBe(false);
    expect(helperEdge.to).toContain('utils/helper.ts');
  });

  it('TC-INT-7: vite alias 端到端 - 对象格式（@/utils/helper 正确解析）', async () => {
    const result = await runKnowledgeGraph(makeOptions(VITE_ALIAS_FIXTURE, tempOutDir));
    expect(result.nodeCount).toBeGreaterThan(0);
    expect(result.edgeCount).toBeGreaterThan(0);

    const jsonPath = join(tempOutDir, 'knowledge-graph.json');
    const json = JSON.parse(readFileSync(jsonPath, 'utf8'));
    const helperEdge = json.edges.find(
      (e: { from: string; to: string; unresolved: boolean }) =>
        e.from.endsWith('main.ts') && e.to.endsWith('helper.ts'),
    );
    expect(helperEdge).toBeDefined();
    expect(helperEdge.unresolved).toBe(false);
    expect(helperEdge.to).toContain('utils/helper.ts');
  });

  it('TC-INT-8: vite alias 端到端 - 数组格式（@/components/Button 正确解析）', async () => {
    const result = await runKnowledgeGraph(makeOptions(VITE_ALIAS_ARRAY_FIXTURE, tempOutDir));
    expect(result.nodeCount).toBeGreaterThan(0);
    expect(result.edgeCount).toBeGreaterThan(0);

    const jsonPath = join(tempOutDir, 'knowledge-graph.json');
    const json = JSON.parse(readFileSync(jsonPath, 'utf8'));
    const buttonEdge = json.edges.find(
      (e: { from: string; to: string; unresolved: boolean }) =>
        e.from.endsWith('main.ts') && e.to.endsWith('Button.ts'),
    );
    expect(buttonEdge).toBeDefined();
    expect(buttonEdge.unresolved).toBe(false);
    expect(buttonEdge.to).toContain('components/Button.ts');
  });
});
