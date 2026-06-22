# legacy-shield v1.2 详细执行计划

> 文档版本：v1.2
> 对应需求文档：[requirements-v1.2.md](requirements-v1.2.md)
> 对应设计文档：[design-v1.2.md](design-v1.2.md)
> 对应阶段 Spec：[phases/phase-v1.2-spec.md](phases/phase-v1.2-spec.md)
> 状态：已完成，已归档

---

## 1. 版本总体进度

| 任务 | 名称 | 优先级 | 依赖 | 预计工作量 |
|---|---|---|---|---|
| T1 | code-quality 源码迁移与目录结构设计 | P0 | 无 | 中 |
| T2 | 依赖整合与 package.json 更新 | P0 | T1 | 低 |
| T3 | `lib/quality.ts` 适配层重构 | P0 | T1、T2 | 高 |
| T4 | 配置加载与 `CODE_QUALITY_ROOT` 兼容处理 | P1 | T3 | 低 |
| T5 | 测试适配与新增 | P0 | T3 | 中 |
| T6 | 用户文档更新 | P1 | T3 | 低 |
| T7 | 全量回归验证与验收 | P0 | T4、T5、T6 | 中 |

---

## 2. 任务详细说明

### 任务 T1：code-quality 源码迁移与目录结构设计

**目标**：

将 `/Users/creayma/personal/code-quality` 源码迁移到 `legacy-shield/lib/code-quality/`，并保持原有能力。

**实现步骤**：

1. 创建 `lib/code-quality/` 目录结构：
   - `lib/code-quality/index.ts`
   - `lib/code-quality/lib/*.ts`（由 code-quality `lib/*.js` 迁移）
   - `lib/code-quality/configs/tsconfig.base.json`
   - `lib/code-quality/configs/eslint.config.ts`
   - `lib/code-quality/configs/vitest.config.ts`
2. 迁移并改造 `lib/paths.js` → `lib/code-quality/lib/paths.ts`：
   - `SKILL_ROOT` 改为 `LEGACY_SHIELD_ROOT`，指向 `legacy-shield` 根目录；
   - 新增 `CODE_QUALITY_DIR`，指向 `lib/code-quality/`；
   - `SKILL_TESTS_DIR` 改为 `CODE_QUALITY_TESTS_DIR`，指向 `tests/code-quality-generated/`。
3. 迁移并改造 `lib/runner.js` → `lib/code-quality/lib/runner.ts`：
   - 使用新的 `LEGACY_SHIELD_ROOT` / `CODE_QUALITY_DIR` 解析 `vitest` 二进制与配置文件路径。
4. 迁移 `lib/orchestrator.js`、`lib/git-diff.js`、`lib/ast-skeleton.js`、`lib/llm-client.js`、`lib/test-writer.js`、`lib/load-local-config.js` 为 `.ts` 文件，保持逻辑不变。
5. 迁移 `tsconfig.json` → `lib/code-quality/configs/tsconfig.base.json`。
6. 迁移 `eslint.config.js` → `lib/code-quality/configs/eslint.config.ts`，调整 `__dirname` 与 `resolvePluginsRelativeTo` 指向 `lib/code-quality/configs/`。
7. 迁移 `vitest.config.js` → `lib/code-quality/configs/vitest.config.ts`：
   - 未设置 `LEGACY_PROJECT_PATH` 时不抛错、不设置 `@` alias；
   - 仅扫描 `tests/code-quality-generated/` 目录；
   - 由 `runner.ts` 在调用时注入 `LEGACY_PROJECT_PATH`。
8. 对迁移后的 `.ts` 文件适配 legacy-shield 严格模式：
   - 未标注类型处显式标注 `any`；
   - 必要时使用 `// @ts-expect-error` 并附注释；
   - 禁止直接关闭项目级 `strict` / `noUnusedLocals` 等开关。
9. 更新 `.gitignore`：追加 `tests/code-quality-generated/`。

**验收标准**：

- [ ] `lib/code-quality/` 目录结构符合设计文档。
- [ ] 路径常量已按 `LEGACY_SHIELD_ROOT` / `CODE_QUALITY_DIR` / `CODE_QUALITY_TESTS_DIR` 改造。
- [ ] `tests/code-quality-generated/` 已创建或已纳入 `.gitignore`。
- [ ] 所有 `.js` 文件已完成 `.ts` 迁移或标记为内部 JS 模块（若保持 JS，需在 `tsconfig.test.json` 中允许）。
- [ ] `pnpm typecheck` 通过。

**风险与应对**：

| 风险 | 应对措施 |
|---|---|
| `.js` → `.ts` 引入类型错误 | 使用宽松类型或显式 `any` 过渡 |
| 路径硬编码导致运行失败 | 统一改为基于 `legacy-shield` 根目录的相对路径 |

---

### 任务 T2：依赖整合与 package.json 更新

**目标**：

将 code-quality 依赖合并到 legacy-shield 的 `package.json`。

**实现步骤**：

1. 列出 code-quality 的 `dependencies` 与 `devDependencies`。
2. 与 legacy-shield 现有依赖做 diff（详见 [design-v1.2.md 第 2.5 节](design-v1.2.md#25-依赖整合方案)）。
3. 对冲突依赖选择兼容版本（优先 legacy-shield 当前版本，必要时升级）。
4. 执行 `pnpm install` 验证依赖可解析。
5. 优先验证 vitest v3 → v4 兼容性：
   - 在仅升级 vitest 的情况下先运行 `pnpm test`；
   - 若现有测试断言或 API 不兼容，记录并修复后再继续。
6. 运行 `pnpm typecheck` 与 `pnpm test` 验证无依赖冲突。

**验收标准**：

- [ ] `pnpm install` 成功。
- [ ] `pnpm typecheck` 通过。
- [ ] 无未解析的依赖冲突。

---

### 任务 T3：`lib/quality.ts` 适配层重构

**目标**：

将外部进程调用改为内部 API 调用。

**实现步骤**：

1. 删除 `DEFAULT_CODE_QUALITY_ROOT`、`runCodeQuality` 中的 `spawn` 逻辑。
2. 引入 `lib/code-quality/index.ts` 的 `runAll`、`runModule`、`runDiff`。
3. 根据 `RunCodeQualityOptions` 判断调用哪个内部 API。
4. 内部 API 返回 `CodeQualityResult`，适配层原样返回。
5. 保留 `parseSummary` 逻辑，用于从 stdout/stderr 中解析 `CodeQualitySummary`（内部 API 也可直接返回结构化 summary，减少解析）。

**验收标准**：

- [ ] `lib/quality.ts` 不再出现 `spawn` 调用外部 `cli.js`。
- [ ] `node ./dist/cli.js quality --project <legacy>` 在未配置 `CODE_QUALITY_ROOT` 时正常工作。
- [ ] `--skip`、`--target`、`--base` 行为与 v1.1 一致。

---

### 任务 T4：配置加载与 `CODE_QUALITY_ROOT` 兼容处理

**目标**：

保留 `.local-llm-config.js` 加载，废弃 `CODE_QUALITY_ROOT`。

**实现步骤**：

1. 确保 `load-local-config.ts` 从 `legacy-shield` 根目录加载 `.local-llm-config.js`。
2. 在 `lib/quality.ts` 中检测 `CODE_QUALITY_ROOT` 环境变量：
   - 若存在，打印一次 `deprecated` 提示；
   - 不影响正常运行。

**验收标准**：

- [ ] 配置 `.local-llm-config.js` 后，`module` / `diff` 模式可正常调用 LLM。
- [ ] 配置 `CODE_QUALITY_ROOT` 后，命令仍可运行，并打印废弃提示。

---

### 任务 T5：测试适配与新增

**目标**：

更新测试，验证内部集成后的行为。

**实现步骤**：

1. 检查 `tests/quality.test.ts`：
   - 将 mock 对象从外部 `spawn` 进程改为 mock `lib/code-quality/index.ts` 的 `runAll` / `runModule` / `runDiff`；
   - 验证 `CODE_QUALITY_ROOT` 环境变量存在时打印废弃提示。
2. 检查 `tests/quality.integration.test.ts`：
   - 移除对外部 `code-quality` 进程路径的依赖；
   - 改为端到端验证 `node ./dist/cli.js quality --project <legacy>` 的实际执行链路。
3. 新增或更新断言，确保 `CODE_QUALITY_ROOT` 废弃提示被正确打印。

**验收标准**：

- [ ] `tests/quality.test.ts` 通过。
- [ ] `tests/quality.integration.test.ts` 通过。
- [ ] 全量 `pnpm test` 通过。

---

### 任务 T6：用户文档更新

**目标**：

移除 `CODE_QUALITY_ROOT` 环境变量说明。

**实现步骤**：

1. 修改 `README.md`：
   - 移除「可选）`quality` 子命令依赖 `code-quality` 项目……」段落；
   - 更新 `quality` 命令示例，删除 `export CODE_QUALITY_ROOT`。
2. 修改 `docs/usage.md`：
   - 移除 `code-quality 路径` 环境准备步骤；
   - 更新 `quality` 命令详解中的环境说明。

**验收标准**：

- [ ] 文档中不再要求配置 `CODE_QUALITY_ROOT`。
- [ ] 文档描述与实现一致，无错别字。

---

### 任务 T7：全量回归验证与验收

**目标**：

确保 v1.2 不引入回归，并完成验收。

**实现步骤**：

1. 运行 `pnpm typecheck`。
2. 运行 `pnpm build`。
3. 运行 `pnpm test`。
4. 手动验证 `quality` 子命令在无 `CODE_QUALITY_ROOT` 环境下的运行。
5. 生成 `docs/specs/acceptance-report-v1.2.md`。
6. 调用测试验收专家评审。

**验收标准**：

- [ ] `pnpm typecheck` 通过。
- [ ] `pnpm build` 通过。
- [ ] `pnpm test` 全量通过。
- [ ] 验收报告通过专家评审。

---

## 3. 依赖与资源

### 3.1 外部依赖

- 新增依赖来自 code-quality 迁移（详见设计文档）。
- 无新的外部运行时依赖。

### 3.2 关键角色

| 角色 | 任务 |
|---|---|
| SOLO Coder | 协调文档、调度专家、最终交付 |
| 开发专家 | 完成 T1-T6 代码实现 |
| 测试验收专家 | 验收 T7 |

---

## 4. 里程碑

| 里程碑 | 时间 | 交付物 |
|---|---|---|
| M1 需求对齐完成 | 2026-06-20 | 会议纪要 |
| M2 需求分解批准 | 2026-06-20 | requirements-decomposition-v1.2.md |
| M3 设计 / 执行计划 / Spec 评审通过 | 待定 | design-v1.2.md、execution-plan-v1.2.md、phase-v1.2-spec.md |
| M4 开发完成 | 待定 | T1-T6 代码与文档 |
| M5 测试验收通过 | 待定 | acceptance-report-v1.2.md |
| M6 归档 | 待定 | phase-v1.2-spec.md 状态改为「已完成，已归档」 |

---

## 5. 变更控制

- 任何对 v1.2 范围的变更必须走新版本流程（v1.3 或补丁流程）。
- 已归档的 Phase 1-5 及 v1.1 文档禁止修改。
- 开发过程中如发现 Spec 缺陷，需暂停开发，升级 Spec 并重新评审。
