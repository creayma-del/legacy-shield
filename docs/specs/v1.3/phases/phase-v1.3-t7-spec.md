# T7：结构化日志输出与文件持久化

> 版本：v1.3
> 任务编号：T7
> 对应阶段 Spec：[phases/phase-v1.3-spec.md](phase-v1.3-spec.md)
> 对应设计文档：[design-v1.3.md](../design-v1.3.md)
> 对应执行计划：[execution-plan-v1.3.md](../execution-plan-v1.3.md)
> 依赖任务：T2、T3、T4、T5、T6
> 状态：已完成，已归档
> 评审记录：见本文档末尾

---

## 1. 任务目标

将 v1.3 监控结果以统一 NDJSON 格式写入本地文件，保留完整上下文；同时保持 v1.2 `QualityLog` 行为不变。

---

## 2. 对应需求与验收标准

| 需求编号 | 需求描述 | 本任务验收标准 |
|---|---|---|
| REQ-1.3-2 | 监控结果以 NDJSON 结构化日志持久化 | 平台、静态规则、运行时采集结果均以 NDJSON 写入 `<project>/.legacy-shield/logs/<sessionId>.ndjson` |
| REQ-1.3-9 | 结构化日志写入本地文件，默认保留 30 天 | 支持 `--log-dir` 与 `--structured-log-retention-days` 配置；保留策略基于 `mtime` 生效 |
| REQ-1.3-8 | 保持现有 CLI 子命令接入方式 | 新增 `--log-dir` 与 `--structured-log-retention-days` 参数；`--log-retention-days` 仍控制 v1.2 QualityLog |

---

## 3. 实现步骤

### 3.1 扩展类型定义

- 在 `lib/types.ts` 新增 `StructuredLogEntry` 接口：
  - `timestamp: string`（ISO 8601）
  - `sessionId: string`
  - `level: 'error' | 'warn' | 'info'`
  - `category: 'quality' | 'static-rule' | 'runtime-memory' | 'runtime-resource' | 'platform'`
  - `ruleId?: string`
  - `riskType?: 'memory-leak' | 'resource-load'`
  - `message: string`
  - `sourceLocation?: { filePath: string; line: number; column: number }`
  - `context?: Record<string, unknown>`
- 扩展 `Logger` 接口：
  - 保留 `logRuntime`、`logNetwork`、`logBehavior`、`logQuality` 方法。
  - 新增 `logStructured(entry: StructuredLogEntry): void`。
  - 新增 `close(): Promise<void>`。

### 3.2 实现 `StructuredLogger`

- 在 `lib/logger.ts` 中新增 `StructuredLogger` 类：
  - 接收 `logDir` 与 `sessionId`。
  - 创建目录（不存在时）。
  - 打开 `<logDir>/<sessionId>.ndjson` 可写流。
  - `logStructured(entry)` 将 entry 序列化为 JSON 行并写入，追加 `\n`。
  - `close()` 关闭文件流。
- `createLogger` 工厂函数返回的实例同时支持 v1.2 `QualityLog` 与 v1.3 `StructuredLog` 双轨输出。

### 3.3 实现日志保留策略

- 默认结构化日志保留 30 天，可通过 `--structured-log-retention-days` 覆盖。
- 清理仅作用于 `--log-dir` 目录下匹配 `shield_*.ndjson` 模式的文件。
- 清理基于文件 `mtime`，在每次启用 v1.3 路径的 `quality` 命令启动时触发。
- v1.2 `QualityLog` 保留策略保持不变，由 `--log-retention-days` 控制。

### 3.4 扩展 CLI 参数与 `QualityCommandOptions`

- 在 `cli.ts` 的 `quality` 子命令中新增：
  - `--log-dir <path>`
  - `--structured-log-retention-days <days>`
- 在 `QualityCommandOptions` 中新增：
  - `logDir?: string`
  - `structuredLogRetentionDays?: number`
- 在 `runQuality` 中透传。

### 3.5 在 `runQuality` 中写入结构化日志

- 平台识别结果：`category: 'platform'`。
- 静态规则命中：`category: 'static-rule'`，携带 `ruleId` 与 `riskType`。
- 内存运行时结果：`category: 'runtime-memory'`。
- 资源运行时结果：`category: 'runtime-resource'`。
- v1.2 code-quality 结果仍写入原有 `QualityLog`，不强制同步写入结构化日志；如需在结构化日志中保留 quality 摘要，以 `category: 'quality'` 写入，但不得改变 v1.2 QualityLog 的路径、格式与保留策略。

### 3.6 新增单元测试

- 新增 `tests/logger.test.ts`：
  - 验证日志文件创建、字段完整性、NDJSON 格式。
  - 验证 `--structured-log-retention-days` 清理逻辑。
  - 验证 `--log-retention-days` 仍控制 v1.2 `QualityLog`。

---

## 4. 测试计划

### 4.1 单元测试

- `createLogger` 返回的实例同时支持 `logQuality` 与 `logStructured`。
- `logStructured` 写入后，文件每行均为合法 JSON，包含 `timestamp`、`sessionId`、`level`、`category`、`message`。
- `--structured-log-retention-days 1` 可清理 2 天前的 `shield_*.ndjson` 文件，但不清理 `--log-dir` 下其他名称的文件。
- `--log-retention-days` 仍控制 `<project>/.runtime-log-ignore/quality/` 目录。

### 4.2 集成测试 / 端到端测试

- 运行 `quality` 子命令，验证 `<project>/.legacy-shield/logs/<sessionId>.ndjson` 文件存在。
- 启用内存/资源监控后，验证日志中包含 `runtime-memory` 与 `runtime-resource` 类别。

### 4.3 回归测试

- 原有 `QualityLog` 路径、格式、保留天数默认 7 天行为不变。
- 未启用任何 v1.3 新参数时，不创建 `.legacy-shield/logs/` 目录或结构化日志文件；`quality` 子命令退出码、QualityLog 路径/格式/保留策略与 v1.2 完全一致。

---

## 5. 风险与依赖

| 风险 / 依赖 | 影响 | 应对措施 |
|---|---|---|
| 依赖 T2-T6 | 各监控模块产生原始结果 | 等待前置任务完成；T7 负责统一持久化 |
| 日志文件过大 | 磁盘占用增加 | 按 session 分文件；默认 30 天清理；后续可扩展采样/压缩 |
| 目录权限问题 | 日志写入失败 | 在 `logStructured` 中捕获异常并记录到终端；不中断 quality 流程 |
| 双轨日志配置混淆 | 用户误用 `--log-retention-days` 控制结构化日志 | 文档明确区分：`--log-retention-days` 控制 QualityLog，`--structured-log-retention-days` 控制 StructuredLog |

---

## 6. 变更范围

- 本任务不修改 v1.2 `QualityLog` 的路径、格式与默认保留天数。
- 本任务不实现具体的监控规则或运行时采集逻辑。
- 本任务不修改 `shield` 子命令的日志行为。

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
