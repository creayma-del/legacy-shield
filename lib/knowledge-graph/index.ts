import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';
import type { GraphOptions, GraphResult } from '../types.js';
import type { KnowledgeGraph } from './types.js';
import { createResolver } from './resolver.js';
import { scanWithCache, computeAliasHash } from './scanner.js';
import { buildGraph } from './graph.js';
import { analyzeGraph, inferLayers } from './analyzer.js';
import { writeJson } from './json-output.js';
import { writeMarkdown } from './markdown-output.js';
import { detectMonorepo, generatePackageGraph, generateAggregateGraph } from './monorepo.js';

/**
 * 知识图谱编排入口。
 * 编排 scanner → graph → analyzer → monorepo → output 完整流程。
 *
 * @param options 图谱生成选项
 * @returns GraphResult 含耗时与统计指标
 */
export async function runKnowledgeGraph(options: GraphOptions): Promise<GraphResult> {
  const startTime = Date.now();
  const projectRoot = resolve(options.project);
  const hubThreshold = options.hubThreshold ?? 10;
  const concurrency = options.concurrency ?? 8;
  const format = options.format ?? 'both';
  const outputPath = resolveOutputPath(options.out, projectRoot);

  try {
    // 1. 判断是否为 monorepo
    const { isMonorepo, packages } = detectMonorepo(projectRoot);

    let graph: KnowledgeGraph;

    if (isMonorepo) {
      // 2a. monorepo 流程
      graph = await runMonorepoFlow(projectRoot, packages, options, hubThreshold, concurrency);
    } else {
      // 2b. 单包流程
      graph = await runSinglePackageFlow(projectRoot, options, hubThreshold, concurrency);
    }

    // 3. 生成分层结构（供 writeMarkdown 使用）
    const layers = inferLayers(graph, hubThreshold);

    // 4. 确保输出目录存在
    mkdirSync(outputPath, { recursive: true });

    // 5. 根据 format 输出
    if (format === 'json' || format === 'both') {
      await writeJson(graph, outputPath);
    }
    if (format === 'md' || format === 'both') {
      await writeMarkdown(graph, layers, outputPath, hubThreshold);
    }

    // 6. 返回 GraphResult
    return {
      projectRoot,
      isMonorepo,
      packages,
      outputPath,
      nodeCount: graph.stats.nodeCount,
      edgeCount: graph.stats.edgeCount,
      cycleCount: graph.stats.cycleCount,
      durationMs: Date.now() - startTime,
    };
  } catch (err) {
    // 异常路径：durationMs 不被返回，调用方通过 catch 处理错误
    throw err;
  }
}

// ============================================================================
// 单包流程
// ============================================================================

/**
 * 单包流程：createResolver → collectSourceFiles → scanWithCache → buildGraph → analyzeGraph
 */
async function runSinglePackageFlow(
  projectRoot: string,
  options: GraphOptions,
  hubThreshold: number,
  concurrency: number,
): Promise<KnowledgeGraph> {
  // 1. 构造 resolver（createResolver 内部读取 tsconfig/jsconfig）
  const resolver = createResolver(projectRoot);

  // 2. 收集 src/ 下的文件
  const srcDir = join(projectRoot, 'src');
  const filePaths = collectSourceFiles(srcDir);

  // 3. 计算 aliasHash（读取 tsconfig/jsconfig 对象）
  const tsconfig = readTsconfig(projectRoot);
  const aliasHash = computeAliasHash(tsconfig);

  // 4. 带缓存的并发扫描（scanWithCache 封装 mtime 缓存与增量更新逻辑）
  const collected = await scanWithCache(
    filePaths,
    resolver,
    concurrency,
    projectRoot,
    aliasHash,
    options.fresh ?? false,
  );

  // 5. 构建图
  let graph = buildGraph(projectRoot, collected, resolver);

  // 6. 分析图（填充 role / isEntry / stats）
  graph = analyzeGraph(graph, hubThreshold);

  return graph;
}

// ============================================================================
// monorepo 流程
// ============================================================================

/**
 * monorepo 流程：generatePackageGraph（每个子包）→ generateAggregateGraph
 *
 * 注意：generateAggregateGraph 内部已调用 analyzeGraph 重新计算统计指标，
 * T10 不再重复调用。inferLayers 在主流程中统一调用。
 */
async function runMonorepoFlow(
  projectRoot: string,
  packages: string[],
  options: GraphOptions,
  hubThreshold: number,
  concurrency: number,
): Promise<KnowledgeGraph> {
  // 1. 为每个子包生成独立图谱（generatePackageGraph 为 async，需 await）
  const packageGraphs: KnowledgeGraph[] = [];
  for (const packageRoot of packages) {
    const packageOptions: GraphOptions = {
      ...options,
      project: packageRoot,
      concurrency,
      hubThreshold,
    };
    const packageGraph = await generatePackageGraph(packageRoot, packageOptions);
    packageGraphs.push(packageGraph);
  }

  // 2. 合并为聚合图谱（generateAggregateGraph 内部已调用 analyzeGraph 重新计算统计指标）
  //    传入 hubThreshold，确保与单包流程使用相同阈值
  const aggregateGraph = generateAggregateGraph(packageGraphs, projectRoot, hubThreshold);

  // 3. 返回聚合图谱（inferLayers 在主流程中调用，不再重复调用 analyzeGraph）
  return aggregateGraph;
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 解析输出路径。
 * - 自定义路径：相对路径基于 projectRoot 解析
 * - 默认路径：<project>/.legacy-shield/knowledge-graph/
 */
function resolveOutputPath(out: string | undefined, projectRoot: string): string {
  if (out && out.length > 0) {
    return isAbsolute(out) ? out : resolve(projectRoot, out);
  }
  return join(projectRoot, '.legacy-shield', 'knowledge-graph');
}

/**
 * 递归遍历 src/ 目录，收集 .js / .jsx / .ts / .tsx / .vue 文件的绝对路径。
 * 若 src/ 不存在，返回空数组。
 */
function collectSourceFiles(srcDir: string): string[] {
  if (!existsSync(srcDir)) return [];
  const stat = statSync(srcDir);
  if (!stat.isDirectory()) return [];

  const extensions = ['.js', '.jsx', '.ts', '.tsx', '.vue'];
  const results: string[] = [];

  function walk(dir: string): void {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const entryPath = join(dir, entry);
      const entryStat = statSync(entryPath);
      if (entryStat.isDirectory()) {
        // 跳过 node_modules 与 .legacy-shield 目录
        if (entry === 'node_modules' || entry === '.legacy-shield') continue;
        walk(entryPath);
      } else if (entryStat.isFile()) {
        const ext = entry.slice(entry.lastIndexOf('.'));
        if (extensions.includes(ext.toLowerCase())) {
          results.push(entryPath);
        }
      }
    }
  }

  walk(srcDir);
  return results;
}

/**
 * 读取 tsconfig.json / jsconfig.json 并返回解析后的对象。
 * 优先读取 tsconfig.json，不存在则读取 jsconfig.json，均不存在时返回 null。
 * 解析失败时返回 null。
 */
function readTsconfig(projectRoot: string): object | null {
  const tsconfigPath = join(projectRoot, 'tsconfig.json');
  const jsconfigPath = join(projectRoot, 'jsconfig.json');
  let configPath: string | null = null;
  if (existsSync(tsconfigPath)) {
    configPath = tsconfigPath;
  } else if (existsSync(jsconfigPath)) {
    configPath = jsconfigPath;
  }
  if (!configPath) return null;
  try {
    const raw = readFileSync(configPath, 'utf8');
    // 去除 JSON 注释（tsconfig 常见）
    const cleaned = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}
