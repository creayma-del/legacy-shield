# Pinia _p 数组包装

> 版本：v1.6
> 任务编号：T1
> 对应阶段 Spec：[phase-v1.6-spec.md](phase-v1.6-spec.md)
> 对应设计文档：[design-v1.6.md](../design-v1.6.md) §2.1
> 对应执行计划：[execution-plan-v1.6.md](../execution-plan-v1.6.md)
> 依赖任务：无
> 状态：已完成，已归档（冻结，不再修改）
> 评审日期：2026-06-23

## 1. 任务目标

在 `patchPinia` 中访问 Pinia 2.x 内部 `_p` 数组，逐个包装 plugin function（含 function 形态与对象 install 形态）为 try/catch，使 plugin install 阶段抛错能被 shield 捕获并落盘为 `pinia-plugin-error`。对应阶段 Spec G-1。

## 2. 对应需求与验收标准

| 需求编号 | 需求描述 | 本任务验收标准 |
|---|---|---|
| REQ-1.6-1 | 遍历 `pinia._p`，逐个包装 plugin function 为 try/catch | patchPinia 中访问 `pinia._p`，对每个 plugin function 包裹 try/catch；install 抛错时 emit `pinia-plugin-error` |
| REQ-1.6-2 | `_p` 数组访问的防御性处理 | `_p` 不存在或非数组时静默跳过；单个 plugin 包装失败不影响其他 plugin；与现有 `pinia.use` 包装层去重协同 |

## 3. 实现步骤

### 3.1 在 patchPinia 中新增 _p 包装步骤

- 修改文件：`lib/inject.iife.ts`
- 修改位置：`patchPinia` 函数（L774-836），在现有「3) 兜底：补登已注册 store」之前新增「2.5) 包装 `_p` 数组中的 plugin」
- 关键逻辑：
  - 读取 `pinia._p` 数组，`Array.isArray(plugins)` 检查
  - 遍历每个 plugin：
    - function 形态：包装为 `shieldWrappedPlugin`，try/catch 内调用 `originalPlugin.apply(this, args)`，catch 中 `markShieldEmitted` + `emitRuntime('pinia-plugin-error', ...)` + throw
    - 对象形态（`install` 为 function）：包装 `obj.install` 方法
  - `__shield_wrapped_plugin__` 标记防重复包装
  - 原地替换 `plugins[i]`，不改变数组长度与顺序

### 3.2 与现有 pinia.use 包装层协同

- `pinia.use` 包装层（L784-796）在 plugin 被 push 到 `_p` 之前捕获同步抛错
- `_p` 包装层在 plugin 被 store 工厂遍历调用时捕获 install 抛错
- 两者通过 `__shield_emitted__` 去重，不会重复落盘

## 4. 测试计划

### 4.1 单元测试

- TC-3（T3 恢复）：plugin install 抛错被正确捕获并落盘为 `pinia-plugin-error`
- _p 不存在时静默跳过，不抛错
- _p 为非数组时静默跳过
- 对象形态 plugin（`{ install: fn }`）install 抛错被捕获
- 重复调用 patchPinia 不重复包装（`__shield_wrapped_plugin__` 生效）

### 4.2 回归测试

- TC-1 / TC-2（既有 Pinia action 错误采集）不受影响
- pinia.use 包装层行为不变

## 5. 风险与依赖

| 风险 / 依赖 | 影响 | 应对措施 |
|---|---|---|
| Pinia 2.x `_p` 私有 API 变更 | 包装失败 | `Array.isArray(plugins)` 防御性检查；失败时静默降级 |
| T2 同文件修改 | inject.iife.ts 合并冲突 | 修改不同函数（patchPinia vs patchErrorHandler/patchVuex），无逻辑冲突 |

## 6. 变更范围

- 仅修改 `lib/inject.iife.ts` 的 `patchPinia` 函数
- 不修改 `patchPinia` 签名
- 不新增文件

## 7. 评审记录

> 评审日期：2026-06-23
> 评审结论：通过
> 评审人：spec-reviewer-expert

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
| P2-1 | 测试计划分类（单元测试/集成测试分离） | §4 | 已处理：测试计划已分类 |
| P2-2 | 缺少去重协同测试 | §4.1 | 已处理：补充 `__shield_wrapped_plugin__` 防重复包装测试 |
| P2-3 | 缺少集成测试章节 | §4 | 已处理：补充集成测试章节 |
| P2-4 | 文档一致性优化 | 全文 | 已处理 |
