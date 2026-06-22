# legacy-shield v1.1 任务 Spec：T5 全量回归与验收

> 版本：v1.1
> 对应阶段 Spec：[phase-v1.1-spec.md](./phase-v1.1-spec.md)
> 对应执行计划：[execution-plan-v1.1.md](../execution-plan-v1.1.md)
> 状态：已通过，可进入代码开发

---

## 1. 目标

在 T1-T4 全部完成后，执行全量回归验证，确保 v1.1 不引入 v1.0 功能回归，并完成阶段验收。

---

## 2. 范围

**包含**：

- 本地执行 `pnpm typecheck`、`pnpm build`、`pnpm test`；
- 生成 `docs/specs/acceptance-report-v1.1.md`；
- 调用测试验收专家进行验收评审。

**不包含**：

- 新功能代码开发（T1-T2）；
- 测试夹具与用例开发（T3）；
- 用户文档编写（T4）。

---

## 3. 依赖

- T1、T2、T3、T4 已全部完成并通过各自验收标准；
- 所有任务 Spec 已评审通过；
- 已归档的 v1.0 及更早阶段 Spec 文档（`docs/specs/phases/phase-1-spec.md` 至 `docs/specs/phases/phase-5-spec.md`）未被修改。

---

## 4. 回归验证清单

### 4.1 类型与构建

| 命令 | 期望结果 |
|---|---|
| `pnpm typecheck` | 0 错误、0 警告（允许第三方依赖的类型声明警告） |
| `pnpm build` | 成功生成 `dist/` 目录，`dist/cli.js` 可执行 |

### 4.2 单元测试

| 测试文件 | 期望结果 |
|---|---|
| `tests/analyzer.test.ts` | 通过，新增 Vue 子类型断言生效 |
| `tests/logger.test.ts` | 通过，`vue-router-error` / `vue-warn` 级别与 `errorId` 断言生效 |
| `tests/utils.test.ts` | 通过，无回归 |
| `tests/api.test.ts` | 通过，`/errors/top` 与 `/suggest` 对新子类型兼容 |
| `tests/reporter.test.ts` | 通过，无回归 |
| `tests/quality.test.ts` | 通过 |
| `tests/custom-rules.test.ts` | 通过 |
| `tests/scanner.test.ts` | 通过 |

### 4.3 端到端测试

| 测试文件 | 期望结果 |
|---|---|
| `tests/e2e/shield.e2e.test.ts` | 通过，v1.0 基础 shield 链路无回归 |
| `tests/e2e/boundary.test.ts` | 通过，边界场景无回归 |
| `tests/e2e/performance.test.ts` | 通过，性能指标在可接受范围 |
| `tests/vue3-monitor.test.ts` | 通过，7 个 Vue 3 监控用例全部通过 |

### 4.4 集成测试

| 测试文件 | 期望结果 |
|---|---|
| `tests/quality.integration.test.ts` | 通过 |

---

## 5. 验收报告

### 5.1 报告路径

`docs/specs/acceptance-report-v1.1.md`

### 5.2 报告内容

1. **版本信息**：v1.1、验收日期、验收人/代理角色；
2. **需求覆盖**：REQ-V1.1-001 至 REQ-V1.1-005 逐项勾选；
3. **测试结果汇总**：
   - `pnpm typecheck` 结果；
   - `pnpm build` 结果；
   - 测试总数、通过数、失败数；
4. **变更文件列表**：T1-T4 修改/新增的文件清单；
5. **已知问题**：P2 优化项、未阻塞验收的说明；
6. **结论**：验收通过 / 不通过。

### 5.3 报告模板

```markdown
# legacy-shield v1.1 验收报告

> 验收日期：2026-06-XX
> 对应阶段 Spec：[phase-v1.1-spec.md](phases/phase-v1.1-spec.md)
> 结论：通过 / 不通过

## 1. 需求覆盖

- [ ] REQ-V1.1-001：运行时错误完整采集
- [ ] REQ-V1.1-002：运行时警告采集
- [ ] REQ-V1.1-003：Vue Router 4 错误采集
- [ ] REQ-V1.1-004：日志分析与报告兼容
- [ ] REQ-V1.1-005：文档更新

## 2. 测试结果

| 检查项 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `pnpm typecheck` | 通过 |
| 构建 | `pnpm build` | 通过 |
| 单元测试 | `pnpm test tests/analyzer.test.ts tests/logger.test.ts tests/api.test.ts ...` | X/Y 通过 |
| 端到端测试 | `pnpm test tests/e2e tests/vue3-monitor.test.ts` | X/Y 通过 |
| 集成测试 | `pnpm test tests/quality.integration.test.ts` | X/Y 通过 |

## 3. 变更文件

- `lib/inject.iife.ts`
- `lib/types.ts`
- `lib/logger.ts`
- `lib/analyzer.ts`
- `lib/api.ts`
- `tests/analyzer.test.ts`
- `tests/logger.test.ts`
- `tests/api.test.ts`
- `tests/vue3-monitor.test.ts`
- `tests/fixtures/vue3/...`
- `README.md`
- `docs/usage.md`
- `docs/api.md`

## 4. 已知问题

- P2 优化项：...（不影响验收）

## 5. 结论

验收通过 / 不通过。
```

---

## 6. 实现步骤

1. 确认 T1-T4 已全部合并到当前工作分支；
2. 校验 Phase 1-5 已归档 Spec 未被修改（如通过 `git diff -- docs/specs/phases/phase-*-spec.md` 确认无变更）；
3. 执行 `pnpm typecheck`，记录结果；
4. 执行 `pnpm build`，记录结果；
5. 执行 `pnpm test`，记录测试总数与通过数；
6. 若任一步骤失败，回退到对应任务修复，修复后重新执行 T5；
7. 生成 `docs/specs/acceptance-report-v1.1.md`；
8. 调用测试验收专家进行验收评审；
9. 验收通过后，将 `phase-v1.1-spec.md` 状态改为「已完成，已归档（冻结，不再修改）」。

---

## 7. 验收标准

- [ ] `pnpm typecheck` 通过；
- [ ] `pnpm build` 通过；
- [ ] `pnpm test` 全量通过；
- [ ] `docs/specs/acceptance-report-v1.1.md` 已生成；
- [ ] 测试验收专家评审结论为「通过」；
- [ ] `phase-v1.1-spec.md` 状态已归档；
- [ ] Phase 1-5 已归档 Spec 未被修改。

---

## 8. 风险与应对

| 风险 | 影响 | 应对措施 |
|---|---|---|
| T5 发现回归 | 需回退修复 | 定位到具体任务 Spec，修复后重新执行该任务及 T5 |
| 验收专家提出阻塞性问题 | 无法归档 | 修复后重新评审 |
| 测试环境偶发失败 | 误报 | 对失败用例单独重试 3 次，确认稳定性 |

---

## 9. 评审记录

| 轮次 | 时间 | 结论 | 主要问题 | 修订内容 |
|---|---|---|---|---|
| 1 | - | 待评审 | - | - |
| 最终 | 2026-06-18 | 通过 | 无 P0；P1 报告模板链接与变更清单遗漏 | 1. 状态改为「已通过，可进入代码开发」；<br>2. 验收报告模板中阶段 Spec 链接修正为 `phases/phase-v1.1-spec.md`；<br>3. 变更文件清单补充 `lib/api.ts`；<br>4. 实现步骤与验收标准增加已归档 Spec 防篡改校验 |
