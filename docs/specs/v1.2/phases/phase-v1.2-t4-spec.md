# 配置加载与 CODE_QUALITY_ROOT 兼容处理任务 Spec

> 版本：v1.2
> 任务编号：T4
> 对应阶段 Spec：[phases/phase-v1.2-spec.md](phase-v1.2-spec.md)
> 对应设计文档：[design-v1.2.md](../design-v1.2.md)
> 对应执行计划：[execution-plan-v1.2.md](../execution-plan-v1.2.md)
> 依赖任务：T3
> 状态：已完成，已归档
> 评审记录：见本文档末尾

## 1. 任务目标

确保 `.local-llm-config.js` 加载逻辑不变，并实现 `CODE_QUALITY_ROOT` 环境变量的一次性废弃提示与静默兼容，保证 v1.1 用户习惯平滑过渡。

## 2. 对应需求与验收标准

| 需求编号 | 需求描述 | 本任务验收标准 |
|---|---|---|
| REQ-1.2-1 | code-quality 源码迁移到 legacy-shield 内部 | 未配置 `CODE_QUALITY_ROOT` 时使用内置 code-quality |
| REQ-1.2-3 | `quality` 子命令 CLI 完全兼容 | 配置 `CODE_QUALITY_ROOT` 时仍正常运行并打印一次性提示 |

## 3. 实现步骤

### 3.1 保留 `.local-llm-config.js` 加载逻辑

- `load-local-config.ts` 继续从 `legacy-shield` 根目录加载 `.local-llm-config.js`（迁移与路径改造由 T1 完成，T4 仅验证行为不变）；
- 加载优先级不变：显式环境变量 > `.local-llm-config.js` > 内置默认值。

### 3.2 实现 `CODE_QUALITY_ROOT` 废弃提示

- 在 `lib/quality.ts` 适配层中检测 `process.env.CODE_QUALITY_ROOT`；
- 若存在，打印一次 `deprecated` 提示：`CODE_QUALITY_ROOT 已废弃，将使用 legacy-shield 内置 code-quality。`；
- 提示后忽略该环境变量，继续使用内置 code-quality。

### 3.3 确保不影响运行

- 废弃提示不影响 `quality` 子命令的正常执行；
- 不抛出错误、不中断流程；
- 每个 CLI 进程生命周期内仅打印一次（通过模块级 flag 实现，避免重复）。

### 3.4 更新环境变量读取位置

- 确保 `lib/code-quality/` 内部不再读取 `CODE_QUALITY_ROOT`；
- 所有路径常量基于 `LEGACY_SHIELD_ROOT` / `CODE_QUALITY_DIR`。

## 4. 测试计划

### 4.1 单元测试

- 验证配置 `CODE_QUALITY_ROOT` 时打印废弃提示；
- 验证未配置 `CODE_QUALITY_ROOT` 时不打印提示；
- 验证废弃提示在每个进程生命周期内仅打印一次；
- 验证 `.local-llm-config.js` 加载逻辑与优先级不变。

### 4.2 集成测试 / 端到端测试

- 运行 `CODE_QUALITY_ROOT=/some/path node ./dist/cli.js quality --project <legacy>`，验证命令正常执行并打印提示；
- 运行 `node ./dist/cli.js quality --project <legacy>`，验证命令正常执行且不打印提示。

### 4.3 回归测试

- 验证 v1.1 的 `.local-llm-config.js` 配置继续生效；
- 验证环境变量优先级高于 `.local-llm-config.js`，`.local-llm-config.js` 优先级高于内置默认值。

## 5. 风险与依赖

| 风险 / 依赖 | 影响 | 应对措施 |
|---|---|---|
| 依赖 T1 | 路径常量未就绪 | 等待 T1 完成 |
| 提示重复打印 | 用户体验差 | 确保每次命令调用只打印一次 |
| 环境变量被内部误读 | 路径解析错误 | 全局搜索并移除 `CODE_QUALITY_ROOT` 读取 |

## 6. 变更范围

- 本任务仅修改 `lib/quality.ts`，增加 `CODE_QUALITY_ROOT` 废弃提示；
- `load-local-config.ts` 的迁移与路径改造由 T1 完成，T4 仅验证其加载逻辑不变；
- 不迁移源码（由 T1 处理）；
- 适配层主改造由 T3 完成。

## 7. 评审记录

| 轮次 | 时间 | 结论 | 主要问题 | 修订内容 |
|---|---|---|---|---|
| 第一轮 | 2026-06-21 | 不通过 | P1：依赖任务应为 T3 而非 T1；变更范围错误包含 `load-local-config.ts`；加载优先级中出现当前 CLI 不存在的 `--model` 参数。 | 将依赖任务改为 T3；精简变更范围为仅修改 `lib/quality.ts`；移除 `--model`，优先级保留环境变量 > 配置文件 > 默认值；将 `CODE_QUALITY_ROOT` 废弃提示测试从 T5 移至 T4。 |
| 第二轮 | 2026-06-21 | 不通过 | P1：4.3 回归测试中仍残留 `--model` CLI 参数。 | 将回归测试改为验证环境变量 > 配置文件 > 默认值的优先级链路。 |
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
