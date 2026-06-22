# legacy-shield v1.2 设计文档：code-quality 内部集成

> 版本：v1.2
> 对应需求文档：[requirements-v1.2.md](requirements-v1.2.md)
> 对应会议纪要：[meetings/requirements-alignment-v1.2-20260620.md](meetings/requirements-alignment-v1.2-20260620.md)
> 对应需求分解文档：[requirements-decomposition-v1.2.md](requirements-decomposition-v1.2.md)
> 状态：已完成，已归档

---

## 1. 总体设计

将 `/Users/creayma/personal/code-quality` 的源码迁移到 `legacy-shield` 的 `lib/code-quality/` 目录下，作为内部子模块运行。`quality` 子命令的入口 `lib/cli/quality.ts` 保持接口不变；底层 `lib/quality.ts` 不再 `spawn` 外部 `cli.js`，而是直接调用 `lib/code-quality/` 暴露的 API。

### 1.1 迁移目录结构

```
legacy-shield/
├── lib/
│   ├── code-quality/
│   │   ├── index.ts          # 导出 runAll / runModule / runDiff / runWatch 内部 API
│   │   ├── cli.ts            # 内部调试入口（可选，用于独立调试）
│   │   ├── lib/
│   │   │   ├── paths.ts      # 由 paths.js 迁移，路径计算
│   │   │   ├── orchestrator.ts
│   │   │   ├── runner.ts
│   │   │   ├── git-diff.ts
│   │   │   ├── ast-skeleton.ts
│   │   │   ├── llm-client.ts
│   │   │   ├── test-writer.ts
│   │   │   └── load-local-config.ts
│   │   └── configs/
│   │       ├── tsconfig.base.json   # 由 code-quality tsconfig.json 迁移
│   │       ├── eslint.config.ts     # 由 eslint.config.js 迁移
│   │       └── vitest.config.ts     # 由 vitest.config.js 迁移
│   ├── quality.ts            # 适配层：调用 lib/code-quality/index.ts
│   └── cli/quality.ts        # quality 子命令入口，接口不变
├── tests/
│   └── code-quality-generated/  # 自动生成的单测落在此稳定目录（纳入 .gitignore）
└── .gitignore                # 追加 tests/code-quality-generated/
```

### 1.2 调用关系

```
node ./dist/cli.js quality [args]
  -> lib/cli/quality.ts
    -> lib/quality.ts
      -> lib/code-quality/index.ts
        -> all / module / diff / watch 内部实现
```

---

## 2. 详细设计

### 2.1 源码迁移策略

1. **`lib/*.js` → `lib/code-quality/lib/*.ts`**
   - 保持函数签名与行为不变。
   - 路径常量重新命名并明确语义：
     - `LEGACY_SHIELD_ROOT`：指向 `legacy-shield` 项目根目录。
     - `CODE_QUALITY_DIR`：指向 `legacy-shield/lib/code-quality/`。
     - `CODE_QUALITY_TESTS_DIR`：指向 `legacy-shield/tests/code-quality-generated/`（自动生成单测落盘目录）。
   - `paths.ts` 中的镜像规则不变：`legacy/src/**/*.js` → `tests/code-quality-generated/**/*.spec.js`。

2. **配置文件迁移**
   - `tsconfig.json` → `lib/code-quality/configs/tsconfig.base.json`。
   - `eslint.config.js` → `lib/code-quality/configs/eslint.config.ts`（顶层 await 需保留；`__dirname` 基于 `lib/code-quality/configs/`）。
   - `vitest.config.js` → `lib/code-quality/configs/vitest.config.ts`：
     - 原配置在缺少 `LEGACY_PROJECT_PATH` 时直接抛错；迁移后改为：
       - 未设置 `LEGACY_PROJECT_PATH` 时，不设置 `@` alias，仅加载 `tests/code-quality-generated/` 下的 spec，确保不破坏 legacy-shield 自身 `pnpm test`；
       - 设置 `LEGACY_PROJECT_PATH` 后（由 `runner.ts` 注入），再添加 `@` → `<legacy>/src` 的 alias。

3. **测试目录稳定化**
   - 将原 code-quality `tests/`（相对 Skill 根）迁移为 `legacy-shield/tests/code-quality-generated/`。
   - 该目录仅存放自动生成的 spec，不纳入版本控制；在 `.gitignore` 中追加 `tests/code-quality-generated/`。
   - 该目录位于项目稳定位置，不受 `dist/` 清理或 `pnpm clean` 影响。

4. **TypeScript 严格模式适配**
   - legacy-shield 根 `tsconfig.json` 启用 `strict`、`noUnusedLocals`、`noUnusedParameters` 等严格选项；code-quality 原 `tsconfig.json` 为 `strict: false`。
   - 迁移后的 `.ts` 文件仍受 legacy-shield 严格模式检查，因此：
     - 对原 `.js` 中未标注类型的变量、参数、返回值统一显式标注 `any`；
     - 对无法直接满足严格模式的第三方库调用或动态导入，使用 `// @ts-expect-error` 并附注释说明；
     - 对未使用变量/参数，使用下划线前缀 `_` 或显式标注 `any` 并禁用该条规则检查（禁止直接关闭项目级严格开关）。
   - 示例：
     ```ts
     // 原 JS：function buildSkeleton(params) { ... }
     // 迁移后：
     function buildSkeleton(params: any): { skeleton: string } {
       // @ts-expect-error 原 JS 直接访问可能不存在的字段
       const ast = parse(params.sourceCode, params.options);
       return { skeleton: '' };
     }
     ```

### 2.2 `lib/code-quality/index.ts` API 设计

```ts
export interface CodeQualityAllOptions {
  projectPath: string;
  skip?: ('type-check' | 'lint' | 'test')[];
}

export interface CodeQualityModuleOptions {
  projectPath: string;
  targets: string[];
  model?: string;
}

export interface CodeQualityDiffOptions {
  projectPath: string;
  base?: string;
  model?: string;
}

export interface CodeQualityWatchOptions {
  projectPath: string;
  debounce?: number;
  model?: string;
}

export interface CodeQualityResult {
  command: string;
  code: number;
  stdout: string;
  stderr: string;
  summary: CodeQualitySummary;
}

export async function runAll(options: CodeQualityAllOptions): Promise<CodeQualityResult>;
export async function runModule(options: CodeQualityModuleOptions): Promise<CodeQualityResult>;
export async function runDiff(options: CodeQualityDiffOptions): Promise<CodeQualityResult>;
export async function runWatch(options: CodeQualityWatchOptions): Promise<CodeQualityResult>;
```

### 2.3 `lib/quality.ts` 适配层

- 移除 `spawn('node', [cliPath, ...])` 逻辑。
- 根据 `RunCodeQualityOptions` 判断调用 `runAll` / `runModule` / `runDiff`。
- `watch` 模式说明：
  - `lib/code-quality/index.ts` 导出 `runWatch` 以保留 code-quality 原 `watch` 子命令的内部能力。
  - v1.1 的 `lib/cli/quality.ts` 未暴露 `watch`，本次集成保持 CLI 参数不变，不新增 `watch` 子命令。
  - 后续如需暴露 `watch`，需单独走 MINOR 版本流程。
- `CODE_QUALITY_ROOT` 环境变量处理：
  - 若已配置，打印一次 `deprecated` 提示：`CODE_QUALITY_ROOT 已废弃，将使用 legacy-shield 内置 code-quality。`
  - 不影响运行。

### 2.4 子进程输出捕获

原 `lib/quality.ts` 通过 `spawn` 的 `stdout`/`stderr` 捕获输出。改为内部调用后：

- 方案 A（推荐）：内部 API 将子进程输出重定向到可写流或字符串数组，`lib/quality.ts` 收集后写入 `QualityLog`。
- 方案 B：保持 `stdio: 'inherit'` 直接输出到终端，`lib/quality.ts` 的 `stdout`/`stderr` 字段为空或仅记录摘要。

本次采用方案 A，确保 `QualityLog` 仍能完整记录 `code-quality` 输出，便于后续 `report` / `api` 消费。具体实现：

- `all` 内部实现将 `type-check` / `lint` / `vitest` 子进程改为 `stdio: 'pipe'`；
- 通过 `data` 事件同时写入 `process.stdout`/`process.stderr`（保持终端可见性）并累积为字符串；
- 各步骤不再调用 `process.exit()`，而是返回退出码；最终组装为 `CodeQualityResult` 返回给 `lib/quality.ts`。

### 2.5 依赖整合方案

将 `/Users/creayma/personal/code-quality/package.json` 中的依赖合并到 `legacy-shield/package.json`。合并策略如下：

1. **合并范围**：`dependencies` 与 `devDependencies` 一并合并到 `legacy-shield` 的 `devDependencies`（这些包只在 `quality` 运行时或开发测试时使用，不随 `legacy-shield` 作为库发布）。
2. **版本冲突处理**：
   - 若 legacy-shield 已存在同包，优先保留 legacy-shield 的当前版本；
   - 若 code-quality 版本更高且包含必要功能，统一升级到较高版本；
   - 若版本差异导致 `pnpm typecheck` / `pnpm test` 失败，以能全量通过为最终判定标准。
3. **新增依赖清单**：

| 包名 | code-quality 版本 | legacy-shield 当前版本 | 处理 | 说明 |
|---|---|---|---|---|
| `@babel/parser` | ^7.29.7 | ^7.26.0 | 升级到 ^7.29.7 | 解析器需与 @babel/eslint-parser 一致 |
| `@babel/traverse` | ^7.29.0 | ^7.26.0 | 升级到 ^7.29.0 | AST 遍历 |
| `@babel/core` | ^7.29.7 | 无 | 新增 | @babel/eslint-parser 依赖 |
| `@babel/eslint-parser` | ^7.29.7 | 无 | 新增 | 替换 babel-eslint |
| `@babel/types` | 无（传递依赖） | ^7.29.7 | 保留 | 已存在 |
| `@eslint/eslintrc` | ^3.3.5 | 无 | 新增 | FlatCompat |
| `@vitejs/plugin-vue` | ^6.0.7 | 无 | 新增 | Vitest 解析 .vue |
| `@vue/compiler-sfc` | ^3.5.38 | ^3.5.0 | 升级到 ^3.5.38 | SFC 编译 |
| `@vue/eslint-config-prettier` | ^9.0.0 | 无 | 新增 | Prettier 兼容 |
| `@vue/test-utils` | ^2.4.11 | 无 | 新增 | Vue 组件测试 |
| `chokidar` | ^4.0.0 | 无 | 新增 | watch 模式 |
| `commander` | ^11.0.0 | ^11.0.0 | 保留 | 版本一致 |
| `eslint` | ^9.30.0 | 无 | 新增 | ESLint 9 flat config |
| `eslint-config-prettier` | ^9.1.2 | 无 | 新增 | Prettier 兼容 |
| `eslint-plugin-import` | ^2.32.0 | 无 | 新增 | import 规则 |
| `eslint-plugin-prettier` | ^5.5.6 | 无 | 新增 | Prettier 规则 |
| `eslint-plugin-vue` | ^10.9.2 | 无 | 新增 | Vue 规则 |
| `jsdom` | ^29.1.1 | 无 | 新增 | Vitest 环境 |
| `prettier` | ^3.8.4 | 无 | 新增 | 格式检查 |
| `typescript` | ^5.4.0 | ^5.9.3 | 保留 ^5.9.3 | legacy-shield 版本更高 |
| `vitest` | ^4.1.8 | ^3.0.0 | 升级到 ^4.1.8 | code-quality 依赖 v4 API |
| `vue-tsc` | ^3.3.4 | 无 | 新增 | Vue TSC |

4. **安装步骤**：
   - 更新 `package.json` 后执行 `pnpm install`；
   - 运行 `pnpm typecheck`、`pnpm build`、`pnpm test` 验证无依赖冲突。

### 2.6 配置加载

- `.local-llm-config.js` 保留在 `legacy-shield` 根目录，由 `load-local-config.ts` 加载。
- 加载逻辑不变：显式环境变量 / CLI `--model` > `.local-llm-config.js` > 内置默认值。

---

## 3. 兼容性设计

### 3.1 CLI 参数兼容

`lib/cli/quality.ts` 的 Commander 参数定义完全保持不变：

```ts
program
  .command('quality')
  .option('--project <path>', '老项目根路径')
  .option('--target <file>', '指定扫描文件，可多次使用')
  .option('--base <ref>', 'git diff 基准')
  .option('--skip <step>', '跳过步骤，可多次使用')
  .option('--disable-rule <rule-id>', '禁用自定义规则，可多次使用')
  .option('--log-retention-days <days>', '日志保留天数')
```

### 3.2 日志结构兼容

`CodeQualityResult` 与 `CodeQualitySummary` 结构保持不变，`lib/analyzer.ts` 无需修改。

### 3.3 测试兼容

- `tests/quality.test.ts` 主要 mock `lib/quality.ts` 或验证 `runQuality` 行为，预计无需大改。
- `tests/quality.integration.test.ts` 若依赖真实 `code-quality` 进程，需改为验证内部 API 调用或端到端执行。

---

## 4. 风险与应对

| 风险 | 影响 | 应对措施 |
|---|---|---|
| `.js` → `.ts` 迁移引入类型错误 | 构建失败 | 对迁移文件启用宽松类型检查；必要时使用 `// @ts-expect-error` 或 `any` 过渡，确保 `tsc --noEmit` 通过 |
| 依赖版本冲突 | 运行时异常 | 按 2.5 节依赖整合方案统一版本；集成后全量测试 |
| ESLint flat config 路径解析变化 | lint 失败 | 改造 `eslint.config.ts` 中的 `resolvePluginsRelativeTo` 指向 `lib/code-quality/configs/` |
| 自动生成的单测路径变化 | 用户历史生成的 spec 找不到 | 文档说明新路径为 `tests/code-quality-generated/`；不保留旧路径软链（避免侵入老项目） |
| 子进程输出捕获不完整 | QualityLog 丢失信息 | 方案 A 内部 API 统一返回 stdout/stderr 字符串 |
| 测试目录被误清理 | 自动生成 spec 丢失 | 使用 `tests/code-quality-generated/` 并纳入 `.gitignore`，与 `dist/` 分离 |

---

## 5. 验收标准

1. `lib/code-quality/` 目录完整包含迁移后的源码与配置。
2. `tests/code-quality-generated/` 已纳入 `.gitignore`，作为自动生成 spec 的稳定落盘目录。
3. `lib/quality.ts` 不再使用 `spawn` 调用外部进程。
4. `pnpm typecheck`、`pnpm build`、`pnpm test` 全量通过。
5. `node ./dist/cli.js quality --project <legacy>` 在未配置 `CODE_QUALITY_ROOT` 时正常工作。
6. 配置 `CODE_QUALITY_ROOT` 时打印一次性废弃提示且运行正常。
7. `README.md`、`docs/usage.md` 已移除 `CODE_QUALITY_ROOT` 说明。
