import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import {
  detectMonorepo,
  generatePackageGraph,
  generateAggregateGraph,
} from '../../lib/knowledge-graph/monorepo.js';
import type { GraphOptions } from '../../lib/types.js';

const MONOREPO_FIXTURE = join(__dirname, 'fixtures/monorepo-project');

function makeOptions(project: string): GraphOptions {
  return {
    project,
    concurrency: 4,
    fresh: true,
    format: 'both',
    hubThreshold: 10,
  };
}

describe('detectMonorepo', () => {
  it('TC-MONO-1: 优先级 1 package.json workspaces', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mono-pkg-'));
    mkdirSync(join(dir, 'packages', 'a'), { recursive: true });
    mkdirSync(join(dir, 'packages', 'b'), { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'root', workspaces: ['packages/*'] }));
    writeFileSync(join(dir, 'packages', 'a', 'package.json'), JSON.stringify({ name: 'a' }));
    writeFileSync(join(dir, 'packages', 'b', 'package.json'), JSON.stringify({ name: 'b' }));
    const result = detectMonorepo(dir);
    expect(result.isMonorepo).toBe(true);
    expect(result.packages.length).toBe(2);
    rmSync(dir, { recursive: true, force: true });
  });

  it('TC-MONO-2: 优先级 2 lerna.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mono-lerna-'));
    mkdirSync(join(dir, 'packages', 'a'), { recursive: true });
    mkdirSync(join(dir, 'packages', 'b'), { recursive: true });
    writeFileSync(join(dir, 'lerna.json'), JSON.stringify({ packages: ['packages/*'] }));
    writeFileSync(join(dir, 'packages', 'a', 'package.json'), JSON.stringify({ name: 'a' }));
    writeFileSync(join(dir, 'packages', 'b', 'package.json'), JSON.stringify({ name: 'b' }));
    const result = detectMonorepo(dir);
    expect(result.isMonorepo).toBe(true);
    expect(result.packages.length).toBe(2);
    rmSync(dir, { recursive: true, force: true });
  });

  it('TC-MONO-3: 优先级 3 pnpm-workspace.yaml 简化解析', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mono-pnpm-'));
    mkdirSync(join(dir, 'packages', 'shared'), { recursive: true });
    mkdirSync(join(dir, 'packages', 'app'), { recursive: true });
    writeFileSync(join(dir, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");
    writeFileSync(join(dir, 'packages', 'shared', 'package.json'), JSON.stringify({ name: '@demo/shared' }));
    writeFileSync(join(dir, 'packages', 'app', 'package.json'), JSON.stringify({ name: '@demo/app' }));
    const result = detectMonorepo(dir);
    expect(result.isMonorepo).toBe(true);
    expect(result.packages.length).toBe(2);
    rmSync(dir, { recursive: true, force: true });
  });

  it('TC-MONO-4: 优先级 3 降级（YAML 锚点等高级特性解析失败降级为优先级 4）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mono-pnpm-degrade-'));
    mkdirSync(join(dir, 'packages', 'a'), { recursive: true });
    // pnpm-workspace.yaml 含 YAML 锚点等高级特性，简化解析无法识别 packages 数组
    writeFileSync(join(dir, 'pnpm-workspace.yaml'), "packages: &anchor\n  - 'packages/*'\n");
    writeFileSync(join(dir, 'packages', 'a', 'package.json'), JSON.stringify({ name: 'a' }));
    const result = detectMonorepo(dir);
    // 简化解析失败降级为优先级 4（packages/* 目录约定）
    expect(result.isMonorepo).toBe(true);
    expect(result.packages.length).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });

  it('TC-MONO-5: 优先级 4 packages/* 目录约定', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mono-dir-'));
    mkdirSync(join(dir, 'packages', 'a'), { recursive: true });
    mkdirSync(join(dir, 'packages', 'b'), { recursive: true });
    writeFileSync(join(dir, 'packages', 'a', 'package.json'), JSON.stringify({ name: 'a' }));
    writeFileSync(join(dir, 'packages', 'b', 'package.json'), JSON.stringify({ name: 'b' }));
    const result = detectMonorepo(dir);
    expect(result.isMonorepo).toBe(true);
    expect(result.packages.length).toBe(2);
    rmSync(dir, { recursive: true, force: true });
  });

  it('TC-MONO-6: 单包项目返回 isMonorepo=false', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mono-single-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'single' }));
    const result = detectMonorepo(dir);
    expect(result.isMonorepo).toBe(false);
    expect(result.packages).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('generatePackageGraph', () => {
  it('TC-MONO-7: 独立图谱生成（packageName 字段为子包名）', async () => {
    const sharedRoot = join(MONOREPO_FIXTURE, 'packages/shared');
    const graph = await generatePackageGraph(sharedRoot, makeOptions(MONOREPO_FIXTURE));
    expect(graph.nodes.size).toBeGreaterThan(0);
    for (const node of graph.nodes.values()) {
      expect(node.packageName).toBe('@demo/shared');
    }
  });
});

describe('generateAggregateGraph', () => {
  it('TC-MONO-8: 聚合图谱合并所有子包图谱', async () => {
    const sharedRoot = join(MONOREPO_FIXTURE, 'packages/shared');
    const appRoot = join(MONOREPO_FIXTURE, 'packages/app');
    const sharedGraph = await generatePackageGraph(sharedRoot, makeOptions(MONOREPO_FIXTURE));
    const appGraph = await generatePackageGraph(appRoot, makeOptions(MONOREPO_FIXTURE));
    const aggregate = generateAggregateGraph([sharedGraph, appGraph], MONOREPO_FIXTURE, 10);
    expect(aggregate.isMonorepo).toBe(true);
    expect(aggregate.packages.length).toBe(2);
    // 聚合后节点数 = shared 节点数 + app 节点数
    expect(aggregate.nodes.size).toBe(sharedGraph.nodes.size + appGraph.nodes.size);
  });

  it('TC-MONO-9: workspace:* 协议解析（跨包依赖被正确解析）', async () => {
    const sharedRoot = join(MONOREPO_FIXTURE, 'packages/shared');
    const appRoot = join(MONOREPO_FIXTURE, 'packages/app');
    const sharedGraph = await generatePackageGraph(sharedRoot, makeOptions(MONOREPO_FIXTURE));
    const appGraph = await generatePackageGraph(appRoot, makeOptions(MONOREPO_FIXTURE));
    const aggregate = generateAggregateGraph([sharedGraph, appGraph], MONOREPO_FIXTURE, 10);
    // app 的 main.ts import @demo/shared（workspace:* 协议），应被解析为跨包边
    const crossEdge = aggregate.edges.find(
      (e) => e.from.includes('app/src/main.ts') && e.to.includes('shared/src/index.ts'),
    );
    expect(crossEdge).toBeDefined();
    expect(crossEdge!.unresolved).toBe(false);
  });

  it('TC-MONO-10: link: 协议解析', async () => {
    // 构造临时 monorepo，app 依赖 shared 使用 link: 协议
    const dir = mkdtempSync(join(tmpdir(), 'mono-link-'));
    mkdirSync(join(dir, 'packages', 'shared', 'src'), { recursive: true });
    mkdirSync(join(dir, 'packages', 'app', 'src'), { recursive: true });
    writeFileSync(join(dir, 'packages', 'shared', 'package.json'), JSON.stringify({ name: '@demo/shared', main: 'src/index.ts' }));
    writeFileSync(join(dir, 'packages', 'shared', 'src', 'index.ts'), 'export function sharedUtil() {}\n');
    writeFileSync(join(dir, 'packages', 'app', 'package.json'), JSON.stringify({ name: '@demo/app', main: 'src/main.ts', dependencies: { '@demo/shared': 'link:./packages/shared' } }));
    writeFileSync(join(dir, 'packages', 'app', 'src', 'main.ts'), "import { sharedUtil } from '@demo/shared';\n");

    const sharedGraph = await generatePackageGraph(join(dir, 'packages/shared'), makeOptions(dir));
    const appGraph = await generatePackageGraph(join(dir, 'packages/app'), makeOptions(dir));
    const aggregate = generateAggregateGraph([sharedGraph, appGraph], dir, 10);
    const crossEdge = aggregate.edges.find(
      (e) => e.from.includes('app/src/main.ts') && e.to.includes('shared/src/index.ts'),
    );
    expect(crossEdge).toBeDefined();
    expect(crossEdge!.unresolved).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it('TC-MONO-11: file: 协议解析', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mono-file-'));
    mkdirSync(join(dir, 'packages', 'shared', 'src'), { recursive: true });
    mkdirSync(join(dir, 'packages', 'app', 'src'), { recursive: true });
    writeFileSync(join(dir, 'packages', 'shared', 'package.json'), JSON.stringify({ name: '@demo/shared', main: 'src/index.ts' }));
    writeFileSync(join(dir, 'packages', 'shared', 'src', 'index.ts'), 'export function sharedUtil() {}\n');
    writeFileSync(join(dir, 'packages', 'app', 'package.json'), JSON.stringify({ name: '@demo/app', main: 'src/main.ts', dependencies: { '@demo/shared': 'file:./packages/shared' } }));
    writeFileSync(join(dir, 'packages', 'app', 'src', 'main.ts'), "import { sharedUtil } from '@demo/shared';\n");

    const sharedGraph = await generatePackageGraph(join(dir, 'packages/shared'), makeOptions(dir));
    const appGraph = await generatePackageGraph(join(dir, 'packages/app'), makeOptions(dir));
    const aggregate = generateAggregateGraph([sharedGraph, appGraph], dir, 10);
    const crossEdge = aggregate.edges.find(
      (e) => e.from.includes('app/src/main.ts') && e.to.includes('shared/src/index.ts'),
    );
    expect(crossEdge).toBeDefined();
    expect(crossEdge!.unresolved).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it('TC-MONO-12: 聚合图统计重算（非简单累加）', async () => {
    const sharedRoot = join(MONOREPO_FIXTURE, 'packages/shared');
    const appRoot = join(MONOREPO_FIXTURE, 'packages/app');
    const sharedGraph = await generatePackageGraph(sharedRoot, makeOptions(MONOREPO_FIXTURE));
    const appGraph = await generatePackageGraph(appRoot, makeOptions(MONOREPO_FIXTURE));
    const aggregate = generateAggregateGraph([sharedGraph, appGraph], MONOREPO_FIXTURE, 10);
    // stats.nodeCount 应等于聚合节点数（非子包 nodeCount 简单相加的中间态）
    expect(aggregate.stats.nodeCount).toBe(aggregate.nodes.size);
    // stats.edgeCount 应等于聚合边数（含跨包边）
    expect(aggregate.stats.edgeCount).toBe(aggregate.edges.length);
    // maxInDegree / maxOutDegree 应为重算后的值
    let expectedMaxIn = 0;
    let expectedMaxOut = 0;
    for (const node of aggregate.nodes.values()) {
      if (node.inDegree > expectedMaxIn) expectedMaxIn = node.inDegree;
      if (node.outDegree > expectedMaxOut) expectedMaxOut = node.outDegree;
    }
    expect(aggregate.stats.maxInDegree).toBe(expectedMaxIn);
    expect(aggregate.stats.maxOutDegree).toBe(expectedMaxOut);
  });
});

describe('无 js-yaml 依赖', () => {
  it('TC-MONO-13: package.json 中无 js-yaml 新增依赖', () => {
    const pkgJsonPath = join(process.cwd(), 'package.json');
    expect(existsSync(pkgJsonPath)).toBe(true);
    const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
    const allDeps = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
    };
    expect(allDeps['js-yaml']).toBeUndefined();
  });
});
