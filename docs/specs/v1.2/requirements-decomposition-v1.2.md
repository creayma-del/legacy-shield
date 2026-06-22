# legacy-shield v1.2 需求分解文档

> 版本：v1.2
> 对应需求文档：requirements-v1.2.md
> 对应会议纪要：meetings/requirements-alignment-v1.2-20260620.md
> 状态：已批准
> 编制日期：2026-06-20
> 批准日期：2026-06-20

---

## 1. 功能分解

| 功能点编号 | 名称 | 描述 | 对应需求 | 验收标准 | 优先级 |
|---|---|---|---|---|---|
| F-1 | code-quality 源码迁移 | 将 `/Users/creayma/personal/code-quality` 的源码按 legacy-shield 规范迁移到当前项目内部目录 | REQ-1.2-1 | 源码全部迁移并按项目规范组织；不依赖外部路径 | P0 |
| F-2 | 依赖整合 | 将 code-quality 的 `dependencies` / `devDependencies` 整合到 legacy-shield 的 `package.json`，处理版本冲突 | REQ-1.2-1 | `pnpm install` 成功；无未解析的依赖冲突 | P0 |
| F-3 | 内部调用重构 | 重构 `lib/quality.ts`，将外部进程调用改为内部模块调用；`lib/cli/quality.ts` 保持接口不变 | REQ-1.2-1、REQ-1.2-3 | `quality` 子命令参数、输出、退出码与 v1.1 一致 | P0 |
| F-4 | 配置加载兼容 | 保留 `.local-llm-config.js` 加载逻辑；`CODE_QUALITY_ROOT` 环境变量保留静默兼容 | REQ-1.2-3 | 未配置 `CODE_QUALITY_ROOT` 时正常运行；配置了则忽略或给出废弃提示 | P1 |
| F-5 | 单测生成能力保留 | 保留 `module` / `diff` / `watch` 自动单测生成与执行能力 | REQ-1.2-2 | 原有单测生成逻辑可正常执行 | P0 |
| F-6 | 静态检查能力保留 | 保留 `all` 模式下的 vue-tsc、ESLint、Vitest 串联校验 | REQ-1.2-2 | `quality --skip` 行为与 v1.1 一致；检查报告正确产出 | P0 |
| F-7 | 测试适配 | 更新 `tests/quality.test.ts` 与 `tests/quality.integration.test.ts`，验证内部集成后的行为 | REQ-1.2-3 | 测试全部通过，无需破坏既有断言 | P0 |
| F-8 | 文档更新 | 更新 `README.md` 与 `docs/usage.md`，移除 `CODE_QUALITY_ROOT` 环境变量说明 | REQ-1.2-4 | 文档描述与实现一致，无失效链接 | P1 |

---

## 2. 任务依赖关系

| 任务 | 依赖 | 可并行任务 |
|---|---|---|
| T1：code-quality 源码迁移与目录结构设计 | 无 | — |
| T2：依赖整合与 package.json 更新 | T1 | — |
| T3：内部调用重构（lib/quality.ts） | T1、T2 | — |
| T4：配置加载与兼容性处理 | T3 | — |
| T5：测试适配与新增 | T3 | T4 |
| T6：文档更新 | T3 | T4、T5 |
| T7：全量回归验证与验收报告 | T4、T5、T6 | — |

---

## 3. 资源分配估算

| 任务 | 工作量 | 角色 | 外部资源 |
|---|---|---|---|
| T1 源码迁移与目录结构设计 | 中 | 开发专家 / SOLO Coder | 需访问 code-quality 仓库源码 |
| T2 依赖整合 | 低 | 开发专家 | 无 |
| T3 内部调用重构 | 高 | 开发专家 | 无 |
| T4 配置加载与兼容性 | 低 | 开发专家 | 无 |
| T5 测试适配 | 中 | 测试验收专家 / 开发专家 | 无 |
| T6 文档更新 | 低 | SOLO Coder / 开发专家 | 无 |
| T7 回归验证与验收 | 中 | 测试验收专家 | 无 |

> 注：具体工时按实际排期确定，本分解文档仅做任务量级估算。

---

## 4. 时间线里程碑

| 里程碑 | 预计日期 | 说明 |
|---|---|---|
| 需求对齐完成 | 2026-06-20 | 会议纪要已双方确认 |
| 需求分解文档批准 | 待定 | 需项目负责人批准 |
| 设计文档评审通过 | 待定 | 完成 design-v1.2.md 并评审通过 |
| 执行计划与阶段 Spec 评审通过 | 待定 | 完成 execution-plan-v1.2.md 与 phase-v1.2-spec.md |
| 代码开发完成 | 待定 | T1-T6 完成 |
| 测试验收通过 | 待定 | T7 完成，验收报告生成 |
| 归档关闭 | 待定 | phase-v1.2-spec.md 状态改为「已完成，已归档」 |

---

## 5. 风险与假设

| 风险 / 假设 | 说明 | 应对措施 |
|---|---|---|
| 依赖版本冲突 | code-quality 与 legacy-shield 均依赖 `@babel/traverse`、`commander`、`typescript`、`vitest` 等，版本可能不一致 | 迁移前做依赖清单 diff，统一使用 legacy-shield 现有版本或升级至兼容版本 |
| code-quality 单测生成依赖 LLM | `module` / `diff` / `watch` 依赖 OpenAI 兼容 API，集成后需保持配置加载与调用链不变 | 保留 `load-local-config.js` 逻辑，确保 `.local-llm-config.js` 加载路径正确 |
| 路径硬编码 | code-quality 内部多处使用 `SKILL_ROOT = __dirname`，迁移后需改为相对于 legacy-shield 的路径 | 迁移时统一改造为基于 `legacy-shield` 根目录的路径解析 |
| 测试环境差异 | 集成后 `vitest` 运行可能受 legacy-shield 自身 vitest 配置影响 | 为 code-quality 内部测试保留独立 vitest 配置或在集成测试中显式指定配置路径 |
| 构建产物体积 | 新增大量依赖可能导致 `node_modules` 与构建产物增大 | 评估是否使用 `optionalDependencies` 或子包方式；在文档中说明 |

---

## 6. 待决策事项

| 事项 | 建议方案 | 决策人 |
|---|---|---|
| code-quality 源码迁入目录 | `lib/code-quality/` 作为独立子模块，内部保持原有文件结构 | 项目负责人 |
| 是否继续暴露 `watch` 子命令 | 保持暴露，通过 `node ./dist/cli.js quality watch --project <path>` 调用 | 项目负责人 |
| `CODE_QUALITY_ROOT` 废弃策略 | 若用户仍配置该变量，打印一次 deprecated 警告并忽略 | 项目负责人 |

---

## 7. 批准记录

- 项目负责人：creayma，2026-06-20，已批准
