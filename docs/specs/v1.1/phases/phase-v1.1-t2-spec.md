# legacy-shield v1.1 任务 Spec：T2 扩展类型定义与日志级别

> 版本：v1.1
> 对应阶段 Spec：[phase-v1.1-spec.md](./phase-v1.1-spec.md)
> 对应执行计划：[execution-plan-v1.1.md](../execution-plan-v1.1.md)
> 状态：已通过，可进入代码开发

---

## 1. 目标

让 `vue-warn` 和 `vue-router-error` 在类型系统与日志工具中被正确识别：

- `vue-warn` 被识别为 `warn` 级别；
- `vue-router-error` 被识别为 `error` 级别，并生成 `errorId`；
- 不影响现有子类型的日志级别判定。

---

## 2. 范围

**包含**：

- `lib/types.ts` 中 `RuntimeSubType` 扩展；
- `lib/logger.ts` 中 `isErrorSubType()` 与 `runtimeLevelFor()` 扩展；
- `tests/logger.test.ts` 新增单元测试（若不存在则创建）。

**不包含**：

- 注入脚本实现（T1）；
- 端到端测试（T3）。

---

## 3. 依赖

- 已批准的 [phase-v1.1-spec.md](../phase-v1.1-spec.md)
- 本任务应先于 T1 完成代码修改，或与 T1 并行但先于 T1 的最终 `pnpm typecheck`。

---

## 4. 实现步骤

### 步骤 1：扩展 `RuntimeSubType`

在 `lib/types.ts` 的 `RuntimeSubType` 联合类型中追加 `vue-warn` 与 `vue-router-error`：

```ts
export type RuntimeSubType =
  | 'js-error'
  | 'promise-rejection'
  | 'resource-error'
  | 'console-error'
  | 'console-warn'
  | 'console-info'
  | 'console-log'
  | 'vue-render-error'
  | 'vue-warn'
  | 'vue-router-error'
  | 'react-render-error';
```

### 步骤 2：扩展 `isErrorSubType()`

在 `lib/logger.ts` 中，将 `vue-router-error` 加入错误子类型判断（`vue-warn` 不应加入，它是 warn 级别）：

```ts
function isErrorSubType(subType: RuntimeSubType): boolean {
  return (
    subType === 'js-error' ||
    subType === 'promise-rejection' ||
    subType === 'vue-render-error' ||
    subType === 'vue-router-error' ||
    subType === 'react-render-error'
  );
}
```

### 步骤 3：扩展 `runtimeLevelFor()`

在 `lib/logger.ts` 中增加 `vue-warn` 的防御性映射，确保即使调用方未显式传 `level`，其默认级别也是 `warn`：

```ts
function runtimeLevelFor(subType: RuntimeSubType): RuntimeLog['level'] {
  if (subType === 'console-warn' || subType === 'vue-warn') return 'warn';
  if (subType === 'console-info' || subType === 'console-log') return 'info';
  return 'error';
}
```

> 注：`vue-warn` 在注入脚本中调用 `emitRuntime` 时已显式传入 `'warn'`，此映射为防御性兜底。

### 步骤 4：创建 `tests/logger.test.ts`

若文件不存在则新建。测试内容覆盖：

1. `logRuntime('vue-router-error', { message: 'x' })` 生成的日志 `level === 'error'` 且 `errorId` 非空；
2. `logRuntime('vue-warn', { message: 'x' })` 生成的日志 `level === 'warn'` 且 `errorId` 未定义；
3. `logRuntime('vue-render-error', { message: 'x' })` 生成的日志 `level === 'error'` 且 `errorId` 非空；
4. `logRuntime('console-error', { message: 'x' })` 生成的日志 `level === 'error'` 且 `errorId` 未定义；
5. `logRuntime('resource-error', { message: 'x' })` 生成的日志 `level === 'error'` 且 `errorId` 未定义；
6. `logRuntime('console-info', { message: 'x' })` / `logRuntime('console-log', { message: 'x' })` 生成的日志 `level === 'info'` 且 `errorId` 未定义；
7. 现有子类型（`js-error`、`console-warn` 等）行为不变。

示例测试骨架：

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createLogger } from '../lib/logger.js';
import { today } from '../lib/utils.js';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('logger runtime sub types', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'shield-logger-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function readRuntimeLogs(projectPath: string, date = today()) {
    const file = join(projectPath, '.runtime-log-ignore', 'runtime', `${date}.jsonl`);
    return readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter((log): log is Record<string, unknown> => log !== null);
  }

  it('assigns error level and errorId to vue-router-error', async () => {
    const logger = createLogger(dir, 's1');
    logger.logRuntime('vue-router-error', { message: 'router error', url: '/', userAgent: 'test' });
    await logger.close();

    const [log] = readRuntimeLogs(dir);
    expect(log.level).toBe('error');
    expect(log.errorId).toBeTruthy();
    expect(log.subType).toBe('vue-router-error');
  });

  it('assigns warn level and no errorId to vue-warn', async () => {
    const logger = createLogger(dir, 's1');
    logger.logRuntime('vue-warn', { message: 'prop type mismatch', url: '/', userAgent: 'test' });
    await logger.close();

    const [log] = readRuntimeLogs(dir);
    expect(log.level).toBe('warn');
    expect(log.errorId).toBeUndefined();
    expect(log.subType).toBe('vue-warn');
  });

  it('keeps vue-render-error behavior unchanged', async () => {
    const logger = createLogger(dir, 's1');
    logger.logRuntime('vue-render-error', { message: 'render error', url: '/', userAgent: 'test' });
    await logger.close();

    const [log] = readRuntimeLogs(dir);
    expect(log.level).toBe('error');
    expect(log.errorId).toBeTruthy();
    expect(log.subType).toBe('vue-render-error');
  });

  it('keeps js-error behavior unchanged', async () => {
    const logger = createLogger(dir, 's1');
    logger.logRuntime('js-error', { message: 'js error', url: '/', userAgent: 'test', stack: 'at foo' });
    await logger.close();

    const [log] = readRuntimeLogs(dir);
    expect(log.level).toBe('error');
    expect(log.errorId).toBeTruthy();
  });

  it('keeps console-warn behavior unchanged', async () => {
    const logger = createLogger(dir, 's1');
    logger.logRuntime('console-warn', { message: 'console warn', url: '/', userAgent: 'test' });
    await logger.close();

    const [log] = readRuntimeLogs(dir);
    expect(log.level).toBe('warn');
    expect(log.errorId).toBeUndefined();
  });
});
```

---

## 5. 测试计划

| 用例 | 位置 | 断言 |
|---|---|---|
| vue-router-error 生成 errorId | `tests/logger.test.ts` | `log.errorId` 非空，且 `log.level === 'error'` |
| vue-warn 为 warn 级别且无 errorId | `tests/logger.test.ts` | `log.level === 'warn'`，`log.errorId` 未定义 |
| vue-render-error 行为不变 | `tests/logger.test.ts` | `log.level === 'error'`，`log.errorId` 非空 |
| js-error 行为不变 | `tests/logger.test.ts` | 与现有行为一致 |
| console-warn 行为不变 | `tests/logger.test.ts` | `log.level === 'warn'`，`log.errorId` 未定义 |
| 类型检查 | `pnpm typecheck` | 无类型错误 |

---

## 6. 验收标准

- [ ] `lib/types.ts` 的 `RuntimeSubType` 包含 `vue-warn` 与 `vue-router-error`；
- [ ] `lib/logger.ts` 的 `isErrorSubType` 包含 `vue-router-error`；
- [ ] `lib/logger.ts` 的 `runtimeLevelFor` 对 `vue-warn` 返回 `'warn'`；
- [ ] `tests/logger.test.ts` 新增测试全部通过；
- [ ] `pnpm typecheck` 通过；
- [ ] `pnpm test` 全量通过。

---

## 7. 风险与应对

| 风险 | 影响 | 应对措施 |
|---|---|---|
| `vue-warn` 被误判为 error | 报告警告数异常 | `runtimeLevelFor` 与 `isErrorSubType` 分别控制，不将 `vue-warn` 加入错误子类型 |
| `vue-router-error` 未生成 errorId | 无法进入 TOP 聚合 | `isErrorSubType` 加入该子类型，确保 `generateErrorId` 被调用 |
| 现有子类型日志级别回归 | 报告数据失真 | 单元测试覆盖所有现有子类型 |

---

## 8. 评审记录

| 轮次 | 时间 | 结论 | 主要问题 | 修订内容 |
|---|---|---|---|---|
| 1 | - | 待评审 | - | - |
| 最终 | 2026-06-18 | 通过 | 无 P0/P1；P2 测试覆盖可扩展 | 1. 状态改为「已通过，可进入代码开发」；<br>2. `tests/logger.test.ts` 补充 `console-error`、`resource-error`、`console-info`/`console-log` 回归断言 |
