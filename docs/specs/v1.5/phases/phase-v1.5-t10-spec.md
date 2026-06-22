# T10：编排入口（lib/knowledge-graph/index.ts runKnowledgeGraph）

> 版本：v1.5
> 任务编号：T10
> 对应阶段 Spec：[phase-v1.5-spec.md](phase-v1.5-spec.md)
> 对应设计文档：[design-v1.5.md](../design-v1.5.md)
> 对应执行计划：[execution-plan-v1.5.md](../execution-plan-v1.5.md)
> 依赖任务：T7（writeJson）、T8（writeMarkdown）、T9（detectMonorepo / generatePackageGraph / generateAggregateGraph）
> 状态：评审中（待评审）
> 评审记录：见本文档末尾（轮次 1 待评审）

---

## 1. 任务目标

实现知识图谱模块的编排入口 `runKnowledgeGraph`，将 scanner → graph → analyzer → monorepo → output 完整流程串联为单一函数调用。具体包括：

- 实现 `lib/knowledge-graph/index.ts`，导出 `runKnowledgeGraph(options: GraphOptions): Promise<GraphResult>` 函数；
- 编排单包流程：scanner → buildGraph → analyzeGraph → inferLayers → output；
- 编排 monorepo 流程：detectMonorepo → generatePackageGraph（每个子包）→ generateAggregateGraph → analyzeGraph → inferLayers → output；
- 根据 `options.format` 调度 JSON / Markdown / 双格式输出；
- 计算并返回 `GraphResult`（含 `durationMs` 耗时）。

对应阶段 Spec §3.1（模块关系中的编排入口层）、设计文档 §11.1 / §9.1、执行计划 T10。

---

## 2. 对应需求与验收标准

| 需求编号 | 需求描述 | 本任务验收标准 |
|---|---|---|
| REQ-1.5-1 | 扫描目标项目 src 下的 JS/JSX/TS/TSX/Vue 文件，构建文件级依赖图 | `runKnowledgeGraph` 编排 scanner → graph → analyzer 完整流程，不跳过任何环节 |
| REQ-1.5-13 | 支持 monorepo，为每个子包生成独立图谱 + 全局聚合图谱 | monorepo 流程编排 detectMonorepo → generatePackageGraph → generateAggregateGraph → analyzeGraph → inferLayers |
| REQ-1.5-14 | 默认输出到 `<project>/.legacy-shield/knowledge-graph/` 目录，可通过 --out 自定义 | `options.out` 未传时输出到 `<project>/.legacy-shield/knowledge-graph/`；传入时输出到指定目录 |
| REQ-1.5-8 | 输出 JSON 格式知识图谱 | `options.format === 'json'` 或 `'both'` 时调用 `writeJson` 生成 `knowledge-graph.json` |
| REQ-1.5-9 | 输出中文 Markdown 格式架构摘要 | `options.format === 'md'` 或 `'both'` 时调用 `writeMarkdown` 生成 `architecture-summary.md` |

---

## 3. 实现步骤

### 3.1 新增 `lib/knowledge-graph/index.ts` 文件

- 文件顶部 import 依赖：
  ```typescript
  import { existsSync, mkdirSync } from 'node:fs';
  import { join, resolve, isAbsolute } from 'node:path';
  import type { GraphOptions, GraphResult } from '../types.js';
  import type { KnowledgeGraph } from './types.js';
  import { ModuleResolver } from './resolver.js';
  import { scanFilesConcurrent } from './scanner.js';
  import { buildGraph } from './graph.js';
  import { analyzeGraph, inferLayers } from './analyzer.js';
  import { writeJson } from './json-output.js';
  import { writeMarkdown } from './markdown-output.js';
  import { detectMonorepo, generatePackageGraph, generateAggregateGraph } from './monorepo.js';
  ```
- `runKnowledgeGraph` 不直接依赖 `commander`，可被 CLI（T11）与测试独立调用。

### 3.2 实现 `runKnowledgeGraph` 函数

**函数签名**：
```typescript
export async function runKnowledgeGraph(options: GraphOptions): Promise<GraphResult>;
```

**参数说明**（`GraphOptions` 由 T1 在 `lib/types.ts` 中定义）：
- `project: string`：目标项目根路径（必填）。
- `out?: string`：输出目录（可选，默认 `<project>/.legacy-shield/knowledge-graph/`）。
- `concurrency?: number`：并发扫描数（可选，默认 8）。
- `fresh?: boolean`：强制全量重建，忽略缓存（可选，默认 false）。
- `format?: 'json' | 'md' | 'both'`：输出格式（可选，默认 'both'）。
- `hubThreshold?: number`：hub 文件入度阈值（可选，默认 10）。

**返回值说明**（`GraphResult` 由 T1 在 `lib/types.ts` 中定义）：
```typescript
export type GraphResult = {
  projectRoot: string;
  isMonorepo: boolean;
  packages: string[];
  outputPath: string;
  nodeCount: number;
  edgeCount: number;
  cycleCount: number;
  durationMs: number;
};
```

### 3.3 编排主流程

```typescript
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
      await writeMarkdown(graph, layers, outputPath);
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
  } finally {
    // durationMs 在 return 时已计算，finally 块仅用于资源清理（如有）
    // 注意：durationMs 的计算在 return 语句中完成，确保覆盖正常与异常路径
  }
}
```

> **durationMs 计算说明**：`startTime` 在函数入口记录，`durationMs = Date.now() - startTime` 在 `return` 语句中计算。若函数在 `try` 块中抛异常，异常向上传播，`durationMs` 不被返回（调用方通过 catch 处理错误）。`finally` 块保留用于未来扩展资源清理逻辑。

### 3.4 单包流程

**函数签名**：
```typescript
async function runSinglePackageFlow(
  projectRoot: string,
  options: GraphOptions,
  hubThreshold: number,
  concurrency: number,
): Promise<KnowledgeGraph>;
```

**实现步骤**：
1. 读取目标项目根目录的 `tsconfig.json` / `jsconfig.json`，构造 `ModuleResolver`（T2）。
2. 收集 `src/` 目录下的所有 JS/JSX/TS/TSX/Vue 文件路径。
3. 调用 `scanFilesConcurrent`（T4）扫描文件，返回 `Map<string, CollectedFile>`，传入 `options.fresh` 控制缓存行为。
4. 调用 `buildGraph`（T5）构建 `KnowledgeGraph`。
5. 调用 `analyzeGraph`（T6）填充 role / isEntry / stats。
6. 返回 `KnowledgeGraph`。

```typescript
async function runSinglePackageFlow(
  projectRoot: string,
  options: GraphOptions,
  hubThreshold: number,
  concurrency: number,
): Promise<KnowledgeGraph> {
  // 1. 构造 resolver
  const resolver = createResolver(projectRoot);

  // 2. 收集 src/ 下的文件
  const srcDir = join(projectRoot, 'src');
  const filePaths = collectSourceFiles(srcDir);

  // 3. 并发扫描
  const collected = await scanFilesConcurrent(filePaths, resolver, concurrency, options.fresh ?? false, projectRoot);

  // 4. 构建图
  let graph = buildGraph(projectRoot, collected, resolver);

  // 5. 分析图（填充 role / isEntry / stats）
  graph = analyzeGraph(graph, hubThreshold);

  return graph;
}
```

> **注意**：`scanFilesConcurrent` 的 `fresh` 参数与 `projectRoot` 参数用于 mtime 缓存的读写（T4 实现）。本任务仅负责将 `options.fresh` 透传至 `scanFilesConcurrent`。

### 3.5 monorepo 流程

**函数签名**：
```typescript
async function runMonorepoFlow(
  projectRoot: string,
  packages: string[],
  options: GraphOptions,
  hubThreshold: number,
  concurrency: number,
): Promise<KnowledgeGraph>;
```

**实现步骤**：
1. 对每个子包调用 `generatePackageGraph`（T9）生成独立图谱。
2. 调用 `generateAggregateGraph`（T9）合并为聚合图谱。
3. 对聚合图谱调用 `analyzeGraph`（T6）重新计算统计指标。
4. 返回聚合 `KnowledgeGraph`。

```typescript
async function runMonorepoFlow(
  projectRoot: string,
  packages: string[],
  options: GraphOptions,
  hubThreshold: number,
  concurrency: number,
): Promise<KnowledgeGraph> {
  // 1. 为每个子包生成独立图谱
  const packageGraphs: KnowledgeGraph[] = [];
  for (const packageRoot of packages) {
    const packageOptions: GraphOptions = {
      ...options,
      project: packageRoot,
      concurrency,
      hubThreshold,
    };
    const packageGraph = generatePackageGraph(packageRoot, packageOptions);
    packageGraphs.push(packageGraph);
  }

  // 2. 合并为聚合图谱
  let aggregateGraph = generateAggregateGraph(packageGraphs, projectRoot);

  // 3. 对聚合图谱重新计算统计指标
  aggregateGraph = analyzeGraph(aggregateGraph, hubThreshold);

  // 4. 返回聚合图谱（inferLayers 在主流程中调用）
  return aggregateGraph;
}
```

> **关键点**：monorepo 流程中 `inferLayers` 在主流程（§3.3 第 3 步）统一调用，对聚合图谱生成分层结构，供 T8 `writeMarkdown` 使用。这是执行计划第 2 轮评审的 P1 修复项——确保 monorepo 流程不遗漏 `inferLayers` 调用。

### 3.6 辅助函数

#### 3.6.1 `resolveOutputPath`

```typescript
function resolveOutputPath(out: string | undefined, projectRoot: string): string {
  if (out && out.length > 0) {
    // 自定义输出路径：相对路径基于 projectRoot 解析
    return isAbsolute(out) ? out : resolve(projectRoot, out);
  }
  // 默认输出路径：<project>/.legacy-shield/knowledge-graph/
  return join(projectRoot, '.legacy-shield', 'knowledge-graph');
}
```

#### 3.6.2 `createResolver`

```typescript
function createResolver(projectRoot: string): ModuleResolver {
  // 读取 tsconfig.json，若不存在读取 jsconfig.json
  const tsconfigPath = join(projectRoot, 'tsconfig.json');
  const jsconfigPath = join(projectRoot, 'jsconfig.json');
  const configPath = existsSync(tsconfigPath) ? tsconfigPath : (existsSync(jsconfigPath) ? jsconfigPath : null);

  if (!configPath) {
    // 无 tsconfig/jsconfig，构造仅支持相对路径与 node_modules 的 resolver
    return new ModuleResolver({ projectRoot });
  }

  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const compilerOptions = config.compilerOptions ?? {};
  const baseUrl = compilerOptions.baseUrl ? resolve(projectRoot, compilerOptions.baseUrl) : projectRoot;
  const paths = compilerOptions.paths ?? undefined;

  return new ModuleResolver({ projectRoot, baseUrl, paths });
}
```

> **注意**：`createResolver` 与 T9 `generatePackageGraph` 中的 `createResolverForPackage` 逻辑相同。为避免代码重复，T9 的 `createResolverForPackage` 可直接调用本函数，或将本函数提取为公共辅助函数。本任务实现 `createResolver`，T9 复用。

#### 3.6.3 `collectSourceFiles`

```typescript
function collectSourceFiles(srcDir: string): string[] {
  if (!existsSync(srcDir)) return [];
  const extensions = ['.js', '.jsx', '.ts', '.tsx', '.vue'];
  const results: string[] = [];
  function walk(dir: string) {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (stat.isFile() && extensions.some(ext => entry.endsWith(ext))) {
        results.push(fullPath);
      }
    }
  }
  walk(srcDir);
  return results;
}
```

> **注意**：`collectSourceFiles` 与 T9 `generatePackageGraph` 中的文件收集逻辑相同。为避免代码重复，可将本函数提取为公共辅助函数供 T9 复用，或在 T9 中直接调用本函数。本任务实现 `collectSourceFiles`，T9 复用。

### 3.7 import 依赖完整清单

文件顶部需补充以下 import（§3.1 中未列出的辅助函数依赖）：

```typescript
import { readFileSync, existsSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';
```

---

## 4. 测试计划

### 4.1 单元测试

> 单元测试文件：`tests/knowledge-graph/integration.test.ts`（由 T12 实现，本任务仅定义测试用例清单）

**runKnowledgeGraph 测试用例**：

| 用例编号 | 场景 | 输入 | 预期输出 |
|---|---|---|---|
| TC-10-1 | 单包项目，format='both' | simple-project 夹具，`{ project, format: 'both' }` | `GraphResult` 含 `isMonorepo: false`、`packages: []`、`outputPath` 为默认路径、`nodeCount > 0`、`durationMs >= 0`；输出目录含 `knowledge-graph.json` 与 `architecture-summary.md` |
| TC-10-2 | 单包项目，format='json' | simple-project 夹具，`{ project, format: 'json' }` | 仅生成 `knowledge-graph.json`，无 `architecture-summary.md` |
| TC-10-3 | 单包项目，format='md' | simple-project 夹具，`{ project, format: 'md' }` | 仅生成 `architecture-summary.md`，无 `knowledge-graph.json` |
| TC-10-4 | monorepo 项目 | monorepo-project 夹具，`{ project, format: 'both' }` | `GraphResult` 含 `isMonorepo: true`、`packages` 含各子包路径；聚合图谱 `stats` 被重新计算 |
| TC-10-5 | 自定义输出路径 | simple-project 夹具，`{ project, out: '/tmp/kg-output' }` | `outputPath` 为 `/tmp/kg-output`，文件输出到该目录 |
| TC-10-6 | fresh=true | simple-project 夹具，首次扫描后再次调用 `{ fresh: true }` | 忽略缓存全量重建，结果与首次一致 |
| TC-10-7 | durationMs 非负整数 | 任意项目 | `durationMs` 为 `number` 类型，`>= 0`，`Number.isInteger(durationMs) === true` |
| TC-10-8 | 自定义 hubThreshold | simple-project 夹具，`{ hubThreshold: 5 }` | 图谱中 `role === 'core'` 的节点入度 >= 5 |
| TC-10-9 | 自定义 concurrency | simple-project 夹具，`{ concurrency: 2 }` | 扫描正常完成，不抛异常 |
| TC-10-10 | 无 src/ 目录的项目 | projectRoot 下无 src/ 目录 | `nodeCount: 0`、`edgeCount: 0`，不抛异常 |

### 4.2 集成测试

> 集成测试文件：`tests/knowledge-graph/integration.test.ts`（由 T12 实现）

- **单包端到端**：`runKnowledgeGraph({ project: simple-project, format: 'both' })` → 验证 JSON + Markdown 输出。
- **monorepo 端到端**：`runKnowledgeGraph({ project: monorepo-project, format: 'both' })` → 验证子包识别 + 聚合图谱。
- **alias 项目端到端**：`runKnowledgeGraph({ project: alias-project })` → 验证 tsconfig paths 解析。
- **循环依赖端到端**：`runKnowledgeGraph({ project: cycle-project })` → 验证循环检测。
- **增量更新端到端**：首次全量 → 修改文件 → 再次调用（`fresh: false`）→ 验证增量扫描。

### 4.3 回归测试

- 本任务仅新增 `lib/knowledge-graph/index.ts`，不修改任何既有文件，无回归风险。
- T12 回归测试要求 `pnpm test` 全量通过，v1.1~v1.4 既有测试零回归。

---

## 5. 风险与依赖

| 风险 / 依赖 | 影响 | 应对措施 |
|---|---|---|
| 依赖 T7（writeJson）、T8（writeMarkdown）、T9（detectMonorepo / generatePackageGraph / generateAggregateGraph） | 上游任务延迟将阻塞 T10 | T10 为编排入口，必须在 T7、T8、T9 全部完成后进行；T9 与 T7 / T8 可并行推进 |
| monorepo 流程遗漏 inferLayers 调用 | Markdown 摘要缺少分层结构信息 | `inferLayers` 在主流程（§3.3 第 3 步）统一调用，单包与 monorepo 流程均覆盖；这是执行计划 R2→R3 的 P1 修复项 |
| durationMs 计算不准确 | 性能指标失真 | `startTime` 在函数入口记录，`durationMs` 在 `return` 语句中计算，覆盖完整流程耗时 |
| 输出目录不存在 | writeJson / writeMarkdown 抛异常 | 主流程在输出前调用 `mkdirSync(outputPath, { recursive: true })` 确保目录存在 |
| 无 src/ 目录的项目 | collectSourceFiles 抛异常 | `collectSourceFiles` 返回空数组，生成空图谱，`GraphResult.nodeCount: 0`，不抛异常 |
| runKnowledgeGraph 直接依赖 commander | 无法被测试独立调用 | `runKnowledgeGraph` 不 import commander，仅接收 `GraphOptions` 参数，CLI 层（T11）负责 commander 参数转换 |

---

## 6. 变更范围

- **本任务范围内**：
  - 新增 `lib/knowledge-graph/index.ts`：`runKnowledgeGraph` 函数及辅助函数（`runSinglePackageFlow` / `runMonorepoFlow` / `resolveOutputPath` / `createResolver` / `collectSourceFiles`）。
- **不在本任务范围内**：
  - `lib/knowledge-graph/resolver.ts`（由 T2 负责）；
  - `lib/knowledge-graph/scanner.ts`（由 T4 负责）；
  - `lib/knowledge-graph/graph.ts`（由 T5 负责）；
  - `lib/knowledge-graph/analyzer.ts`（由 T6 负责）；
  - `lib/knowledge-graph/json-output.ts`（由 T7 负责）；
  - `lib/knowledge-graph/markdown-output.ts`（由 T8 负责）；
  - `lib/knowledge-graph/monorepo.ts`（由 T9 负责）；
  - `lib/cli/graph.ts` CLI 适配器（由 T11 负责，T11 调用本任务的 `runKnowledgeGraph`）；
  - 测试夹具与测试用例实现（由 T12 负责，本任务仅定义测试用例清单）；
  - **不修改 `cli.ts`**（由 T11 负责）；
  - **不修改 `lib/types.ts`**（由 T1 负责）。

---

## 7. 评审记录

| 轮次 | 日期 | 结论 | P0/P1 问题 | 修复方案 |
|---|---|---|---|---|
| 1 | 待评审 | 待评审 | — | — |
