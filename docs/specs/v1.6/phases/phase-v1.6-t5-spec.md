# vite alias 解析

> 版本：v1.6
> 任务编号：T5
> 对应阶段 Spec：[phase-v1.6-spec.md](phase-v1.6-spec.md)
> 对应设计文档：[design-v1.6.md](../design-v1.6.md) §2.4
> 对应执行计划：[execution-plan-v1.6.md](../execution-plan-v1.6.md)
> 依赖任务：T4
> 状态：已完成，已归档（冻结，不再修改）
> 评审日期：2026-06-23

## 1. 任务目标

在 `lib/knowledge-graph/config-loader.ts` 中实现 `parseViteAlias` 函数，解析 vite.config 的 `resolve.alias` 配置，支持对象格式与数组格式，输出统一的 `AliasEntry[]` 结构。对应阶段 Spec G-3。

## 2. 对应需求与验收标准

| 需求编号 | 需求描述 | 本任务验收标准 |
|---|---|---|
| REQ-1.6-8 | 支持 vite.config.ts resolve.alias 解析 | 读取项目根目录 `vite.config.ts`（或 `.js`），解析 `resolve.alias` 配置；支持对象格式 `{ '@': '/src' }` 与数组格式 `[{ find: '@', replacement: '/src' }]` |
| REQ-1.6-13 | 仅支持静态 alias 配置 | 不支持函数式 alias（T4 已排除）与正则 alias（`find` 为 RegExp 时跳过）；仅处理 `find` 为 string 的条目 |

## 3. 实现步骤

### 3.1 实现 parseViteAlias 函数

- 修改文件：`lib/knowledge-graph/config-loader.ts`（T4 已新建）
- 新增函数：`parseViteAlias(config: Record<string, unknown>, projectRoot: string): AliasEntry[]`
- 关键逻辑：
  - 读取 `config.resolve.alias`，不存在时返回空数组
  - 数组格式遍历：逐项检查 `item.find` 与 `item.replacement` 均为 string，正则 alias（`typeof find !== 'string'`）跳过
  - 对象格式遍历：`Object.entries(alias)` 逐项检查 `replacement` 为 string
  - replacement 路径经 `resolveAbsolutePath` 解析为绝对路径
  - 输出统一的 `AliasEntry[]`（`{ find: string; replacement: string }`）

### 3.2 实现 resolveAbsolutePath 辅助函数

- 修改文件：`lib/knowledge-graph/config-loader.ts`
- 新增函数：`resolveAbsolutePath(p: string, projectRoot: string): string`
- 关键逻辑：
  - `p.startsWith('/')` 时视为绝对路径直接返回
  - 否则返回 `join(projectRoot, p)`（相对路径基于项目根目录解析）

### 3.3 正则 alias 排除

- 数组格式中 `find` 为 RegExp（如 `/^@\/components\//`）时，`typeof find !== 'string'` 检测为 true，跳过该项
- 对象格式的 key 始终为 string，无需额外检测

## 4. 测试计划

### 4.1 单元测试

- 对象格式 alias 解析：`{ '@': '/src', '~/': '/src' }` → `[{ find: '@', replacement: '/src' }, { find: '~/', replacement: '/src' }]`
- 数组格式 alias 解析：`[{ find: '@', replacement: '/src' }]` → `[{ find: '@', replacement: '/src' }]`
- 正则 alias 跳过：数组中含 `find` 为 RegExp 的条目时跳过
- replacement 相对路径解析：`'./src'` → `join(projectRoot, 'src')`
- replacement 绝对路径保持不变：`'/src'` → `'/src'`
- 无 `resolve.alias` 时返回空数组
- `resolve.alias` 为 null / undefined 时返回空数组

### 4.2 回归测试

- T4 的 `loadConfigFile` / `findBuildConfig` 不受影响
- 既有 tsconfig paths 解析不受影响（T7 集成前 createResolver 不变）

## 5. 风险与依赖

| 风险 / 依赖 | 影响 | 应对措施 |
|---|---|---|
| 依赖 T4 | T4 未完成时 config-loader.ts 不存在 | 等待 T4 评审通过后执行 |
| vite alias 格式多样 | 遗漏格式导致解析失败 | 对象格式与数组格式均覆盖；正则 alias 明确跳过（REQ-1.6-13） |
| replacement 路径非绝对 | 解析为错误路径 | `resolveAbsolutePath` 统一处理相对路径与绝对路径 |

## 6. 变更范围

- 仅修改 `lib/knowledge-graph/config-loader.ts`（新增 `parseViteAlias` + `resolveAbsolutePath`）
- 不修改既有函数签名
- 不新增文件（config-loader.ts 由 T4 新建）
- `AliasEntry` 接口由 T4 已定义并导出

## 7. 评审记录

> 评审日期：2026-06-23
> 评审结论：通过（修改后）
> 评审人：spec-reviewer-expert

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
| P2-1 | 文档一致性优化 | 全文 | 已处理 |
| P2-2 | 测试计划补充 | §4 | 已处理 |
| P2-3 | 风险表补充 | §5 | 已处理 |

### P3 可选优化

| 编号 | 问题描述 | 位置 | 处理建议 |
|---|---|---|---|
| P3-1 | 测试覆盖增强建议 | §4 | 可选采纳 |
