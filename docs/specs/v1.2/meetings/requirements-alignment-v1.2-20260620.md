# 需求对齐会议纪要

> 版本：v1.2
> 会议时间：2026-06-20
> 会议地点：线上（Trae IDE 对话）
> 记录人：SOLO Coder

## 参与人员

- 用户 / 产品负责人：creayma
- SOLO Coder：AI Assistant

## 需求条目确认

| 需求编号 | 需求描述 | 确认结论 | 备注 |
|---|---|---|---|
| REQ-1.2-1 | 将 code-quality 能力从外部路径引用改为源码迁移集成到 legacy-shield 当前项目 | 确认 | 通过源码迁移方式集成，不再依赖 `CODE_QUALITY_ROOT` 环境变量 |
| REQ-1.2-2 | 保留 code-quality 现有全部能力：TypeScript 类型检查、ESLint 代码规范、Vitest 单元测试 | 确认 | 包含 `all` / `module` / `diff` / `watch` 子命令能力 |
| REQ-1.2-3 | `quality` 子命令 CLI 接口保持完全兼容 | 确认 | 现有参数、输出格式、行为不变；`CODE_QUALITY_ROOT` 可废弃但保留静默兼容 |
| REQ-1.2-4 | 不修改老项目源码，不在老项目内安装依赖 | 确认 | 继承 code-quality 的零侵入原则 |

## 验收标准确认

1. `CODE_QUALITY_ROOT` 环境变量不再为必需项；未配置时 `quality` 子命令仍能正常工作。
2. `legacy-shield` 的 `quality` 子命令参数与行为与 v1.1 完全一致（`--project`、`--target`、`--base`、`--skip`、`--disable-rule`、`--log-retention-days`）。
3. 集成后 `pnpm typecheck`、`pnpm build`、`pnpm test` 全量通过。
4. 原有 `quality.integration.test.ts` 与 `quality.test.ts` 用例无需修改即可通过，或仅因路径/内部调用方式变化做最小适配。
5. 用户文档（`README.md`、`docs/usage.md`）更新为不再说明 `CODE_QUALITY_ROOT` 环境变量。

## 成功指标确认

- 老项目无需配置 `CODE_QUALITY_ROOT` 即可执行 `node ./dist/cli.js quality --project /path/to/legacy`。
- 首次安装 `legacy-shield` 依赖后，`quality` 子命令可直接使用，无需额外 clone 或路径配置。
- v1.0 / v1.1 的 `quality` 使用方式无回归。

## 风险与约束

| 风险 | 影响 | 应对措施 |
|---|---|---|
| code-quality 依赖版本与 legacy-shield 现有依赖冲突 | 构建或运行时异常 | 集成前梳理依赖清单，对冲突依赖统一版本或做隔离处理 |
| 自动单测生成的 LLM 配置（`.local-llm-config.js`）路径变化影响用户习惯 | 用户需要重新配置 | 保持配置加载逻辑不变，文档说明新位置 |
| 源码迁移后代码风格/目录结构不一致 | 维护成本增加 | 迁移时按 legacy-shield 的目录规范与代码风格做必要重构 |
| 集成导致 legacy-shield 安装体积显著增加 | 首次 install 时间变长 | 评估是否将 code-quality 相关依赖作为可选依赖；如必须则文档说明 |

## 遗留问题

| 问题 | 责任人 | 解决时限 |
|---|---|---|
| 确定 code-quality 源码迁移后的具体目录结构（如 `lib/code-quality/` 或分散到 `lib/quality/` 等） | SOLO Coder / 设计文档 | 设计文档评审前 |
| 是否保留 `watch` 子命令在 legacy-shield 的暴露方式 | SOLO Coder / 设计文档 | 设计文档评审前 |

## 版本与流程确认

- 版本级别：MINOR（v1.2）
- 集成方式：源码迁移
- 兼容性要求：`quality` 子命令完全兼容，`CODE_QUALITY_ROOT` 废弃但保留静默兼容
- 后续流程：需求分解文档 → 设计文档 → 执行计划 → 阶段 Spec → 评审 → 开发 → 验收 → 归档

## 签字确认

- 用户 / 产品负责人：creayma，2026-06-20，已确认
- SOLO Coder：AI Assistant，2026-06-20，已确认
