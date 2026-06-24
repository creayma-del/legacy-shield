---
name: "spec-guardian-spec"
description: "Internal dependency of spec-guardian. DO NOT invoke directly. Loaded only when referenced by the spec-guardian main skill."
---

# Spec Guardian — Spec Stage

本子 Skill 覆盖 Spec 阶段：阶段 Spec、任务 Spec 拆解、任务 Spec 评审。

## 阶段范围

阶段 Spec（评审通过） → 任务 Spec 拆解 → 任务 Spec 评审通过

## 强制评审门禁

| 文档 | 评审方式 | 阻塞的下一阶段 |
|---|---|---|
| 阶段 Spec | 调用评审专家正式评审 | 任务 Spec 拆解 |
| 任务 Spec | 调用评审专家正式评审 | 代码开发 |

## 规则（if-then）

```
IF 阶段 Spec 不存在 → 检查设计阶段前置条件 → 通过则允许创建（草稿）
IF 阶段 Spec 状态 == "草稿" → 阻止拆解任务 Spec，提示提交评审
IF 阶段 Spec 状态 == "评审中" → 阻止拆解任务 Spec，提示等待评审
IF 阶段 Spec 状态 == "已通过" → 允许拆解任务 Spec
IF 任一任务 Spec 状态 != "已通过" → 阻止该任务进入代码开发
IF 所有任务 Spec 状态 == "已通过" → 允许进入代码开发
```

## 任务 Spec 拆解规则

- 一任务一 Spec：执行计划中每个任务必须对应一个独立任务 Spec。
- 依赖先行：被依赖的任务 Spec 优先编写和评审。
- 可并行评审：无依赖关系的任务 Spec 可并行评审。
- 不可分割：一个任务只能对应一个任务 Spec。
- 文件命名：`docs/specs/phases/phase-v{x}.{y}-t{n}-spec.md`。
- 初始状态：草稿。

## 任务 Spec 与阶段 Spec 的关系

| 维度 | 阶段 Spec | 任务 Spec |
|---|---|---|
| 范围 | 版本总体目标、范围、验收标准 | 单个任务实现步骤、测试计划、验收标准 |
| 修改权限 | 通过后不可直接修改 | 通过后不可直接修改 |
| 开发门禁 | 所有任务 Spec 通过前禁止开发 | 单个通过前该任务禁止开发 |

## 任务 Spec 边缘场景

- **新增任务**：创建新任务 Spec，单独评审通过后方可开发。
- **删除任务**：未开发则标记废弃；已开发则按范围变更处理。
- **任务合并**：保留一个，废弃其他，重新评审。
- **任务拆分**：原 Spec 废弃，为新任务各创建新 Spec 并评审。
- **阶段 Spec 变更**：所有任务 Spec 重新评估一致性，受影响的重新评审。

## 阶段转换检查点（Spec → 开发）

| 检查项 | 通过条件 | 失败动作 |
|---|---|---|
| 阶段 Spec | 状态为「已通过」 | 阻止，提示提交评审 |
| 所有任务 Spec | 状态均为「已通过」 | 阻止，提示等待未通过任务 Spec 评审 |

## 模板引用

需要创建文档时，读取 `spec-guardian-templates` 获取文件头模板，读取 `spec-guardian-doc-templates` 获取任务 Spec 正文模板。
