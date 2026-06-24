---
name: "spec-guardian-requirements"
description: "Internal dependency of spec-guardian. DO NOT invoke directly. Loaded only when referenced by the spec-guardian main skill."
---

# Spec Guardian — Requirements Stage

本子 Skill 覆盖需求阶段：需求澄清、需求对齐会议、需求分解文档。

## 阶段范围

需求澄清 → 需求文档 → 需求对齐会议（双方确认） → 需求分解文档（项目负责人批准）

## 规则（if-then）

```
IF 用户要求创建需求文档 AND 无需求澄清记录 → 先澄清需求
IF 用户要求创建需求文档 AND 有需求澄清记录 → 允许创建（草稿）
IF 需求文档已创建 AND 无会议纪要 → 阻止进入设计阶段，提示召开需求对齐会议
IF 会议纪要已创建 AND 未双方确认 → 阻止进入需求分解，提示确认
IF 会议纪要已确认 AND 无需求分解文档 → 阻止进入设计阶段，提示编写需求分解文档
IF 需求分解文档已创建 AND 未获项目负责人批准 → 阻止进入设计阶段，提示批准
IF 需求分解文档已获批准 → 允许进入设计阶段
```

## 需求对齐会议规则

- 必须在编写设计文档之前召开。
- 输出《需求对齐会议纪要》，需双方签字确认。
- 会议纪要存档于 `docs/specs/meetings/requirements-alignment-v{x}.{y}-YYYYMMDD.md`。
- 在 IDE 场景下，「签字」指用户明确回复「确认」「同意」。

## 需求分解文档规则

- 必须在需求对齐完成后编写。
- 包含：功能分解、任务依赖关系、资源分配估算、时间线里程碑、风险与假设。
- 必须经项目负责人批准后方可进入设计阶段。
- 文件命名：`docs/specs/requirements-decomposition-v{x}.{y}.md`。

## 阶段转换检查点（需求 → 设计）

| 检查项 | 通过条件 | 失败动作 |
|---|---|---|
| 需求对齐会议纪要 | 已创建且双方确认 | 阻止，提示召开会议 |
| 需求分解文档 | 已创建且项目负责人批准 | 阻止，提示编写并批准 |

## 模板引用

需要创建文档时，读取 `spec-guardian-doc-templates` 获取：
- 需求对齐会议纪要模板
- 需求分解文档模板
