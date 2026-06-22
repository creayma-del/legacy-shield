# T4：文件扫描器改造（并发 + mtime 缓存 + 异常处理）

> 版本：v1.5
> 任务编号：T4
> 对应阶段 Spec：[phase-v1.5-spec.md](phase-v1.5-spec.md)
> 对应设计文档：[design-v1.5.md](../design-v1.5.md)
> 对应执行计划：[execution-plan-v1.5.md](../execution-plan-v1.5.md)
> 依赖任务：T2、T3
> 状态：评审中（待评审）
> 评审记录：见本文档末尾（轮次 1 待评审）

---

## 1. 任务目标

为 v1.5 知识图谱生成模块提供高性能的并发文件扫描能力，支持 5000 文件规模项目的快速扫描。具体包括：
- 新增 `lib/knowledge-graph/scanner.ts`，实现 `scanFilesConcurrent` 并发扫描函数（索引游标替代 `queue.shift()` 避免 O(n) 开销）；
- 实现 mtime 缓存机制（`CacheEntry` / `CacheFile` 结构），未变更文件跳过重新解析，支持增量更新；
- 实现四种缓存失效策略（文件 mtime 变更 / alias 配置 hash 变更 / `--fresh` 参数 / 缓存文件不存在）；
- 单文件解析异常隔离，单文件失败不影响整体扫描。

对应阶段 Spec §3.9（并发扫描与缓存）与交付物 D5。本任务依赖 T2（ModuleResolver 实例）与 T3（CollectedFile 类型 + collectDependencies 调用），是 T9 monorepo 支持的前置依赖。

---

## 2. 对应需求与验收标准

| 需求编号 | 需求描述 | 本任务验收标准 |
|---|---|---|
| REQ-1.5-11 | 支持并发文件扫描（Promise.all + 限流） | `scanFilesConcurrent` 使用索引游标 `cursor` 替代 `queue.shift()`（代码中无 `shift()` 调用）；创建 `concurrency` 个 worker，每个 worker 通过 `while (cursor < filePaths.length)` 循环取任务；并发数可通过参数配置，默认 8 |
| REQ-1.5-12 | 支持文件 mtime 缓存，未变更文件跳过重新解析（增量更新） | mtime 缓存结构为 `Record<string, CacheEntry>`（`CacheFile.entries` 字段）；首次扫描后 `.cache.json` 文件生成于 `<project>/.legacy-shield/knowledge-graph/.cache.json`；第二次扫描（无文件变更）命中缓存，跳过 `collectDependencies` 调用；修改某文件后第二次扫描，仅该文件重新解析，其余命中缓存 |
| REQ-1.5-16 | 目标项目规模支持到 5000 文件 | 并发扫描 + mtime 缓存 + 增量更新，5000 文件全量扫描 < 30 秒（SSD 存储，并发数=8）；单文件解析抛错时，该文件在返回 Map 中对应 `{ dependencies: [], exports: [] }`，整体扫描不中断 |

---

## 3. 实现步骤

### 3.1 新增 `lib/knowledge-graph/scanner.ts` 文件结构与接口定义

- **文件位置**：`lib/knowledge-graph/scanner.ts`（新增文件）。
- **导入依赖**（均为项目现有依赖，不引入新依赖）：

  ```typescript
  import { readFile, writeFile, mkdir } from 'node:fs/promises';
  import { existsSync, statSync } from 'node:fs';
  import { createHash } from 'node:crypto';
  import { join, dirname } from 'node:path';
  import type { ModuleResolver } from './resolver.js';
  import type { CollectedDependency, CollectedFile } from './collector.js';
  import { collectDependencies } from './collector.js';
  ```

- **新增 `CacheEntry` 接口**（严格按设计文档 [design-v1.5.md §8.2](../design-v1.5.md#82-mtime-缓存设计) 定义）：

  ```typescript
  export interface CacheEntry {
    /** 文件路径 */
    path: string;
    /** 文件 mtime（毫秒时间戳） */
    mtime: number;
    /** alias 配置 hash（用于检测 alias 变更） */
    aliasHash: string;
    /** 解析结果（依赖列表） */
    dependencies: CollectedDependency[];
    /** 导出符号列表 */
    exports: string[];
  }
  ```

- **新增 `CacheFile` 接口**：

  ```typescript
  export interface CacheFile {
    /** 缓存版本 */
    version: string;
    /** 生成时间（ISO 8601 格式） */
    generatedAt: string;
    /** alias 配置 hash */
    aliasHash: string;
    /** 缓存条目（以文件路径为 key，确保 JSON 可序列化） */
    entries: Record<string, CacheEntry>;
  }
  ```

  - **`entries` 为 `Record` 类型（非 `Map`）**：确保 JSON 可序列化，与设计 §8.2 说明一致。

### 3.2 实现 `scanFilesConcurrent` 并发扫描函数

- **函数签名**：

  ```typescript
  export async function scanFilesConcurrent(
    filePaths: string[],
    resolver: ModuleResolver,
    concurrency: number,
  ): Promise<Map<string, CollectedFile>>
  ```

- **实现**（严格按设计文档 [design-v1.5.md §8.1](../design-v1.5.md#81-并发扫描策略) 实现）：

  ```typescript
  export async function scanFilesConcurrent(
    filePaths: string[],
    resolver: ModuleResolver,
    concurrency: number,
  ): Promise<Map<string, CollectedFile>> {
    const results = new Map<string, CollectedFile>();
    let cursor = 0;

    const workers = Array.from({ length: concurrency }, async () => {
      while (cursor < filePaths.length) {
        const filePath = filePaths[cursor++];
        if (!filePath) break;
        try {
          const code = await readFile(filePath, 'utf8');
          const deps = collectDependencies(filePath, code, resolver);
          results.set(filePath, deps);
        } catch (err) {
          // 单文件失败仅告警并写入空依赖，不影响整体扫描
          console.warn(
            `[scanner] 处理文件失败: ${filePath}`,
            err instanceof Error ? err.message : String(err),
          );
          results.set(filePath, { dependencies: [], exports: [] });
        }
      }
    });

    await Promise.all(workers);
    return results;
  }
  ```

  - **索引游标 `cursor`**：替代 `queue.shift()`，避免 O(n) 的数组移位开销。每个 worker 通过 `while (cursor < filePaths.length)` 循环取任务，`cursor++` 原子递增（JavaScript 单线程事件循环保证无竞态）。
  - **`try-catch` 异常隔离**：包裹 `readFile` 与 `collectDependencies`，单文件失败仅 `console.warn` 告警并写入空依赖 `{ dependencies: [], exports: [] }`，不影响整体扫描。
  - **返回 `Map<string, CollectedFile>`**：key 为文件绝对路径，value 为收集结果。

### 3.3 实现 mtime 缓存读写函数

- **缓存文件路径**：`<project>/.legacy-shield/knowledge-graph/.cache.json`。

- **`loadCache(projectRoot: string): CacheFile | null`**：读取缓存文件。

  ```typescript
  const CACHE_VERSION = '1';
  const CACHE_DIR = '.legacy-shield/knowledge-graph';
  const CACHE_FILE = '.cache.json';

  /**
   * 读取 mtime 缓存。
   * @param projectRoot 项目根目录
   * @returns 缓存对象，或 null（缓存文件不存在 / 解析失败 / 版本不匹配）
   */
  export async function loadCache(projectRoot: string): Promise<CacheFile | null> {
    const cachePath = join(projectRoot, CACHE_DIR, CACHE_FILE);
    if (!existsSync(cachePath)) return null;
    try {
      const raw = await readFile(cachePath, 'utf8');
      const cache = JSON.parse(raw) as CacheFile;
      // 版本不匹配视为无缓存
      if (cache.version !== CACHE_VERSION) return null;
      return cache;
    } catch {
      // 解析失败视为无缓存
      return null;
    }
  }
  ```

- **`saveCache(projectRoot: string, cache: CacheFile): Promise<void>`**：写入缓存文件。

  ```typescript
  /**
   * 写入 mtime 缓存。
   * @param projectRoot 项目根目录
   * @param cache 缓存对象
   */
  export async function saveCache(projectRoot: string, cache: CacheFile): Promise<void> {
    const cacheDir = join(projectRoot, CACHE_DIR);
    const cachePath = join(cacheDir, CACHE_FILE);
    // 确保目录存在
    await mkdir(cacheDir, { recursive: true });
    await writeFile(cachePath, JSON.stringify(cache, null, 2), 'utf8');
  }
  ```

- **`computeAliasHash(tsconfig: object | null): string`**：基于 `compilerOptions.paths` 与 `compilerOptions.baseUrl` 的 MD5 hash。

  ```typescript
  /**
   * 计算 alias 配置 hash。
   * @param tsconfig tsconfig/jsconfig 对象，或 null（无配置文件）
   * @returns MD5 hash 字符串，或 'none'（无配置文件时）
   */
  export function computeAliasHash(tsconfig: object | null): string {
    if (!tsconfig) return 'none';
    const paths = (tsconfig as any).compilerOptions?.paths ?? {};
    const baseUrl = (tsconfig as any).compilerOptions?.baseUrl ?? '';
    return createHash('md5').update(JSON.stringify({ paths, baseUrl })).digest('hex');
  }
  ```

### 3.4 实现缓存失效策略与增量扫描

- **新增 `scanWithCache` 函数**：封装 `scanFilesConcurrent` + mtime 缓存逻辑，实现增量扫描。

  ```typescript
  /**
   * 带缓存的并发扫描。根据 mtime 与 aliasHash 判断是否命中缓存，未命中则重新解析。
   *
   * @param filePaths 文件路径列表
   * @param resolver ModuleResolver 实例
   * @param concurrency 并发数
   * @param projectRoot 项目根目录（用于缓存读写）
   * @param aliasHash 当前 alias 配置 hash
   * @param fresh 是否强制全量重建（忽略缓存）
   * @returns 扫描结果 Map（key 为文件绝对路径）
   */
  export async function scanWithCache(
    filePaths: string[],
    resolver: ModuleResolver,
    concurrency: number,
    projectRoot: string,
    aliasHash: string,
    fresh: boolean,
  ): Promise<Map<string, CollectedFile>> {
    // 1. 加载缓存（fresh=true 或缓存不存在时跳过）
    const cache = fresh ? null : await loadCache(projectRoot);

    const results = new Map<string, CollectedFile>();
    const pendingFiles: string[] = [];

    if (cache && cache.aliasHash === aliasHash) {
      // 2. 缓存命中判断：aliasHash 一致时逐文件检查 mtime
      for (const filePath of filePaths) {
        const entry = cache.entries[filePath];
        if (entry) {
          try {
            const currentMtime = statSync(filePath).mtimeMs;
            if (entry.mtime === currentMtime) {
              // mtime 一一致，命中缓存，直接复用
              results.set(filePath, {
                dependencies: entry.dependencies,
                exports: entry.exports,
              });
              continue;
            }
          } catch {
            // 文件不存在或 stat 失败，加入待扫描列表
          }
        }
        pendingFiles.push(filePath);
      }
    } else {
      // aliasHash 变更或无缓存，全部文件待扫描
      pendingFiles.push(...filePaths);
    }

    // 3. 并发扫描待扫描文件
    if (pendingFiles.length > 0) {
      const freshResults = await scanFilesConcurrent(
        pendingFiles,
        resolver,
        concurrency,
      );
      for (const [filePath, collected] of freshResults) {
        results.set(filePath, collected);
      }
    }

    // 4. 更新并保存缓存
    const newEntries: Record<string, CacheEntry> = {};
    for (const [filePath, collected] of results) {
      try {
        const mtime = statSync(filePath).mtimeMs;
        newEntries[filePath] = {
          path: filePath,
          mtime,
          aliasHash,
          dependencies: collected.dependencies,
          exports: collected.exports,
        };
      } catch {
        // 文件 stat 失败时跳过缓存写入
      }
    }
    const newCache: CacheFile = {
      version: CACHE_VERSION,
      generatedAt: new Date().toISOString(),
      aliasHash,
      entries: newEntries,
    };
    await saveCache(projectRoot, newCache);

    return results;
  }
  ```

- **四种缓存失效策略实现**：
  1. **文件 mtime 变更 → 该文件缓存失效**：`scanWithCache` 中逐文件检查 `entry.mtime === currentMtime`，不一致时加入 `pendingFiles` 重新解析。
  2. **alias 配置 hash 变更 → 全部缓存失效**：`scanWithCache` 中 `cache.aliasHash === aliasHash` 判断，不一致时 `pendingFiles` 包含全部文件。
  3. **`--fresh` 参数 → 忽略缓存，全量重建**：`scanWithCache` 中 `fresh=true` 时 `cache = null`，跳过缓存加载。
  4. **缓存文件不存在 → 全量重建**：`loadCache` 返回 `null` 时 `cache = null`，`pendingFiles` 包含全部文件。

### 3.5 性能设计要点

- **索引游标替代 `queue.shift()`**：避免 O(n) 的数组移位开销，时间复杂度从 O(n²) 降为 O(n)。
- **`Promise.all` + worker 池**：创建 `concurrency` 个 worker 并发执行，每个 worker 独立从游标取任务，无共享状态竞争。
- **`fs/promises` 异步 API**：文件读取使用 `readFile`（异步），避免阻塞事件循环。
- **单文件异常隔离**：`try-catch` 包裹 `readFile` 与 `collectDependencies`，单文件失败不影响整体扫描。
- **mtime 缓存**：未变更文件跳过 `collectDependencies` 调用，增量扫描性能显著优于全量重建。

---

## 4. 测试计划

### 4.1 单元测试

> 单元测试在 T12 的 `tests/knowledge-graph/scanner.test.ts` 中实现，本任务需确保实现可测试性。

- **并发扫描**：
  - `scanFilesConcurrent` 返回 `Map<string, CollectedFile>`，key 为文件绝对路径；
  - 使用索引游标 `cursor` 而非 `queue.shift()`（代码中无 `shift()` 调用）；
  - 并发数可通过参数配置，默认 8；
  - 并发数=1 时仍能正确扫描（串行降级）。
- **单文件异常隔离**：
  - 单文件解析抛错时，该文件在返回 Map 中对应 `{ dependencies: [], exports: [] }`；
  - 整体扫描不中断，其他文件正常扫描；
  - 错误信息通过 `console.warn` 输出。
- **mtime 缓存命中**：
  - 首次扫描后 `.cache.json` 文件生成于 `<project>/.legacy-shield/knowledge-graph/.cache.json`；
  - 缓存结构为 `Record<string, CacheEntry>`（`CacheFile.entries` 字段）；
  - 第二次扫描（无文件变更）命中缓存，跳过 `collectDependencies` 调用；
  - 缓存文件含 `version` / `generatedAt` / `aliasHash` / `entries` 四个字段。
- **mtime 缓存失效**：
  - 修改某文件后第二次扫描，仅该文件重新解析，其余命中缓存；
  - alias 配置变更（tsconfig.paths 修改）后，全部缓存失效，全量重建；
  - `--fresh` 参数为 true 时，忽略缓存全量重建；
  - 缓存文件不存在时，全量重建；
  - 缓存文件版本不匹配时，全量重建。
- **`computeAliasHash`**：
  - 无 tsconfig 时返回 `'none'`；
  - 有 tsconfig 时返回 MD5 hash 字符串；
  - 相同 paths 与 baseUrl 返回相同 hash；
  - 不同 paths 或 baseUrl 返回不同 hash。
- **`loadCache` / `saveCache`**：
  - `loadCache` 缓存文件不存在时返回 `null`；
  - `loadCache` 缓存文件解析失败时返回 `null`；
  - `loadCache` 缓存版本不匹配时返回 `null`；
  - `saveCache` 能正确创建目录（`mkdir { recursive: true }`）并写入文件。

### 4.2 集成测试 / 端到端测试

- 在 T12 的 `tests/knowledge-graph/integration.test.ts` 中通过增量更新场景端到端验证：
  - 首次全量扫描 → 生成 `.cache.json`；
  - 修改文件 → 增量扫描 → 仅修改文件重新解析；
  - alias 配置变更 → 全量重建。

### 4.3 回归测试

- 既有 `tests/custom-rules.test.ts` 全绿（本任务新增独立模块，不修改 `lib/custom-rules/scanner.ts`）；
- `pnpm typecheck` / `pnpm build` 对现有代码无新增错误。

---

## 5. 风险与依赖

| 风险 / 依赖 | 影响 | 应对措施 |
|---|---|---|
| 依赖 T2（ModuleResolver 实例） | T2 未完成时无法进行路径解析 | T2 与 T1 可并行启动；T2 完成后可立即启动 T4 |
| 依赖 T3（CollectedFile 类型 + collectDependencies 调用） | T3 未完成时无法收集依赖 | T3 依赖 T1 与 T2，T1/T2 完成后可立即启动 T3；T3 完成后可立即启动 T4 |
| 5000 文件性能基线在 T12 才验证，若不达标需返工 | 性能不达标需升级为 v1.6 引入 Worker 线程 | T4 完成后可用真实项目提前验证并发扫描性能；设计文档已预留升级为 v1.6 的方案 |
| mtime 缓存失效策略不当 | 增量更新结果不准确 | 四种失效策略（mtime 变更 / aliasHash 变更 / --fresh / 缓存不存在）均实现；`scanWithCache` 中逐文件检查 mtime |
| 缓存文件并发写入冲突 | 多进程同时运行 graph 子命令时缓存覆盖 | v1.5 不处理多进程并发场景（单进程运行）；后续版本可引入文件锁 |
| `statSync` 在文件被删除后抛异常 | 缓存命中判断失败 | `scanWithCache` 中 `statSync` 用 `try-catch` 包裹，失败时加入待扫描列表 |
| 缓存文件 JSON 解析失败 | 缓存无法加载 | `loadCache` 中 `JSON.parse` 用 `try-catch` 包裹，失败时返回 `null`（全量重建） |
| 不引入新的运行时依赖 | 仅使用 Node.js 内置模块 | 仅使用 `node:fs` / `node:fs/promises` / `node:crypto` / `node:path`，均为 Node.js 内置模块 |

---

## 6. 变更范围

- **本任务范围内**：
  - `lib/knowledge-graph/scanner.ts` 新增：`CacheEntry` 接口、`CacheFile` 接口、`scanFilesConcurrent` 函数、`scanWithCache` 函数、`loadCache` 函数、`saveCache` 函数、`computeAliasHash` 函数、`CACHE_VERSION` / `CACHE_DIR` / `CACHE_FILE` 常量。
- **不在本任务范围内**：
  - `lib/knowledge-graph/types.ts` 类型定义（由 T1 负责）；
  - `ModuleResolver` 类与 `createResolver` 工厂函数（由 T2 负责，本任务仅消费 `ModuleResolver` 实例）；
  - `CollectedDependency` / `CollectedFile` 接口与 `collectDependencies` 函数（由 T3 负责，本任务仅消费 `CollectedFile` 类型与 `collectDependencies` 调用）；
  - 图构建、循环检测、连通分量（由 T5 负责）；
  - 图谱分析、hub/孤立/分层推断（由 T6 负责）；
  - monorepo 子包识别与聚合图谱（由 T9 负责，但 T9 会复用 `scanFilesConcurrent` / `scanWithCache`）；
  - 编排入口 `runKnowledgeGraph`（由 T10 负责，会调用 `scanWithCache`）；
  - CLI 子命令注册（由 T11 负责）；
  - 测试夹具（由 T12 负责）；
  - 不修改 `lib/custom-rules/scanner.ts` 中现有的 `scanFiles` / `scanFile` 实现（graph 模块独立实现扫描器，不复用 custom-rules 的串行扫描）；
  - 不引入任何新的运行时依赖。

---

## 7. 评审记录

| 轮次 | 日期 | 结论 | P0/P1 问题 | 修复方案 |
|---|---|---|---|---|
| 1 | 待评审 | 待评审 | — | — |
