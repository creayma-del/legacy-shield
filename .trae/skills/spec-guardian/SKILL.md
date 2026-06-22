---
name: "spec-guardian"
description: "Enforces a structured project workflow from requirements alignment through spec review. Invoke when the user initiates requirements, design, execution plans, specs, or attempts code development before spec approval."
---

# Spec Guardian

本 Skill 是项目规范流程的入口 Skill。它识别用户意图、判断当前阶段、核对前置条件，并调度以下子 Skill：

| 子 Skill | 职责 |
|---|---|
| spec-guardian-core | 核心流程、状态机、版本判定 |
| spec-guardian-patch | PATCH 流程、Spec 批准后范围变更 |
| spec-guardian-task-spec | 任务 Spec 拆解、评审、边缘场景 |
| spec-guardian-scenarios | 常见场景处理、违规操作处理 |
| spec-guardian-templates | 命名规范、状态定义、Spec 文件头、任务 Spec 正文模板 |
| spec-guardian-doc-templates | 需求分解、设计文档、执行计划模板 |
| spec-guardian-meeting-templates | 会议纪要、PATCH 影响评估模板 |
| spec-guardian-reply-templates | 标准回复、验收报告模板 |
| spec-guardian-review | 评审准入/准出、重评规则 |
| spec-guardian-checklists | 预审清单、归档前检查清单 |

## 触发条件

- 用户要求创建或修改需求、设计、执行计划、阶段 Spec、任务 Spec。
- 用户要求直接开始代码开发。
- 用户要求修改已归档文档。
- 用户要求评审、验收或归档。
- 用户询问项目流程、规范、纪律或文档体系。

## 核心规则摘要

1. **MINOR 及以上改动必须走完整流程**：需求澄清 → 需求文档 → 需求对齐会议（双方确认） → 需求分解文档（项目负责人批准） → 设计文档（评审通过） → 执行计划（评审通过） → 阶段 Spec（评审通过） → 任务 Spec 拆解 → 任务 Spec 评审通过 → 代码开发 → 测试验收 → 归档。
2. **设计文档、执行计划、阶段 Spec、任务 Spec 状态均为「已通过」之前，禁止进入下一阶段**。
3. **执行计划中每个独立任务必须生成对应任务 Spec，并单独评审通过**。
4. **已归档文档不可直接修改**；如需变更，走 PATCH 或新版本流程。
5. **需求对齐会议纪要必须双方确认，需求分解文档必须项目负责人批准**。
6. **PATCH 判定条件**：不新增 API/CLI/配置、不修改接口签名、不引入新依赖、不破坏已有测试断言。

## 编排执行流程

1. **识别用户意图**：创建、修改、评审、验收、开发、询问流程。
2. **定位相关文档**：按命名规范定位需求、设计、执行计划、阶段 Spec、任务 Spec。
3. **核查文档状态**：读取文件头 `> 状态：xxx`。不存在 → 未创建；无状态行 → 草稿；「评审中」→ 禁止进入下一阶段；「已通过」→ 可开发；「已完成，已归档」→ 不可直接修改。
4. **核对前置条件**：根据当前阶段，检查进入下一阶段所需条件。
5. **判定操作权限**：满足则允许并提示后续要求；不满足则阻止并说明缺失环节。
6. **读取并应用子 Skill 规则**：按「子 Skill 读取决策矩阵」使用 Read 工具读取对应子 Skill 文件。若读取失败，使用本 Skill 核心规则和常见场景快速判断继续处理，并提示异常。
7. **记录与确认**：回复中列出已满足和未满足条件，必要时请用户文字确认。

## 子 Skill 读取决策矩阵

| 用户场景 | 必读子 Skill（顺序） |
|---|---|
| 询问流程、规范、当前阶段、状态判断 | core |
| 判断版本级别或 PATCH 可行性 | core → patch |
| 根据执行计划生成任务 Spec | task-spec → templates → review |
| 任务 Spec 变更、合并、拆分、评审不通过 | task-spec |
| 创建新文档 | templates / doc-templates / meeting-templates → core |
| 修改草稿或评审中文档 | core → templates / reply-templates |
| 直接开始代码开发 | core → task-spec |
| 修改已归档文档 | core → patch → reply-templates |
| 评审文档 | review → checklists → reply-templates |
| 验收或归档 | checklists → reply-templates |
| 范围蔓延、需求变更、偏差 | core → patch → task-spec |

**执行原则**：跨场景时合并读取对应子 Skill；子 Skill 与本 Skill 冲突时以本 Skill 为准；读取失败时跳过并使用兜底规则。

## 核心流程速览

```
需求澄清 → 需求文档 → 需求对齐会议（双方确认） → 需求分解文档（项目负责人批准） → 设计文档（评审通过） → 执行计划（评审通过） → 阶段 Spec（评审通过） → 任务 Spec 拆解 → 任务 Spec 评审通过 → 代码开发 → 测试验收 → 归档关闭
```

## 常见场景快速判断

### 开始代码开发

1. 定位阶段 Spec 和所有任务 Spec。
2. 阶段 Spec 不存在 → 阻止，提示完成完整流程。
3. 阶段 Spec 非「已通过」→ 阻止，提示当前状态。
4. 存在未通过的任务 Spec → 阻止，提示等待评审完成。
5. 全部通过 → 允许开发，提醒严格按 Spec 执行。

### 修改已归档文档

1. 确认状态为「已完成，已归档」。
2. 阻止直接修改。
3. 错别字/示例修正 → PATCH；能力变更/新增 → 新版本。

### 评审文档

1. 确认状态为「草稿」或「评审中」。
2. 检查准入条件：结构完整、文件头完整、上游已通过、自检完成。
3. 调用评审专家前执行预审清单。
4. 结论只能为「通过」或「不通过」。

### 创建新文档

1. 判断版本级别（MINOR / MAJOR / PATCH）。
2. 检查前置文档状态。
3. 按对应模板创建，初始状态设为「草稿」。

### 根据执行计划生成任务 Spec

1. 确认执行计划和阶段 Spec 已通过。
2. 按任务列表为每个任务生成任务 Spec。
3. 任务 Spec 引用阶段 Spec、设计文档、执行计划、任务编号和依赖。
4. 所有任务 Spec 评审通过后，方可进入代码开发。

## 必须询问用户的场景

- 用户意图不明确。
- 版本级别不确定（MINOR / MAJOR 边界）。
- 多个版本并行，目标版本不明确。
- 已归档文档需修改，路径不明确。
- 用户坚持绕过流程。
- 需求边界不清、验收标准不明确。
- 子 Skill 读取失败，是否继续按核心规则处理。

## 多版本并行时的当前版本判定

1. 用户明确指定 → 以用户指定为准。
2. 最高版本号的「已通过」或「已完成，已归档」阶段 Spec → 最新交付版本。
3. 最高版本号的「草稿」或「评审中」阶段 Spec → 正在开发版本。
4. 多个版本均处于开发中 → 询问用户。
5. 已归档版本不可作为开发目标；修改须走 PATCH 或新版本。

## 禁止行为

- **未对齐先设计**：先召开需求对齐会议并产出双方确认的会议纪要。
- **未分解先设计**：先完成《需求分解文档》并获项目负责人批准。
- **未审先开发**：Spec 评审通过前禁止开发。
- **擅自修改已归档文档**：须走新版本或 PATCH 流程重新发起。
- **范围蔓延**：新需求应单独走新版本流程，不得混入当前 Spec。

## 输出要求

- 使用与项目现有文档一致的语言。
- 引用文件路径时使用可点击的 `file:///` 链接。
- 阻止违规时说明当前阶段、缺失环节及下一步动作。
- 优先使用 `spec-guardian-reply-templates` 中的标准回复模板。
- 不代替用户执行 git 提交、推送、系统命令或依赖安装等越权操作。
