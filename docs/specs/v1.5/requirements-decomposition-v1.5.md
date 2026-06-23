# legacy-shield v1.5 需求分解文档

> 版本：v1.5
> 对应需求文档：[requirements-alignment-v1.5-20260622.md](meetings/requirements-alignment-v1.5-20260622.md)
> 对应会议纪要：[meetings/requirements-alignment-v1.5-20260622.md](meetings/requirements-alignment-v1.5-20260622.md)
> 状态：已完成，已归档（冻结，不再修改）
> 编制日期：2026-06-22
> 批准日期：2026-06-22

---

## 1. 功能分解

| 功能点编号 | 名称 | 描述 | 对应需求 | 验收标准 | 优先级 |
|---|---|---|---|---|---|
| F-1 | 文件扫描器（并发 + 缓存） | 改造现有 scanner.ts 的串行遍历为并发扫描（Promise.all + 限流），支持文件 mtime 缓存，未变更文件跳过重新解析；支持 5000 文件规模 | REQ-1.5-1、REQ-1.5-11、REQ-1.5-12、REQ-1.5-16 | 5000 文件项目扫描可在合理时间内完成；增量模式下未变更文件跳过解析；并发数可配置 | P0 |
| F-2 | 模块路径解析器 | 自建轻量 resolver，处理相对路径、`@/` alias、`~` alias、node_modules 包、扩展名补全、index 解析；读取 tsconfig.json / jsconfig.json 的 paths 配置自动识别 alias | REQ-1.5-3、REQ-1.5-4 | 路径解析覆盖 alias、node_modules、扩展名补全；兼容无 tsconfig 的纯 JS 项目；不引入 enhanced-resolve | P0 |
| F-3 | 依赖关系收集 | 新建 Babel visitor 收集 ImportDeclaration / ExportNamedDeclaration / ExportDefaultDeclaration / require() 调用，构建文件→文件依赖边；动态 import() 标记为"未解析"边 | REQ-1.5-2 | 正确收集静态 import/export/require；动态 import 标记为"未解析"边；复用现有 Babel 工具链 | P0 |
| F-4 | 图构建器 | 构建邻接表 + 反向邻接表；基于深度优先搜索检测循环依赖并输出循环链 | REQ-1.5-5 | 循环依赖被正确检测；循环链完整输出；邻接表与反向索引一致 | P0 |
| F-5 | 图谱分析器 | 识别 hub 文件（高入度节点）、孤立文件（零入度零出度）；基于拓扑排序与入度/出度分析推断项目分层结构（入口文件、核心模块、叶子模块） | REQ-1.5-6、REQ-1.5-7 | hub 文件与孤立文件正确识别；分层结构推断合理；输出入度/出度统计 | P1 |
| F-6 | JSON 输出器 | 输出 JSON 格式知识图谱：邻接表 + 反向索引 + 节点元数据（路径、类型、导出符号）+ 图统计指标（节点数、边数、循环数、连通分量数） | REQ-1.5-8 | JSON 结构完整；机器可读；包含图统计指标 | P0 |
| F-7 | Markdown 摘要生成器 | 输出中文 Markdown 格式架构摘要：架构概览、依赖拓扑、关键节点（hub/孤立）、循环依赖链、分层结构推断；AI 优化格式，非 JSON 简单转译 | REQ-1.5-9 | 中文输出；章节结构完整；AI 可直接消费作为上下文；包含建筑学判断 | P0 |
| F-8 | monorepo 支持 | 识别 monorepo 子包（packages/* / pnpm-workspace.yaml / lerna.json）；为每个子包生成独立图谱；生成全局聚合图谱，解析包间依赖（node_modules 与 workspace 协议） | REQ-1.5-13 | 子包正确识别；独立图谱 + 聚合图谱均生成；包间依赖关系通过 workspace 协议解析 | P0 |
| F-9 | CLI 子命令集成 | 新增独立 `graph` 子命令，与 quality/report/api 并列；默认输出到 `<project>/.legacy-shield/knowledge-graph/`，可通过 `--out` 自定义；与 quality 完全独立 | REQ-1.5-10、REQ-1.5-14、REQ-1.5-15 | `shield graph --project <path>` 可用；输出路径正确；不与 quality 自动集成 | P0 |
| F-10 | 测试与文档 | 新增测试夹具（含 monorepo 场景）、单测、集成测试；更新 README、api.md；确保 v1.1 ~ v1.4 能力零回归 | REQ-1.5-17、REQ-1.5-18 | 测试矩阵覆盖正反场景；文档与代码一致；全量测试通过 | P1 |

---

## 2. 任务依赖关系

| 任务 | 依赖 | 可并行任务 |
|---|---|---|
| T1：类型定义与图谱 schema（lib/types.ts 扩展） | 无 | T2、T4 |
| T2：模块路径解析器（alias/node_modules/扩展名补全） | 无 | T1、T4 |
| T3：依赖关系收集 visitor（import/export/require） | T1、T2 | — |
| T4：文件扫描器改造（并发 + mtime 缓存） | 无 | T1、T2 |
| T5：图构建器（邻接表 + 反向索引 + 循环检测） | T1、T3 | — |
| T6：图谱分析器（hub/孤立/分层推断） | T5 | — |
| T7：JSON 输出器 | T5、T6 | T8 |
| T8：Markdown 摘要生成器（中文 AI 优化格式） | T6 | T7 |
| T9：monorepo 支持（子包识别 + 独立图谱 + 聚合图谱） | T4、T5 | — |
| T10：CLI 子命令集成（graph 子命令） | T7、T8、T9 | — |
| T11：测试夹具、单测、集成测试 | T10 | — |
| T12：文档更新与验收报告 | T11 | — |

---

## 3. 资源分配估算

| 任务 | 工作量 | 角色 | 外部资源 |
|---|---|---|---|
| T1 类型定义与图谱 schema | 低 | 开发专家 / SOLO Coder | 无 |
| T2 模块路径解析器 | **高** | 开发专家 | 无（自建，不引入 enhanced-resolve） |
| T3 依赖关系收集 visitor | 中 | 开发专家 | 复用现有 @babel/parser + @babel/traverse |
| T4 文件扫描器改造 | 中 | 开发专家 | 复用现有 scanner.ts，改造为并发 |
| T5 图构建器 | 中 | 开发专家 | 无 |
| T6 图谱分析器 | 中 | 开发专家 | 无 |
| T7 JSON 输出器 | 低 | 开发专家 | 无 |
| T8 Markdown 摘要生成器 | **高** | 开发专家 | 无（需设计 AI 优化格式） |
| T9 monorepo 支持 | **高** | 开发专家 | 无 |
| T10 CLI 子命令集成 | 低 | 开发专家 | 复用现有 commander 模式 |
| T11 测试 | 中 | 开发专家 | 测试夹具（含 monorepo 场景） |
| T12 文档与验收 | 低 | SOLO Coder | 无 |

> 注：高复杂度任务为 T2（路径解析边界情况多）、T8（AI 优化摘要格式设计）、T9（monorepo 包间依赖解析）。所有任务均不引入新的运行时依赖，AST 相关复用现有 devDependencies 中已引入的 `@babel/*` 与 `@vue/compiler-sfc`。

---

## 4. 时间线里程碑

| 里程碑 | 预计日期 | 说明 |
|---|---|---|
| 需求对齐完成 | 2026-06-22 | 会议纪要已双方确认 |
| 需求分解文档批准 | 待定 | 项目负责人批准 |
| 设计文档评审通过 | 待定 | 完成 design-v1.5.md 并评审通过 |
| 执行计划与阶段 Spec 评审通过 | 待定 | 完成 execution-plan-v1.5.md 与 phase-v1.5-spec.md |
| 任务 Spec 评审通过 | 待定 | T1-T12 任务 Spec 全部评审通过 |
| 代码开发完成 | 待定 | T1-T11 完成 |
| 测试验收通过 | 待定 | T12 完成，验收报告生成 |
| 归档关闭 | 待定 | phase-v1.5-spec.md 状态改为「已完成，已归档」 |

---

## 5. 风险与假设

| 风险 / 假设 | 说明 | 应对措施 |
|---|---|---|
| 模块路径解析边界情况多 | 动态 import()、变量 require()、字符串拼接路径无法静态解析 | v1.5 只处理静态 import/require，动态 import() 标记为"未解析"边，文档中明确说明 |
| 大型项目性能（5000 文件） | 全量扫描耗时长 | 并发扫描（Promise.all + 限流）+ mtime 缓存 + 增量更新；具体性能基线在设计文档中确定 |
| monorepo 包间依赖解析复杂 | workspace 协议多样性（pnpm-workspace.yaml / lerna.json / packages/*） | 设计文档中明确支持的协议类型；聚合图谱通过 node_modules 与 workspace 协议解析 |
| 图谱 schema 设计不当导致 AI 难消费 | Markdown 摘要结构不合理，AI 无法有效利用 | Markdown 摘要需在真实 LLM 上验证效果，设计文档中给出样例 |
| alias 配置多样性 | tsconfig paths、webpack resolve.alias、vite resolve.alias 格式不一 | v1.5 优先支持 tsconfig/jsconfig paths，webpack/vite alias 在设计文档中评估支持范围 |
| mtime 缓存失效策略不当 | alias 配置变更后缓存未失效，导致解析结果不准确 | 缓存 key 包含文件路径 + mtime + alias 配置 hash，设计文档中细化 |
| 与现有 custom-rules scanner 职责重叠 | 现有 scanner.ts 也有文件遍历能力 | graph 模块独立实现扫描器，支持并发与缓存，不复用 custom-rules 的串行扫描；后续可考虑抽取公共能力 |

---

## 6. 批准记录

- 项目负责人：creayma，2026-06-22，已批准
