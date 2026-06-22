# legacy-shield v1.3 验收报告

> 版本：v1.3
> 验收日期：2026-06-21
> 对应阶段 Spec：[phases/phase-v1.3-spec.md](phases/phase-v1.3-spec.md)
> 对应设计文档：[design-v1.3.md](design-v1.3.md)
> 对应执行计划：[execution-plan-v1.3.md](execution-plan-v1.3.md)
> 状态：已完成，已归档

---

## 1. 测试环境

- 操作系统：macOS
- Node.js：>= 20.19.0
- pnpm：>= 10.33.4
- 浏览器：Playwright Chromium
- 测试框架：Vitest v4.1.9
- TypeScript：v5.9.3

## 2. 测试范围

本次验收覆盖 v1.3 全部 8 个任务（T1-T8）：

| 任务 | 任务目标 | 验收结果 |
|---|---|---|
| T1 | H5/Web 项目检测入口与配置适配 | 通过 |
| T2 | 代码静态质量规则扩展（no-leaked-listener、no-uncleared-timer、no-large-resource、no-sync-script） | 通过 |
| T3 | 内存泄漏静态分析（风险清单聚合） | 通过 |
| T4 | 内存泄漏运行时采集 | 通过 |
| T5 | 资源加载长耗时静态分析（风险清单聚合） | 通过 |
| T6 | 资源加载长耗时运行时采集 | 通过 |
| T7 | 结构化日志输出与文件持久化 | 通过 |
| T8 | 文档更新与全量验收 | 通过 |

## 3. 验证结果

### 3.1 类型检查

```bash
pnpm run typecheck
```

结果：通过，无类型错误。

### 3.2 构建

```bash
pnpm run build
```

结果：通过，`dist/cli.js` 构建成功。

### 3.3 单元测试与集成测试

```bash
pnpm test
```

结果：16 个测试文件，108 条测试全部通过。

新增测试覆盖：

- `tests/platform.test.ts`：平台自动推断与显式指定。
- `tests/custom-rules.test.ts`：新增 SHIELD-005/006/007/008 规则命中与未命中场景。
- `tests/risk-aggregator.test.ts`：内存泄漏与资源加载风险清单聚合。
- `tests/structured-logger.test.ts`：NDJSON 写入、自定义目录、过期清理。
- `tests/start-page.test.ts`：启动页面 URL/file/dev server 解析。
- `tests/quality.integration.test.ts`：v1.3 `quality` 子命令端到端行为验证。

### 3.4 端到端示例验证

使用临时业务系统项目验证：

```bash
node ./dist/cli.js quality \
  --project /tmp/shield-test-project \
  --platform web \
  --skip type-check --skip lint --skip test
```

结果：

- 终端正确输出平台类型、自定义规则命中摘要、结构化日志路径；
- `<project>/.legacy-shield/logs/<sessionId>.ndjson` 文件生成；
- 结构化日志包含 `platform`、`static-rule` 等类别条目；
- 未启用 `--enable-memory-monitor`/`--enable-resource-monitor` 时不启动浏览器，保持低开销。

## 4. 实现变更摘要

### 4.1 新增文件

- `lib/platform.ts`：H5/Web 平台检测。
- `lib/structured-logger.ts`：NDJSON 结构化日志输出与过期清理。
- `lib/custom-rules/risk-aggregator.ts`：静态风险清单聚合。
- `lib/runtime-monitor/memory-collector.ts`：内存泄漏运行时采集。
- `lib/runtime-monitor/resource-collector.ts`：资源加载运行时采集。
- `lib/runtime-monitor/start-page.ts`：启动页面解析（URL/HTML/dev server）。
- `lib/custom-rules/rules/no-leaked-listener.ts`：未移除事件监听检测。
- `lib/custom-rules/rules/no-uncleared-timer.ts`：未清除定时器检测。
- `lib/custom-rules/rules/no-large-resource.ts`：大体积本地静态资源检测。
- `lib/custom-rules/rules/no-sync-script.ts`：HTML `<head>` 同步脚本检测。
- 新增对应单元/集成测试文件。

### 4.2 修改文件

- `lib/types.ts`：扩展 `RuleHit`、`QualityCommandOptions`、`StartBrowserOptions`，新增 `RiskType`、`StaticRiskItem`、`StructuredLogEntry`、`StructuredLogger` 等类型。
- `lib/cli/quality.ts`：集成平台检测、结构化日志、运行时内存/资源监控、v1.3 路径开关。
- `lib/custom-rules/index.ts`：特殊处理 `no-sync-script` 规则 HTML 扫描。
- `lib/custom-rules/rules/index.ts`：注册 4 条新规则。
- `cli.ts`：新增 `quality` 子命令 v1.3 参数；验收过程中修复 `--structured-log-retention-days` 默认值导致 v1.3 路径无条件启用的问题，确保未显式使用 v1.3 参数时保持 v1.2 行为。
- `lib/browser.ts`：支持 `skipInject`、`skipProxy`。
- `README.md`、`docs/usage.md`：更新项目定位与 v1.3 使用说明。

## 5. 遗留问题与注意事项

1. **no-leaked-listener / no-uncleared-timer**：当前实现可识别同作用域及返回清理函数中的 `removeEventListener` / `clearInterval` / `clearTimeout`。若清理逻辑通过变量传递、在异步回调或更复杂的生命周期钩子中执行，可能产生误报或漏报；后续可根据实际业务反馈迭代。
2. **no-large-resource**：仅检测相对路径（`./` 或 `../`）且实际存在的本地资源，忽略 URL、webpack alias 与构建后路径，符合设计文档要求。
3. **运行时监控**：内存与资源采集依赖 Playwright 与可访问的启动页面。若目标项目无 dev server 脚本且未提供 `index.html`，`resolveStartPage` 会抛出明确错误；采集失败不影响 `quality` 整体退出码。
4. **结构化日志清理**：仅清理 `shield_*.ndjson` 文件，避免误删用户自定义文件。
5. **v1.2 兼容性**：未使用 `--platform`/`--enable-memory-monitor`/`--enable-resource-monitor`/`--log-dir`/`--structured-log-retention-days` 时，`quality` 保持 v1.2 行为不变。验收过程中已修复 `cli.ts` 中 `--structured-log-retention-days` 默认值为 `30` 导致 v1.3 路径被无条件触发的问题。

## 6. 评审结论

v1.3 全部任务实现符合设计文档、执行计划与任务 Spec 要求；类型检查、构建、单元测试、集成测试与端到端示例验证均通过；用户文档已更新。同意验收通过并归档。

> 评审人：开发助手 + 自动化测试套件
> 评审日期：2026-06-21
