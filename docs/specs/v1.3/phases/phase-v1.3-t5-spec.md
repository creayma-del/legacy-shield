# T5：资源加载长耗时静态分析

> 版本：v1.3
> 任务编号：T5
> 对应阶段 Spec：[phases/phase-v1.3-spec.md](phase-v1.3-spec.md)
> 对应设计文档：[design-v1.3.md](../design-v1.3.md)
> 对应执行计划：[execution-plan-v1.3.md](../execution-plan-v1.3.md)
> 依赖任务：T1、T2
> 状态：已完成，已归档
> 评审记录：见本文档末尾

---

## 1. 任务目标

基于 T2 新增的资源相关静态规则，聚合资源加载风险清单，并作为 T6 运行时采集的可选重点关注上下文。

---

## 2. 对应需求与验收标准

| 需求编号 | 需求描述 | 本任务验收标准 |
|---|---|---|
| REQ-1.3-3 | 在 v1.2 code-quality 基础上扩展代码静态质量检查 | 资源加载静态风险点可被识别与聚合 |
| REQ-1.3-5 | 新增资源加载长耗时检测 | 输出资源加载风险列表，供运行时采集参考 |
| REQ-1.3-2 | 监控结果以 NDJSON 结构化日志持久化 | 资源加载风险命中以 `category: 'static-rule'` 写入结构化日志 |

---

## 3. 实现步骤

### 3.1 统一资源规则 `riskType`

- 确保 `no-large-resource` 与 `no-sync-script` 命中时，`RuleHit.riskType === 'resource-load'`。
- 确保 `no-large-resource` 在 `context` 中记录原始资源路径。

### 3.2 聚合资源加载风险列表

- 在 `lib/custom-rules/index.ts` 的 `runCustomRules` 结果中，过滤所有 `riskType === 'resource-load'` 的命中项。
- 将过滤结果映射为 `StaticRiskItem[]` 类型，作为 `resourceRiskList` 返回字段之一。

### 3.3 暴露给运行时采集

- 在 `lib/cli/quality.ts` 的 `runQuality` 中，调用 `runCustomRules` 后读取 `resourceRiskList`。
- 当 `--enable-resource-monitor` 启用时，将 `resourceRiskList` 作为可选上下文传入 `runResourceMonitor`。
- 将风险命中项通过 `logger.logStructured` 写入结构化日志，`category: 'static-rule'`，`riskType: 'resource-load'`。

### 3.4 新增单元测试

- 新增 `tests/custom-rules/resource-risk-list.test.ts`：验证 `runCustomRules` 返回的 `resourceRiskList` 字段包含预期的资源风险项。
- 覆盖大体积资源、同步脚本、无风险场景。

---

## 4. 测试计划

### 4.1 单元测试

- `runCustomRules` 返回的 `resourceRiskList` 包含 `no-large-resource` 与 `no-sync-script` 的命中项。
- `resourceRiskList` 项符合 `StaticRiskItem` 类型。
- `no-large-resource` 的 `context` 中包含原始资源路径。

### 4.2 集成测试 / 端到端测试

- 构造包含大体积资源引用与同步脚本的测试项目，运行 `quality --enable-resource-monitor`，验证结构化日志中同时存在 `static-rule` 与 `runtime-resource` 两类资源相关日志。

### 4.3 回归测试

- 未启用 `--enable-resource-monitor` 时，`resourceRiskList` 仅用于日志与摘要，不中断 `quality` 流程。
- v1.2 的 custom-rules 输出结构不被破坏。

---

## 5. 风险与依赖

| 风险 / 依赖 | 影响 | 应对措施 |
|---|---|---|
| 依赖 T1 | 平台识别决定 `allowNoSrc` 与 H5/Web 上下文 | 等待 T1 完成 |
| 依赖 T2 | 资源规则由 T2 实现 | 等待 T2 完成；T5 主要负责聚合结果 |
| 静态分析无法覆盖运行时动态加载资源 | 遗漏异步加载、懒加载资源 | 与 T6 运行时采集互补 |

---

## 6. 变更范围

- 本任务不修改规则核心命中逻辑，仅在 T2 基础上聚合结果。
- 本任务不实现资源运行时采集（由 T6 处理）。
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
