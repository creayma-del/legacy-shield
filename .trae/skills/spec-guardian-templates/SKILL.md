---
name: "spec-guardian-templates"
description: "Internal dependency of spec-guardian. DO NOT invoke directly. Loaded only when referenced by the spec-guardian main skill."
---

# Spec Guardian — Templates

本子 Skill 定义 spec-guardian 所需的文件命名规范、文档状态定义及 Spec 文件头模板。

## 文件命名规范

| 文档类型 | 命名示例 |
|---|---|
| 项目总规范 | `docs/specs/project-rules.md` |
| 需求文档 | `docs/specs/requirements-v{x}.{y}.md` |
| 需求对齐会议纪要 | `docs/specs/meetings/requirements-alignment-v{x}.{y}-YYYYMMDD.md` |
| 需求分解文档 | `docs/specs/requirements-decomposition-v{x}.{y}.md` |
| 设计文档 | `docs/specs/design-v{x}.{y}.md` |
| 执行计划 | `docs/specs/execution-plan-v{x}.{y}.md` |
| 阶段 Spec | `docs/specs/phases/phase-v{x}.{y}-spec.md` |
| 任务 Spec | `docs/specs/phases/phase-v{x}.{y}-t{n}-spec.md` |
| PATCH 任务 Spec | `docs/specs/phases/phase-v{x}.{y}-patch-{n}-spec.md` |
| 验收报告 | `docs/specs/acceptance-report-v{x}.{y}.md` |
| PATCH 影响评估 | `docs/specs/patch-impact-v{x}.{y}-{n}.md` 或附在 Spec 的 PATCH 小节中 |

## 文档状态定义

| 状态 | 含义 | 是否可修改 |
|---|---|---|
| 草稿 | 文档初稿，尚未进入评审 | 是 |
| 评审中 | 已提交评审，等待或正在评审 | 是（仅限按评审意见修订） |
| 已通过 | 评审通过，可作为开发依据 | 否，需通过补丁流程或新版本 |
| 已完成，已归档 | 开发验收完成，冻结不再修改 | 否 |

## Spec 文件头模板

### 阶段 Spec 文件头

```markdown
# {标题}

> 版本：v{x}.{y}
> 对应需求文档：requirements-v{x}.{y}.md
> 对应设计文档：design-v{x}.{y}.md
> 对应执行计划：execution-plan-v{x}.{y}.md
> 状态：草稿
> 评审记录：见本文档末尾
```

### 任务 Spec 文件头

```markdown
# {任务名称}

> 版本：v{x}.{y}
> 任务编号：T{n}
> 对应阶段 Spec：phases/phase-v{x}.{y}-spec.md
> 对应设计文档：design-v{x}.{y}.md
> 对应执行计划：execution-plan-v{x}.{y}.md
> 依赖任务：T{a}, T{b}（无则填「无」）
> 状态：草稿
> 评审记录：见本文档末尾
```

## 任务 Spec 正文模板

```markdown
# {任务名称}

> 任务编号：T{n}
> 版本：v{x}.{y}
> 状态：草稿

## 1. 任务目标

- {用 1-3 句话说明本任务要实现的目标}
- {对应阶段 Spec 中的哪个总体目标}

## 2. 对应需求与验收标准

| 需求编号 | 需求描述 | 本任务验收标准 |
|---|---|---|
| REQ-{x}-{n} | {描述} | {可量化的验收标准} |

## 3. 实现步骤

### 3.1 步骤一：{步骤名称}

- {详细描述}
- {涉及文件 / 模块}
- {关键代码逻辑或接口变更}

### 3.2 步骤二：{步骤名称}

- {详细描述}

## 4. 测试计划

### 4.1 单元测试

- {测试用例 1}
- {测试用例 2}

### 4.2 集成测试 / 端到端测试

- {测试场景 1}
- {测试场景 2}

### 4.3 回归测试

- {需验证的已有功能 1}
- {需验证的已有功能 2}

## 5. 风险与依赖

| 风险 / 依赖 | 影响 | 应对措施 |
|---|---|---|
| {依赖 T{a}} | {阻塞本任务开发} | {等待 T{a} 评审通过} |
| {风险 1} | {影响} | {措施} |

## 6. 变更范围

- {明确说明不在本任务范围内的事项}
- {可能与阶段 Spec 存在偏差的边界说明}

## 7. 评审记录

> 评审日期：YYYY-MM-DD
> 评审结论：通过 / 不通过
> 评审人：{姓名}

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
```
