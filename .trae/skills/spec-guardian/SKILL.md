---
name: "spec-guardian"
description: "Enforces a structured project workflow from requirements alignment through spec review. Invoke when the user initiates requirements, design, execution plans, specs, or attempts code development before spec approval."
---

# Spec Guardian

## 三层渐进式加载

| 层级 | 内容 | 加载时机 |
|---|---|---|
| L1 始终加载 | 本 Skill 核心规则、状态分支、Plan-Execute-Verify | Skill 触发时 |
| L2 按需加载 | 阶段子 Skill（requirements/design/spec/development/acceptance） | 按当前阶段读取 |
| L3 引用查找 | spec-guardian-templates + spec-guardian-doc-templates | 需创建文档或回复时读取 |

## Plan-Execute-Verify 架构

### PLAN 阶段

1. 分析用户意图（创建/修改/评审/验收/开发/询问流程）。
2. 定位目标文档（按命名规范定位）。
3. 核查文档状态（读取文件头 `> 状态：xxx`）。
4. 制定执行计划：确定当前阶段、需读取的子 Skill、需检查的条件、预期输出。

### EXECUTE 阶段

1. 按「子 Skill 调度矩阵」读取对应阶段子 Skill。
2. 按状态驱动分支规则执行检查。
3. 执行判定（允许/阻止/需补充）。
4. 如需调用评审专家，执行调用。

### VERIFY 阶段

1. 验证判定结果是否与核心规则一致。
2. 验证是否遗漏必要检查项。
3. 验证输出格式是否符合标准。
4. 如验证失败，回退到 PLAN 阶段重新规划。

## 标准化 I/O

### 输入

| 字段 | 说明 | 来源 |
|---|---|---|
| 用户意图 | 创建/修改/评审/验收/开发/询问 | 用户消息 |
| 目标文档路径 | 按命名规范定位 | Glob/Read |
| 当前状态 | 草稿/评审中/已通过/已归档/未创建 | 文件头状态行 |
| 前置文档状态 | 上游文档的状态 | Read |

### 输出

| 字段 | 说明 |
|---|---|
| 判定结果 | 允许/阻止/需补充 |
| 当前阶段 | 需求/设计/Spec/开发/验收 |
| 缺失条件 | 未满足的前置条件列表 |
| 下一步动作 | 具体的下一步建议 |
| 使用模板 | 需要使用的回复模板编号 |

## 核心规则（L1 始终加载）

1. MINOR 及以上走完整流程：需求澄清 → 需求文档 → 需求对齐会议 → 需求分解文档 → 设计文档 → 执行计划 → 阶段 Spec → 任务 Spec → 代码开发 → 测试验收 → 归档。
2. 强制评审门禁：设计文档、执行计划、阶段 Spec、任务 Spec 必须调用评审专家评审，未通过禁止下一步。
3. 每个任务必须生成任务 Spec 并单独评审通过。
4. 已归档文档不可直接修改。
5. 需求对齐会议纪要双方确认，需求分解文档项目负责人批准。
6. PATCH 判定：不新增 API/CLI/配置、不改接口、不引入依赖、不破坏测试。

## 状态驱动分支（if-then）

```
IF 文档不存在 → 检查前置条件 → 允许创建（初始状态：草稿）
IF 状态 == "草稿" → 阻止进入下一阶段 → 提示提交评审
IF 状态 == "评审中" → 阻止进入下一阶段 → 提示等待评审完成
IF 状态 == "已通过" → 检查下一阶段前置条件 → 允许或阻止
IF 状态 == "已归档" → 阻止修改 → 引导 PATCH 或新版本
```

## 子 Skill 调度矩阵

| 当前阶段 | 必读子 Skill（L2） | 引用子 Skill（L3） |
|---|---|---|
| 需求澄清/对齐/分解 | spec-guardian-requirements | templates / doc-templates |
| 设计文档/执行计划 | spec-guardian-design | templates / doc-templates |
| 阶段 Spec/任务 Spec | spec-guardian-spec | templates / doc-templates |
| 代码开发/PATCH/范围变更 | spec-guardian-development | templates / doc-templates |
| 测试验收/归档 | spec-guardian-acceptance | templates / doc-templates |

**执行原则**：跨场景时合并读取对应子 Skill；子 Skill 与本 Skill 冲突时以本 Skill 为准；读取失败时使用本 Skill 核心规则兜底。

## 阶段转换检查点

| 转换 | 检查项 | 通过 → 动作 | 失败 → 动作 |
|---|---|---|---|
| 需求 → 设计 | 会议纪要双方确认 + 分解文档已批准 | 允许编写设计文档 | 阻止，回退需求阶段 |
| 设计 → Spec | 设计文档已通过 + 执行计划已通过 | 允许编写阶段 Spec | 阻止，回退设计阶段 |
| Spec → 开发 | 阶段 Spec 已通过 + 所有任务 Spec 已通过 | 允许代码开发 | 阻止，回退 Spec 阶段 |
| 开发 → 验收 | 代码开发完成 + 测试通过 | 允许验收 | 阻止，回退开发阶段 |
| 验收 → 归档 | 验收报告通过 + 文档已更新 | 允许归档 | 阻止，回退验收阶段 |

## 版本决策树

```
是否破坏架构或引入不兼容变更？
  ├─ 是 → MAJOR
  └─ 否 → 是否新增功能或能力增强？
      ├─ 是 → MINOR（完整流程）
      └─ 否 → 是否仅修复 bug/文档/性能？
          ├─ 是 → PATCH（PATCH 流程）
          └─ 否 → 与用户澄清
```

## 必须询问用户

- 用户意图不明确。
- 版本级别不确定。
- 多版本并行，目标版本不明确。
- 已归档文档需修改，路径不明确。
- 用户坚持绕过流程。
- 需求边界不清。
- 子 Skill 读取失败。

## 多版本并行判定

1. 用户明确指定 → 以用户指定为准。
2. 最高版本号已通过/已归档阶段 Spec → 最新交付版本。
3. 最高版本号草稿/评审中阶段 Spec → 正在开发版本。
4. 多个版本均开发中 → 询问用户。

## 禁止行为

- 未对齐先设计。
- 未分解先设计。
- 未审先下一步。
- 擅自跳过评审。
- 未审先开发。
- 擅自修改已归档文档。
- 范围蔓延。

## 输出要求

- 使用与项目现有文档一致的语言。
- 引用文件路径时使用 `file:///` 链接。
- 阻止时说明当前阶段、缺失环节及下一步动作。
- 优先使用 spec-guardian-templates 中的回复模板。
- 不执行 git 提交、推送、系统命令或依赖安装。
