# alias 优先级合并 + resolver 集成

> 版本：v1.6
> 任务编号：T7
> 对应阶段 Spec：[phase-v1.6-spec.md](phase-v1.6-spec.md)
> 对应设计文档：[design-v1.6.md](../design-v1.6.md) §2.6
> 对应执行计划：[execution-plan-v1.6.md](../execution-plan-v1.6.md)
> 依赖任务：T5, T6
> 状态：已完成，已归档（冻结，不再修改）
> 评审日期：2026-06-23

## 1. 任务目标

重写 `createResolver`，自动检测 tsconfig/jsconfig、vite.config、webpack.config，按 tsconfig > vite > webpack 优先级合并 alias，构造支持多来源 alias 的 `ModuleResolver`；扩展 `resolveAlias` 先匹配 tsconfig paths 再匹配 aliases；扩展 `computeAliasHash` 含所有 alias 来源。对应阶段 Spec G-4。

## 2. 对应需求与验收标准

| 需求编号 | 需求描述 | 本任务验收标准 |
|---|---|---|
| REQ-1.6-11 | 自动检测配置文件，无需新增 CLI 参数 | resolver 自动检测 webpack.config.{js,ts} / vite.config.{ts,js}，与 v1.5 tsconfig 自动检测一致，保持零配置体验 |
| REQ-1.6-12 | alias 解析优先级：tsconfig paths > vite alias > webpack alias | 当多个 alias 来源同时存在时，按优先级合并；高优先级来源的 alias 不被低优先级覆盖；`resolveAlias` 先匹配 tsconfig paths 再匹配合并后的 aliases |

## 3. 实现步骤

### 3.1 在 config-loader.ts 中实现 loadAliasConfig

- 修改文件：`lib/knowledge-graph/config-loader.ts`
- 新增接口：`AliasConfig`（含 tsconfig、baseUrl、paths、viteAliases、webpackAliases、mergedAliases 字段；`tsconfig` 字段保留 raw tsconfig 对象用于调试/未来扩展，computeAliasHash 与 createResolver 不消费此字段）
- 新增函数：`loadAliasConfig(projectRoot: string): AliasConfig`
- 关键逻辑：
  - 模块级缓存 `aliasConfigCache: Map<string, AliasConfig>`，按 projectRoot 缓存，避免 createResolver 与 computeAliasHash 重复加载
  - 1. 调用 `loadTsconfigPaths(projectRoot)` 收集 tsconfig/jsconfig paths（最高优先级）
  - 2. 调用 `findBuildConfig(projectRoot, 'vite')` + `loadConfigFile` + `parseViteAlias` 收集 vite alias（中优先级）
  - 3. 调用 `findBuildConfig(projectRoot, 'webpack')` + `loadConfigFile` + `parseWebpackAlias` 收集 webpack alias（最低优先级）
  - 4. 调用 `mergeAliases(viteAliases, webpackAliases)` 按优先级合并（vite > webpack）
  - 5. 缓存并返回 `AliasConfig`

### 3.2 在 config-loader.ts 中实现 loadTsconfigPaths

- 修改文件：`lib/knowledge-graph/config-loader.ts`
- 新增函数：`loadTsconfigPaths(projectRoot: string): { raw: object; baseUrl?: string; paths?: Record<string, string[]> } | null`
- 关键逻辑：
  - 提取自现有 `createResolver`（resolver.ts L100-130）与 `readTsconfig`（index.ts L209-227）的 tsconfig 读取逻辑
  - 优先读取 tsconfig.json，不存在则读取 jsconfig.json
  - 去除 JSON 注释后 JSON.parse
  - baseUrl 解析为基于 projectRoot 的绝对路径
  - 解析失败时返回 null

### 3.3 在 config-loader.ts 中实现 mergeAliases

- 修改文件：`lib/knowledge-graph/config-loader.ts`
- 新增函数：`mergeAliases(viteAliases: AliasEntry[], webpackAliases: AliasEntry[]): AliasEntry[]`
- 关键逻辑：
  - 先放入 webpack（低优先级），后放入 vite（高优先级覆盖）
  - 同一 `find` 字符串（精确匹配）只保留最高优先级的 replacement
  - 使用 `Map<string, string>` 去重，vite 覆盖 webpack

### 3.4 修改 resolver.ts：扩展 ResolverOptions

- 修改文件：`lib/knowledge-graph/resolver.ts`
- 修改位置：`ResolverOptions` 接口（L4-11）
- 新增字段：`aliases?: AliasEntry[]`（vite/webpack 合并后的 alias 列表）
- 向后兼容：可选字段，未传入时 `resolveAlias` 跳过 aliases 匹配

### 3.5 修改 resolver.ts：扩展 resolveAlias

- 修改文件：`lib/knowledge-graph/resolver.ts`
- 修改位置：`ModuleResolver.resolveAlias` 方法（L44-56）
- 关键逻辑：
  - 注意：v1.5 的 `if (!this.opts.paths) return null;` 需改为 `if (this.opts.paths) { ... }` 后 fallthrough 到 aliases 匹配，确保无 tsconfig 但有 vite/webpack alias 时仍能解析
  - 1. 优先匹配 tsconfig paths（最高优先级）：遍历 `this.opts.paths`，正则匹配 `*` 通配符
  - 2. 再匹配 vite/webpack alias（合并后，vite > webpack）：遍历 `this.opts.aliases`，`spec === find || spec.startsWith(find + '/')` 时替换
  - 3. 均未命中时返回 null

### 3.6 修改 resolver.ts：重写 createResolver

- 修改文件：`lib/knowledge-graph/resolver.ts`
- 修改位置：`createResolver` 函数（L100-130）
- 关键逻辑：
  - 调用 `loadAliasConfig(projectRoot)` 获取所有 alias 来源（复用缓存）
  - 构造 `new ModuleResolver({ projectRoot, baseUrl, paths, aliases: mergedAliases })`
  - 签名不变：`(projectRoot: string): ModuleResolver`

### 3.7 修改 scanner.ts：扩展 computeAliasHash

- 修改文件：`lib/knowledge-graph/scanner.ts`
- 修改位置：`computeAliasHash` 函数（L106-111）
- 关键逻辑：
  - 参数从 `(tsconfig: object | null)` 变为 `(aliasConfig: AliasConfig | null)`
  - hash 输入扩展为 `{ paths, baseUrl, viteAliases, webpackAliases }`（`paths` 为 undefined 时默认 `{}`，`baseUrl` 为 undefined 时默认 `''`）
  - 无配置时返回 `'none'`
- 同步修改 `tests/knowledge-graph/scanner.test.ts`：TC-SCAN-12 测试用例的 `computeAliasHash(tsconfig)` 调用改为 `computeAliasHash(aliasConfig)`，测试数据从 tsconfig 对象改为构造 `AliasConfig` 对象（含 `paths` / `baseUrl` / `viteAliases` / `webpackAliases` / `mergedAliases` 字段）

### 3.8 修改 index.ts：readTsconfig → loadAliasConfig

- 修改文件：`lib/knowledge-graph/index.ts`
- 修改位置：`runSinglePackageFlow` 函数（L94-95）
- 关键逻辑：
  - 将 `readTsconfig(projectRoot)` + `computeAliasHash(tsconfig)` 替换为 `loadAliasConfig(projectRoot)` + `computeAliasHash(aliasConfig)`
  - 复用 `createResolver` 已缓存的配置，配置文件仅加载一次
  - 移除 `readTsconfig` 辅助函数（逻辑已迁移至 config-loader.ts 的 `loadTsconfigPaths`）
  - 移除 `readTsconfig` 后，同步清理 index.ts 中未使用的 `readFileSync` import（readTsconfig 是 index.ts 中唯一使用 readFileSync 的位置）

## 4. 测试计划

### 4.1 单元测试

- `loadAliasConfig` 正确加载 tsconfig + vite + webpack 三来源
- `loadAliasConfig` 缓存生效：同一 projectRoot 第二次调用不重复加载
- `mergeAliases`：vite alias 覆盖 webpack alias（同一 find 字符串）
- `mergeAliases`：不同 find 字符串的 alias 均保留
- `resolveAlias` 优先级：tsconfig paths 命中时不匹配 aliases
- `resolveAlias` 优先级：tsconfig paths 未命中时匹配 aliases
- `resolveAlias`：`spec === find` 精确匹配
- `resolveAlias`：`spec.startsWith(find + '/')` 前缀匹配
- `computeAliasHash`：含 vite/webpack alias 时 hash 与仅 tsconfig 时不同
- `computeAliasHash`：无配置时返回 `'none'`
- 无 tsconfig/vite/webpack 配置的项目：`createResolver` 返回无 alias 的 resolver

### 4.2 回归测试

- TC-RES-2（tsconfig paths alias 解析）不受影响
- TC-RES-11（jsconfig.json 兼容）不受影响
- TC-INT-3（alias 项目端到端 tsconfig paths 解析）不受影响
- TC-PERF-1 / TC-PERF-2（性能基线）不受影响
- TC-SCAN-12（aliasHash 计算）**需更新**：测试数据从 tsconfig 对象改为 AliasConfig 对象，验证含 vite/webpack alias 时 hash 与仅 tsconfig 时不同；无配置时返回 `'none'`

## 5. 风险与依赖

| 风险 / 依赖 | 影响 | 应对措施 |
|---|---|---|
| 依赖 T5, T6 | T5/T6 未完成时 parseViteAlias / parseWebpackAlias 不存在 | 等待 T5/T6 评审通过后执行 |
| computeAliasHash 签名变更（破坏性） | scanner.ts 调用方需同步修改 | 设计文档 §4.2 标注「向后兼容：否」；`runSinglePackageFlow`（index.ts）与 `scanner.test.ts` TC-SCAN-12 测试用例需同步修改 |
| loadAliasConfig 缓存泄漏 | 模块级 Map 缓存不释放 | 同一进程内同一项目仅缓存一次，进程退出时自动释放；可接受 |
| alias 优先级合并错误 | tsconfig/vite/webpack 同一 alias 前缀的 replacement 冲突 | `resolveAlias` 先匹配 tsconfig paths（最高优先级），再匹配合并后的 aliases（vite > webpack）；T8 测试夹具验证多来源场景 |

## 6. 变更范围

- 修改 `lib/knowledge-graph/config-loader.ts`：新增 `loadAliasConfig`、`loadTsconfigPaths`、`mergeAliases`、`AliasConfig` 接口
- 修改 `lib/knowledge-graph/resolver.ts`：扩展 `ResolverOptions`（新增 `aliases` 字段）、扩展 `resolveAlias`（新增 aliases 匹配分支）、重写 `createResolver`
- 修改 `lib/knowledge-graph/scanner.ts`：扩展 `computeAliasHash`（参数语义变更）
- 修改 `lib/knowledge-graph/index.ts`：`readTsconfig` → `loadAliasConfig`，移除 `readTsconfig` 辅助函数，清理未使用的 `readFileSync` import
- 修改 `tests/knowledge-graph/scanner.test.ts`：TC-SCAN-12 测试数据结构适配 computeAliasHash 新签名
- 不修改 `createResolver` / `ModuleResolver.resolve` 签名
- 不修改 `runKnowledgeGraph` 签名
- 不新增文件

## 7. 评审记录

> - 第一轮评审（2026-06-23）：不通过，发现 1 个 P0 + 2 个 P1 + 5 个 P2 问题
> - 第二轮重评（2026-06-23）：通过（修改后），P0 + 2 个 P1 全部闭环，5 个 P2 优化项中 4 项完全闭环，P2-2 核心修复已完成（§3.3），§4.1 L109-110 的"前缀"用词建议在后续同步修正以保持一致性
> 评审人：spec-reviewer-expert

### 第一轮问题闭环情况

| 编号 | 级别 | 问题描述 | 闭环状态 |
|---|---|---|---|
| P0-1 | P0 | T5 上游依赖未通过 | 已闭环（T5 状态已更新为「已通过」，评审记录完整） |
| P1-1 | P1 | computeAliasHash 测试调用方遗漏 scanner.test.ts | 已闭环（§3.7 / §5 / §6 已同步补充 scanner.test.ts） |
| P1-2 | P1 | TC-SCAN-12 回归测试未列出 | 已闭环（§4.2 已补充 TC-SCAN-12 需更新说明） |
| P2-1 | P2 | readFileSync import 未清理 | 已闭环（§3.8 已补充 import 清理说明） |
| P2-2 | P2 | mergeAliases「前缀」用词误导 | 部分闭环（§3.3 已修正为「精确匹配」，§4.1 L109-110 仍使用"前缀"用词，建议后续同步修正） |
| P2-3 | P2 | loadTsconfigPaths 行号偏差 | 已闭环（§3.2 已修正为 L209-227） |
| P2-4 | P2 | resolveAlias 行为变更未标注 | 已闭环（§3.5 已补充 fallthrough 说明） |
| P2-5 | P2 | AliasConfig.tsconfig 字段用途未说明 | 已闭环（§3.1 已补充字段用途说明） |

### 第二轮重评验证结论

- 对照设计文档 §2.6 验证：T7 实现步骤与设计完全一致（8 个子步骤一一对应）
- 对照阶段 Spec 验证：REQ-1.6-11, REQ-1.6-12 验收标准完整覆盖
- 对照源代码验证：修改位置行号全部准确（resolver.ts / index.ts / scanner.ts / scanner.test.ts）
- T5 上游依赖已通过（T5 文件头状态「已通过」，评审记录完整）
- 未引入新的范围变更
