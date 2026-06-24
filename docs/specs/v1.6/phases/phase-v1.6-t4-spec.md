# jiti 依赖提升 + 配置加载器

> 版本：v1.6
> 任务编号：T4
> 对应阶段 Spec：[phase-v1.6-spec.md](phase-v1.6-spec.md)
> 对应设计文档：[design-v1.6.md](../design-v1.6.md) §2.3
> 对应执行计划：[execution-plan-v1.6.md](../execution-plan-v1.6.md)
> 依赖任务：无
> 状态：已完成，已归档（冻结，不再修改）
> 评审日期：2026-06-23

## 1. 任务目标

将 jiti 从 devDependencies 移至 dependencies；新建 `lib/knowledge-graph/config-loader.ts`，实现 `loadConfigFile` 与 `findBuildConfig` 函数，使用 jiti 加载 JS/TS 格式的构建配置文件。对应阶段 Spec G-3。

## 2. 对应需求与验收标准

| 需求编号 | 需求描述 | 本任务验收标准 |
|---|---|---|
| REQ-1.6-10 | 使用 jiti 加载 JS/TS 配置文件 | jiti 可正确加载 webpack.config.{js,ts} / vite.config.{ts,js}；处理 ESM/CJS 互操作；加载失败时静默降级为无 alias |

## 3. 实现步骤

### 3.1 jiti 依赖提升

- 修改文件：`package.json`
- 将 `"jiti": "^2.6.1"` 从 `devDependencies` 移至 `dependencies`

### 3.2 新建 config-loader.ts

- 新建文件：`lib/knowledge-graph/config-loader.ts`
- 实现 `loadConfigFile(configPath: string): Record<string, unknown> | null`：
  - 使用 `createJiti(configPath, { interopDefault: true, fsCache: false, sourceMaps: false })`
  - `const mod = jiti(configPath)`；`const config = mod.default ?? mod`
  - 函数式配置返回 null（REQ-1.6-13 排除）
  - catch 降级返回 null
- 实现 `findBuildConfig(projectRoot: string, tool: 'vite' | 'webpack'): string | null`：
  - vite 查找顺序：`vite.config.ts` → `vite.config.js` → `vite.config.mts` → `vite.config.mjs`
  - webpack 查找顺序：`webpack.config.ts` → `webpack.config.js` → `webpack.config.mts` → `webpack.config.mjs`

### 3.3 定义 AliasEntry 接口

- 在 `config-loader.ts` 中导出 `AliasEntry` 接口：`{ find: string; replacement: string }`
- 供 T5 / T6 / T7 使用

## 4. 测试计划

### 4.1 单元测试

- loadConfigFile 加载 ESM 配置（export default）正确返回配置对象
- loadConfigFile 加载 CJS 配置（module.exports）正确返回配置对象
- loadConfigFile 加载函数式配置返回 null
- loadConfigFile 加载不存在的文件返回 null
- loadConfigFile 加载语法错误的文件返回 null（catch 降级）
- findBuildConfig 正确查找 vite.config.ts
- findBuildConfig 正确查找 webpack.config.js
- findBuildConfig 未找到时返回 null

### 4.2 回归测试

- 知识图谱既有 tsconfig paths 解析不受影响（T7 集成前 createResolver 不变）

## 5. 风险与依赖

| 风险 / 依赖 | 影响 | 应对措施 |
|---|---|---|
| jiti 2.x API 与文档不符 | createJiti 调用方式可能不正确 | 开发时验证 jiti 2.6.1 实际 API；失败时 catch 降级 |
| jiti 依赖提升影响构建 | dist/ 中 require('jiti') 可能被 bundle 排除 | 确保构建配置不排除 jiti |

## 6. 变更范围

- 修改 `package.json`（jiti 依赖提升）
- 新建 `lib/knowledge-graph/config-loader.ts`（loadConfigFile + findBuildConfig + AliasEntry）
- 不修改既有源代码

## 7. 评审记录

> 评审日期：2026-06-23
> 评审结论：通过
> 评审人：creayma

### P0 阻塞缺陷

| 编号 | 问题描述 | 位置 | 修订建议 |
|---|---|---|---|
| - | - | - | - |

### P1 重要问题

| 编号 | 问题描述 | 位置 | 修订建议 |
|---|---|---|---|
| - | - | - | - |

### P2 优化项

| 编号 | 问题描述 | 位置 | 处理建议 |
|---|---|---|---|
| - | - | - | - |
