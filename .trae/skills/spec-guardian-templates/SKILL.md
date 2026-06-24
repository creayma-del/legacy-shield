---
name: "spec-guardian-templates"
description: "Internal dependency of spec-guardian. DO NOT invoke directly. Loaded only when referenced by the spec-guardian main skill."
---

# Spec Guardian — Templates

本子 Skill 存放命名规范、状态定义、Spec 文件头模板和标准回复模板。

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

## 文档状态定义

| 状态 | 含义 | 可修改 |
|---|---|---|
| 草稿 | 初稿，未进入评审 | 是 |
| 评审中 | 已提交评审 | 是（仅限按意见修订） |
| 已通过 | 评审通过，可作开发依据 | 否 |
| 已完成，已归档 | 验收完成，冻结 | 否 |

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

## 标准回复模板

### 模板 A：前置条件不满足，阻止进入下一阶段

```
当前处于【{当前阶段}】，若要进入【{目标阶段}】，必须先完成：

1. {缺失条件 1}
2. {缺失条件 2}

请补充以上环节后，我再继续协助。
```

### 模板 B：允许进入代码开发

```
阶段 Spec {路径} 状态为「已通过」。
所有任务 Spec 状态均为「已通过」。
可以进入代码开发阶段。

开发约束：
- 严格遵循 {设计文档路径} 与对应任务 Spec。
- 如需偏离 Spec，必须先升级 Spec 并重新评审。
- 完成后需调用测试验收专家进行验收。
```

### 模板 C：已归档文档不可直接修改

```
{文件路径} 状态为「已完成，已归档」，不可直接修改。

请选择以下路径之一：
1. 若仅为错别字/示例修正 → 走 PATCH 流程。
2. 若涉及能力变更或新增 → 走新版本流程。
```

### 模板 D：PATCH 级别判定建议

```
该改动属于 PATCH 级别（{原因}），可走 PATCH 流程简化处理。

仍需完成：
- 补丁任务 Spec 评审通过。
- 测试验收通过。
- 如涉及设计变更，同步更新设计文档。
```

### 模板 E：评审不通过，需修订

```
{文档路径} 评审不通过，存在以下需修订项：

阻塞项（P0）：
- {问题 1}

重要问题（P1）：
- {问题 2}

优化项（P2）：
- {问题 3}

请按以上意见修订后，重新提交评审。
```
