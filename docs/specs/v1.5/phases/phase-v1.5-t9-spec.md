# T9：monorepo 支持（子包识别 + 独立图谱 + 聚合图谱）

> 版本：v1.5
> 任务编号：T9
> 对应阶段 Spec：[phase-v1.5-spec.md](phase-v1.5-spec.md)
> 对应设计文档：[design-v1.5.md](../design-v1.5.md)
> 对应执行计划：[execution-plan-v1.5.md](../execution-plan-v1.5.md)
> 依赖任务：T2（ModuleResolver）、T4（scanFilesConcurrent）、T5（buildGraph / detectCycles / computeComponents）、T6（analyzeGraph / inferLayers）
> 状态：评审中（待评审）
> 评审记录：见本文档末尾（轮次 1 待评审）

---

## 1. 任务目标

为知识图谱模块提供 monorepo 支持，使 `shield graph` 能识别 monorepo 项目结构，为每个子包生成独立图谱，并合并为全局聚合图谱。具体包括：

- 实现 `detectMonorepo` 函数，按 4 级优先级识别 monorepo 项目（package.json workspaces → lerna.json → pnpm-workspace.yaml 简化解析 → packages/* 目录约定）；
- 实现 `generatePackageGraph` 函数，以子包根目录为 projectRoot 生成独立图谱；
- 实现 `generateAggregateGraph` 函数，合并所有子包图谱，解析跨包依赖（`workspace:*` / `link:` / `file:` 协议 / node_modules 软链接），并重新计算聚合图统计指标；
- pnpm-workspace.yaml 采用**简化解析**（仅识别 `packages:` 顶层数组字面量），**不引入 `js-yaml` 依赖**（遵守 OUT-6 约束）。

对应阶段 Spec §3.8、设计文档 §6、执行计划 T9。

---

## 2. 对应需求与验收标准

| 需求编号 | 需求描述 | 本任务验收标准 |
|---|---|---|
| REQ-1.5-13 | 支持 monorepo，为每个子包生成独立图谱 + 全局聚合图谱 | `detectMonorepo` 4 级优先级识别；`generatePackageGraph` 为每个子包生成独立图谱（节点 `packageName` 字段为子包名）；`generateAggregateGraph` 合并所有子包图谱并重新计算 `stats`（非简单累加） |
| REQ-1.5-3 | 支持模块路径解析：相对路径、alias、node_modules 包、扩展名补全、index 解析 | 跨包依赖协议解析覆盖 `workspace:*` / `link:./packages/foo` / `file:./packages/foo` / node_modules 软链接（pnpm 风格），解析为对应子包入口 |
| REQ-1.5-8 | 输出 JSON 格式知识图谱（邻接表 + 反向索引 + 节点元数据 + 图统计指标） | 聚合图谱 `packages` 字段含各子包路径；`isMonorepo` 字段为 `true`；节点 `packageName` 字段正确赋值 |

---

## 3. 实现步骤

### 3.1 新增 `lib/knowledge-graph/monorepo.ts` 文件骨架

- 文件顶部 import 依赖：
  ```typescript
  import { readFileSync, existsSync, readdirSync, statSync, readlinkSync, lstatSync } from 'node:fs';
  import { join, resolve, dirname, relative, isAbsolute } from 'node:path';
  import type { GraphOptions, GraphResult } from '../types.js';
  import type { KnowledgeGraph, GraphNode, GraphEdge, GraphStats } from './types.js';
  import { ModuleResolver } from './resolver.js';
  import { collectDependencies, type CollectedFile } from './collector.js';
  import { scanFilesConcurrent } from './scanner.js';
  import { buildGraph, detectCycles, computeComponents } from './graph.js';
  import { analyzeGraph, inferLayers } from './analyzer.js';
  ```
- 不引入 `js-yaml`，pnpm-workspace.yaml 采用简化解析（见 §3.2.3）。

### 3.2 实现 `detectMonorepo` 函数

**函数签名**：
```typescript
export function detectMonorepo(projectRoot: string): { isMonorepo: boolean; packages: string[] };
```

**职责**：按 4 级优先级依次尝试识别 monorepo，命中任一级即返回，不继续向下尝试。

**返回值**：
- monorepo 项目：`{ isMonorepo: true, packages: ['/abs/path/to/packages/foo', ...] }`，`packages` 为子包根目录的**绝对路径**列表。
- 单包项目：`{ isMonorepo: false, packages: [] }`。

#### 3.2.1 优先级 1：package.json workspaces 字段

```typescript
function detectByPackageJsonWorkspaces(projectRoot: string): string[] | null {
  const pkgPath = join(projectRoot, 'package.json');
  if (!existsSync(pkgPath)) return null;
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const workspaces = pkg.workspaces;
  if (!workspaces) return null;
  // workspaces 可为字符串数组或 { packages: string[] } 对象
  const globs: string[] = Array.isArray(workspaces) ? workspaces : workspaces?.packages ?? [];
  if (globs.length === 0) return null;
  return expandWorkspaceGlobs(projectRoot, globs);
}
```

- `workspaces` 字段支持两种形式：字符串数组（npm/yarn）或 `{ packages: string[] }` 对象（yarn）。
- `expandWorkspaceGlobs(projectRoot, globs)` 辅助函数：对每个 glob 模式（如 `packages/*`），使用 `readdirSync` 列出匹配的子目录，过滤出含 `package.json` 的目录，返回绝对路径列表。
- **简化 glob 处理**：仅支持 `*` 通配符在最后一段目录的匹配（如 `packages/*`、`apps/*`），不支持 `**` 递归通配符。若 glob 含 `**`，跳过该模式（降级到下一优先级）。

#### 3.2.2 优先级 2：lerna.json packages 字段

```typescript
function detectByLernaJson(projectRoot: string): string[] | null {
  const lernaPath = join(projectRoot, 'lerna.json');
  if (!existsSync(lernaPath)) return null;
  const lerna = JSON.parse(readFileSync(lernaPath, 'utf8'));
  const globs: string[] = lerna.packages ?? [];
  if (globs.length === 0) return null;
  return expandWorkspaceGlobs(projectRoot, globs);
}
```

- `lerna.json` 为 JSON 格式，使用原生 `JSON.parse` 解析。
- `packages` 字段为字符串数组，复用 `expandWorkspaceGlobs` 展开。

#### 3.2.3 优先级 3：pnpm-workspace.yaml 简化解析

```typescript
function detectByPnpmWorkspace(projectRoot: string): string[] | null {
  const yamlPath = join(projectRoot, 'pnpm-workspace.yaml');
  if (!existsSync(yamlPath)) return null;
  const content = readFileSync(yamlPath, 'utf8');
  const globs = parsePnpmWorkspaceYaml(content);
  if (globs.length === 0) return null;
  return expandWorkspaceGlobs(projectRoot, globs);
}
```

**`parsePnpmWorkspaceYaml(content: string): string[]` 简化解析规则**：
- **不引入 `js-yaml`**，使用正则 + 字符串处理实现简化解析。
- 仅识别 `packages:` 顶层数组字面量，支持两种格式：
  1. **行内数组格式**：`packages: ['packages/*', 'apps/*']` 或 `packages: ["packages/*", "apps/*"]`
  2. **块级数组格式**：
     ```yaml
     packages:
       - 'packages/*'
       - 'apps/*'
     ```
- **解析逻辑**：
  1. 按行分割，去除每行首尾空白与注释（`#` 开头的行）。
  2. 查找以 `packages:` 开头的行。
  3. 若同行含 `[`，按行内数组格式解析：提取 `[...]` 内的字符串字面量（单引号或双引号包裹）。
  4. 若同行不含 `[`，按块级数组格式解析：从下一行开始，收集以 `-` 开头的行，提取其字符串字面量，直到遇到非 `-` 开头且非空行或文件结束。
- **降级策略**：若解析过程中遇到无法识别的语法（YAML 锚点 `&`、合并键 `<<`、多行字符串 `|` / `>` 等），返回空数组（降级为优先级 4）。
- **不支持的 YAML 特性**（文档中明确说明）：锚点（`&` / `*`）、合并键（`<<`）、多行字符串（`|` / `>`）、流式映射（`{}`）、标签（`!`）。

```typescript
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

function extractStringLiterals(s: string): string[] {
  const result: string[] = [];
  // 匹配单引号或双引号包裹的字符串
  const regex = /['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(s)) !== null) {
    result.push(match[1]);
  }
  return result;
}
```

#### 3.2.4 优先级 4：packages/* 目录约定

```typescript
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
```

- 仅当 `packages/` 目录存在且其下**每个**子目录都有 `package.json` 时，视为 monorepo。
- 若 `packages/` 目录下无任何含 `package.json` 的子目录，返回 `null`（降级为单包）。

#### 3.2.5 detectMonorepo 主函数

```typescript
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
```

### 3.3 实现 `generatePackageGraph` 函数

**函数签名**：
```typescript
export function generatePackageGraph(
  packageRoot: string,
  options: GraphOptions,
): KnowledgeGraph;
```

**职责**：以子包根目录为 projectRoot，生成该子包的独立图谱。

**实现步骤**：
1. 读取子包的 `tsconfig.json` / `jsconfig.json`，构造 `ModuleResolver`（复用 T2 的解析逻辑）。
2. 收集子包 `src/` 目录下的所有 JS/JSX/TS/TSX/Vue 文件路径。
3. 调用 `scanFilesConcurrent`（T4）扫描文件，返回 `Map<string, CollectedFile>`。
4. 调用 `buildGraph`（T5）构建 `KnowledgeGraph`。
5. 调用 `analyzeGraph`（T6）填充 role / isEntry / stats。
6. 为所有节点的 `packageName` 字段赋值为子包名（从子包 `package.json` 的 `name` 字段读取；若无 `name` 字段，使用子包目录名）。
7. 设置 `graph.isMonorepo = true`、`graph.packages = [packageRoot]`、`graph.projectRoot = packageRoot`。

```typescript
export function generatePackageGraph(
  packageRoot: string,
  options: GraphOptions,
): KnowledgeGraph {
  // 1. 读取子包 tsconfig/jsconfig，构造 resolver
  const resolver = createResolverForPackage(packageRoot);

  // 2. 收集子包 src/ 下的文件
  const srcDir = join(packageRoot, 'src');
  const filePaths = collectSourceFiles(srcDir);

  // 3. 并发扫描
  const concurrency = options.concurrency ?? 8;
  const collected = scanFilesConcurrent(filePaths, resolver, concurrency);

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
```

**辅助函数**：
- `createResolverForPackage(packageRoot: string): ModuleResolver`：读取子包的 `tsconfig.json` / `jsconfig.json`，解析 `compilerOptions.baseUrl` 与 `compilerOptions.paths`，构造 `ModuleResolver` 实例。无 tsconfig/jsconfig 时构造仅支持相对路径与 node_modules 的 resolver。
- `collectSourceFiles(srcDir: string): string[]`：递归遍历 `src/` 目录，收集 `.js` / `.jsx` / `.ts` / `.tsx` / `.vue` 文件的绝对路径。若 `src/` 不存在，返回空数组。
- `readPackageName(packageRoot: string): string`：读取子包 `package.json` 的 `name` 字段；无 `name` 字段或无 `package.json` 时，使用 `basename(packageRoot)` 作为包名。

### 3.4 实现 `generateAggregateGraph` 函数

**函数签名**：
```typescript
export function generateAggregateGraph(
  packageGraphs: KnowledgeGraph[],
  projectRoot: string,
): KnowledgeGraph;
```

**职责**：合并所有子包的独立图谱为全局聚合图谱，解析跨包依赖，重新计算统计指标。

**实现步骤**：
1. 创建空的聚合图谱结构（nodes / adjacency / reverseAdjacency / edges / cycles / stats）。
2. 合并所有子包图谱的节点与边（节点 id 使用绝对路径，天然去重）。
3. 解析跨包依赖（见 §3.5）。
4. 重新计算聚合图的 `cycles`（调用 T5 的 `detectCycles`）。
5. 重新计算 `stats`（调用 T5 的 `computeComponents` + T6 的 `analyzeGraph`）。
6. 设置 `graph.isMonorepo = true`、`graph.packages` 为所有子包路径、`graph.projectRoot = projectRoot`。

```typescript
export function generateAggregateGraph(
  packageGraphs: KnowledgeGraph[],
  projectRoot: string,
): KnowledgeGraph {
  const nodes = new Map<string, GraphNode>();
  const adjacency = new Map<string, string[]>();
  const reverseAdjacency = new Map<string, string[]>();
  const edges: GraphEdge[] = [];

  // 1. 合并所有子包的节点与边
  for (const pkgGraph of packageGraphs) {
    for (const [id, node] of pkgGraph.nodes) {
      nodes.set(id, node);
    }
    for (const edge of pkgGraph.edges) {
      edges.push(edge);
    }
    for (const [from, tos] of pkgGraph.adjacency) {
      if (!adjacency.has(from)) adjacency.set(from, []);
      adjacency.get(from)!.push(...tos);
    }
    for (const [to, froms] of pkgGraph.reverseAdjacency) {
      if (!reverseAdjacency.has(to)) reverseAdjacency.set(to, []);
      reverseAdjacency.get(to)!.push(...froms);
    }
  }

  // 2. 解析跨包依赖（workspace:* / link: / file: / node_modules 软链接）
  const crossPackageEdges = resolveCrossPackageDependencies(packageGraphs, nodes);
  edges.push(...crossPackageEdges);
  for (const edge of crossPackageEdges) {
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
    adjacency.get(edge.from)!.push(edge.to);
    if (!reverseAdjacency.has(edge.to)) reverseAdjacency.set(edge.to, []);
    reverseAdjacency.get(edge.to)!.push(edge.from);
  }

  // 3. 重新计算入度/出度
  for (const [id, node] of nodes) {
    node.inDegree = reverseAdjacency.get(id)?.length ?? 0;
    node.outDegree = adjacency.get(id)?.length ?? 0;
  }

  // 4. 构建聚合图谱
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

  // 5. 重新计算循环依赖
  aggregateGraph.cycles = detectCycles(adjacency);

  // 6. 重新计算统计指标（调用 T6 analyzeGraph）
  const hubThreshold = 10; // 聚合图使用默认阈值，由 T10 传入
  return analyzeGraph(aggregateGraph, hubThreshold);
}
```

### 3.5 实现跨包依赖协议解析

**函数签名**：
```typescript
function resolveCrossPackageDependencies(
  packageGraphs: KnowledgeGraph[],
  nodes: Map<string, GraphNode>,
): GraphEdge[];
```

**职责**：扫描所有子包图谱中 `unresolved === true` 的边，尝试通过 workspace 协议解析为跨包依赖。

**支持的协议**：

#### 3.5.1 `workspace:*` 协议

- **场景**：子包 `package.json` 的 `dependencies` 中使用 `"@scope/shared": "workspace:*"`。
- **解析方式**：
  1. 遍历每个子包的 `package.json` 的 `dependencies` / `devDependencies` / `peerDependencies`。
  2. 对值为 `workspace:*` / `workspace:^` / `workspace:~` 的依赖，提取依赖包名。
  3. 在所有子包中查找 `package.json` 的 `name` 字段匹配该包名的子包。
  4. 将该子包的入口文件（`src/index.ts` / `src/main.ts` / `package.json` 的 `main` 字段对应的文件）作为解析目标。
  5. 生成 `GraphEdge`，`kind` 为原边的 `kind`，`unresolved` 设为 `false`。

#### 3.5.2 `link:./packages/foo` 协议

- **场景**：子包 `package.json` 的 `dependencies` 中使用 `"@scope/shared": "link:./packages/shared"`。
- **解析方式**：
  1. 提取 `link:` 前缀后的相对路径。
  2. 相对于 projectRoot 解析为绝对路径。
  3. 在 `nodes` Map 中查找该路径下的入口文件节点。
  4. 生成跨包 `GraphEdge`。

#### 3.5.3 `file:./packages/foo` 协议

- **场景**：子包 `package.json` 的 `dependencies` 中使用 `"@scope/shared": "file:./packages/shared"`。
- **解析方式**：与 `link:` 协议相同，提取 `file:` 前缀后的相对路径，解析为绝对路径，查找入口文件节点。

#### 3.5.4 node_modules 软链接（pnpm 风格）

- **场景**：pnpm 在 `node_modules/<pkg-name>` 下创建指向 `../../packages/<pkg-name>` 的符号链接。
- **解析方式**：
  1. 对每个子包，检查 `node_modules/<dep-name>` 是否为符号链接（使用 `lstatSync().isSymbolicLink()`）。
  2. 若是符号链接，使用 `readlinkSync()` 读取链接目标。
  3. 将链接目标解析为绝对路径（`resolve(dirname(linkPath), target)`）。
  4. 若链接目标指向 projectRoot 下的 `packages/` 子目录，视为跨包依赖，查找入口文件节点。

```typescript
function resolveCrossPackageDependencies(
  packageGraphs: KnowledgeGraph[],
  nodes: Map<string, GraphNode>,
): GraphEdge[] {
  const crossEdges: GraphEdge[] = [];
  const packageByName = buildPackageByNameMap(packageGraphs);
  const projectRoot = packageGraphs[0]?.projectRoot ?? '';

  for (const pkgGraph of packageGraphs) {
    const pkgJsonPath = join(pkgGraph.projectRoot, 'package.json');
    if (!existsSync(pkgJsonPath)) continue;
    const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
    const depFields = ['dependencies', 'devDependencies', 'peerDependencies'] as const;

    for (const field of depFields) {
      const deps = pkgJson[field];
      if (!deps) continue;
      for (const [depName, depSpec] of Object.entries(deps) as [string, string][]) {
        const targetEntry = resolveWorkspaceProtocol(depSpec, depName, pkgGraph.projectRoot, projectRoot, packageByName, nodes);
        if (targetEntry) {
          // 为该子包中所有引用了 depName 的 unresolved 边生成跨包边
          for (const edge of pkgGraph.edges) {
            if (edge.unresolved && (edge.rawSpec === depName || edge.rawSpec.startsWith(depName + '/'))) {
              crossEdges.push({
                from: edge.from,
                to: targetEntry,
                kind: edge.kind,
                symbols: edge.symbols,
                unresolved: false,
                rawSpec: edge.rawSpec,
              });
            }
          }
        }
      }
    }
  }
  return crossEdges;
}
```

**辅助函数**：
- `buildPackageByNameMap(packageGraphs: KnowledgeGraph[]): Map<string, string>`：构建包名 → 子包入口文件绝对路径的映射。入口文件优先级：`package.json` 的 `main` 字段 → `src/index.ts` → `src/main.ts` → 子包图谱中 `isEntry === true` 的第一个节点。
- `resolveWorkspaceProtocol(spec: string, depName: string, pkgRoot: string, projectRoot: string, packageByName: Map<string, string>, nodes: Map<string, GraphNode>): string | null`：根据 spec 前缀（`workspace:` / `link:` / `file:` / 符号链接）解析目标入口文件绝对路径，失败返回 `null`。

### 3.6 `expandWorkspaceGlobs` 辅助函数

```typescript
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
```

---

## 4. 测试计划

### 4.1 单元测试

> 单元测试文件：`tests/knowledge-graph/monorepo.test.ts`（由 T12 实现，本任务仅定义测试用例清单）

**detectMonorepo 测试用例**：

| 用例编号 | 场景 | 输入 | 预期输出 |
|---|---|---|---|
| TC-9-1 | package.json 含 `workspaces: ['packages/*']` | projectRoot 指向含 workspaces 字段的项目 | `{ isMonorepo: true, packages: [含 packages/ 下所有子包绝对路径] }` |
| TC-9-2 | package.json 含 `workspaces: { packages: ['packages/*'] }` | yarn 风格对象格式 | `{ isMonorepo: true, packages: [...] }` |
| TC-9-3 | lerna.json 含 `packages: ['packages/*']` | projectRoot 无 workspaces 但有 lerna.json | `{ isMonorepo: true, packages: [...] }` |
| TC-9-4 | pnpm-workspace.yaml 行内数组格式 | `packages: ['packages/*']` | `{ isMonorepo: true, packages: [...] }` |
| TC-9-5 | pnpm-workspace.yaml 块级数组格式 | 多行 `- 'packages/*'` | `{ isMonorepo: true, packages: [...] }` |
| TC-9-6 | pnpm-workspace.yaml 含 YAML 锚点 | `packages: [*foo]` 等高级特性 | 降级为优先级 4 或返回 `isMonorepo: false` |
| TC-9-7 | packages/* 目录约定 | projectRoot 无上述配置但有 packages/ 目录 | `{ isMonorepo: true, packages: [...] }` |
| TC-9-8 | 单包项目 | projectRoot 无任何 monorepo 配置 | `{ isMonorepo: false, packages: [] }` |
| TC-9-9 | 优先级覆盖 | 同时存在 package.json workspaces 与 lerna.json | 优先级 1（package.json workspaces）生效 |
| TC-9-10 | packages/ 目录下部分子目录无 package.json | packages/a 有 package.json，packages/b 无 | 仅识别 packages/a |

**generatePackageGraph 测试用例**：

| 用例编号 | 场景 | 预期输出 |
|---|---|---|
| TC-9-11 | 子包含 src/ 目录与 tsconfig.json | 生成独立图谱，节点 `packageName` 为子包名 |
| TC-9-12 | 子包无 src/ 目录 | 生成空图谱（nodes 为空 Map），不抛异常 |
| TC-9-13 | 子包 package.json 无 name 字段 | `packageName` 使用子包目录名 |

**generateAggregateGraph 测试用例**：

| 用例编号 | 场景 | 预期输出 |
|---|---|---|
| TC-9-14 | 两个子包，workspace:* 协议跨包依赖 | 聚合图谱含跨包边，`unresolved === false` |
| TC-9-15 | 两个子包，link: 协议跨包依赖 | 聚合图谱含跨包边 |
| TC-9-16 | 两个子包，file: 协议跨包依赖 | 聚合图谱含跨包边 |
| TC-9-17 | pnpm 风格 node_modules 软链接 | 聚合图谱含跨包边 |
| TC-9-18 | 聚合图 stats 重新计算 | `stats.nodeCount` 等于所有子包节点总数，`stats` 非简单累加（cycleCount / componentCount 重新计算） |
| TC-9-19 | 跨包循环依赖 | 聚合图谱 `cycles` 含跨包循环链 |

### 4.2 集成测试

> 集成测试文件：`tests/knowledge-graph/integration.test.ts`（由 T12 实现）

- **monorepo-project 端到端**：使用 `tests/knowledge-graph/fixtures/monorepo-project/` 夹具（含 pnpm-workspace.yaml + packages/shared + packages/app），验证：
  - `detectMonorepo` 正确识别为 monorepo；
  - 每个子包生成独立图谱；
  - 聚合图谱包含跨包依赖（packages/app 依赖 packages/shared）；
  - 聚合图谱 `stats` 被重新计算。

### 4.3 回归测试

- 本任务仅新增 `lib/knowledge-graph/monorepo.ts`，不修改任何既有文件，无回归风险。
- T12 回归测试要求 `pnpm test` 全量通过，v1.1~v1.4 既有测试零回归。

---

## 5. 风险与依赖

| 风险 / 依赖 | 影响 | 应对措施 |
|---|---|---|
| pnpm-workspace.yaml 简化解析漏覆盖部分 monorepo 配置 | 部分 pnpm monorepo 无法识别 | 降级为优先级 4（packages/* 目录约定）；文档明确不支持 YAML 高级特性（锚点 / 合并键 / 多行字符串） |
| 跨包依赖协议解析不完整 | 聚合图谱可能遗漏部分跨包边 | 覆盖 4 种协议（workspace:* / link: / file: / node_modules 软链接）；未解析的跨包边保留 `unresolved: true`，不丢弃 |
| 依赖 T2（ModuleResolver）、T4（scanFilesConcurrent）、T5（buildGraph / detectCycles / computeComponents）、T6（analyzeGraph / inferLayers） | 上游任务延迟将阻塞 T9 | T9 可在 T6 完成后立即启动；T9 与 T7 / T8 在时间上可重叠 |
| 子包无 src/ 目录 | generatePackageGraph 抛异常 | `collectSourceFiles` 返回空数组，生成空图谱，不抛异常 |
| workspace glob 含 `**` 递归通配符 | expandWorkspaceGlobs 无法处理 | 跳过含 `**` 的 glob 模式，降级到下一优先级 |
| 聚合图 stats 简单累加而非重新计算 | 统计指标不准确 | `generateAggregateGraph` 必须调用 `detectCycles` + `computeComponents` + `analyzeGraph` 重新计算，不使用子包 stats 累加 |

---

## 6. 变更范围

- **本任务范围内**：
  - 新增 `lib/knowledge-graph/monorepo.ts`：`detectMonorepo` / `generatePackageGraph` / `generateAggregateGraph` 及辅助函数。
- **不在本任务范围内**：
  - `lib/knowledge-graph/resolver.ts`（由 T2 负责）；
  - `lib/knowledge-graph/scanner.ts`（由 T4 负责）；
  - `lib/knowledge-graph/graph.ts`（由 T5 负责）；
  - `lib/knowledge-graph/analyzer.ts`（由 T6 负责）；
  - `lib/knowledge-graph/index.ts` 编排入口（由 T10 负责，T10 调用本任务的 `detectMonorepo` / `generatePackageGraph` / `generateAggregateGraph`）；
  - 测试夹具与测试用例实现（由 T12 负责，本任务仅定义测试用例清单）；
  - **不引入 `js-yaml` 依赖**（遵守 OUT-6 约束）；
  - **不修改 `package.json` 依赖列表**。

---

## 7. 评审记录

| 轮次 | 日期 | 结论 | P0/P1 问题 | 修复方案 |
|---|---|---|---|---|
| 1 | 待评审 | 待评审 | — | — |
