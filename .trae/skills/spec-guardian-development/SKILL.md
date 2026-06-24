---
name: "spec-guardian-development"
description: "Internal dependency of spec-guardian. DO NOT invoke directly. Loaded only when referenced by the spec-guardian main skill."
---

# Spec Guardian — Development Stage

本子 Skill 覆盖开发阶段：代码开发门禁、PATCH 流程、Spec 批准后范围变更。

## 阶段范围

代码开发 → PATCH 流程 → 范围变更处理

## 代码开发门禁规则（if-then）

```
IF 阶段 Spec 状态 != "已通过" → 阻止开发
IF 任一任务 Spec 状态 != "已通过" → 阻止该任务开发
IF 所有任务 Spec 状态 == "已通过" → 允许开发，提醒严格按 Spec 执行
IF 开发中需偏离 Spec → 必须先升级 Spec 并重新评审
```

## PATCH 流程

### 判定条件（必须同时满足）

- 不新增 API / CLI 参数 / 配置项。
- 不修改现有接口签名或返回结构。
- 不引入新的外部依赖。
- 不影响已有测试的断言目标。

### 允许的简化

- 可在现有阶段 Spec 中新增「PATCH 任务」小节。
- 需求对齐会议和需求分解文档可合并为「补丁影响评估」。
- 设计文档如无需变更，可仅做引用说明。

### 仍需强制通过

- 补丁任务 Spec 必须通过评审专家评审。
- 如涉及设计变更，必须同步更新设计文档。
- 必须通过测试验收。

### PATCH 与任务 Spec 的关系

- **默认**：在现有阶段 Spec 中新增「PATCH 任务」小节。
- **可选**：跨模块影响时可创建独立 PATCH 任务 Spec 文件（`phase-v{x}.{y}-patch-{n}-spec.md`）。
- **禁止**：未形成任何 Spec 就直接修改代码。

### 紧急安全修复

- 可先修复并合并，但事后 24 小时内补全 Spec 与评审记录。

## Spec 批准后范围变更处理

| 偏差级别 | 条件 | 处理 |
|---|---|---|
| 小型 | 不影响核心目标、不改技术方案、不引入新能力 | PATCH 流程消化 |
| 中型 | 影响验收标准或实现细节，不改整体范围 | 修订 Spec，重新评审 |
| 大型 | 改变核心目标、新增能力、修改接口或架构 | 新版本流程 |

## 阶段转换检查点（开发 → 验收）

| 检查项 | 通过条件 | 失败动作 |
|---|---|---|
| 代码开发 | 所有任务已完成 | 阻止，提示完成剩余任务 |
| 测试 | 单元/集成/E2E 测试通过 | 阻止，提示修复失败测试 |

## 模板引用

需要创建文档时，读取 `spec-guardian-doc-templates` 获取 PATCH 影响评估模板。
