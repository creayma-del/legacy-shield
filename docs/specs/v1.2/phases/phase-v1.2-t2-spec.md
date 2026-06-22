# 依赖整合任务 Spec

> 版本：v1.2
> 任务编号：T2
> 对应阶段 Spec：[phases/phase-v1.2-spec.md](phase-v1.2-spec.md)
> 对应设计文档：[design-v1.2.md](../design-v1.2.md)
> 对应执行计划：[execution-plan-v1.2.md](../execution-plan-v1.2.md)
> 依赖任务：T1
> 状态：已完成，已归档
> 评审记录：见本文档末尾

## 1. 任务目标

将 `/Users/creayma/personal/code-quality/package.json` 中的 `dependencies` 与 `devDependencies` 合并到 `legacy-shield/package.json`，解决版本冲突，确保 `pnpm install`、`pnpm typecheck`、`pnpm test` 全量通过。

## 2. 对应需求与验收标准

| 需求编号 | 需求描述 | 本任务验收标准 |
|---|---|---|
| REQ-1.2-1 | code-quality 源码迁移到 legacy-shield 内部 | 依赖不再依赖外部 code-quality 项目 |
| REQ-1.2-4 | 不修改老项目源码，不在老项目内安装依赖 | 依赖全部安装在 legacy-shield 项目内 |

## 3. 实现步骤

### 3.1 列出 code-quality 依赖

- 读取 `/Users/creayma/personal/code-quality/package.json`；
- 列出全部 `dependencies` 与 `devDependencies`。

### 3.2 与 legacy-shield 现有依赖做 diff

- 读取 `legacy-shield/package.json`；
- 对比每个包的当前版本与 code-quality 版本；
- 参考 [design-v1.2.md 第 2.5 节](../design-v1.2.md#25-依赖整合方案) 的依赖 diff 表。

### 3.3 版本冲突处理

- 冲突时优先保留 legacy-shield 当前版本；
- 若 code-quality 版本更高且包含必要功能，统一升级到较高版本；
- 若版本差异导致 `pnpm typecheck` / `pnpm test` 失败，以能全量通过为最终判定标准。

### 3.4 更新 `package.json`

- 新增/升级且仅用于开发或 `quality` 运行的依赖写入 `devDependencies`；
- 已存在于 `dependencies` 的运行时依赖（如 `commander`）保持原分类不变；
- 不修改老项目的 `package.json`。

### 3.5 安装依赖

- 执行 `pnpm install`；
- 验证无未解析依赖冲突。

### 3.6 vitest v3 → v4 兼容性验证

- 在仅升级 `vitest` 的情况下先运行 `pnpm test`；
- 若现有测试断言或 API 不兼容，记录并修复后再继续。

### 3.7 全量验证

- 运行 `pnpm typecheck`；
- 运行 `pnpm build`；
- 运行 `pnpm test`。

## 4. 测试计划

### 4.1 单元测试

- 无（本任务为工程配置任务）。

### 4.2 集成测试 / 端到端测试

- `pnpm install` 成功；
- `pnpm typecheck` 通过；
- `pnpm build` 通过；
- `pnpm test` 通过。

### 4.3 回归测试

- 确认 legacy-shield 现有测试在 vitest v4 下仍通过。

## 5. 风险与依赖

| 风险 / 依赖 | 影响 | 应对措施 |
|---|---|---|
| vitest v4 破坏现有测试 | `pnpm test` 失败 | 先单独验证 vitest 兼容性 |
| ESLint 9 与现有配置冲突 | lint 失败 | 按 design-v1.2.md 调整 flat config |
| 依赖版本冲突 | 运行时异常 | 优先保留 legacy-shield 版本，必要时升级 |
| 依赖 T1 | 源码未迁移时无法验证 typecheck/build | 等待 T1 完成或先并行更新 package.json |

## 6. 变更范围

- 本任务修改 `legacy-shield/package.json`，并同步更新 `pnpm-lock.yaml`；
- 不迁移源码（由 T1 处理）；
- 不改造适配层（由 T3 处理）。

## 7. 评审记录

| 轮次 | 时间 | 结论 | 主要问题 | 修订内容 |
|---|---|---|---|---|
| 第一轮 | 2026-06-21 | 不通过 | P1：依赖任务与执行计划不一致（写为「无」，应为 T1）；P2：依赖分类说明不严谨、未提及 `pnpm-lock.yaml` 同步更新。 | 将依赖任务改为 T1；明确新增/升级依赖写入 `devDependencies`，已存在的运行时依赖保持原分类；在变更范围中补充 `pnpm-lock.yaml` 同步更新。 |
| 第二轮 | 2026-06-21 | 通过 | 无 P0/P1 问题。 | - |

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
