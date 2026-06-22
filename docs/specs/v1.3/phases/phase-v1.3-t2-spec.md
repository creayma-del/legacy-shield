# T2：代码静态质量规则扩展

> 版本：v1.3
> 任务编号：T2
> 对应阶段 Spec：[phases/phase-v1.3-spec.md](phase-v1.3-spec.md)
> 对应设计文档：[design-v1.3.md](../design-v1.3.md)
> 对应执行计划：[execution-plan-v1.3.md](../execution-plan-v1.3.md)
> 依赖任务：T1
> 状态：已完成，已归档
> 评审记录：见本文档末尾

---

## 1. 任务目标

在现有 custom-rules 框架中新增与内存、资源相关的 4 条静态规则，扩展 `RuleHit` 类型与 HTML 扫描能力，为 T3/T5 的风险清单聚合提供基础数据。

---

## 2. 对应需求与验收标准

| 需求编号 | 需求描述 | 本任务验收标准 |
|---|---|---|
| REQ-1.3-3 | 在 v1.2 code-quality 基础上扩展代码静态质量检查 | 新增 4 条规则可被 `runCustomRules` 执行，默认启用且不影响 v1.2 行为 |
| REQ-1.3-5 | 新增内存泄漏检测与资源加载长耗时检测 | `no-leaked-listener`、`no-uncleared-timer` 命中内存泄漏风险；`no-large-resource`、`no-sync-script` 命中资源加载风险 |
| REQ-1.3-10 | 所有指标不阻断发版或合并 | 新增规则默认 severity 为 `warning`，不影响 `quality` 退出码 |

---

## 3. 实现步骤

### 3.1 扩展 `RuleHit` 类型

- 在 `lib/types.ts`（或 `lib/custom-rules/types.ts`，按项目现有位置）扩展 `RuleHit`：
  - 新增 `riskType?: 'memory-leak' | 'resource-load'`。
  - 新增 `context?: Record<string, unknown>`。
- 新增 `StaticRiskItem = Pick<RuleHit, 'ruleId' | 'filePath' | 'line' | 'column' | 'riskType' | 'message' | 'severity'>` 类型导出。

### 3.2 创建 `no-leaked-listener.ts`

- 检测 `addEventListener` 调用后未在对应作用域或组件卸载生命周期内调用 `removeEventListener`。
- 使用 `@babel/traverse` 遍历 AST，追踪事件类型、目标对象与清理调用配对关系。
- 命中时 `riskType` 置为 `'memory-leak'`，`severity` 为 `warning`。

### 3.3 创建 `no-uncleared-timer.ts`

- 检测 `setInterval` / `setTimeout` 返回值未在作用域内被 `clearInterval` / `clearTimeout`。
- 使用 `@babel/traverse` 追踪定时器变量引用与清理调用。
- 命中时 `riskType` 置为 `'memory-leak'`，`severity` 为 `warning`。

### 3.4 创建 `no-large-resource.ts`

- 检测代码中引用的静态资源路径（字符串字面量或模板字符串）。
- 仅处理可解析的相对文件路径（相对于当前源文件或项目根目录）。
- 忽略 URL（以 `http://`、`https://`、`//`、`data:` 开头）、webpack alias 与构建后路径。
- 对可解析路径通过 `fs.statSync` 判断实际体积是否超过 1024KB（默认阈值）。
- 命中时 `riskType` 置为 `'resource-load'`，`context` 中记录原始资源路径，`severity` 为 `warning`。

### 3.5 创建 `no-sync-script.ts`

- 扩展 `lib/custom-rules/scanner.ts` 支持 `.html` 文件扫描。
- 新增 `ShieldHtmlRule` 接口与 `HTML_RULE_IMPLEMENTATIONS` 注册表。
- `DEFAULT_INCLUDE` 增加 `.html`；对 `.html` 文件直接读取字符串，不再调用 Babel 解析。
- 扫描入口 `.html` 文件（优先 `index.html`，其次 `public/index.html`，最后 `src/index.html`），检测 `<head>` 中不含 `async`、`defer`、`type="module"` 的同步 `<script>` 标签。
- 命中时 `riskType` 置为 `'resource-load'`，`severity` 为 `warning`。
- 行号/列号通过 `html.slice(0, match.index).split('\n')` 计算。

### 3.6 注册新规则

- 在 `lib/custom-rules/rules/index.ts` 中注册 4 条新规则。
- 确保 `runCustomRules` 默认启用新增规则，且 `--disable-rule <rule-id>` 可禁用指定规则。

### 3.7 新增单元测试

- 新增 `tests/custom-rules/no-leaked-listener.test.ts`、`no-uncleared-timer.test.ts`、`no-large-resource.test.ts`、`no-sync-script.test.ts`。
- 覆盖命中场景、未命中场景、`--disable-rule` 禁用行为。

---

## 4. 测试计划

### 4.1 单元测试

- `no-leaked-listener` 对未清理的 `addEventListener('scroll', ...)` 命中。
- `no-uncleared-timer` 对未清理的 `setInterval(...)` 命中。
- `no-large-resource` 对引用超过 1024KB 的本地资源命中，对 URL/alias 不命中。
- `no-sync-script` 对 `<head>` 中同步 `<script>` 命中，对含 `defer` 的不命中。
- `--disable-rule no-leaked-listener` 后该规则不再输出命中。

### 4.2 集成测试 / 端到端测试

- 构造包含 4 类问题的测试项目，运行 `quality` 子命令，验证 4 条规则均产生命中。
- 验证命中项包含 `riskType` 与 `context` 字段。

### 4.3 回归测试

- 未启用新增规则或传入 `--disable-rule` 全部禁用后，`quality` 退出码与 v1.2 一致。
- 现有 custom-rules 框架对其他规则的扫描不受影响。

---

## 5. 风险与依赖

| 风险 / 依赖 | 影响 | 应对措施 |
|---|---|---|
| 依赖 T1 | T1 提供的 `allowNoSrc` 与平台信息是 H5/Web 项目扫描的前提 | 等待 T1 评审通过后再开发 |
| 规则误报 | 报告噪音增加 | 默认 severity 为 `warning`；根据测试反馈迭代调整；支持 `--disable-rule` 禁用 |
| HTML 行号/列号计算错误 | 定位信息不准确 | 对典型 HTML 结构（含换行、缩进）逐项验证 |

---

## 6. 变更范围

- 本任务不实现风险清单聚合（由 T3/T5 处理）。
- 本任务不实现运行时采集（由 T4/T6 处理）。
- 本任务不修改 v1.2 code-quality 相关逻辑。

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
