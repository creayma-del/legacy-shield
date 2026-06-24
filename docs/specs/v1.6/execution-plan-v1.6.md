# legacy-shield v1.6 执行计划

> 版本：v1.6
> 对应设计文档：[design-v1.6.md](design-v1.6.md)
> 对应需求分解文档：[requirements-decomposition-v1.6.md](requirements-decomposition-v1.6.md)
> 状态：已完成，已归档（冻结，不再修改）

> 评审记录：
> - 第一轮评审（2026-06-23）：不通过，发现 2 个 P1 + 4 个 P2 问题
> - 第二轮重评（2026-06-23）：通过，P1 全部闭环，P2-1~P2-3 已修复，P2-4 遗留至任务 Spec 阶段细化

---

## 1. 任务清单

| 任务编号 | 任务名称 | 优先级 | 依赖 | 预计耗时 | 负责人 |
|---|---|---|---|---|---|
| T1 | Pinia _p 数组包装 | P0 | 无 | 低 | 开发专家 |
| T2 | Vuex strict errorHandler 协同 | P0 | 无 | 中 | 开发专家 |
| T3 | 恢复 it.skip 测试用例 | P0 | T1, T2 | 低 | 开发专家 |
| T4 | jiti 依赖提升 + 配置加载器 | P0 | 无 | 中 | 开发专家 |
| T5 | vite alias 解析 | P0 | T4 | 中 | 开发专家 |
| T6 | webpack alias 解析 | P0 | T4 | 中 | 开发专家 |
| T7 | alias 优先级合并 + resolver 集成 | P0 | T5, T6 | 中 | 开发专家 |
| T8 | 测试夹具与测试用例 | P0 | T7 | 中 | 开发专家 |
| T9 | 回归测试 + 文档更新 | P0 | T3, T8 | 低 | 开发专家 |

### 任务详细说明

#### T1：Pinia _p 数组包装

- **目标**：在 `patchPinia` 中遍历 `pinia._p` 数组，逐个包装 plugin function（含 function 形态与对象 install 形态）为 try/catch
- **涉及文件**：`lib/inject.iife.ts`（patchPinia 函数，L774-836）
- **关键实现**：新增步骤 2.5，遍历 `_p` 数组，用 `__shield_wrapped_plugin__` 防重复标记，包装后原地替换 `plugins[i]`
- **验收标准**：plugin install 抛错被捕获并落盘为 `pinia-plugin-error`；`_p` 不存在时静默跳过

#### T2：Vuex strict errorHandler 协同

- **目标**：在 `patchVuex` 末尾注册 strict store 到模块级 `strictStoresByApp`（WeakRef）；在 `patchErrorHandler` 中新增 `tryEmitVuexStrictViolation` 识别逻辑
- **涉及文件**：`lib/inject.iife.ts`（patchVuex L931、patchErrorHandler L491-502）
- **关键实现**：新增 `strictStoresByApp` Map、`tryEmitVuexStrictViolation`、`findStrictStore`、`buildVuexStrictViolationDetail` 函数
- **验收标准**：strict 违规经 errorHandler 捕获并落盘为 `vuex-strict-violation`；errorHandler 链式调用不吞错；与 `__shield_emitted__` 去重协同

#### T3：恢复 it.skip 测试用例

- **目标**：取消 TC-3 / TC-8 / TC-8a1 的 `it.skip`，恢复为活跃测试用例
- **涉及文件**：`tests/pinia-monitor.test.ts`（TC-3 L196）、`tests/vuex-monitor.test.ts`（TC-8 L210、TC-8a1 L221）
- **关键实现**：移除 `it.skip` 改为 `it`；更新测试注释说明 v1.6 已补强捕获链路
- **验收标准**：3 个测试用例全部通过

#### T4：jiti 依赖提升 + 配置加载器

- **目标**：将 jiti 从 devDependencies 移至 dependencies；新建 `lib/knowledge-graph/config-loader.ts`，实现 `loadConfigFile` + `findBuildConfig`
- **涉及文件**：`package.json`、`lib/knowledge-graph/config-loader.ts`（新建）
- **关键实现**：使用 `createJiti` + `interopDefault: true`；函数式配置返回 null；加载失败 catch 降级
- **验收标准**：jiti 可正确加载 webpack.config.{js,ts} / vite.config.{ts,js}；加载失败时静默降级

#### T5：vite alias 解析

- **目标**：实现 `parseViteAlias` 函数，支持对象格式与数组格式
- **涉及文件**：`lib/knowledge-graph/config-loader.ts`
- **关键实现**：对象格式 `{ '@': '/src' }` + 数组格式 `[{ find, replacement }]`；正则 alias 跳过；输出 `AliasEntry[]`
- **验收标准**：两种格式均可正确解析；replacement 解析为绝对路径

#### T6：webpack alias 解析

- **目标**：实现 `parseWebpackAlias` 函数，支持对象格式（含对象形态 alias）
- **涉及文件**：`lib/knowledge-graph/config-loader.ts`
- **关键实现**：对象格式 `{ '@': path.resolve(__dirname, 'src') }`；webpack 5 对象形态 `{ path, exact }` 兼容
- **验收标准**：alias 可正确解析为绝对路径；对象形态 alias 兼容

#### T7：alias 优先级合并 + resolver 集成

- **目标**：重写 `createResolver`，自动检测 tsconfig/vite/webpack，按 tsconfig > vite > webpack 优先级合并；扩展 `resolveAlias` 先匹配 tsconfig paths 再匹配 aliases；扩展 `computeAliasHash`
- **涉及文件**：`lib/knowledge-graph/resolver.ts`、`lib/knowledge-graph/scanner.ts`、`lib/knowledge-graph/index.ts`
- **关键实现**：`loadTsconfigPaths` 提取、`mergeAliases` 合并函数、`resolveAlias` 优先级调整、`loadAliasConfig` 替代 `readTsconfig`
- **验收标准**：多来源 alias 正确合并；高优先级不被低优先级覆盖；aliasHash 含所有来源

#### T8：测试夹具与测试用例

- **目标**：新增 webpack-alias-project / vite-alias-project / vite-alias-project-array 测试夹具；扩展 resolver / integration / performance 测试
- **涉及文件**：`tests/knowledge-graph/fixtures/webpack-alias-project/`（新建）、`tests/knowledge-graph/fixtures/vite-alias-project/`（新建）、`tests/knowledge-graph/fixtures/vite-alias-project-array/`（新建）、`tests/knowledge-graph/resolver.test.ts`、`tests/knowledge-graph/integration.test.ts`、`tests/knowledge-graph/performance.test.ts`
- **关键实现**：夹具含 webpack.config.js / vite.config.ts + src/ 源文件 + alias 引用；vite-alias-project 使用对象格式 alias，vite-alias-project-array 使用数组格式 alias；性能测试验证配置解析 < 500ms；异常路径测试覆盖 jiti 加载失败降级、函数式配置排除、`_p` 不存在时跳过、WeakRef 不支持时降级
- **验收标准**：端到端验证 alias 解析正确性（含对象格式与数组格式）；配置解析耗时 < 500ms；异常路径降级逻辑被测试覆盖

#### T9：回归测试 + 文档更新

- **目标**：全量回归测试；更新 README / api.md
- **涉及文件**：`README.md`、`docs/api.md`
- **关键实现**：README 知识图谱章节移除「不支持 webpack/vite resolve.alias」说明；补充 v1.6 新增能力说明
- **验收标准**：v1.1 ~ v1.5 零回归；文档与代码一致

---

## 2. 里程碑

| 里程碑 | 预计日期 | 交付物 |
|---|---|---|
| 设计文档评审通过 | 2026-06-23 | design-v1.6.md（已通过） |
| 执行计划评审通过 | 2026-06-23 | execution-plan-v1.6.md |
| 阶段 Spec 评审通过 | 2026-06-23 | phases/phase-v1.6-spec.md |
| 任务 Spec 评审通过 | 2026-06-23 | phases/phase-v1.6-t{1-9}-spec.md |
| 批次 1 开发完成（T1, T2, T4） | 2026-06-24 | patchPinia _p 包装、Vuex strict errorHandler、jiti 配置加载器 |
| 批次 2 开发完成（T3, T5, T6） | 2026-06-24 | it.skip 恢复、vite alias 解析、webpack alias 解析 |
| 批次 3 开发完成（T7） | 2026-06-24 | alias 优先级合并 + resolver 集成 |
| 批次 4 开发完成（T8） | 2026-06-24 | 测试夹具与测试用例 |
| 批次 5 开发完成（T9） | 2026-06-24 | 回归测试 + 文档更新 |
| 测试验收通过 | 2026-06-24 | acceptance-report-v1.6.md |
| 归档关闭 | 2026-06-24 | 所有 v1.6 文档归档冻结 |

---

## 3. 资源与角色

- **开发专家**：负责 T1-T9 全部代码开发与单元测试
- **质量管控专家**：负责代码评审与功能测试（开发完成后并行调用）
- **SOLO Coder**：负责 Spec 文档创建、流程编排、验收归档

---

## 4. 风险与应对

| 风险 | 影响 | 应对措施 |
|---|---|---|
| T1/T2 同文件修改冲突 | inject.iife.ts 合并冲突 | 按批次顺序执行 T1 → T2，修改不同函数无逻辑冲突 |
| jiti 2.x API 变更 | createJiti 调用方式可能与文档不符 | T4 开发时验证 jiti 2.6.1 实际 API；失败时 catch 降级 |
| webpack path.resolve 求值 | jiti 加载时 __dirname 可能不正确 | T8 测试夹具验证；失败时降级为无 webpack alias |
| alias 优先级测试覆盖不足 | 多来源冲突场景遗漏 | T8 测试夹具含 tsconfig + vite + webpack 三来源场景 |
| 性能回退 | 配置解析增加知识图谱耗时 | T8 性能测试验证 < 500ms；全量扫描 < 30s |
| Pinia 2.x `_p` 私有 API 变更 | T1 _p 包装失效 | `Array.isArray(plugins)` 类型检查；不存在时静默跳过（设计文档 §5.3） |
| Vue errorHandler 已被业务覆盖 | T2 链式调用顺序影响业务 handler | 先调用业务 handler 再执行 shield 识别（REQ-1.6-5）；业务 handler 抛错不阻断 emit |
| computeAliasHash 签名变更（破坏性） | T7 影响 scanner.ts 调用方 | 设计文档 §4.2 标注「向后兼容：否」；T7 同步修改所有调用方 |
| WeakRef 浏览器兼容性 | T2 strict store 注册表在老浏览器不可用 | `typeof WeakRef !== 'undefined'` 防御性检查；不支持时降级为 null（设计文档 §2.2.3） |

---

## 5. 任务 Spec 拆解说明

- 每个任务在计划评审通过后，必须拆解为独立的任务 Spec。
- 任务 Spec 文件命名：`docs/specs/phases/phase-v1.6-t{n}-spec.md`。
- 所有任务 Spec 评审通过后，方可进入代码开发阶段。
- 任务 Spec 引用阶段 Spec、设计文档、执行计划、任务编号和依赖关系。
