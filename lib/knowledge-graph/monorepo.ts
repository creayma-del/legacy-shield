import { readFileSync, existsSync, readdirSync, statSync, readlinkSync, lstatSync } from 'node:fs';
import { join, resolve, dirname, basename, extname } from 'node:path';
import type { GraphOptions } from '../types.js';
import type { KnowledgeGraph, GraphNode, GraphEdge, GraphStats } from './types.js';
import { createResolver } from './resolver.js';
import { scanFilesConcurrent } from './scanner.js';
import { buildGraph, detectCycles, computeComponents } from './graph.js';
import { analyzeGraph } from './analyzer.js';

// ============================================================================
// 1. detectMonorepo：按 4 级优先级识别 monorepo 项目
// ============================================================================

/**
 * 识别 monorepo 项目结构。
 * 按 4 级优先级依次尝试：package.json workspaces → lerna.json → pnpm-workspace.yaml 简化解析 → packages/* 目录约定。
 * 命中任一级即返回，不继续向下尝试。
 */
export function detectMonorepo(projectRoot: string): { isMonorepo: boolean; packages: string[] } {
  // 优先级 1：package.json workspaces
  const byPkg = detectByPackageJsonWorkspaces(projectRoot);
  if (byPkg && byPkg.length > 0) {
    return { isMonorepo: true, packages: byPkg };
  }
  // 优先级 2：lerna.json
  const byLerna = detectByLernaJson(projectRoot);
  if (byLerna && byLerna.length > 0) {
    return { isMonorepo: true, packages: byLerna };
  }
  // 优先级 3：pnpm-workspace.yaml 简化解析
  const byPnpm = detectByPnpmWorkspace(projectRoot);
  if (byPnpm && byPnpm.length > 0) {
    return { isMonorepo: true, packages: byPnpm };
  }
  // 优先级 4：packages/* 目录约定
  const byDir = detectByPackagesDir(projectRoot);
  if (byDir && byDir.length > 0) {
    return { isMonorepo: true, packages: byDir };
  }
  return { isMonorepo: false, packages: [] };
}

/** 优先级 1：package.json workspaces 字段 */
function detectByPackageJsonWorkspaces(projectRoot: string): string[] | null {
  const pkgPath = join(projectRoot, 'package.json');
  if (!existsSync(pkgPath)) return null;
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const workspaces = pkg.workspaces;
  if (!workspaces) return null;
  // workspaces 可为字符串数组（npm/yarn）或 { packages: string[] } 对象（yarn）
  const globs: string[] = Array.isArray(workspaces) ? workspaces : workspaces?.packages ?? [];
  if (globs.length === 0) return null;
  return expandWorkspaceGlobs(projectRoot, globs);
}

/** 优先级 2：lerna.json packages 字段 */
function detectByLernaJson(projectRoot: string): string[] | null {
  const lernaPath = join(projectRoot, 'lerna.json');
  if (!existsSync(lernaPath)) return null;
  const lerna = JSON.parse(readFileSync(lernaPath, 'utf8'));
  const globs: string[] = lerna.packages ?? [];
  if (globs.length === 0) return null;
  return expandWorkspaceGlobs(projectRoot, globs);
}

/** 优先级 3：pnpm-workspace.yaml 简化解析（不引入 js-yaml） */
function detectByPnpmWorkspace(projectRoot: string): string[] | null {
  const yamlPath = join(projectRoot, 'pnpm-workspace.yaml');
  if (!existsSync(yamlPath)) return null;
  const content = readFileSync(yamlPath, 'utf8');
  const globs = parsePnpmWorkspaceYaml(content);
  if (globs.length === 0) return null;
  return expandWorkspaceGlobs(projectRoot, globs);
}

/** 优先级 4：packages/* 目录约定 */
function detectByPackagesDir(projectRoot: string): string[] | null {
  const packagesDir = join(projectRoot, 'packages');
  if (!existsSync(packagesDir)) return null;
  const stat = statSync(packagesDir);
  if (!stat.isDirectory()) return null;
  const entries = readdirSync(packagesDir);
  const packageRoots: string[] = [];
  for (const entry of entries) {
    const entryPath = join(packagesDir, entry);
    if (statSync(entryPath).isDirectory() && existsSync(join(entryPath, 'package.json'))) {
      packageRoots.push(entryPath);
    }
  }
  return packageRoots.length > 0 ? packageRoots : null;
}

/**
 * pnpm-workspace.yaml 简化解析。
 * 仅识别 `packages:` 顶层数组字面量，支持行内数组与块级数组两种格式。
 * 遇到不支持的 YAML 特性（锚点 / 合并键 / 多行字符串等）返回空数组降级。
 */
function parsePnpmWorkspaceYaml(content: string): string[] {
  const lines = content.split('\n').map(l => l.trim());
  const packagesLineIdx = lines.findIndex(l => l.startsWith('packages:'));
  if (packagesLineIdx === -1) return [];

  const packagesLine = lines[packagesLineIdx];
  // 行内数组格式：packages: ['packages/*', 'apps/*']
  const inlineMatch = packagesLine.match(/^packages:\s*\[(.*)\]\s*$/);
  if (inlineMatch) {
    return extractStringLiterals(inlineMatch[1]);
  }

  // 块级数组格式：
  // packages:
  //   - 'packages/*'
  //   - 'apps/*'
  const globs: string[] = [];
  for (let i = packagesLineIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === '' || line.startsWith('#')) continue;
    if (line.startsWith('-')) {
      const literal = extractStringLiterals(line.slice(1).trim());
      globs.push(...literal);
    } else {
      // 遇到非数组项行，结束收集
      break;
    }
  }
  return globs;
}

/** 从字符串中提取单引号或双引号包裹的字符串字面量 */
function extractStringLiterals(s: string): string[] {
  const result: string[] = [];
  const regex = /['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(s)) !== null) {
    result.push(match[1]);
  }
  return result;
}

/**
 * 展开 workspace glob 模式为子包绝对路径列表。
 * 仅支持 `*` 通配符在最后一段目录的匹配（如 `packages/*`），不支持 `**` 递归通配符。
 */
function expandWorkspaceGlobs(projectRoot: string, globs: string[]): string[] {
  const packageRoots: string[] = [];
  for (const glob of globs) {
    // 仅支持最后一段目录的 * 通配符，不支持 **
    if (glob.includes('**')) continue;
    const lastSlashIdx = glob.lastIndexOf('/');
    if (lastSlashIdx === -1) continue;
    const dirPart = glob.slice(0, lastSlashIdx);
    const filePart = glob.slice(lastSlashIdx + 1);
    const absDir = resolve(projectRoot, dirPart);
    if (!existsSync(absDir)) continue;
    if (filePart === '*') {
      const entries = readdirSync(absDir);
      for (const entry of entries) {
        const entryPath = join(absDir, entry);
        if (statSync(entryPath).isDirectory() && existsSync(join(entryPath, 'package.json'))) {
          packageRoots.push(entryPath);
        }
      }
    } else {
      // 非通配符，直接检查目录
      const entryPath = resolve(projectRoot, glob);
      if (existsSync(join(entryPath, 'package.json'))) {
        packageRoots.push(entryPath);
      }
    }
  }
  return packageRoots;
}

// ============================================================================
// 2. generatePackageGraph：为单个子包生成独立图谱
// ============================================================================

/**
 * 以子包根目录为 projectRoot，生成该子包的独立图谱。
 * 内部 await scanFilesConcurrent，返回 Promise<KnowledgeGraph>。
 */
export async function generatePackageGraph(
  packageRoot: string,
  options: GraphOptions,
): Promise<KnowledgeGraph> {
  // 1. 读取子包 tsconfig/jsconfig，构造 resolver
  const resolver = createResolver(packageRoot);

  // 2. 收集子包 src/ 下的文件
  const srcDir = join(packageRoot, 'src');
  const filePaths = collectSourceFiles(srcDir);

  // 3. 并发扫描（await 异步结果）
  const concurrency = options.concurrency ?? 8;
  const collected = await scanFilesConcurrent(filePaths, resolver, concurrency);

  // 4. 构建图
  const hubThreshold = options.hubThreshold ?? 10;
  let graph = buildGraph(packageRoot, collected, resolver);

  // 5. 分析图
  graph = analyzeGraph(graph, hubThreshold);

  // 6. 赋值 packageName
  const packageName = readPackageName(packageRoot);
  for (const node of graph.nodes.values()) {
    node.packageName = packageName;
  }

  // 7. 设置 monorepo 元数据
  graph.isMonorepo = true;
  graph.packages = [packageRoot];
  graph.projectRoot = packageRoot;

  return graph;
}

/**
 * 递归遍历 src/ 目录，收集 .js / .jsx / .ts / .tsx / .vue 文件的绝对路径。
 * 若 src/ 不存在，返回空数组。
 */
function collectSourceFiles(srcDir: string): string[] {
  if (!existsSync(srcDir)) return [];
  const stat = statSync(srcDir);
  if (!stat.isDirectory()) return [];

  const results: string[] = [];
  const extensions = ['.js', '.jsx', '.ts', '.tsx', '.vue'];

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
        const ext = extname(entry).toLowerCase();
        if (extensions.includes(ext)) {
          results.push(entryPath);
        }
      }
    }
  }

  walk(srcDir);
  return results;
}

/**
 * 读取子包 package.json 的 name 字段。
 * 无 name 字段或无 package.json 时，使用 basename(packageRoot) 作为包名。
 */
function readPackageName(packageRoot: string): string {
  const pkgJsonPath = join(packageRoot, 'package.json');
  if (!existsSync(pkgJsonPath)) return basename(packageRoot);
  try {
    const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
    return pkg.name ?? basename(packageRoot);
  } catch {
    return basename(packageRoot);
  }
}

// ============================================================================
// 3. generateAggregateGraph：合并所有子包图谱为全局聚合图谱
// ============================================================================

/**
 * 合并所有子包的独立图谱为全局聚合图谱，解析跨包依赖，重新计算统计指标。
 *
 * @param packageGraphs 所有子包的独立图谱
 * @param projectRoot monorepo 根路径（用于 link: / file: 协议的相对路径解析）
 * @param hubThreshold hub 文件入度阈值（由 T10 编排入口传入）
 */
export function generateAggregateGraph(
  packageGraphs: KnowledgeGraph[],
  projectRoot: string,
  hubThreshold: number,
): KnowledgeGraph {
  const nodes = new Map<string, GraphNode>();
  const allEdges: GraphEdge[] = [];

  // 1. 合并所有子包的节点与边（节点 id 使用绝对路径，天然去重）
  for (const pkgGraph of packageGraphs) {
    for (const [id, node] of pkgGraph.nodes) {
      nodes.set(id, node);
    }
    for (const edge of pkgGraph.edges) {
      allEdges.push(edge);
    }
  }

  // 2. 解析跨包依赖（workspace:* / link: / file: / node_modules 软链接）
  //    返回跨包边 + 被替代的原始边 key 集合
  const { crossEdges, replacedEdgeKeys } = resolveCrossPackageDependencies(
    packageGraphs,
    nodes,
    projectRoot,
  );

  // 3. 过滤掉被跨包解析替代的原始 unresolved 边，追加跨包边
  const edges: GraphEdge[] = [];
  for (const edge of allEdges) {
    const key = `${edge.from}|${edge.rawSpec}`;
    if (edge.unresolved && replacedEdgeKeys.has(key)) {
      // 该原始 unresolved 边已被跨包边替代，跳过
      continue;
    }
    edges.push(edge);
  }
  edges.push(...crossEdges);

  // 4. 基于过滤后的 edges 重建 adjacency / reverseAdjacency
  const adjacency = new Map<string, string[]>();
  const reverseAdjacency = new Map<string, string[]>();
  for (const id of nodes.keys()) {
    adjacency.set(id, []);
    reverseAdjacency.set(id, []);
  }
  for (const edge of edges) {
    if (adjacency.has(edge.from) && reverseAdjacency.has(edge.to)) {
      adjacency.get(edge.from)!.push(edge.to);
      reverseAdjacency.get(edge.to)!.push(edge.from);
    }
  }

  // 5. 重新计算入度/出度
  for (const [id, node] of nodes) {
    node.inDegree = reverseAdjacency.get(id)?.length ?? 0;
    node.outDegree = adjacency.get(id)?.length ?? 0;
  }

  // 6. 构建聚合图谱
  const aggregateGraph: KnowledgeGraph = {
    projectRoot,
    isMonorepo: true,
    packages: packageGraphs.map(g => g.projectRoot),
    nodes,
    adjacency,
    reverseAdjacency,
    edges,
    cycles: [],
    stats: {} as GraphStats,
  };

  // 7. 重新计算循环依赖
  aggregateGraph.cycles = detectCycles(adjacency);

  // 8. 重新计算基础统计指标（nodeCount / edgeCount / cycleCount / componentCount）
  const { componentCount } = computeComponents(
    Array.from(nodes.keys()),
    edges.filter(e => !e.unresolved),
  );
  aggregateGraph.stats.nodeCount = nodes.size;
  aggregateGraph.stats.edgeCount = edges.length;
  aggregateGraph.stats.cycleCount = aggregateGraph.cycles.length;
  aggregateGraph.stats.componentCount = componentCount;

  // 9. 重新计算高级统计指标（hubCount / isolatedCount / entryCount / maxInDegree / maxOutDegree / unresolvedEdgeCount）
  return analyzeGraph(aggregateGraph, hubThreshold);
}

// ============================================================================
// 4. 跨包依赖协议解析
// ============================================================================

/**
 * 扫描所有子包图谱中 unresolved === true 的边，尝试通过 workspace 协议解析为跨包依赖。
 *
 * @param packageGraphs 所有子包图谱
 * @param nodes 聚合后的节点 Map
 * @param projectRoot monorepo 根路径（用于 link: / file: 协议的相对路径解析）
 * @returns crossEdges: 新建的跨包边列表；replacedEdgeKeys: 被替代的原始边 key 集合
 */
function resolveCrossPackageDependencies(
  packageGraphs: KnowledgeGraph[],
  nodes: Map<string, GraphNode>,
  projectRoot: string,
): { crossEdges: GraphEdge[]; replacedEdgeKeys: Set<string> } {
  const crossEdges: GraphEdge[] = [];
  const replacedEdgeKeys = new Set<string>();
  const packageByName = buildPackageByNameMap(packageGraphs);

  for (const pkgGraph of packageGraphs) {
    const pkgJsonPath = join(pkgGraph.projectRoot, 'package.json');
    if (!existsSync(pkgJsonPath)) continue;
    let pkgJson: any;
    try {
      pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
    } catch {
      continue;
    }
    const depFields = ['dependencies', 'devDependencies', 'peerDependencies'] as const;

    for (const field of depFields) {
      const deps = pkgJson[field];
      if (!deps) continue;
      for (const [depName, depSpec] of Object.entries(deps) as [string, string][]) {
        const targetEntry = resolveWorkspaceProtocol(
          depSpec,
          depName,
          pkgGraph.projectRoot,
          projectRoot,
          packageByName,
          nodes,
        );
        if (targetEntry) {
          // 为该子包中所有引用了 depName 的 unresolved 边生成跨包边
          for (const edge of pkgGraph.edges) {
            if (
              edge.unresolved &&
              (edge.rawSpec === depName || edge.rawSpec.startsWith(depName + '/'))
            ) {
              crossEdges.push({
                from: edge.from,
                to: targetEntry,
                kind: edge.kind,
                symbols: edge.symbols,
                unresolved: false,
                rawSpec: edge.rawSpec,
              });
              // 记录被替代的原始边 key，供 generateAggregateGraph 过滤
              replacedEdgeKeys.add(`${edge.from}|${edge.rawSpec}`);
            }
          }
        }
      }
    }
  }
  return { crossEdges, replacedEdgeKeys };
}

/**
 * 构建包名 → 子包入口文件绝对路径的映射。
 * 入口文件优先级：package.json main → src/index.ts → src/main.ts → 子包图谱中 isEntry 的第一个节点。
 */
function buildPackageByNameMap(packageGraphs: KnowledgeGraph[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const pkgGraph of packageGraphs) {
    const packageName = readPackageName(pkgGraph.projectRoot);
    const entry = findPackageEntry(pkgGraph.projectRoot, pkgGraph);
    if (entry) {
      map.set(packageName, entry);
    }
  }
  return map;
}

/**
 * 根据依赖 spec 前缀解析目标入口文件绝对路径。
 * 支持 workspace:* / link: / file: / pnpm node_modules 软链接四种协议。
 *
 * @param spec 依赖版本 spec（如 "workspace:*", "link:./packages/foo", "^1.0.0"）
 * @param depName 依赖包名（如 "@scope/shared"）
 * @param pkgRoot 当前子包根路径（用于查找 node_modules 软链接）
 * @param projectRoot monorepo 根路径（用于 link: / file: 相对路径解析）
 * @param packageByName 包名 → 入口文件映射
 * @param nodes 聚合节点 Map（用于验证入口文件存在）
 * @returns 解析后的入口文件绝对路径，或 null
 */
function resolveWorkspaceProtocol(
  spec: string,
  depName: string,
  pkgRoot: string,
  projectRoot: string,
  packageByName: Map<string, string>,
  nodes: Map<string, GraphNode>,
): string | null {
  // 1. workspace:* / workspace:^ / workspace:~
  if (spec.startsWith('workspace:')) {
    const entry = packageByName.get(depName);
    if (entry && nodes.has(entry)) return entry;
    return null;
  }

  // 2. link:./packages/foo
  if (spec.startsWith('link:')) {
    const relPath = spec.slice('link:'.length);
    const targetDir = resolve(projectRoot, relPath);
    const entry = findPackageEntry(targetDir);
    if (entry && nodes.has(entry)) return entry;
    return null;
  }

  // 3. file:./packages/foo
  if (spec.startsWith('file:')) {
    const relPath = spec.slice('file:'.length);
    const targetDir = resolve(projectRoot, relPath);
    const entry = findPackageEntry(targetDir);
    if (entry && nodes.has(entry)) return entry;
    return null;
  }

  // 4. pnpm 风格 node_modules 软链接
  const linkPath = join(pkgRoot, 'node_modules', depName);
  if (existsSync(linkPath)) {
    try {
      const stat = lstatSync(linkPath);
      if (stat.isSymbolicLink()) {
        const target = readlinkSync(linkPath);
        const targetDir = resolve(dirname(linkPath), target);
        // 仅当链接目标指向 projectRoot 下的 packages/ 目录时，视为跨包依赖
        const packagesDir = join(projectRoot, 'packages');
        if (targetDir.startsWith(packagesDir)) {
          const entry = findPackageEntry(targetDir);
          if (entry && nodes.has(entry)) return entry;
        }
      }
    } catch {
      // 符号链接读取失败，忽略
    }
  }

  return null;
}

/**
 * 查找子包入口文件绝对路径。
 * 优先级：package.json main → src/index.ts → src/main.ts → 图谱中 isEntry 的第一个节点。
 *
 * @param packageRoot 子包根路径
 * @param graph 子包图谱（可选，用于 isEntry 回退）
 * @returns 入口文件绝对路径，或 null
 */
function findPackageEntry(packageRoot: string, graph?: KnowledgeGraph): string | null {
  // 1. package.json main 字段
  const pkgJsonPath = join(packageRoot, 'package.json');
  if (existsSync(pkgJsonPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
      if (pkg.main) {
        const mainPath = resolve(packageRoot, pkg.main);
        if (existsSync(mainPath) && statSync(mainPath).isFile()) return mainPath;
        // 补全扩展名
        for (const ext of ['.ts', '.tsx', '.js', '.jsx']) {
          if (existsSync(mainPath + ext)) return mainPath + ext;
        }
      }
    } catch {
      // package.json 解析失败，降级
    }
  }
  // 2. src/index.ts
  const indexTs = join(packageRoot, 'src/index.ts');
  if (existsSync(indexTs)) return indexTs;
  // 3. src/main.ts
  const mainTs = join(packageRoot, 'src/main.ts');
  if (existsSync(mainTs)) return mainTs;
  // 4. 图谱中 isEntry 的第一个节点
  if (graph) {
    for (const node of graph.nodes.values()) {
      if (node.isEntry) return node.id;
    }
  }
  return null;
}
