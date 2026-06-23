# 需求对齐会议纪要

> 版本：v1.5
> 会议时间：2026-06-22
> 会议地点：线上（Trae IDE 对话）
> 记录人：SOLO Coder
> 状态：已完成，已归档（冻结，不再修改）

## 背景

v1.4 已归档冻结，完成了 Pinia 2.x / Vuex 4 状态管理库错误链路的零侵入采集。本次 v1.5 在不破坏既有能力的前提下，新增"项目知识图谱生成"能力——分析目标项目的目录结构与文件引用关系，生成 AI 可读的知识图谱，增强 AI 对护航项目的理解能力。

该能力的战略价值已通过深度可行性调研确认：
- 学术界验证 AST 派生知识图谱对 LLM 的价值：token 消耗降低 10 倍、工具调用减少 2.1 倍（Codebase-Memory, arXiv:2603.27277, 2026）
- 确定性 AST 图谱在完整性、成本、可靠性上全面优于 LLM 提取的图谱（arXiv:2601.08773, 2026）
- legacy-shield 已具备全部基础设施（Babel AST 工具链、文件遍历、CLI 子命令、结构化输出），无需新增任何运行时依赖

## 参与人员

- 用户 / 产品负责人：creayma
- SOLO Coder：AI Assistant

## 需求条目确认

| 需求编号 | 需求描述 | 确认结论 | 备注 |
|---|---|---|---|
| REQ-1.5-1 | 扫描目标项目 src 下的 JS/JSX/TS/TSX/Vue 文件，构建文件级依赖图 | 确认 | 复用现有 Babel AST 工具链，不引入新依赖 |
| REQ-1.5-2 | 解析 import / export / require 语句，收集文件间依赖关系 | 确认 | 静态分析，动态 import() 标记为"未解析"边 |
| REQ-1.5-3 | 支持模块路径解析：相对路径、`@/` alias、`~` alias、node_modules 包、扩展名补全、index 解析 | 确认 | 自建轻量 resolver，不引入 enhanced-resolve |
| REQ-1.5-4 | 读取目标项目 tsconfig.json / jsconfig.json 的 paths 配置，自动识别 alias | 确认 | 兼容无 tsconfig 的纯 JS 项目 |
| REQ-1.5-5 | 检测循环依赖并输出循环链 | 确认 | 基于深度优先搜索 |
| REQ-1.5-6 | 识别 hub 文件（高入度节点）与孤立文件（零入度零出度） | 确认 | P1 优先级，用于架构健康度评估 |
| REQ-1.5-7 | 推断项目分层结构（入口文件、核心模块、叶子模块） | 确认 | P1 优先级，基于拓扑排序与入度/出度分析 |
| REQ-1.5-8 | 输出 JSON 格式知识图谱（邻接表 + 反向索引 + 节点元数据 + 图统计指标） | 确认 | 机器消费格式 |
| REQ-1.5-9 | 输出中文 Markdown 格式架构摘要（AI 优化格式，含架构概览/依赖拓扑/关键节点/循环依赖） | 确认 | AI 消费格式，非 JSON 简单转译 |
| REQ-1.5-10 | 新增独立 graph 子命令，与 quality/report/api 并列 | 确认 | 子命令命名：`graph` |
| REQ-1.5-11 | 支持并发文件扫描（Promise.all + 限流） | 确认 | 替代现有串行扫描 |
| REQ-1.5-12 | 支持文件 mtime 缓存，未变更文件跳过重新解析（增量更新） | 确认 | 增量更新基础 |
| REQ-1.5-13 | 支持 monorepo，为每个子包生成独立图谱 + 全局聚合图谱 | 确认 | 独立 + 聚合双图谱策略 |
| REQ-1.5-14 | 默认输出到 `<project>/.legacy-shield/knowledge-graph/` 目录，可通过 --out 自定义 | 确认 | 与结构化日志同级 |
| REQ-1.5-15 | graph 子命令与 quality 子命令完全独立，不自动集成 | 确认 | 职责分离，用户需手动运行 graph |
| REQ-1.5-16 | 目标项目规模支持到 5000 文件 | 确认 | 大型项目，并发扫描 + mtime 缓存 + 增量更新 |
| REQ-1.5-17 | 保持 v1.1 ~ v1.4 已有能力零回归 | 确认 | 测试矩阵覆盖既有用例 |
| REQ-1.5-18 | 文档同步更新 README、api.md | 确认 | P1 优先级，与代码同期交付 |

## 边界与不做项确认

| 编号 | 不做项 | 确认结论 | 后续版本 |
|---|---|---|---|
| OUT-1 | 不做函数/类级符号图 | 确认 | v1.6+ |
| OUT-2 | 不做 MCP 接口暴露 | 确认 | v1.6+ |
| OUT-3 | 不做 Worker 线程 | 确认 | v1.6+ |
| OUT-4 | 不做影响范围分析（改 X 影响谁） | 确认 | v1.6+ |
| OUT-5 | 不做架构规则验证（forbidden 规则） | 确认 | v1.6+ |
| OUT-6 | 不引入新的运行时依赖 | 确认 | 保持项目依赖克制风格 |
| OUT-7 | 不做 watch 模式 / 实时更新 | 确认 | v1.6+ |

## 验收标准确认

1. `shield graph --project <path>` 可在目标项目上生成 JSON + Markdown 双格式知识图谱。
2. 知识图谱正确反映文件间 import / export / require 依赖关系，路径解析覆盖 alias、node_modules、扩展名补全。
3. 循环依赖被正确检测并输出循环链。
4. monorepo 项目可生成每个子包的独立图谱 + 全局聚合图谱，包间依赖关系通过 node_modules 与 workspace 协议解析。
5. 增量更新模式下，未变更文件跳过重新解析，性能显著优于全量重建。
6. 5000 文件规模项目可在合理时间内完成扫描（具体基线在设计文档中确定）。
7. Markdown 架构摘要为中文，包含架构概览、依赖拓扑、关键节点、循环依赖等章节，AI 可直接消费。
8. `pnpm typecheck`、`pnpm build`、`pnpm test` 全量通过。
9. README、api.md 文档与代码行为一致。
10. v1.1 ~ v1.4 已有能力无回归。

## 成功指标确认

- AI 智能体可通过知识图谱快速理解目标项目的架构与模块依赖关系，无需逐文件扫描。
- 知识图谱的 Markdown 摘要可作为 AI 上下文注入，显著降低 AI 分析项目的 token 消耗。
- 开发者可通过知识图谱识别循环依赖、hub 文件、孤立模块等架构问题。
- monorepo 项目可同时获得包级与全局级的架构视图。
- v1.1 ~ v1.4 已交付能力无回归。

## 风险与约束

| 风险 | 影响 | 应对措施 |
|---|---|---|
| 模块路径解析边界情况多（动态 import、变量 require） | 部分依赖关系无法解析 | v1.5 只处理静态 import/require，动态 import() 标记为"未解析"边，文档中明确说明 |
| 大型项目性能（5000 文件） | 扫描耗时长 | 并发扫描（Promise.all + 限流）+ mtime 缓存 + 增量更新 |
| monorepo 包间依赖解析复杂 | 聚合图谱可能不完整 | 通过 node_modules 与 workspace 协议解析，设计文档中明确支持的工作区协议类型 |
| 图谱 schema 设计不当导致 AI 难消费 | AI 无法有效利用图谱 | Markdown 摘要需在真实 LLM 上验证效果，设计文档中给出样例 |
| alias 配置多样性（tsconfig paths、webpack resolve.alias、vite resolve.alias） | alias 解析不完整 | v1.5 优先支持 tsconfig/jsconfig paths，webpack/vite alias 在设计文档中评估 |
| mtime 缓存失效策略不当 | 增量更新结果不准确 | 缓存 key 包含文件路径 + mtime + alias 配置 hash，设计文档中细化 |

## 遗留问题

| 问题 | 责任人 | 解决时限 |
|---|---|---|
| Markdown 摘要的具体章节结构与样例 | SOLO Coder | 设计文档评审前 |
| monorepo 子包识别策略（packages/* / lerna.json / pnpm-workspace.yaml） | SOLO Coder | 设计文档评审前 |
| mtime 缓存的存储位置与失效策略 | SOLO Coder | 设计文档评审前 |
| webpack/vite resolve.alias 的支持范围 | SOLO Coder | 设计文档评审前 |
| 5000 文件规模项目的性能基线指标 | SOLO Coder | 设计文档评审前 |

## 双方确认

- 用户 / 产品负责人：creayma，2026-06-22，已确认
- SOLO Coder：AI Assistant，2026-06-22，已确认
