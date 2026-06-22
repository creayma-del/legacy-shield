# legacy-shield v1.2 Spec：code-quality 内部集成

> 版本：v1.2
> 对应需求文档：[requirements-v1.2.md](../requirements-v1.2.md)
> 对应设计文档：[design-v1.2.md](../design-v1.2.md)
> 对应执行计划：[execution-plan-v1.2.md](../execution-plan-v1.2.md)
> 状态：已完成，已归档
> 评审记录：见本文档末尾

---

## 1. 目标

将 legacy-shield 的 `quality` 子命令从依赖外部 `code-quality` 项目路径，改为直接集成 `code-quality` 源码到当前项目内部，实现：

- 消除 `CODE_QUALITY_ROOT` 环境变量依赖；
- 保持 `quality` 子命令 CLI 接口与输出完全兼容；
- 保留 code-quality 全部能力（`all` / `module` / `diff` / `watch`）。

**明确不在范围内**：新增质量检查规则、修改老项目 ESLint/TS/Vitest 配置、改变 `quality` 子命令的 CLI 参数。

---

## 2. 交付物清单

| 编号 | 交付物 | 路径 | 说明 |
|---|---|---|---|
| D1 | 迁移后的 code-quality 源码 | `lib/code-quality/` | 包含内部 API、工具函数、配置文件 |
| D2 | 适配层 | `lib/quality.ts` | 调用内部 API 替代外部进程 |
| D3 | 依赖更新 | `package.json`、`pnpm-lock.yaml` | 整合 code-quality 依赖 |
| D4 | 测试更新 | `tests/quality.test.ts`、`tests/quality.integration.test.ts` | 验证内部集成行为 |
| D5 | 用户文档更新 | `README.md`、`docs/usage.md` | 移除 `CODE_QUALITY_ROOT` 说明 |
| D6 | 验收报告 | `docs/specs/acceptance-report-v1.2.md` | v1.2 验收结论 |

---

## 3. 技术方案

### 3.1 总体策略

将 `/Users/creayma/personal/code-quality` 的源码迁移到 `legacy-shield/lib/code-quality/`，作为内部模块运行。`lib/cli/quality.ts` 保持接口不变；`lib/quality.ts` 改为调用 `lib/code-quality/index.ts` 暴露的内部 API。

### 3.2 目录结构

```
lib/code-quality/
├── index.ts                  # 导出 runAll / runModule / runDiff / runWatch
├── cli.ts                    # 内部调试入口（可选）
├── lib/
│   ├── paths.ts              # 路径计算
│   ├── orchestrator.ts       # 单测生成与执行编排
│   ├── runner.ts             # vitest 调用
│   ├── git-diff.ts           # git 变更收集
│   ├── ast-skeleton.ts       # AST 骨架提取
│   ├── llm-client.ts         # LLM 断言生成
│   ├── test-writer.ts        # spec 文件写入
│   └── load-local-config.ts  # 本地 LLM 配置加载
└── configs/
    ├── tsconfig.base.json    # 派生 tsconfig 基础配置
    ├── eslint.config.ts      # ESLint flat config
    └── vitest.config.ts      # Vitest 配置

tests/code-quality-generated/ # 自动生成的单测落在此稳定目录（纳入 .gitignore）
```

### 3.3 内部 API

`lib/code-quality/index.ts` 导出：

```ts
export async function runAll(options: { projectPath: string; skip?: string[] }): Promise<CodeQualityResult>;
export async function runModule(options: { projectPath: string; targets: string[]; model?: string }): Promise<CodeQualityResult>;
export async function runDiff(options: { projectPath: string; base?: string; model?: string }): Promise<CodeQualityResult>;
export async function runWatch(options: { projectPath: string; debounce?: number; model?: string }): Promise<CodeQualityResult>;
```

返回的 `CodeQualityResult` 与 v1.1 的 `CodeQualityResult` 结构一致。

### 3.4 `lib/quality.ts` 适配层

- 移除 `spawn` 外部 `cli.js` 的逻辑。
- 根据 `RunCodeQualityOptions` 调用 `runAll` / `runModule` / `runDiff`。
- `watch` 模式说明：
  - `lib/code-quality/index.ts` 导出 `runWatch` 以保留原 `watch` 子命令的内部能力。
  - v1.1 的 `lib/cli/quality.ts` 未暴露 `watch`，本次集成保持 CLI 参数不变，不新增 `watch` 子命令。
- 检测 `CODE_QUALITY_ROOT` 环境变量：若存在，打印一次 `deprecated` 提示，不影响运行。
- 保留 `parseSummary` 以兼容现有 `CodeQualitySummary` 解析。

### 3.5 依赖整合

- 将 code-quality 的 `dependencies` / `devDependencies` 合并到 legacy-shield `package.json` 的 `devDependencies`。
- 冲突时优先保留 legacy-shield 当前版本；若 code-quality 版本更高且为必要功能，统一升级。
- 详见 [design-v1.2.md 第 2.5 节](design-v1.2.md#25-依赖整合方案) 的依赖 diff 表。

### 3.6 配置兼容

- `.local-llm-config.js` 保留在 `legacy-shield` 根目录，加载逻辑不变。
- `eslint.config.ts` 中的 `resolvePluginsRelativeTo` 指向 `lib/code-quality/configs/`。
- `vitest.config.ts` 改造：未设置 `LEGACY_PROJECT_PATH` 时不抛错、不设置 `@` alias，仅扫描 `tests/code-quality-generated/`，避免破坏 legacy-shield 自身 `pnpm test`。
- TypeScript 严格模式适配：迁移文件通过显式 `any` 与 `// @ts-expect-error` 过渡，确保 `pnpm typecheck` 全量通过，不关闭项目级严格开关。

### 3.7 测试目录策略

- 自动生成单测统一落盘到 `tests/code-quality-generated/`。
- 该目录纳入 `.gitignore`，不参与版本控制。
- 路径常量 `CODE_QUALITY_TESTS_DIR` 指向该目录，确保构建/清理脚本不会误删。
- 历史用户如需查找旧 spec，参见更新后的用户文档。

---

## 4. 任务拆解与验收标准

### 任务 1：code-quality 源码迁移

**实现内容**：

- 创建 `lib/code-quality/` 目录结构；
- 迁移 code-quality `lib/*.js` → `lib/code-quality/lib/*.ts`；
- 迁移 `tsconfig.json`、`eslint.config.js`、`vitest.config.js` → `lib/code-quality/configs/`；
  - `vitest.config.ts` 需兼容无 `LEGACY_PROJECT_PATH` 场景；
  - 迁移文件需通过显式 `any` / `// @ts-expect-error` 适配 legacy-shield 严格模式。
- 改造路径常量：
  - `SKILL_ROOT` → `LEGACY_SHIELD_ROOT`（指向 `legacy-shield` 根目录）；
  - 新增 `CODE_QUALITY_DIR`（指向 `lib/code-quality/`）；
  - `SKILL_TESTS_DIR` → `CODE_QUALITY_TESTS_DIR`（指向 `tests/code-quality-generated/`）。
- 在 `.gitignore` 追加 `tests/code-quality-generated/`。

**验收标准**：

- [ ] `lib/code-quality/` 目录结构符合 3.2 节；
- [ ] `tests/code-quality-generated/` 已创建或已纳入 `.gitignore`；
- [ ] `pnpm typecheck` 通过。

### 任务 2：依赖整合

**实现内容**：

- 按 [design-v1.2.md 第 2.5 节](design-v1.2.md#25-依赖整合方案) 更新 `package.json`；
- 执行 `pnpm install`；
- 解决版本冲突并记录最终版本决策。

**验收标准**：

- [ ] `pnpm install` 成功；
- [ ] 无未解析依赖冲突；
- [ ] `pnpm typecheck` 与 `pnpm test` 通过。

### 任务 3：适配层重构

**实现内容**：

- 重构 `lib/quality.ts`，调用 `lib/code-quality/index.ts`；
- 处理 `CODE_QUALITY_ROOT` 废弃提示。

**验收标准**：

- [ ] `lib/quality.ts` 不再 `spawn` 外部进程；
- [ ] `node ./dist/cli.js quality --project <legacy>` 在未配置 `CODE_QUALITY_ROOT` 时正常工作；
- [ ] 配置 `CODE_QUALITY_ROOT` 时打印废弃提示且运行正常。

### 任务 4：测试适配

**实现内容**：

- 更新 `tests/quality.test.ts`；
- 更新 `tests/quality.integration.test.ts`。

**验收标准**：

- [ ] 全量 `pnpm test` 通过。

### 任务 5：文档更新

**实现内容**：

- 更新 `README.md`、`docs/usage.md`，移除 `CODE_QUALITY_ROOT` 说明。

**验收标准**：

- [ ] 文档与实现一致；
- [ ] 无错别字或失效链接。

### 任务 6：全量回归验证

**验收标准**：

- [ ] `pnpm typecheck` 通过；
- [ ] `pnpm build` 通过；
- [ ] `pnpm test` 全量通过；
- [ ] 无 v1.1 功能回归；
- [ ] `docs/specs/acceptance-report-v1.2.md` 已生成；
- [ ] 本阶段 Spec 状态已归档。

---

## 5. 验收标准

1. `lib/code-quality/` 完整包含迁移后的源码与配置。
2. `tests/code-quality-generated/` 作为自动生成 spec 的稳定目录，已纳入 `.gitignore`。
3. `quality` 子命令在未配置 `CODE_QUALITY_ROOT` 时可正常运行。
4. 配置 `CODE_QUALITY_ROOT` 时打印一次性废弃提示且运行正常。
5. `quality` 子命令参数、输出、退出码与 v1.1 一致；`watch` 不新增为 legacy-shield CLI 子命令。
6. `pnpm typecheck && pnpm build && pnpm test` 全量通过。
7. 用户文档已更新。
8. 验收报告 `docs/specs/acceptance-report-v1.2.md` 已生成。

---

## 6. 风险与应对

| 风险 | 影响 | 应对措施 |
|---|---|---|
| `.js` → `.ts` 迁移引入类型错误 | 构建失败 | 使用宽松类型或显式 `any` 过渡 |
| 依赖版本冲突 | 运行时异常 | 按 design-v1.2.md 第 2.5 节依赖整合方案统一版本 |
| ESLint 配置路径解析变化 | lint 失败 | 改造 `resolvePluginsRelativeTo` 指向 `lib/code-quality/configs/` |
| 历史生成的 spec 路径变化 | 用户找不到旧 spec | 文档说明新路径为 `tests/code-quality-generated/` |
| 子进程输出捕获变化 | QualityLog 信息缺失 | 内部 API 统一返回 stdout/stderr |
| 测试目录被误清理 | 自动生成 spec 丢失 | 使用 `tests/code-quality-generated/` 并纳入 `.gitignore` |

---

## 7. 评审记录

| 轮次 | 时间 | 结论 | 主要问题 | 修订内容 |
|---|---|---|---|---|
| 预审 | 2026-06-21 | 已按 P0 阻塞项修订，待正式评审 | 1. `watch` 子命令暴露范围与需求表述存在歧义；<br>2. 路径常量命名与指向不明确；<br>3. 自动生成单测目录不稳定；<br>4. 依赖整合方案过于简略。 | 1. 明确 `watch` 仅作为 `lib/code-quality/index.ts` 内部 API 保留，不新增 legacy-shield CLI 子命令；<br>2. 路径常量统一为 `LEGACY_SHIELD_ROOT` / `CODE_QUALITY_DIR` / `CODE_QUALITY_TESTS_DIR`；<br>3. 自动生成单测目录改为 `tests/code-quality-generated/` 并纳入 `.gitignore`；<br>4. 在设计文档新增 2.5 节依赖整合方案与依赖 diff 表。 |
| 正式评审 | 2026-06-21 | 不通过 | 1. `vitest.config.ts` 缺少 `LEGACY_PROJECT_PATH` 缺省处理方案；<br>2. TypeScript 严格模式差异处理方案不具体；<br>3. `requirements-v1.2.md` 中 `watch` 表述仍存在歧义；<br>4. vitest v3 → v4 升级缺少兼容性验证步骤。 | 1. 明确 `vitest.config.ts` 未设置 `LEGACY_PROJECT_PATH` 时不抛错、不设置 `@` alias，仅扫描 `tests/code-quality-generated/`；<br>2. 明确迁移文件通过显式 `any` 与 `// @ts-expect-error` 适配严格模式，禁止关闭项目级严格开关；<br>3. 更新 `requirements-v1.2.md` REQ-1.2-2 验收标准，说明 `watch` 通过内部 API 保留；<br>4. 在执行计划 T2 中增加 vitest v4 兼容性前置验证步骤。 |
| 第二轮正式评审 | 2026-06-21 | 通过 | 无 P0/P1 问题；遗留 4 项 P2 优化项（严格模式表述细化、Spec 任务编号与执行计划对齐、`parseSummary` 职责边界、文档搜索清单），可在开发阶段处理。 | 确认上一轮 P1 问题已闭环，文档一致性良好，批准进入开发阶段。 |
