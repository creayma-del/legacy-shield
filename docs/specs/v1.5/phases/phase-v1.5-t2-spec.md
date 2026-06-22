# T2：模块路径解析器（alias/node_modules/扩展名补全）

> 版本：v1.5
> 任务编号：T2
> 对应阶段 Spec：[phase-v1.5-spec.md](phase-v1.5-spec.md)
> 对应设计文档：[design-v1.5.md](../design-v1.5.md)
> 对应执行计划：[execution-plan-v1.5.md](../execution-plan-v1.5.md)
> 依赖任务：无
> 状态：评审中（待评审）
> 评审记录：见本文档末尾（轮次 1 待评审）

---

## 1. 任务目标

为 v1.5 知识图谱生成模块提供自建的轻量模块路径解析器，覆盖相对路径、tsconfig/jsconfig paths alias、node_modules 包（含 scoped 包）、扩展名补全与 index 文件解析。具体包括：
- 新增 `lib/knowledge-graph/resolver.ts`，实现 `ModuleResolver` 类；
- 不引入 `enhanced-resolve` 依赖，保持项目依赖克制风格（OUT-6 约束）；
- 读取目标项目根目录的 `tsconfig.json` / `jsconfig.json`，解析 `compilerOptions.baseUrl` 与 `compilerOptions.paths`。

对应阶段 Spec §3.3（模块路径解析器）与交付物 D3。本任务为关键路径上的高复杂度任务（工作量 4-6 人时），是 T3 / T4 / T9 的前置依赖。

---

## 2. 对应需求与验收标准

| 需求编号 | 需求描述 | 本任务验收标准 |
|---|---|---|
| REQ-1.5-3 | 支持模块路径解析：相对路径、`@/` alias、`~` alias、node_modules 包、扩展名补全、index 解析 | `ModuleResolver.resolve(spec, importer)` 按优先级依次尝试相对路径 → alias 路径 → node_modules 包路径；`tryExtensions` 覆盖 `.ts` / `.tsx` / `.js` / `.jsx` / `.vue` 扩展名补全与 index 文件解析 |
| REQ-1.5-4 | 读取目标项目 tsconfig.json / jsconfig.json 的 paths 配置，自动识别 alias | 构造 `ModuleResolver` 时读取 `tsconfig.json`（不存在则读 `jsconfig.json`），解析 `compilerOptions.baseUrl` 与 `compilerOptions.paths`；无 tsconfig/jsconfig 的纯 JS 项目，相对路径与 node_modules 解析仍正常工作 |

---

## 3. 实现步骤

### 3.1 新增 `lib/knowledge-graph/resolver.ts` 文件结构

- **文件位置**：`lib/knowledge-graph/resolver.ts`（新增文件，目录由 T1 创建）。
- **导入依赖**（均为项目现有依赖，不引入新依赖）：

  ```typescript
  import { existsSync, statSync, readFileSync } from 'node:fs';
  import { resolve, dirname, join } from 'node:path';
  ```

- **新增 `ResolverOptions` 接口**：

  ```typescript
  export interface ResolverOptions {
    /** 项目根目录 */
    projectRoot: string;
    /** tsconfig/jsconfig compilerOptions.baseUrl */
    baseUrl?: string;
    /** tsconfig/jsconfig compilerOptions.paths */
    paths?: Record<string, string[]>;
  }
  ```

### 3.2 实现 `ModuleResolver` 类

- **类定义与构造函数**：

  ```typescript
  export class ModuleResolver {
    constructor(private opts: ResolverOptions) {}
  }
  ```

- **公开方法 `resolve(spec, importer): string | null`**：按优先级依次尝试相对路径 → alias 路径 → node_modules 包路径。

  ```typescript
  /**
   * 将 import spec 解析为目标文件绝对路径
   * @param spec import 路径（如 './foo', '@/utils/bar', 'lodash'）
   * @param importer 导入文件的绝对路径
   * @returns 解析后的文件绝对路径，或 null（无法解析）
   */
  resolve(spec: string, importer: string): string | null {
    // 1. 相对路径（./ 或 ../）
    if (spec.startsWith('.')) {
      return this.resolveRelative(spec, importer);
    }

    // 2. alias 路径（@/ ~/ 等）
    const aliasResolved = this.resolveAlias(spec);
    if (aliasResolved) {
      return this.resolveRelative(aliasResolved, this.opts.baseUrl ?? this.opts.projectRoot);
    }

    // 3. node_modules 包路径
    return this.resolveNodeModules(spec, importer);
  }
  ```

- **私有方法 `resolveRelative(spec, baseDir): string | null`**：基于 `path.resolve` 拼接后调用 `tryExtensions`。

  ```typescript
  private resolveRelative(spec: string, baseDir: string): string | null {
    const basePath = resolve(baseDir, spec);
    return this.tryExtensions(basePath);
  }
  ```

- **私有方法 `resolveAlias(spec): string | null`**：遍历 `paths` 映射，正则匹配 `*` 通配符。

  ```typescript
  private resolveAlias(spec: string): string | null {
    if (!this.opts.paths) return null;
    for (const [pattern, targets] of Object.entries(this.opts.paths)) {
      // 先转义正则元字符，再替换 * 为捕获组
      const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace('*', '(.*)');
      const regex = new RegExp('^' + escaped + '$');
      const match = spec.match(regex);
      if (match) {
        return targets[0].replace('*', match[1]);
      }
    }
    return null;
  }
  ```

  - **正则转义说明**：先使用 `pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&')` 转义所有正则元字符（除 `*` 外），再将 `*` 替换为捕获组 `(.*)`。这样 `@/*` 会被转换为 `^@/(.*)$`，匹配 `@/utils/bar` 时捕获组为 `utils/bar`，再用捕获组替换 target 中的 `*`（如 `src/*` → `src/utils/bar`）。

- **私有方法 `resolveNodeModules(spec, importer): string | null`**：支持 scoped 包名，从 importer 目录逐级向上查找。

  ```typescript
  private resolveNodeModules(spec: string, importer: string): string | null {
    // 纯包名无子路径（如 'lodash'），跳过
    if (!spec.includes('/')) return null;
    const parts = spec.split('/');
    // scoped 包名含斜杠（如 @vue/compiler-sfc/foo，取前两段为包名）
    const packageName = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
    const subPath = (spec.startsWith('@') ? parts.slice(2) : parts.slice(1)).join('/');
    if (!subPath) return null;
    let dir = dirname(importer);
    while (true) {
      const candidate = join(dir, 'node_modules', packageName, subPath);
      const resolved = this.tryExtensions(candidate);
      if (resolved) return resolved;
      const parent = dirname(dir);
      // 根目录检查：dirname(dir) === dir 时终止向上查找
      if (parent === dir) break;
      dir = parent;
    }
    return null;
  }
  ```

  - **scoped 包处理**：`@vue/compiler-sfc/foo` 中 `packageName = '@vue/compiler-sfc'`（前两段），`subPath = 'foo'`（第三段起）。
  - **根目录终止**：当 `dirname(dir) === dir` 时表示已到达文件系统根目录，终止向上查找，避免无限循环。

- **私有方法 `tryExtensions(basePath): string | null`**：依次尝试直接匹配 → 补全扩展名 → index 文件。

  ```typescript
  private tryExtensions(basePath: string): string | null {
    const extensions = ['.ts', '.tsx', '.js', '.jsx', '.vue'];
    // 1. 直接匹配
    if (existsSync(basePath) && statSync(basePath).isFile()) return basePath;
    // 2. 补全扩展名
    for (const ext of extensions) {
      if (existsSync(basePath + ext)) return basePath + ext;
    }
    // 3. index 文件
    for (const ext of extensions) {
      const indexFile = join(basePath, 'index' + ext);
      if (existsSync(indexFile)) return indexFile;
    }
    return null;
  }
  ```

### 3.3 tsconfig.json / jsconfig.json 读取与解析

- **新增工厂函数 `createResolver(projectRoot: string): ModuleResolver`**：读取目标项目根目录的 tsconfig.json / jsconfig.json，构造 `ModuleResolver` 实例。

  ```typescript
  /**
   * 从项目根目录读取 tsconfig.json / jsconfig.json，构造 ModuleResolver。
   * 优先读取 tsconfig.json，不存在则读取 jsconfig.json，均不存在时返回无 alias 配置的 resolver。
   */
  export function createResolver(projectRoot: string): ModuleResolver {
    const tsconfigPath = join(projectRoot, 'tsconfig.json');
    const jsconfigPath = join(projectRoot, 'jsconfig.json');
    let configPath: string | null = null;
    if (existsSync(tsconfigPath)) {
      configPath = tsconfigPath;
    } else if (existsSync(jsconfigPath)) {
      configPath = jsconfigPath;
    }
    if (!configPath) {
      // 无 tsconfig/jsconfig 的纯 JS 项目，仅支持相对路径与 node_modules 解析
      return new ModuleResolver({ projectRoot });
    }
    try {
      const raw = readFileSync(configPath, 'utf8');
      // 去除 JSON 注释（tsconfig 常见）
      const cleaned = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/g, '');
      const config = JSON.parse(cleaned);
      const compilerOptions = config.compilerOptions ?? {};
      const baseUrl: string | undefined = compilerOptions.baseUrl;
      const paths: Record<string, string[]> | undefined = compilerOptions.paths;
      return new ModuleResolver({ projectRoot, baseUrl, paths });
    } catch {
      // 解析失败时降级为无 alias 配置
      return new ModuleResolver({ projectRoot });
    }
  }
  ```

  - **JSON 注释处理**：tsconfig.json / jsconfig.json 通常含 `//` 和 `/* */` 注释，标准 `JSON.parse` 无法处理，需先去除注释。
  - **异常容错**：读取或解析失败时降级为无 alias 配置的 resolver，确保不阻断扫描流程。

### 3.4 边界情况处理

- **动态 `import()`**：由 T3 collector 标记为 `unresolved: true`，不进入 `resolve` 方法。
- **变量 `require(varName)`**：由 T3 collector 标记为 `unresolved: true`，不进入 `resolve` 方法。
- **纯包名（如 `lodash`）**：`resolveNodeModules` 中 `!spec.includes('/')` 返回 `null`，跳过。
- **CSS/图片等非 JS 资源**：由 T3 collector 在 visitor 层面跳过，不进入 `resolve` 方法。
- **解析失败**：`resolve` 返回 `null`，由 T3 collector 标记 `unresolved: true` 并保留 `rawSpec`。

---

## 4. 测试计划

### 4.1 单元测试

> 单元测试在 T12 的 `tests/knowledge-graph/resolver.test.ts` 中实现，本任务需确保实现可测试性。

- **相对路径解析**：
  - `resolve('./foo', '/proj/src/main.ts')` 解析到 `/proj/src/foo.ts`（扩展名补全）；
  - `resolve('../utils/bar', '/proj/src/views/home.ts')` 解析到 `/proj/utils/bar.ts`（`../` 路径）；
  - `resolve('./foo/bar', '/proj/src/main.ts')` 解析到 `/proj/src/foo/bar.ts`（多级路径）。
- **alias 路径解析**：
  - `resolve('@/utils/bar', '/proj/src/main.ts')` 在 tsconfig paths 配置 `{"@/*": ["src/*"]}` 时解析到 `/proj/src/utils/bar.ts`；
  - `resolve('~/utils/bar', '/proj/src/main.ts')` 在 tsconfig paths 配置 `{"~/*": ["src/*"]}` 时解析到 `/proj/src/utils/bar.ts`；
  - `resolve('@/utils/bar', '/proj/src/main.ts')` 在无 tsconfig paths 配置时返回 `null`。
- **node_modules 包路径解析**：
  - `resolve('@vue/compiler-sfc/foo', '/proj/src/main.ts')` 解析到 `node_modules/@vue/compiler-sfc/foo.ts`（scoped 包）；
  - `resolve('lodash', '/proj/src/main.ts')` 返回 `null`（纯包名无子路径，跳过）；
  - `resolve('lodash/get', '/proj/src/main.ts')` 解析到 `node_modules/lodash/get.js`（非 scoped 包子路径）。
- **扩展名补全与 index 解析**：
  - `tryExtensions` 对 `index.ts` / `index.js` 等 index 文件能正确解析；
  - `resolve('./utils', '/proj/src/main.ts')` 在 `utils/` 目录下有 `index.ts` 时解析到 `/proj/src/utils/index.ts`。
- **无 tsconfig/jsconfig 的纯 JS 项目**：
  - 相对路径与 node_modules 解析仍正常工作；
  - alias 路径返回 `null`。
- **根目录终止**：
  - 向上查找 node_modules 时，到达根目录（`dirname(dir) === dir`）能正确终止，不无限循环。
- **JSON 注释处理**：
  - tsconfig.json 含 `//` 和 `/* */` 注释时能正确解析。

### 4.2 集成测试 / 端到端测试

- 在 T12 的 `tests/knowledge-graph/integration.test.ts` 中通过 `alias-project` 夹具端到端验证：
  - `@/utils/helper` 被正确解析为 `src/utils/helper.ts`；
  - `tsconfig.json` 的 `paths` 配置被正确读取。

### 4.3 回归测试

- 既有 `tests/custom-rules.test.ts` 全绿（本任务新增独立模块，不修改 `lib/custom-rules/scanner.ts`）；
- `pnpm typecheck` / `pnpm build` 对现有代码无新增错误。

---

## 5. 风险与依赖

| 风险 / 依赖 | 影响 | 应对措施 |
|---|---|---|
| alias 配置多样性（tsconfig paths、webpack resolve.alias、vite resolve.alias） | webpack/vite alias 无法解析 | v1.5 仅支持 tsconfig/jsconfig paths，不支持 webpack/vite resolve.alias；设计文档 §3.1 已明确说明不支持的场景 |
| tsconfig.json 含 JSON 注释导致 `JSON.parse` 失败 | alias 配置无法读取，降级为无 alias 模式 | `createResolver` 中先去除 `//` 和 `/* */` 注释再解析；解析失败时降级为无 alias 配置 |
| `resolveAlias` 正则匹配 `*` 通配符时元字符未转义 | 正则注入或匹配失败 | 先使用 `pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&')` 转义所有正则元字符（除 `*`），再将 `*` 替换为捕获组 `(.*)` |
| `resolveNodeModules` 向上查找未正确终止 | 无限循环 | 根目录检查：`dirname(dir) === dir` 时 `break`，终止向上查找 |
| 本任务无依赖，但被 T3 / T4 / T9 依赖 | 解析器延迟将级联影响 T3 / T4 / T5 / T6 / T7 / T8 / T9 / T10 / T11 / T12 / T13 | T2 优先启动并尽早暴露边界问题；T2 为高复杂度任务（4-6 人时），是关键路径上的主要风险点 |
| 不引入 `enhanced-resolve` 依赖 | 自建 resolver 可能遗漏边界情况 | 严格按设计 §3.2 实现，T12 单测覆盖所有验收标准场景 |

---

## 6. 变更范围

- **本任务范围内**：
  - `lib/knowledge-graph/resolver.ts` 新增：`ResolverOptions` 接口、`ModuleResolver` 类（`resolve` / `resolveRelative` / `resolveAlias` / `resolveNodeModules` / `tryExtensions` 方法）、`createResolver` 工厂函数。
- **不在本任务范围内**：
  - `lib/knowledge-graph/types.ts` 类型定义（由 T1 负责）；
  - `CollectedDependency` / `CollectedFile` 接口与 `collectDependencies` 函数（由 T3 负责）；
  - `scanFilesConcurrent` 并发扫描与 mtime 缓存（由 T4 负责）；
  - monorepo 子包识别与聚合图谱（由 T9 负责，但 T9 会复用 `ModuleResolver` 与 `createResolver`）；
  - CLI 子命令注册（由 T11 负责）；
  - 不修改 `lib/custom-rules/scanner.ts` 中现有的 `parseCode` 实现（graph 模块独立实现解析器，不复用 custom-rules 的扫描逻辑）；
  - 不修改 `lib/code-quality/lib/ast-skeleton.ts`（graph 模块独立实现，仅在 T3 中参考其 `pluginsFor` 实现思路）；
  - 不引入 `enhanced-resolve` 或任何新的运行时依赖。

---

## 7. 评审记录

| 轮次 | 日期 | 结论 | P0/P1 问题 | 修复方案 |
|---|---|---|---|---|
| 1 | 待评审 | 待评审 | — | — |
