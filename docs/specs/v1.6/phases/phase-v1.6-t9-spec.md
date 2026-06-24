# 回归测试 + 文档更新

> 版本：v1.6
> 任务编号：T9
> 对应阶段 Spec：[phase-v1.6-spec.md](phase-v1.6-spec.md)
> 对应设计文档：[design-v1.6.md](../design-v1.6.md) §2.9
> 对应执行计划：[execution-plan-v1.6.md](../execution-plan-v1.6.md)
> 依赖任务：T3, T8
> 状态：已完成，已归档（冻结，不再修改）

## 1. 任务目标

执行全量回归测试，确保 v1.1 ~ v1.5 已有能力零回归；更新 README / api.md，移除 v1.5 遗留的「不支持 webpack/vite resolve.alias」说明，补充 v1.6 新增能力说明。对应阶段 Spec G-5。

## 2. 对应需求与验收标准

| 需求编号 | 需求描述 | 本任务验收标准 |
|---|---|---|
| REQ-1.6-16 | 保持 v1.1 ~ v1.5 已有能力零回归 | 现有 vue-render-error / vue-warn / vue-router-error / pinia-error / vuex-error / 知识图谱 tsconfig paths 解析等行为不变；`pnpm typecheck`、`pnpm build`、`pnpm test` 全量通过 |
| REQ-1.6-17 | 文档同步更新 README、api.md | README 知识图谱章节移除「不支持 webpack/vite resolve.alias」说明；补充 v1.6 新增能力说明；api.md 补充 webpack/vite alias 支持与 `vuex-strict-watcher` source 字段 |

## 3. 实现步骤

### 3.1 全量回归测试

- 执行 `pnpm typecheck`：类型检查零错误
- 执行 `pnpm build`：构建零错误
- 执行 `pnpm test`：全量测试零失败
- 验证范围：
  - v1.1 ~ v1.3：vue-render-error / vue-warn / vue-router-error / js-error / promise-rejection 采集不受影响
  - v1.4：pinia-error / pinia-plugin-error / vuex-error / vuex-strict-violation 采集不受影响（TC-3 / TC-8 / TC-8a1 已在 T3 恢复为活跃用例）
  - v1.5：知识图谱 tsconfig paths 解析 / monorepo / 循环依赖检测 / 缓存机制不受影响（TC-RES-1 ~ TC-RES-11、TC-INT-1 ~ TC-INT-5、TC-PERF-1 ~ TC-PERF-3 全部通过）
  - v1.6：T8 新增测试用例全部通过

### 3.2 更新 README.md

- 修改文件：`README.md`
- 变更点 1（L170-171）：移除「不支持的场景」中的 webpack / vite resolve.alias 条目
  - 移除：`- webpack resolve.alias 配置（需读取 webpack.config.js）`
  - 移除：`- vite resolve.alias 配置（需读取 vite.config.ts）`
- 变更点 2：知识图谱章节补充 v1.6 新增能力说明
  - 补充：支持 webpack `resolve.alias`（对象格式）与 vite `resolve.alias`（对象格式 + 数组格式）解析
  - 补充：alias 优先级说明：tsconfig paths > vite alias > webpack alias
  - 补充：使用 jiti 加载 JS/TS 配置文件，加载失败时静默降级
- 变更点 3：补充 Pinia plugin install 异常捕获增强说明（v1.4 R-1 闭环）
  - 补充：遍历 `pinia._p` 数组包装 plugin，捕获 install 阶段异步抛错
- 变更点 4：补充 Vuex strict 违规直接 watcher 捕获说明（v1.4 R-2 闭环，PATCH-T2 策略调整）
  - 补充：通过 `Vue.watch` 自建 watcher 直接检测 `_committing === false` 并 emit `vuex-strict-violation`（PATCH-T2：vendor 构建中 `enableStrictMode` callback 为空，errorHandler 协同方案失效）

### 3.3 更新 docs/api.md

- 修改文件：`docs/api.md`
- 变更点 1（L465-466）：移除「不支持的场景」中的 webpack / vite resolve.alias 条目
  - 移除：`- webpack resolve.alias 配置（需读取 webpack.config.js）`
  - 移除：`- vite resolve.alias 配置（需读取 vite.config.ts）`
- 变更点 2（L458 附近）：路径解析能力说明补充 webpack/vite alias 支持
  - 补充：webpack `resolve.alias`（对象格式，含 webpack 5 对象形态）
  - 补充：vite `resolve.alias`（对象格式 + 数组格式）
  - 补充：alias 优先级：tsconfig paths > vite alias > webpack alias
- 变更点 3（L84 附近）：`vuex-strict-violation` 子类型说明补充 source 字段新增值
  - 补充：`source` 字段新增值 `vuex-strict-watcher`（经直接 watcher 捕获，v1.6 PATCH-T2 新增）
  - 既有 `source: 'vuex-store-patch'`（经 commit 包装捕获，v1.4）保持不变
- 变更点 4（L387 附近）：`graph` 子命令说明补充 webpack/vite alias 支持
  - 补充：自动检测 webpack.config.{js,ts} / vite.config.{ts,js}，无需新增 CLI 参数

## 4. 测试计划

### 4.1 回归测试

- `pnpm typecheck` 通过（AC-9）
- `pnpm build` 通过（AC-10）
- `pnpm test` 全量通过（AC-7, AC-11）
- v1.1 ~ v1.5 已有能力零回归（REQ-1.6-16）
- v1.6 新增测试用例全部通过（T3 恢复的 TC-3 / TC-8 / TC-8a1 + T8 新增测试用例）

### 4.2 文档验证

- README 知识图谱章节不再包含「不支持 webpack/vite resolve.alias」说明
- README 补充 v1.6 新增能力说明（alias 解析、Pinia _p 包装、Vuex strict 直接 watcher）
- api.md 路径解析能力说明不再包含「不支持 webpack/vite resolve.alias」说明
- api.md 补充 `vuex-strict-watcher` source 字段值
- 文档与代码行为一致（AC-8）

## 5. 风险与依赖

| 风险 / 依赖 | 影响 | 应对措施 |
|---|---|---|
| 依赖 T3 | T3 未完成时 TC-3 / TC-8 / TC-8a1 仍为 it.skip，回归测试失败 | 等待 T3 评审通过后执行 |
| 依赖 T8 | T8 未完成时新增测试用例不存在，回归测试覆盖不足 | 等待 T8 评审通过后执行 |
| 文档与代码不一致 | 文档描述与实际行为不符 | 文档更新后人工审阅；对照设计文档 §2.9 逐条核对 |
| 遗漏文档变更点 | 部分 v1.6 能力未在文档中说明 | 对照设计文档 §2.9.2 / §2.9.3 逐条核对 README / api.md 变更点 |

## 6. 变更范围

- 修改 `README.md`（移除不支持说明，补充 v1.6 能力）
- 修改 `docs/api.md`（移除不支持说明，补充 v1.6 能力，补充 source 字段值）
- 不修改任何源代码
- 不修改任何测试文件
- 不新增文件

## 7. 评审记录

> - 第一轮评审（2026-06-23）：通过（无 P0 / P1 阻塞缺陷，5 个 P2 遗留至实现阶段处理）
>   - 评审结论：通过，P2 遗留项需在代码实现阶段逐条处理
>   - P0 问题清单：无
>   - P1 问题清单：无
>   - P2 问题清单（遗留至实现阶段处理）：
>     - P2-1：README 变更点 2 中「使用 jiti 加载 JS/TS 配置文件，加载失败时静默降级」超出设计文档 §2.9.2 范围（设计 §2.9.2 未提及 jiti 实现细节）。处理意向：实现时移除该条，或先在设计文档 §2.9.2 补充后再写入 README。
>     - P2-2：api.md 变更点 3 中 `source` 字段文档位置不明确。`source` 是 detail 顶层字段（与 `message` / `stack` / `context` 同级），不在 `context` 内；当前 docs/api.md L79-84 表格「关键 context 字段」列仅列出 context 内字段。处理意向：实现时在表格下方补充 `source` 字段说明段落，或扩展表格列。
>     - P2-3：api.md 变更点 3 中「既有 `source: 'vuex-store-patch'`（经 commit 包装捕获，v1.4）保持不变」措辞误导。当前 docs/api.md 未文档化 `source` 字段（仅代码 inject.iife.ts:916 存在）。处理意向：实现时改为「补充 `source` 字段说明，含既有值 `vuex-store-patch`（v1.4）与新增值 `vuex-strict-errorhandler`（v1.6）」。
>     - P2-4：api.md 变更点未明确 `pinia-plugin-error` source 字段不变。设计 §2.9.3 措辞「pinia-plugin-error / vuex-strict-violation 的 source 字段新增值」存在歧义，但设计 §6.3 明确 `pinia-plugin-error` source 为 `'pinia-plugin'`（既有）不变。处理意向：实现时在 api.md 补充说明 `pinia-plugin-error` source 字段为 `'pinia-plugin'`（v1.4 既有，不变）。
>     - P2-5：风险与依赖中「等待 T3/T8 评审通过后执行」措辞不准确。T3/T8 Spec 已通过（状态：已通过），风险描述的是 T3/T8 代码开发未完成，应对措施应改为「等待 T3/T8 代码开发完成后执行」。处理意向：实现时修正 §5 风险表应对措施措辞。
>   - P3 优化建议（可选）：
>     - P3-1：§4.1「v1.6 新增测试用例全部通过（T3 恢复的 TC-3 / TC-8 / TC-8a1 + T8 新增测试用例）」中 T3 恢复的用例非「新增」，建议改为「v1.6 测试用例全部通过」。
>     - P3-2：§3.2/§3.3 中「L458 附近」「L84 附近」已验证为精确目标行，建议改为精确行号「L458」「L84」。
>     - P3-3：§4.2 文档验证建议补充「对照源代码验证 README.md / docs/api.md 行号引用准确」步骤。
>   - 准入标准核查：
>     - 文档结构完整性：7 个章节齐全（任务目标 / 需求与验收标准 / 实现步骤 / 测试计划 / 风险与依赖 / 变更范围 / 评审记录）✓
>     - 文件头含评审记录占位 ✓
>     - 上游依赖文档已通过：T3（已通过）、T8（已通过）、设计文档（已通过）、执行计划（已通过）、阶段 Spec（已通过）✓
>     - 内部引用路径有效：phase-v1.6-spec.md / design-v1.6.md / execution-plan-v1.6.md 均存在 ✓
>   - 评审重点核查：
>     - 设计文档 §2.9 一致性：§2.9.2 README 变更点 1~4 全覆盖；§2.9.3 api.md 变更点全覆盖（含 graph 子命令、source 字段）✓
>     - 阶段 Spec 验收标准覆盖：REQ-1.6-16 / REQ-1.6-17 全覆盖；AC-7 / AC-8 / AC-9 / AC-10 / AC-11 全覆盖 ✓
>     - 文档变更点完整性：README 移除不支持说明 + 补充 v1.6 能力；api.md 移除不支持说明 + 补充 v1.6 能力 + 补充 source 字段值 ✓
>     - 回归测试覆盖：v1.1~v1.5 零回归 + v1.6 新增测试通过 ✓
>     - 行号引用准确性：README L170-171、api.md L465-466 / L458 / L84 / L387 均已对照源代码验证准确 ✓
>     - 变更范围合理性：仅修改文档（README.md / docs/api.md），不修改源代码和测试文件 ✓
>     - 文档变更点与设计 §2.9.2 / §2.9.3 一致性：全覆盖（P2-1 jiti 细节为 T9 Spec 额外补充，P2-3/P2-4 source 字段措辞需实现时澄清）✓
>   - 范围检查：未引入新的范围变更，与阶段 Spec §5.1 涉及文件清单一致（README.md / docs/api.md）
>
> **PATCH-T2 同步说明（2026-06-23）**：T2 实现策略从「errorHandler 协同」调整为「直接 watcher」后，本 Spec 中以下内容已同步更新：
> - §2 REQ-1.6-17 验收标准：`vuex-strict-errorhandler` → `vuex-strict-watcher`
> - §3.2 变更点 4：策略描述从「errorHandler 协同捕获」更新为「直接 watcher 检测 `_committing === false`」
> - §3.3 变更点 3：source 字段新增值从 `vuex-strict-errorhandler` 更新为 `vuex-strict-watcher`
> - §4.2 文档验证：同步更新 source 字段值引用
> - 评审记录 P2-3 处理意向中 `vuex-strict-errorhandler` 已被 PATCH-T2 取代为 `vuex-strict-watcher`，实现时以 PATCH-T2 Spec 为准
