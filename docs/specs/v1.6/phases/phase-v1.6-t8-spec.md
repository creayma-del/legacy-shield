# 测试夹具与测试用例

> 版本：v1.6
> 任务编号：T8
> 对应阶段 Spec：[phase-v1.6-spec.md](phase-v1.6-spec.md)
> 对应设计文档：[design-v1.6.md](../design-v1.6.md) §2.8
> 对应执行计划：[execution-plan-v1.6.md](../execution-plan-v1.6.md)
> 依赖任务：T7
> 状态：已完成，已归档（冻结，不再修改）

## 1. 任务目标

新增 webpack-alias-project / vite-alias-project / vite-alias-project-array 三个测试夹具，验证端到端 alias 解析正确性；扩展 resolver / integration / performance 测试，覆盖正常路径与异常路径。对应阶段 Spec G-3, G-4, G-5。

## 2. 对应需求与验收标准

| 需求编号 | 需求描述 | 本任务验收标准 |
|---|---|---|
| REQ-1.6-14 | 配置文件解析性能约束 | 单次配置文件解析耗时 < 500ms；配置解析仅执行一次，不进入并发扫描阶段 |
| REQ-1.6-18 | 新增测试夹具覆盖 webpack/vite alias 场景 | 在 `tests/knowledge-graph/fixtures/` 下新增 webpack-alias-project / vite-alias-project / vite-alias-project-array 三个夹具，验证端到端解析正确性 |

## 3. 实现步骤

### 3.1 新建 webpack-alias-project 夹具

- 新建目录：`tests/knowledge-graph/fixtures/webpack-alias-project/`
- 目录结构：
  ```
  webpack-alias-project/
  ├── src/
  │   ├── utils/
  │   │   └── helper.ts      # 被 @/ 和 ~/ alias 引用的模块
  │   └── main.ts             # import { helper } from '@/utils/helper' + '~/utils/helper'
  ├── webpack.config.js       # resolve.alias: { '@': ..., '~/': ... }
  └── package.json
  ```
- 关键内容：
  - `webpack.config.js`：
    ```javascript
    const path = require('path');
    module.exports = {
      resolve: {
        alias: {
          '@': path.resolve(__dirname, 'src'),
          '~/': path.resolve(__dirname, 'src')
        }
      }
    };
    ```
  - `src/main.ts`：`import { helper } from '@/utils/helper'` + `import { helper as tildeHelper } from '~/utils/helper'`
  - `src/utils/helper.ts`：`export const helper = () => 'helper'`
  - `package.json`：`{ "name": "webpack-alias-project", "version": "1.0.0" }`

### 3.2 新建 vite-alias-project 夹具（对象格式）

- 新建目录：`tests/knowledge-graph/fixtures/vite-alias-project/`
- 目录结构：
  ```
  vite-alias-project/
  ├── src/
  │   ├── utils/
  │   │   └── helper.ts      # 被 alias 引用的模块
  │   └── main.ts             # import { helper } from '@/utils/helper'
  ├── vite.config.ts          # resolve.alias: { '@': path.resolve(__dirname, 'src') }（对象格式）
  └── package.json
  ```
- 关键内容：
  - `vite.config.ts`：
    ```typescript
    import path from 'node:path';

    export default {
      resolve: {
        alias: { '@': path.resolve(__dirname, 'src') }
      }
    };
    ```
  - `src/main.ts`：`import { helper } from '@/utils/helper'`
  - `src/utils/helper.ts`：`export const helper = () => 'helper'`
  - `package.json`：`{ "name": "vite-alias-project", "version": "1.0.0" }`

### 3.3 新建 vite-alias-project-array 夹具（数组格式）

- 新建目录：`tests/knowledge-graph/fixtures/vite-alias-project-array/`
- 目录结构：
  ```
  vite-alias-project-array/
  ├── src/
  │   ├── components/
  │   │   └── Button.ts      # 被 alias 引用的模块
  │   └── main.ts             # import { Button } from '@/components/Button'
  ├── vite.config.ts          # resolve.alias: [{ find: '@', replacement: path.resolve(__dirname, 'src') }]
  └── package.json
  ```
- 关键内容：
  - `vite.config.ts`：
    ```typescript
    import path from 'node:path';

    export default {
      resolve: {
        alias: [{ find: '@', replacement: path.resolve(__dirname, 'src') }]
      }
    };
    ```
  - `src/main.ts`：`import { Button } from '@/components/Button'`
  - `src/components/Button.ts`：`export const Button = () => 'button'`
  - `package.json`：`{ "name": "vite-alias-project-array", "version": "1.0.0" }`

### 3.4 扩展 resolver.test.ts

- 修改文件：`tests/knowledge-graph/resolver.test.ts`
- 新增测试用例（TC-RES-12 ~ TC-RES-17）：
  - TC-RES-12：webpack alias 解析 `@/utils/helper` → `<project>/src/utils/helper.ts`
  - TC-RES-13：webpack alias 解析 `~/utils/helper` → `<project>/src/utils/helper.ts`（AC-3 `~/` 别名验证）
  - TC-RES-14：vite 对象格式 alias 解析 `@/utils/helper` → `<project>/src/utils/helper.ts`
  - TC-RES-15：vite 数组格式 alias 解析 `@/components/Button` → `<project>/src/components/Button.ts`
  - TC-RES-16：多来源优先级 tsconfig paths > vite alias > webpack alias（构造含三来源的临时目录验证）
    - 临时目录结构：tsconfig.json（`@/* → src/*`）、vite.config.ts（`@ → <vite-src>`）、webpack.config.js（`@ → <webpack-src>`）
    - 断言：`@/utils/helper` 解析为 tsconfig 的 `src/utils/helper`，而非 vite/webpack 的路径
  - TC-RES-17：`resolveAlias` 精确匹配（`spec === find`）与前缀匹配（`spec.startsWith(find + '/')`）

### 3.5 扩展 integration.test.ts

- 修改文件：`tests/knowledge-graph/integration.test.ts`
- 新增测试用例（TC-INT-6 ~ TC-INT-8）：
  - TC-INT-6：webpack alias 端到端：依赖图中 `@/utils/helper` 边正确解析（`unresolved: false`）
  - TC-INT-7：vite alias 端到端（对象格式）：依赖图中 `@/utils/helper` 边正确解析
  - TC-INT-8：vite alias 端到端（数组格式）：依赖图中 `@/components/Button` 边正确解析

### 3.6 扩展 performance.test.ts

- 修改文件：`tests/knowledge-graph/performance.test.ts`
- 新增测试用例（TC-PERF-4）：
  - TC-PERF-4：配置解析耗时：单次 `loadAliasConfig` 解析 < 500ms（使用 webpack-alias-project 夹具验证单来源；使用 §3.4 多来源优先级临时目录验证三来源同时加载）
  - 5000 文件全量扫描 < 30s（v1.5 基线不变，既有 TC-PERF-1 验证）

### 3.7 新增异常路径测试

- 新建文件：`tests/knowledge-graph/config-loader.test.ts`（config-loader 相关异常路径）
- 修改文件：`tests/pinia-monitor.test.ts`（T1 异常路径）、`tests/vuex-monitor.test.ts`（T2 异常路径）
- 异常路径测试用例（TC-RES-18 ~ TC-RES-22）：
  - TC-RES-18：jiti 加载失败降级（config-loader.test.ts）：配置文件含语法错误时 `loadConfigFile` 返回 null，`loadAliasConfig` 跳过该来源
  - TC-RES-19：函数式配置排除（config-loader.test.ts）：`defineConfig((env) => ({...}))` 返回函数时 `loadConfigFile` 返回 null
  - TC-RES-20：配置文件解析失败（config-loader.test.ts）：tsconfig.json 含语法错误时 `loadTsconfigPaths` 返回 null，`loadAliasConfig` 跳过 tsconfig 来源
  - TC-RES-21：`_p` 不存在时跳过（pinia-monitor.test.ts）：`pinia._p` 为 undefined / 非数组时静默跳过（T1 逻辑的异常路径验证，与 T3 取消 it.skip 的修改不冲突，新增独立测试用例）
  - TC-RES-22：WeakRef 不支持时降级（vuex-monitor.test.ts）：`typeof WeakRef === 'undefined'` 时 `strictStoresByApp` 为 null，errorHandler 仍可 emit（T2 逻辑的异常路径验证，与 T3 取消 it.skip 的修改不冲突，新增独立测试用例）

## 4. 测试计划

### 4.1 单元测试

- TC-RES-12：webpack alias 解析 `@/`（resolver.test.ts）
- TC-RES-13：webpack alias 解析 `~/`（resolver.test.ts）
- TC-RES-14：vite 对象格式 alias 解析（resolver.test.ts）
- TC-RES-15：vite 数组格式 alias 解析（resolver.test.ts）
- TC-RES-16：多来源优先级（resolver.test.ts）
- TC-RES-17：resolveAlias 精确匹配与前缀匹配（resolver.test.ts）
- TC-RES-18：jiti 加载失败降级（config-loader.test.ts）
- TC-RES-19：函数式配置排除（config-loader.test.ts）
- TC-RES-20：配置文件解析失败（config-loader.test.ts）
- TC-RES-21：`_p` 不存在时跳过（pinia-monitor.test.ts）
- TC-RES-22：WeakRef 不支持时降级（vuex-monitor.test.ts）

### 4.2 集成测试

- TC-INT-6：webpack alias 端到端（integration.test.ts）
- TC-INT-7：vite alias 端到端 - 对象格式（integration.test.ts）
- TC-INT-8：vite alias 端到端 - 数组格式（integration.test.ts）

### 4.3 性能测试

- TC-PERF-4：配置解析耗时 < 500ms（performance.test.ts，含单来源和三来源场景）
- 既有 TC-PERF-1：5000 文件全量扫描 < 30s（v1.5 基线不变）

### 4.4 回归测试

- TC-RES-1 ~ TC-RES-11（既有 resolver 测试）不受影响（均不涉及 aliases 字段）
- TC-INT-1 ~ TC-INT-5（既有集成测试）不受影响
- TC-PERF-1 ~ TC-PERF-3（既有性能测试）不受影响
- resolveAlias 行为变更（T7 §3.5 fallthrough）由新增 TC-RES-12 ~ TC-RES-17 验证：无 tsconfig 但有 vite/webpack alias 时 resolveAlias 仍能解析

## 5. 风险与依赖

| 风险 / 依赖 | 影响 | 应对措施 |
|---|---|---|
| 依赖 T7 | T7 未完成时 createResolver / loadAliasConfig 不支持多来源 | 等待 T7 评审通过后执行 |
| jiti 运行时加载性能 | 大型项目配置文件加载耗时超 500ms | 性能测试用例验证；超时时 catch 降级为无 alias |
| webpack `path.resolve` 求值 | jiti 加载时 `__dirname` 可能不正确 | 测试夹具验证；失败时降级为无 webpack alias |
| 异常路径测试覆盖不足 | 降级逻辑未被测试覆盖 | 明确列出 5 类异常路径测试用例（jiti 加载失败、函数式配置、`_p` 不存在、WeakRef 不支持、配置文件解析失败） |
| 测试夹具 vite.config.ts 中 path 模块导入 | jiti 加载 TS 文件时 import 语法可能不兼容 | vite.config.ts 使用 `import path from 'node:path'`，jiti 2.x 支持 ESM 互操作；T8 测试夹具验证 |

## 6. 变更范围

- 新建 `tests/knowledge-graph/fixtures/webpack-alias-project/`（含 src/、webpack.config.js、package.json）
- 新建 `tests/knowledge-graph/fixtures/vite-alias-project/`（含 src/、vite.config.ts、package.json）
- 新建 `tests/knowledge-graph/fixtures/vite-alias-project-array/`（含 src/、vite.config.ts、package.json）
- 新建 `tests/knowledge-graph/config-loader.test.ts`（config-loader 异常路径测试用例 TC-RES-18 ~ TC-RES-20）
- 修改 `tests/knowledge-graph/resolver.test.ts`（新增 alias 解析与优先级测试用例 TC-RES-12 ~ TC-RES-17）
- 修改 `tests/knowledge-graph/integration.test.ts`（新增端到端测试用例 TC-INT-6 ~ TC-INT-8）
- 修改 `tests/knowledge-graph/performance.test.ts`（新增配置解析性能测试用例 TC-PERF-4）
- 修改 `tests/pinia-monitor.test.ts`（新增 `_p` 不存在异常路径用例 TC-RES-21，与 T3 取消 it.skip 不冲突）
- 修改 `tests/vuex-monitor.test.ts`（新增 WeakRef 不支持异常路径用例 TC-RES-22，与 T3 取消 it.skip 不冲突）
- 不修改任何源代码
- 不修改既有测试用例的断言

## 7. 评审记录

> - 第一轮评审（2026-06-23）：不通过，发现 2 个 P0 + 4 个 P1 + 7 个 P2 问题
>   - P0-1：vite 夹具 `/src` replacement 与 resolveAbsolutePath 冲突（§3.2/§3.3）
>   - P0-2：vite 夹具 defineConfig 未导入/定义，§3.2/§3.3 与 §5 风险表自相矛盾
>   - P1-1：webpack 夹具 path.resolve 未展示 path 导入（§3.1）
>   - P1-2：AC-3 `~/` 别名在 webpack 夹具中遗漏（§3.1/§3.4）
>   - P1-3：变更范围 §6 未列出 pinia/vuex 测试文件
>   - P1-4：§3.7 修改文件与 §4.1 测试文件归属不一致
>   - P2-1~P2-7：TC 编号分配、config-loader.test.ts 明确、性能三来源场景、多来源断言细节、import 风格统一、package.json 补充、回归验证说明
> - 第二轮重评（2026-06-23）：通过
>   - 2 个 P0 全部闭环：vite 夹具 replacement 改为 `path.resolve(__dirname, 'src')`；移除 defineConfig，§5 风险表更新为 path 模块导入风险
>   - 4 个 P1 全部闭环：webpack 夹具补充 `const path = require('path')`；`~/` alias 与 TC-RES-13 已添加；§6 变更范围补充 pinia/vuex 测试文件；§3.7 与 §4.1 文件归属一致
>   - 7 个 P2 全部处理：TC 编号连续（TC-RES-12~22、TC-INT-6~8、TC-PERF-4）；config-loader.test.ts 明确新建；TC-PERF-4 含单来源+三来源场景；TC-RES-16 含临时目录结构与断言；vite 夹具 import 风格统一；三夹具 package.json 齐全；§4.4 resolveAlias 行为变更验证说明已补充
>   - 设计 §2.8 一致性：vite 夹具 replacement 从设计文档的 `/src` 修正为 `path.resolve(__dirname, 'src')`，属 P0-1 必要修复（消除 resolveAbsolutePath 误判），设计意图保持一致
>   - AC 覆盖：AC-3/AC-4/AC-5/AC-6/AC-13/AC-14 全覆盖
>   - 无新增范围变更，无新增问题
