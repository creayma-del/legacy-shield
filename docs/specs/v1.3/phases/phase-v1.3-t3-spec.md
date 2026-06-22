# T3：内存泄漏静态分析

> 版本：v1.3
> 任务编号：T3
> 对应阶段 Spec：[phases/phase-v1.3-spec.md](phase-v1.3-spec.md)
> 对应设计文档：[design-v1.3.md](../design-v1.3.md)
> 对应执行计划：[execution-plan-v1.3.md](../execution-plan-v1.3.md)
> 依赖任务：T1、T2
> 状态：已完成，已归档
> 评审记录：见本文档末尾

---

## 1. 任务目标

基于 T2 新增的内存相关静态规则，抽象公共作用域追踪 helper，聚合内存泄漏风险清单，并作为 T4 运行时采集的可选重点关注上下文。

---

## 2. 对应需求与验收标准

| 需求编号 | 需求描述 | 本任务验收标准 |
|---|---|---|
| REQ-1.3-3 | 在 v1.2 code-quality 基础上扩展代码静态质量检查 | 内存泄漏静态风险点可被识别与聚合 |
| REQ-1.3-5 | 新增内存泄漏检测 | 输出内存泄漏风险列表，供运行时采集参考 |
| REQ-1.3-2 | 监控结果以 NDJSON 结构化日志持久化 | 内存泄漏风险命中以 `category: 'static-rule'` 写入结构化日志 |

---

## 3. 实现步骤

### 3.1 抽象公共 helper `trackScopeCleanup`

- 在 `lib/custom-rules/utils.ts`（或按项目现有 helper 目录）新增 `trackScopeCleanup`。
- 职责：追踪作用域内资源注册（如 `addEventListener`、`setInterval`）与清理（如 `removeEventListener`、`clearInterval`）的配对关系。
- 输入：AST NodePath、注册 API 名称列表、清理 API 名称列表。
- 输出：未清理的注册节点列表，包含节点位置与资源类型。
- 被 `no-leaked-listener.ts` 与 `no-uncleared-timer.ts` 复用。

### 3.2 统一内存规则 `riskType`

- 确保 `no-leaked-listener` 与 `no-uncleared-timer` 命中时，`RuleHit.riskType === 'memory-leak'`。

### 3.3 聚合内存泄漏风险列表

- 在 `lib/custom-rules/index.ts` 的 `runCustomRules` 结果中，过滤所有 `riskType === 'memory-leak'` 的命中项。
- 将过滤结果映射为 `StaticRiskItem[]` 类型，作为 `memoryRiskList` 返回字段之一。

### 3.4 暴露给运行时采集

- 在 `lib/cli/quality.ts` 的 `runQuality` 中，调用 `runCustomRules` 后读取 `memoryRiskList`。
- 当 `--enable-memory-monitor` 启用时，将 `memoryRiskList` 作为可选上下文传入 `runMemoryMonitor`。
- 将风险命中项通过 `logger.logStructured` 写入结构化日志，`category: 'static-rule'`，`riskType: 'memory-leak'`。

### 3.5 新增单元测试

- 新增 `tests/custom-rules/memory-risk-list.test.ts`：验证 `runCustomRules` 返回的 `memoryRiskList` 字段包含预期的内存风险项。
- 覆盖无风险、单风险、多风险场景。

---

## 4. 测试计划

### 4.1 单元测试

- `trackScopeCleanup` 对成对的注册/清理返回空列表。
- `trackScopeCleanup` 对未清理的注册返回对应节点。
- `runCustomRules` 返回的 `memoryRiskList` 包含 `no-leaked-listener` 与 `no-uncleared-timer` 的命中项。
- `memoryRiskList` 项符合 `StaticRiskItem` 类型。

### 4.2 集成测试 / 端到端测试

- 构造包含事件监听与定时器未清理的测试项目，运行 `quality --enable-memory-monitor`，验证结构化日志中同时存在 `static-rule` 与 `runtime-memory` 两类内存相关日志。

### 4.3 回归测试

- 未启用 `--enable-memory-monitor` 时，`memoryRiskList` 仅用于日志与摘要，不中断 `quality` 流程。
- v1.2 的 custom-rules 输出结构不被破坏。

---

## 5. 风险与依赖

| 风险 / 依赖 | 影响 | 应对措施 |
|---|---|---|
| 依赖 T1 | 平台识别决定 `allowNoSrc` 与 H5/Web 上下文 | 等待 T1 完成 |
| 依赖 T2 | 内存规则由 T2 实现 | 等待 T2 完成；T3 主要负责聚合与 helper 抽象 |
| 静态分析无法覆盖动态注册场景 | 遗漏运行时生成的监听/定时器 | 与 T4 运行时采集互补，静态分析输出风险点，运行时验证 |

---

## 6. 变更范围

- 本任务不修改规则核心命中逻辑，仅在 T2 基础上抽象 helper 与聚合结果。
- 本任务不实现内存运行时采集（由 T4 处理）。
- 本任务不修改 `lib/logger.ts` 的底层写入逻辑（由 T7 处理）。

---

## 7. 评审记录

> 评审日期：2026-06-21
> 评审结论：通过
> 评审人：SPEC 动态评审团

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
