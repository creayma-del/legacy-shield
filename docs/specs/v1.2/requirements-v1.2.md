# legacy-shield v1.2 需求文档

> 版本：v1.2
> 状态：已确认
> 编制日期：2026-06-20

---

## 1. 背景

当前 `legacy-shield` 的 `quality` 子命令通过 `CODE_QUALITY_ROOT` 环境变量或硬编码默认路径，启动外部 `code-quality` 项目的 `cli.js` 进程来完成 TypeScript 类型检查、ESLint 校验与 Vitest 单元测试。这种方式带来以下问题：

1. 用户需要额外 clone 并安装 `code-quality` 项目；
2. 路径配置容易出错，首次使用门槛高；
3. 两个项目版本独立管理，存在依赖冲突与维护成本。

## 2. 目标

将 `code-quality` 能力以源码迁移方式集成到 `legacy-shield` 当前项目内部，消除对外部路径的依赖，同时保持 `quality` 子命令的完全兼容。

## 3. 需求条目

| 编号 | 需求 | 优先级 | 验收标准 |
|---|---|---|---|
| REQ-1.2-1 | `code-quality` 源码迁移到 `legacy-shield` 内部 | P0 | 源码位于当前项目内，`quality` 子命令不再依赖 `CODE_QUALITY_ROOT` |
| REQ-1.2-2 | 保留全部现有能力 | P0 | `all` / `module` / `diff` / `watch` 能力均保留；其中 `watch` 通过内部 API 保留，本次不新增为 legacy-shield CLI 子命令 |
| REQ-1.2-3 | `quality` 子命令 CLI 完全兼容 | P0 | 参数、输出、退出码与 v1.1 一致 |
| REQ-1.2-4 | 不修改老项目源码，不在老项目内安装依赖 | P0 | 继承零侵入原则 |
| REQ-1.2-5 | 用户文档更新 | P1 | `README.md`、`docs/usage.md` 不再要求 `CODE_QUALITY_ROOT` |

## 4. 非目标

- 不重构 `quality` 子命令的 CLI 参数与输出格式。
- 不改写老项目 ESLint / TypeScript / Vitest 的校验规则。
- 不新增除源码迁移所必需的依赖之外的功能依赖。

## 5. 约束

- 源代码路径必须保持 `.ts` 后缀（legacy-shield 工程约定）。
- 必须处理 code-quality 源码中的 `.js` 文件向 `.ts` 的迁移或保持其作为内部 JS 模块的兼容性。
- 必须保证 `pnpm typecheck`、`pnpm build`、`pnpm test` 全量通过。

## 6. 验收标准

1. 未配置 `CODE_QUALITY_ROOT` 时，`node ./dist/cli.js quality --project <legacy>` 可正常执行。
2. 已配置的 `CODE_QUALITY_ROOT` 保留静默兼容或给出一次性废弃提示，不影响运行。
3. `quality` 子命令支持的全部参数（`--project`、`--target`、`--base`、`--skip`、`--disable-rule`、`--log-retention-days`）行为不变。
4. 全部测试通过，v1.0 / v1.1 功能无回归。
5. 文档准确反映新的使用方式。

---

## 7. 相关文档

- 会议纪要：[meetings/requirements-alignment-v1.2-20260620.md](meetings/requirements-alignment-v1.2-20260620.md)
- 需求分解文档：[requirements-decomposition-v1.2.md](requirements-decomposition-v1.2.md)
