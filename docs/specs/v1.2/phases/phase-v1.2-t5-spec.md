# 测试改造任务 Spec

> 版本：v1.2
> 任务编号：T5
> 对应阶段 Spec：[phases/phase-v1.2-spec.md](phase-v1.2-spec.md)
> 对应设计文档：[design-v1.2.md](../design-v1.2.md)
> 对应执行计划：[execution-plan-v1.2.md](../execution-plan-v1.2.md)
> 依赖任务：T3
> 状态：已完成，已归档
> 评审记录：见本文档末尾

## 1. 任务目标

更新 legacy-shield 现有测试，验证 code-quality 内部集成后的行为，确保 `quality` 子命令输出、退出码、`CODE_QUALITY_ROOT` 废弃提示等均符合预期。

## 2. 对应需求与验收标准

| 需求编号 | 需求描述 | 本任务验收标准 |
|---|---|---|
| REQ-1.2-1 | code-quality 源码迁移到 legacy-shield 内部 | 测试不再依赖外部 code-quality 进程 |
| REQ-1.2-3 | `quality` 子命令 CLI 完全兼容 | 端到端测试验证参数、输出、退出码与 v1.1 一致 |
| REQ-1.2-2 | 保留全部现有能力 | `all` / `module` / `diff` 能力均有测试覆盖 |

## 3. 实现步骤

### 3.1 更新 `tests/quality.test.ts`

- 将 mock 对象从外部 `spawn` 进程改为 mock `lib/code-quality/index.ts` 的 `runAll` / `runModule` / `runDiff`；
- 验证 `lib/quality.ts` 根据 `targets` / `base` 正确分发；
- 验证 `skipList` 正确映射为内部 API 的 `skip` 参数；
- 验证 `lib/quality.ts` 返回完整 `CodeQualityResult`，包含正确的 `code`、`stdout`、`stderr`、`summary`。

### 3.2 更新 `tests/quality.integration.test.ts`

- 移除对外部 `code-quality` 进程路径的依赖；
- 使用项目内测试夹具创建临时 legacy 项目；
- 改为端到端验证 `node ./dist/cli.js quality --project <legacy>` 的实际执行链路；
- 覆盖 `all`、`module`、`diff` 三种命令；
- 验证退出码与输出格式。

### 3.3 验证自动生成单测目录

- 验证 `tests/code-quality-generated/` 目录被正确创建；
- 验证生成的 spec 文件可被 vitest 正确加载（在 `LEGACY_PROJECT_PATH` 设置后）。

## 4. 测试计划

### 4.1 单元测试

- `tests/quality.test.ts` 通过；
- mock 内部 API 返回值并验证适配层行为。

### 4.2 集成测试 / 端到端测试

- `tests/quality.integration.test.ts` 通过；
- 端到端运行 `node ./dist/cli.js quality --project <legacy>`。

### 4.3 回归测试

- 确认 legacy-shield 其他测试不受 code-quality 集成影响；
- 确认 `pnpm test` 全量通过。

## 5. 风险与依赖

| 风险 / 依赖 | 影响 | 应对措施 |
|---|---|---|
| 依赖 T3 | 适配层未就绪 | 等待 T3 完成 |
| 端到端测试依赖示例老项目 | 测试不稳定 | 使用项目内测试夹具创建临时 legacy 项目 |
| 自动生成 spec 目录不存在 | 集成测试失败 | 测试前置创建目录 |

## 6. 变更范围

- 本任务修改 `tests/quality.test.ts`、`tests/quality.integration.test.ts`；
- 本任务不修改业务代码；
- 本任务不迁移源码（由 T1 处理）。

## 7. 评审记录

| 轮次 | 时间 | 结论 | 主要问题 | 修订内容 |
|---|---|---|---|---|
| 第一轮 | 2026-06-21 | 不通过 | P1：依赖任务与执行计划不一致（写为 T3、T4，应为 T3）；`CODE_QUALITY_ROOT` 废弃提示测试应归属 T4。 | 将依赖任务改为 T3；将 `CODE_QUALITY_ROOT` 废弃提示测试移至 T4；补充 `runWatch` 基本覆盖与测试夹具说明。 |
| 第二轮 | 2026-06-21 | 不通过 | P1：测试描述错误（`CodeQualityResult` 已含 `summary`，无需转换）；P2：缺少 `skipList` 映射测试。 | 修正测试描述为验证完整 `CodeQualityResult`；补充 `skipList` 到 `skip` 映射的单元测试。 |
| 第三轮 | 2026-06-21 | 通过 | 无 P0/P1/P2 问题。 | - |

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
