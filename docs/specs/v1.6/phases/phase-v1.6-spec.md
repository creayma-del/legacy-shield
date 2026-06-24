# legacy-shield v1.6 阶段 Spec

> 版本：v1.6
> 对应需求文档：[requirements-v1.6.md](../requirements-v1.6.md)
> 对应需求分解文档：[requirements-decomposition-v1.6.md](../requirements-decomposition-v1.6.md)
> 对应设计文档：[design-v1.6.md](../design-v1.6.md)
> 对应执行计划：[execution-plan-v1.6.md](../execution-plan-v1.6.md)
> 状态：已完成，已归档（冻结，不再修改）

---

## 1. 阶段目标

v1.6 作为 MINOR 版本，目标为：

1. **闭环 v1.4 遗留的 2 个 it.skip 测试用例**（R-1 / R-2）：
   - R-1：Pinia 2.x plugin install 异步路径异常捕获（遍历 `_p` 数组包装）
   - R-2：Vuex 4 strict mode 异步 watcher 违规捕获（errorHandler 协同）
2. **消除 v1.5 遗留的 webpack/vite alias 不支持限制**：
   - 新增 jiti 配置加载器，支持 webpack.config / vite.config 的 resolve.alias 解析
   - 按 tsconfig > vite > webpack 优先级合并 alias
3. **保持 v1.1 ~ v1.5 已有能力零回归**。

---

## 2. 总体目标

| 目标编号 | 描述 | 对应需求 | 验收标准 |
|---|---|---|---|
| G-1 | Pinia plugin install 异常捕获主链路补强 | REQ-1.6-1, REQ-1.6-2, REQ-1.6-3 | TC-3 取消 it.skip 后通过；_p 不存在时静默跳过 |
| G-2 | Vuex strict 违规 errorHandler 协同捕获 | REQ-1.6-4, REQ-1.6-5, REQ-1.6-6, REQ-1.6-7 | TC-8 / TC-8a1 取消 it.skip 后通过；errorHandler 链式调用不吞错 |
| G-3 | jiti 配置加载器 + vite/webpack alias 解析 | REQ-1.6-8 ~ REQ-1.6-15 | vite 对象+数组格式、webpack 对象格式均可正确解析；配置解析 < 500ms |
| G-4 | alias 优先级合并 + resolver 集成 | REQ-1.6-11, REQ-1.6-12 | tsconfig > vite > webpack 优先级正确；aliasHash 含所有来源 |
| G-5 | 回归与文档 | REQ-1.6-16, REQ-1.6-17, REQ-1.6-18 | v1.1 ~ v1.5 零回归；文档与代码一致 |

---

## 3. 任务清单

| 任务编号 | 任务名称 | 优先级 | 依赖 | 对应需求 |
|---|---|---|---|---|
| T1 | Pinia _p 数组包装 | P0 | 无 | REQ-1.6-1, REQ-1.6-2 |
| T2 | Vuex strict errorHandler 协同 | P0 | 无 | REQ-1.6-4, REQ-1.6-5, REQ-1.6-6 |
| T3 | 恢复 it.skip 测试用例 | P0 | T1, T2 | REQ-1.6-3, REQ-1.6-7 |
| T4 | jiti 依赖提升 + 配置加载器 | P0 | 无 | REQ-1.6-10, REQ-1.6-13 |
| T5 | vite alias 解析 | P0 | T4 | REQ-1.6-8, REQ-1.6-13 |
| T6 | webpack alias 解析 | P0 | T4 | REQ-1.6-9, REQ-1.6-15 |
| T7 | alias 优先级合并 + resolver 集成 | P0 | T5, T6 | REQ-1.6-11, REQ-1.6-12 |
| T8 | 测试夹具与测试用例 | P0 | T7 | REQ-1.6-14, REQ-1.6-18 |
| T9 | 回归测试 + 文档更新 | P0 | T3, T8 | REQ-1.6-16, REQ-1.6-17 |

### 并行执行批次

| 批次 | 任务 | 说明 |
|---|---|---|
| 批次 1 | T1, T2, T4 | 三个独立任务，无依赖关系 |
| 批次 2 | T3, T5, T6 | T3 依赖 T1/T2；T5/T6 依赖 T4 |
| 批次 3 | T7 | 依赖 T5/T6 |
| 批次 4 | T8 | 依赖 T7 |
| 批次 5 | T9 | 依赖 T3/T8，最终收尾 |

---

## 4. 验收标准

### 4.1 功能验收

| 编号 | 验收项 | 验证方式 |
|---|---|---|
| AC-1 | TC-3 取消 it.skip 后测试通过 | `pnpm test` 全量通过 |
| AC-2 | TC-8 / TC-8a1 取消 it.skip 后测试通过 | `pnpm test` 全量通过 |
| AC-3 | webpack alias 项目可正确解析 `@/`、`~/` 别名 | T8 测试夹具端到端验证 |
| AC-4 | vite alias 项目可正确解析对象格式与数组格式 | T8 测试夹具端到端验证 |
| AC-5 | alias 优先级正确：tsconfig > vite > webpack | T8 多来源测试夹具验证 |
| AC-6 | 配置文件解析耗时 < 500ms（单次解析） | T8 性能测试用例 |
| AC-7 | v1.1 ~ v1.5 零回归 | `pnpm test` 全量通过 |
| AC-8 | README / api.md 文档与代码一致 | 人工审阅 |
| AC-13 | 5000 文件全量扫描 < 30s（v1.5 基线不变） | T8 性能测试用例 |
| AC-14 | 异常路径降级逻辑被测试覆盖（含 jiti 加载失败、函数式配置排除、`_p` 不存在时跳过、WeakRef 不支持时降级、配置文件解析失败） | T8 异常路径测试用例 |

### 4.2 工程验收

| 编号 | 验收项 | 验证方式 |
|---|---|---|
| AC-9 | `pnpm typecheck` 通过 | 类型检查零错误 |
| AC-10 | `pnpm build` 通过 | 构建零错误 |
| AC-11 | `pnpm test` 全量通过 | 测试零失败 |
| AC-12 | jiti 从 devDependencies 移至 dependencies | package.json 检查 |

---

## 5. 变更范围

### 5.1 涉及文件

| 文件 | 变更类型 | 任务 |
|---|---|---|
| `lib/inject.iife.ts` | 修改（patchPinia 新增 _p 包装、patchVuex 新增 strict 注册、patchErrorHandler 新增 strict 识别） | T1, T2 |
| `lib/knowledge-graph/config-loader.ts` | 新建 | T4, T5, T6 |
| `lib/knowledge-graph/resolver.ts` | 修改（createResolver 重写、resolveAlias 扩展、ResolverOptions 扩展） | T7 |
| `lib/knowledge-graph/scanner.ts` | 修改（computeAliasHash 扩展） | T7 |
| `lib/knowledge-graph/index.ts` | 修改（readTsconfig → loadAliasConfig） | T7 |
| `package.json` | 修改（jiti 依赖提升） | T4 |
| `tests/pinia-monitor.test.ts` | 修改（TC-3 取消 it.skip） | T3 |
| `tests/vuex-monitor.test.ts` | 修改（TC-8 / TC-8a1 取消 it.skip） | T3 |
| `tests/knowledge-graph/fixtures/webpack-alias-project/` | 新建 | T8 |
| `tests/knowledge-graph/fixtures/vite-alias-project/` | 新建 | T8 |
| `tests/knowledge-graph/fixtures/vite-alias-project-array/` | 新建 | T8 |
| `tests/knowledge-graph/resolver.test.ts` | 修改（新增 alias 测试用例） | T8 |
| `tests/knowledge-graph/integration.test.ts` | 修改（新增端到端测试） | T8 |
| `tests/knowledge-graph/performance.test.ts` | 修改（新增配置解析性能测试） | T8 |
| `README.md` | 修改（移除不支持说明，补充 v1.6 能力） | T9 |
| `docs/api.md` | 修改（补充 v1.6 说明） | T9 |

### 5.2 不在范围内

- webpack-chain / webpack-merge / 函数式 alias / 正则 alias 等动态配置解析
- Vue 2 + Vuex 3 的支持
- Pinia / Vuex devtools 协议对接
- 新增 CLI 参数控制 alias 来源
- webpack `resolve.modules` / `resolve.extensions` 配置解析
- vite `resolve.dedupe` / `resolve.conditions` 等其他 resolve 配置项
- Proxy 包装 Vuex state 精确定位被修改字段路径
- 知识图谱对 webpack/vite 构建配置的其他字段解析

---

## 6. 依赖与约束

### 6.1 外部依赖

| 依赖 | 版本 | 用途 | 变更 |
|---|---|---|---|
| jiti | ^2.6.1 | JS/TS 配置文件加载器 | devDependencies → dependencies |

### 6.2 约束

- Node.js 18+（jiti 2.x 运行时要求）
- 浏览器侧 WeakRef 兼容性：inject.iife.ts 中 `strictStoresByApp` 在 `typeof WeakRef === 'undefined'` 时降级为 null，不影响 errorHandler 主路径 emit（设计文档 §2.2.3）
- 不新增 CLI 参数
- 不修改现有接口签名（`patchPinia` / `patchVuex` / `patchErrorHandler` / `createResolver` / `ModuleResolver.resolve` / `runKnowledgeGraph` 签名不变；`RuntimeSubType` 类型不变）
- `computeAliasHash` 参数语义变更（从 tsconfig 对象扩展为 alias 配置对象），仅 `runSinglePackageFlow` 一个调用方需同步修改
- REQ-1.6-13 约束：仅支持静态 alias 配置，函数式 alias（T4 排除）与正则 alias（T5 跳过）不在范围内

---

## 7. 评审记录

> - 第一轮评审（2026-06-23）：不通过，发现 3 个 P1 + 5 个 P2 问题
> - 第二轮重评（2026-06-23）：通过，P1 全部闭环，P2-1~P2-4 已修复，P2-5 遗留至 T3 任务 Spec 阶段确认
