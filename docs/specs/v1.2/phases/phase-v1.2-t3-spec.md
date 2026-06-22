# 适配层改造任务 Spec

> 版本：v1.2
> 任务编号：T3
> 对应阶段 Spec：[phases/phase-v1.2-spec.md](phase-v1.2-spec.md)
> 对应设计文档：[design-v1.2.md](../design-v1.2.md)
> 对应执行计划：[execution-plan-v1.2.md](../execution-plan-v1.2.md)
> 依赖任务：T1, T2
> 状态：已完成，已归档
> 评审记录：见本文档末尾

## 1. 任务目标

改造 `lib/quality.ts` 适配层，使其直接调用 `lib/code-quality/index.ts` 的内部 API，移除对外部 code-quality 进程的 `spawn` 依赖，并完整捕获子进程输出写入 `QualityLog`。

## 2. 对应需求与验收标准

| 需求编号 | 需求描述 | 本任务验收标准 |
|---|---|---|
| REQ-1.2-1 | code-quality 源码迁移到 legacy-shield 内部 | `lib/quality.ts` 不再使用外部 `spawn` |
| REQ-1.2-3 | `quality` 子命令 CLI 完全兼容 | 参数、输出、退出码与 v1.1 一致 |
| REQ-1.2-2 | 保留全部现有能力 | `all` / `module` / `diff` 内部 API 调用正常 |

## 3. 实现步骤

### 3.1 分析现有 `lib/quality.ts`

- 阅读当前 `lib/quality.ts`，确认 `RunCodeQualityOptions`、`CodeQualitySummary`、`parseSummary` 等接口；
- 记录当前 `spawn` 调用方式与参数映射。

### 3.2 改造 `lib/quality.ts`

- 移除 `spawn('node', [cliPath, ...])` 逻辑；
- 根据 `RunCodeQualityOptions.targets` / `base` 解析 command，调用 `runAll` / `runModule` / `runDiff`；
- 将 `RunCodeQualityOptions.skipList` 映射为内部 API 的 `skip` 参数，确保 `--skip` 行为与 v1.1 一致；
- `watch` 不新增为 legacy-shield CLI 子命令；
- 保留 `parseSummary` 以兼容现有 `CodeQualitySummary` 解析（仅作为容错解析，不重复生成 summary）。

### 3.3 使用 `CodeQualityResult`

- 内部 API（由 T1 实现）返回 `CodeQualityResult`，包含 `code`、`stdout`、`stderr`、`summary`；
- `lib/quality.ts` 保持终端可见性（将 stdout/stderr 同步写入 `process.stdout`/`process.stderr`）后原样返回 `CodeQualityResult`；
- `CodeQualityResult.summary` 已包含 `CodeQualitySummary`，无需额外转换。

### 3.4 `lib/cli/quality.ts` 保持不变

- 不新增 `watch` 子命令；
- 参数解析与 v1.1 一致。

### 3.5 类型定义同步

- `CodeQualityResult` / `CodeQualitySummary` 统一从 `lib/types.ts` 导入，`lib/code-quality/index.ts` 仅做 re-export，不在 `lib/quality.ts` 中重复定义；
- 确保类型与现有消费方（`lib/cli/quality.ts`、`lib/report.ts` 等）兼容。

## 4. 测试计划

### 4.1 单元测试

- 验证 `lib/quality.ts` 根据 `targets` / `base` 正确分发到 `runAll` / `runModule` / `runDiff`；
- 验证 `skipList` 正确映射为内部 API 的 `skip` 参数；
- 验证 `CodeQualityResult` 包含正确的 `code`、`stdout`、`stderr`、`summary`；
- 验证错误退出码正确传递。

### 4.2 集成测试 / 端到端测试

- 运行 `node ./dist/cli.js quality --project <legacy>`，验证输出与退出码与 v1.1 一致；
- 验证无 `CODE_QUALITY_ROOT` 时命令可正常运行（`CODE_QUALITY_ROOT` 废弃提示由 T4 覆盖）。

### 4.3 回归测试

- 验证 `quality all`、`quality module`、`quality diff` 行为与 v1.1 一致；
- 验证 `quality` 子命令的 `--project`、`-p`、`-c` 等参数仍有效。

## 5. 风险与依赖

| 风险 / 依赖 | 影响 | 应对措施 |
|---|---|---|
| 依赖 T1 | 内部 API 未就绪 | 等待 T1 完成并评审通过 |
| 依赖 T2 | 依赖未安装 | 等待 T2 完成并评审通过 |
| 输出捕获不完整 | `QualityLog` 丢失信息 | 采用方案 A 并验证 |
| `parseSummary` 边界 | 重复解析或职责不清 | 开发阶段明确仅作为容错解析 |

## 6. 变更范围

- 本任务主要修改 `lib/quality.ts`；
- 本任务不修改 `lib/cli/quality.ts`；
- 本任务不迁移源码（由 T1 处理）；
- 本任务不安装依赖（由 T2 处理）。

## 7. 评审记录

| 轮次 | 时间 | 结论 | 主要问题 | 修订内容 |
|---|---|---|---|---|
| 第一轮 | 2026-06-21 | 不通过 | P1：引用了不存在的 `RunCodeQualityOptions.command`；将 T1 内部实现细节（`stdio: 'pipe'`、不调用 `process.exit()`）写入 T3。 | 改为根据 `targets` / `base` 解析 command；T3 仅描述对 `CodeQualityResult` 的使用，删除内部子进程实现细节。 |
| 第二轮 | 2026-06-21 | 不通过 | P1：`CodeQualityResult` 字段名错误（应为 `code`）；返回类型描述错误（应原样返回 `CodeQualityResult`）；未明确 `skipList` 到 `skip` 的映射。 | 将字段名改为 `code`；修正返回类型描述；补充 `skipList` 映射与测试；调整集成测试范围避免与 T4 重叠。 |
| 第三轮 | 2026-06-21 | 通过 | P2：`CodeQualityResult` / `CodeQualitySummary` 类型导入来源表述存在歧义。 | 明确统一从 `lib/types.ts` 导入，`lib/code-quality/index.ts` 仅做 re-export。 |

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
