# webpack alias 解析

> 版本：v1.6
> 任务编号：T6
> 对应阶段 Spec：[phase-v1.6-spec.md](phase-v1.6-spec.md)
> 对应设计文档：[design-v1.6.md](../design-v1.6.md) §2.5
> 对应执行计划：[execution-plan-v1.6.md](../execution-plan-v1.6.md)
> 依赖任务：T4, T5
> 状态：已完成，已归档（冻结，不再修改）

## 1. 任务目标

在 `lib/knowledge-graph/config-loader.ts` 中实现 `parseWebpackAlias` 函数，解析 webpack.config 的 `resolve.alias` 配置，支持对象格式（含 webpack 5 对象形态 alias），输出统一的 `AliasEntry[]` 结构。对应阶段 Spec G-3。

## 2. 对应需求与验收标准

| 需求编号 | 需求描述 | 本任务验收标准 |
|---|---|---|
| REQ-1.6-9 | 支持 webpack.config.js resolve.alias 解析 | 读取项目根目录 `webpack.config.js`（或 `.ts`），解析 `resolve.alias` 配置；支持对象格式 `{ '@': path.resolve(__dirname, 'src') }` |
| REQ-1.6-15 | alias 路径解析为基于项目根目录的绝对路径 | webpack alias 中的 `path.resolve(__dirname, 'src')` 需正确解析为项目根目录下的绝对路径（jiti 加载时 `__dirname` 已正确求值） |

## 3. 实现步骤

### 3.1 实现 parseWebpackAlias 函数

- 修改文件：`lib/knowledge-graph/config-loader.ts`（T4 已新建）
- 新增函数：`parseWebpackAlias(config: Record<string, unknown>, projectRoot: string): AliasEntry[]`
- 关键逻辑：
  - 读取 `config.resolve.alias`，不存在或非对象时返回空数组
  - 遍历 `Object.entries(alias)` 逐项处理：
    - string 形态：`{ '@': '/src' }` → `{ find: '@', replacement: resolveAbsolutePath('/src', projectRoot) }`
    - 对象形态（webpack 5）：`{ '@': { path: '/src', exact: false } }` → 读取 `aliasObj.path`，`exact` 等其他字段忽略
  - replacement 路径经 `resolveAbsolutePath` 解析为绝对路径（T5 已实现）
  - 输出统一的 `AliasEntry[]`

### 3.2 对象形态 alias 兼容

- webpack 5 支持 `{ '@': { path: '/src', exact: false } }` 对象形态
- 检测 `replacement` 为 object 时，读取 `replacement.path` 字段
- `path` 为 string 时构造 `AliasEntry`，`exact` 等其他字段忽略（不影响路径解析）

### 3.3 path.resolve 已求值说明

- webpack.config.js 中的 `path.resolve(__dirname, 'src')` 在 jiti 加载配置文件时已被执行
- jiti 在加载时执行配置文件，`__dirname` 会被正确设置为配置文件所在目录
- 因此 `alias` 对象的 value 已是绝对路径字符串，`resolveAbsolutePath` 仅作兜底（处理意外相对路径）

## 4. 测试计划

### 4.1 单元测试

- 对象格式 alias 解析：`{ '@': '/src', '~/': '/src' }` → `[{ find: '@', replacement: '/src' }, { find: '~/', replacement: '/src' }]`
- webpack 5 对象形态 alias：`{ '@': { path: '/src', exact: false } }` → `[{ find: '@', replacement: '/src' }]`
- 对象形态 alias 缺少 `path` 字段时跳过
- replacement 相对路径解析：`'./src'` → `join(projectRoot, 'src')`
- replacement 绝对路径保持不变：`'/src'` → `'/src'`
- 无 `resolve.alias` 时返回空数组
- `resolve.alias` 为 null / undefined / 非对象时返回空数组

### 4.2 回归测试

- T4 的 `loadConfigFile` / `findBuildConfig` 不受影响
- T5 的 `parseViteAlias` 不受影响
- 既有 tsconfig paths 解析不受影响（T7 集成前 createResolver 不变）

## 5. 风险与依赖

| 风险 / 依赖 | 影响 | 应对措施 |
|---|---|---|
| 依赖 T4 | T4 未完成时 config-loader.ts 不存在 | 等待 T4 评审通过后执行 |
| 依赖 T5 | `resolveAbsolutePath` 由 T5 实现 | 等待 T5 评审通过后执行；或 T5/T6 同批次开发时确保 `resolveAbsolutePath` 先实现 |
| webpack 5 对象形态 alias 遗漏 | 对象形态 alias 未被解析 | 检测 `replacement` 为 object 时读取 `path` 字段 |
| jiti `__dirname` 求值不正确 | `path.resolve(__dirname, 'src')` 解析为错误路径 | jiti 在加载时正确设置 `__dirname`；T8 测试夹具验证 |

## 6. 变更范围

- 仅修改 `lib/knowledge-graph/config-loader.ts`（新增 `parseWebpackAlias`）
- 复用 T5 的 `resolveAbsolutePath` 辅助函数
- 不修改既有函数签名
- 不新增文件（config-loader.ts 由 T4 新建）
- `AliasEntry` 接口由 T4 已定义并导出

## 7. 评审记录

> - 第一轮评审（2026-06-23）：通过（修改后），发现 1 个 P1 问题
>   - P1-T6-1（文件头依赖任务不一致）：文件头依赖任务写 "T4"，但 §5 风险表明确依赖 T5（`resolveAbsolutePath` 由 T5 实现），不一致
>   - 修复内容：文件头依赖任务从 "T4" 改为 "T4, T5"
> - 第二轮重评（2026-06-23）：通过，P1-T6-1 已闭环
>   - 验证项 1（P1 闭环确认）：文件头依赖任务已改为 "T4, T5"，与 §3.1、§5 风险表、§6 变更范围中对 T5 的引用全部一致
>   - 验证项 2（设计一致性）：对照设计文档 §2.5，T6 实现步骤与设计一致（`parseWebpackAlias` 函数签名、对象格式 alias 处理、webpack 5 对象形态兼容、`resolveAbsolutePath` 复用、`path.resolve` 已求值说明）
>   - 验证项 3（验收标准覆盖）：对照阶段 Spec，REQ-1.6-9（webpack.config.js resolve.alias 解析）/ REQ-1.6-15（alias 路径解析为绝对路径）验收标准已覆盖
>   - 验证项 4（范围变更检查）：作者仅修改文件头依赖任务字段，§1~§6 主体内容未变更，未引入新的范围变更，无需重新全量评审
>   - 结论：无 P0 阻塞缺陷、无未解决 P1 问题、无新引入范围变更，重评通过
