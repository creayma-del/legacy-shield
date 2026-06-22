# code-quality 源码迁移任务 Spec

> 版本：v1.2
> 任务编号：T1
> 对应阶段 Spec：[phases/phase-v1.2-spec.md](phase-v1.2-spec.md)
> 对应设计文档：[design-v1.2.md](../design-v1.2.md)
> 对应执行计划：[execution-plan-v1.2.md](../execution-plan-v1.2.md)
> 依赖任务：无
> 状态：已完成，已归档
> 评审记录：见本文档末尾

## 1. 任务目标

将外部 `/Users/creayma/personal/code-quality` 项目的源码、配置文件迁移到 `legacy-shield/lib/code-quality/` 目录，完成 `.js` → `.ts` 改造与路径常量重命名，为 T3 适配层提供可直接调用的内部 API。

## 2. 对应需求与验收标准

| 需求编号 | 需求描述 | 本任务验收标准 |
|---|---|---|
| REQ-1.2-1 | code-quality 源码迁移到 legacy-shield 内部 | `lib/code-quality/` 目录完整包含迁移后的源码与配置 |
| REQ-1.2-2 | 保留全部现有能力 | `all` / `module` / `diff` / `watch` 内部 API 均可调用 |
| REQ-1.2-4 | 不修改老项目源码，不在老项目内安装依赖 | 迁移过程仅在 legacy-shield 项目内操作 |

## 3. 实现步骤

### 3.1 创建目录结构

- 创建 `lib/code-quality/` 目录结构：
  - `lib/code-quality/index.ts`
  - `lib/code-quality/cli.ts`
  - `lib/code-quality/lib/paths.ts`
  - `lib/code-quality/lib/orchestrator.ts`
  - `lib/code-quality/lib/runner.ts`
  - `lib/code-quality/lib/git-diff.ts`
  - `lib/code-quality/lib/ast-skeleton.ts`
  - `lib/code-quality/lib/llm-client.ts`
  - `lib/code-quality/lib/test-writer.ts`
  - `lib/code-quality/lib/load-local-config.ts`
  - `lib/code-quality/configs/tsconfig.base.json`
  - `lib/code-quality/configs/eslint.config.ts`
  - `lib/code-quality/configs/vitest.config.ts`

### 3.2 迁移 `lib/paths.js` → `lib/code-quality/lib/paths.ts`

- 改造路径常量：
  - `SKILL_ROOT` → `LEGACY_SHIELD_ROOT`（指向 `legacy-shield` 根目录）；
  - 新增 `CODE_QUALITY_DIR`（指向 `lib/code-quality/`）；
  - `SKILL_TESTS_DIR` → `CODE_QUALITY_TESTS_DIR`（指向 `tests/code-quality-generated/`）。
- 更新镜像规则：`legacy/src/**/*.js` → `tests/code-quality-generated/**/*.spec.js`。

### 3.3 迁移 `lib/runner.js` → `lib/code-quality/lib/runner.ts`

- 使用新的 `LEGACY_SHIELD_ROOT` / `CODE_QUALITY_DIR` 解析 `vitest` 二进制与配置文件路径；
- 调用时注入 `LEGACY_PROJECT_PATH` 环境变量；
- 子进程输出捕获改造：
  - `type-check` / `lint` / `vitest` 子进程使用 `stdio: 'pipe'`；
  - 通过 `data` 事件同时写入 `process.stdout`/`process.stderr`（保持终端可见性）并累积为字符串；
  - 返回完整 `CodeQualityResult`（字段与 `lib/types.ts` 保持一致，含 `command`、`code`、`stdout`、`stderr`、`legacyRoot`、`executedAt`、`summary`），不再调用 `process.exit()`。

### 3.4 迁移其他 `lib/*.js` → `lib/code-quality/lib/*.ts`

- 迁移并改造 `orchestrator.js`、`git-diff.js`、`ast-skeleton.js`、`llm-client.js`、`test-writer.js`、`load-local-config.js`；
- 保持函数逻辑不变；
- 对未标注类型处显式标注 `any`；
- 必要时使用 `// @ts-expect-error` 并附注释；
- 对未使用变量/参数使用下划线前缀 `_` 或行内禁用单条规则检查；
- 禁止直接关闭项目级 `strict` / `noUnusedLocals` 等开关。

### 3.5 迁移配置文件

- `tsconfig.json` → `lib/code-quality/configs/tsconfig.base.json`：
  - 该文件作为 code-quality 内部 type-check 派生配置的 `extends` 目标；
  - 路径基于 `CODE_QUALITY_DIR`，确保运行时可解析。
- `eslint.config.js` → `lib/code-quality/configs/eslint.config.ts`：
  - 保留顶层 await；
  - `__dirname` 基于 `lib/code-quality/configs/`；
  - `resolvePluginsRelativeTo` 指向 `lib/code-quality/configs/`。
- `vitest.config.js` → `lib/code-quality/configs/vitest.config.ts`：
  - 未设置 `LEGACY_PROJECT_PATH` 时不抛错、不设置 `@` alias；
  - 仅扫描 `tests/code-quality-generated/` 目录；
  - 设置 `LEGACY_PROJECT_PATH` 后添加 `@` → `<legacy>/src` alias。

### 3.6 迁移入口文件

- `cli.js` → `lib/code-quality/cli.ts`（内部调试入口，可选）；
- `index.js` → `lib/code-quality/index.ts`：导出 `runAll` / `runModule` / `runDiff` / `runWatch`。

### 3.7 更新 `.gitignore`

- 追加 `tests/code-quality-generated/`。

## 4. 测试计划

### 4.1 单元测试

- 验证 `paths.ts` 中 `LEGACY_SHIELD_ROOT`、`CODE_QUALITY_DIR`、`CODE_QUALITY_TESTS_DIR` 解析正确；
- 验证 `index.ts` 导出包含 `runAll`、`runModule`、`runDiff`、`runWatch`。

### 4.2 集成测试 / 端到端测试

- 运行 `pnpm typecheck`，确认迁移后的 `.ts` 文件无类型错误；
- 运行 `pnpm build`，确认构建产物包含 `dist/lib/code-quality/`。

### 4.3 回归测试

- 确认 legacy-shield 自身 `pnpm test` 仍可正常执行（vitest.config.ts 未破坏根测试）。

## 5. 风险与依赖

| 风险 / 依赖 | 影响 | 应对措施 |
|---|---|---|
| `.js` → `.ts` 类型错误 | 构建失败 | 显式 `any` + `// @ts-expect-error` 过渡 |
| 路径常量遗漏 | 运行时找不到文件 | 按验收标准逐项检查路径解析 |
| 依赖任务 | 无 | 本任务为首个任务，无前置依赖 |

## 6. 变更范围

- 本任务不修改 `lib/quality.ts`、`lib/cli/quality.ts`（由 T3 处理）；
- 本任务不安装/升级依赖（由 T2 处理）；
- 本任务不执行端到端 `quality` 子命令验证（由 T5 处理）。

## 7. 评审记录

| 轮次 | 时间 | 结论 | 主要问题 | 修订内容 |
|---|---|---|---|---|
| 第一轮 | 2026-06-21 | 不通过 | P1：未包含内部 API 输出捕获与返回码改造步骤；P2：未明确未使用变量处理约定、tsconfig.base.json 消费方式。 | 在 `runner.ts` 步骤中补充 `stdio: 'pipe'`、累积输出、返回 `CodeQualityResult`；在迁移步骤中补充未使用变量处理约定；在 `tsconfig.base.json` 步骤中说明其作为派生配置 `extends` 目标。 |
| 第二轮 | 2026-06-21 | 不通过 | P1：`CodeQualityResult` 字段名错误，应为 `code` 而非 `exitCode`。 | 将 `CodeQualityResult` 字段描述改为 `code`、`stdout`、`stderr`、`summary`。 |
| 第三轮 | 2026-06-21 | 通过 | P2：`runner.ts` 返回 `CodeQualityResult` 字段描述不完整。 | 补充说明返回完整 `CodeQualityResult`，字段与 `lib/types.ts` 保持一致。 |

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
