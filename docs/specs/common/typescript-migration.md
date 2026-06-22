# legacy-shield TypeScript 迁移专项 Spec

> 文档版本：v1.0
> 对应需求文档：[requirements.md](./requirements.md)
> 对应设计文档：[design.md](./design.md)
> 对应执行计划：[execution-plan.md](./execution-plan.md)
> 状态：已通过评审并实施

---

## 1. 目标与范围

### 1.1 目标

将 `legacy-shield` 自身工程从 JavaScript 迁移到 TypeScript，在保持现有需求/设计/阶段规划不变的前提下：

- 所有源码使用 TypeScript 编写，类型覆盖完整。
- 通过 `tsc` 编译输出到 `dist/`，运行时只使用 `dist/` 产物。
- 启用 `strict: true`，生成 `.d.ts` 声明文件。
- 所有既有功能（shield / quality / report / api）在迁移后行为不变。

### 1.2 范围

**必须迁移的文件**：

| 原路径 | 新路径 | 说明 |
|---|---|---|
| `cli.js` | `cli.ts` | CLI 主入口 |
| `bin/cli.js` | `bin/cli.ts` | 可选可执行入口（保持与根入口一致） |
| `lib/utils.js` | `lib/utils.ts` | 通用工具函数 |
| `lib/logger.js` | `lib/logger.ts` | JSONL 日志服务 |
| `lib/proxy.js` | `lib/proxy.ts` | HTTP 反向代理 |
| `lib/browser.js` | `lib/browser.ts` | Playwright 浏览器监控 |
| `lib/inject.iife.js` | `lib/inject.iife.ts` | 浏览器注入脚本（TS 源文件，编译后仍为 IIFE） |
| `lib/analyzer.js` | `lib/analyzer.ts` | 日志分析引擎 |
| `lib/reporter.js` | `lib/reporter.ts` | 报告生成器 |
| `lib/api.js` | `lib/api.ts` | REST API 服务 |
| `lib/quality.js` | `lib/quality.ts` | code-quality 调用封装 |
| `lib/cli/shield.js` | `lib/cli/shield.ts` | shield 子命令编排 |
| `lib/cli/quality.js` | `lib/cli/quality.ts` | quality 子命令编排 |
| `lib/cli/report.js` | `lib/cli/report.ts` | report 子命令编排 |
| `lib/cli/api.js` | `lib/cli/api.ts` | api 子命令编排 |
| `lib/custom-rules/index.js` | `lib/custom-rules/index.ts` | 自定义规则入口 |
| `lib/custom-rules/scanner.js` | `lib/custom-rules/scanner.ts` | AST 扫描器 |
| `lib/custom-rules/rules/*.js` | `lib/custom-rules/rules/*.ts` | 4 条 MVP 规则 |
| `tests/*.test.js` | `tests/*.test.ts` | 单元与集成测试（含阶段 2~4 定义的所有测试文件） |
| `tests/e2e/*.test.js` | `tests/e2e/*.test.ts` | E2E / 边界 / 性能测试 |

**新增配置文件**：

- `tsconfig.json`：生产源码编译配置。
- `tsconfig.test.json`：测试文件类型检查配置（`noEmit: true`）。

**必须更新的文件**：

- `package.json`：依赖、脚本、`bin` 入口。
- `.gitignore`：忽略 `dist/`。

**不修改的文件**：

- `docs/specs/requirements.md`
- `docs/specs/design.md`
- `docs/specs/execution-plan.md`
- `docs/specs/phases/phase-1-spec.md` ~ `phase-5-spec.md`

这些文档中的功能需求、数据 schema、接口语义继续有效；本 spec 只补充 TypeScript 工程约束。

> **注意**：`bin/cli.ts` 作为可选可执行入口，仅 re-export 根 `cli.ts` 的导出，不重复实现 CLI 逻辑：
>
> ```ts
> // bin/cli.ts
> export * from '../cli.js';
> export { default } from '../cli.js';
> ```
>
> `package.json` 的 `bin` 字段仍指向根入口产物 `./dist/cli.js`。

---

## 2. 设计决策

### 2.1 编译模型

- 使用官方 `typescript` 作为唯一编译工具，不引入 `tsx`、`swc`、`esbuild` 等额外运行时/构建依赖。
- 源码使用 `NodeNext` 模块系统，与项目现有 `"type": "module"` 保持一致。
- 相对导入必须带 `.js` 扩展名（例如 `import { foo } from './utils.js'`），`tsc` 在编译时会解析到对应的 `.ts` 源文件，并在输出中保留 `.js`。
- 产物目录 `dist/` 与源码目录完全隔离；`package.json`、`tsconfig.json`、测试文件均不进入 `dist/`。

### 2.2 类型输出

- `declaration: true`、`declarationMap: true`、`sourceMap: true`。
- `.d.ts` 与 `.js` 同目录输出，不单独设置 `declarationDir`。
- 测试文件不参与产物输出，仅做类型检查（通过 `tsconfig.test.json`）。

### 2.3 严格度

- `strict: true` 开启所有严格类型检查。
- 额外开启：
  - `noUnusedLocals: true`
  - `noUnusedParameters: true`
  - `noImplicitReturns: true`
  - `noFallthroughCasesInSwitch: true`
  - `isolatedModules: true`
  - `forceConsistentCasingInFileNames: true`
- 禁止显式使用 `any`；解析外部 JSON 时使用泛型 `unknown`，由调用方负责类型守卫或断言。

### 2.4 运行时产物路径约定

- 运行时所有模块都从 `dist/` 加载。
- `bin` 入口：`./dist/cli.js`。
- `lib/browser.ts` 在运行时读取的注入脚本路径为 `dist/lib/inject.iife.js`（通过 `import.meta.url` 相对解析）。

---

## 3. 类型规范

### 3.1 共享类型入口

新增 `lib/types.ts`，集中定义日志、规则、配置等公共类型。各模块通过命名导入使用，避免类型重复定义。

核心类型示例（最终代码需与 `requirements.md` schema 保持一致）：

```ts
// lib/types.ts

import type { Visitor } from '@babel/traverse';

export type LogLevel = 'error' | 'warn' | 'info';

export type RuntimeSubType =
  | 'js-error'
  | 'promise-rejection'
  | 'resource-error'
  | 'console-error'
  | 'console-warn'
  | 'console-info'
  | 'console-log'
  | 'vue-render-error'
  | 'react-render-error';

export type BehaviorSubType =
  | 'click'
  | 'input'
  | 'change'
  | 'submit'
  | 'keydown'
  | 'keyup'
  | 'scroll'
  | 'route-change'
  | 'visibility-change';

export type NetworkSubType = 'xhr' | 'fetch' | 'static-resource' | 'proxy-error' | 'unknown';

export type QualitySubType = 'code-quality' | 'custom-rule';

export interface RuntimeLog {
  type: 'runtime';
  subType: RuntimeSubType;
  sessionId: string;
  errorId?: string;
  timestamp: string;
  level: LogLevel;
  url: string;
  userAgent: string;
  message: string;
  stack?: string;
  source?: string;
  line?: number;
  column?: number;
  context?: Record<string, unknown>;
}

export interface NetworkRequestRecord {
  headers: Record<string, string | string[] | undefined>;
  redactedHeaders: string[];
  body: string | null;
  bodySize: number;
  bodyTruncated: boolean;
  bodyEncoding?: 'utf8' | 'base64' | null;
}

export interface NetworkResponseRecord {
  status: number;
  statusText: string;
  headers: Record<string, string | string[] | undefined>;
  redactedHeaders: string[];
  body: string | null;
  bodySize: number;
  bodyTruncated: boolean;
  bodyEncoding?: 'utf8' | 'base64' | null;
}

export interface NetworkLog {
  type: 'network';
  subType: NetworkSubType;
  sessionId: string;
  timestamp: string;
  level: LogLevel;
  requestId: string;
  method: string;
  url: string;
  request: NetworkRequestRecord;
  response: NetworkResponseRecord;
  durationMs: number;
  pageUrl: string | null;
}

export interface BehaviorTarget {
  tagName: string;
  selector: string | null;
  text?: string;
  className?: string;
  id?: string;
}

export interface BehaviorLog {
  type: 'behavior';
  subType: BehaviorSubType;
  sessionId: string;
  timestamp: string;
  level: 'info';
  sequence: number;
  pageUrl: string;
  target: BehaviorTarget | null;
  payload: Record<string, unknown>;
  coordinates: { x: number; y: number } | null;
}

export interface QualityLog {
  type: 'quality';
  subType: QualitySubType;
  sessionId: string;
  timestamp: string;
  level: LogLevel;
  command?: string;
  code?: number;
  stdout?: string;
  stderr?: string;
  summary?: Record<string, unknown>;
  customRuleHits?: RuleHit[];
}

export type ShieldLog = RuntimeLog | NetworkLog | BehaviorLog | QualityLog;

export interface RuleHit {
  ruleId: string;
  ruleName: string;
  filePath: string;
  line: number;
  column: number;
  message: string;
  severity: 'error' | 'warning';
}

> **与阶段 3 spec 的对齐**：阶段 3 spec 中 `runCustomRules` 的 `summary` 统计逻辑若使用 `severity === 'warn'`，需同步修正为 `severity === 'warning'`，以匹配本 spec 的类型定义。

export interface ShieldRule {
  id: string;
  name: string;
  severity: 'error' | 'warning';
  description: string;
  visitor: (hits: RuleHit[], filePath: string) => Visitor;
}

export interface Logger {
  logRuntime(subType: RuntimeSubType, detail: Partial<Omit<RuntimeLog, 'type' | 'subType' | 'sessionId' | 'timestamp' | 'level'>>, level?: LogLevel): void;
  logNetwork(detail: Partial<Omit<NetworkLog, 'type' | 'sessionId' | 'timestamp'>>): void;
  logBehavior(detail: Partial<Omit<BehaviorLog, 'type' | 'sessionId' | 'timestamp' | 'level'>>): void;
  logQuality(detail: Partial<Omit<QualityLog, 'type' | 'sessionId' | 'timestamp'>>): void;
  close(): void;
}
```

### 3.2 函数签名规范

- 所有 `export` 函数必须显式声明返回类型。
- 选项对象统一使用 `interface` 命名，例如 `StartProxyOptions`、`StartBrowserOptions`。
- 回调/事件处理函数参数类型必须明确。
- 尽量使用 `readonly` 数组和元组。

### 3.3 JSON 解析类型

`safeJsonParse` 改为泛型函数：

```ts
export function safeJsonParse<T = unknown>(str: string): T | null {
  try {
    return JSON.parse(str) as T;
  } catch {
    return null;
  }
}
```

`readJsonl` 默认返回 `unknown[]`，调用方使用类型断言或守卫转换为具体日志类型。

### 3.4 AST 扫描器运行时兼容

`@babel/traverse` 的 ESM/CJS 导出在不同版本中存在差异，运行时导入需保留 `default || 命名空间` 兼容逻辑。TypeScript 下不得使用 `any`，推荐写法：

```ts
// lib/custom-rules/scanner.ts
import _traverse from '@babel/traverse';

const traverse: typeof _traverse =
  typeof _traverse === 'function'
    ? _traverse
    : (_traverse as unknown as { default: typeof _traverse }).default;
```

该写法在 `strict: true` 下可通过类型检查，且不引入显式 `any`。

---

## 4. 工程配置

### 4.1 tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": [
    "cli.ts",
    "bin/**/*.ts",
    "lib/**/*.ts"
  ],
  "exclude": [
    "node_modules",
    "dist",
    "tests"
  ]
}
```

### 4.2 tsconfig.test.json

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": true
  },
  "include": [
    "cli.ts",
    "bin/**/*.ts",
    "lib/**/*.ts",
    "tests/**/*.ts"
  ],
  "exclude": [
    "node_modules",
    "dist"
  ]
}
```

### 4.3 package.json 变更

新增/修改的字段：

```json
{
  "bin": {
    "legacy-shield": "./dist/cli.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "clean": "node -e \"import('node:fs').then(fs => fs.rmSync('dist', { recursive: true, force: true }))\"",
    "typecheck": "tsc --noEmit && tsc -p tsconfig.test.json --noEmit",
    "shield": "node ./dist/cli.js shield",
    "quality": "node ./dist/cli.js quality",
    "report": "node ./dist/cli.js report",
    "api": "node ./dist/cli.js api",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "@babel/parser": "^7.26.0",
    "@babel/traverse": "^7.26.0",
    "@types/babel__traverse": "^7.20.0",
    "@types/http-proxy": "^1.17.0",
    "@types/node": "^22.0.0",
    "@vue/compiler-sfc": "^3.5.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

说明：

- `typescript` 版本使用当前 Node 20 ESM 稳定支持的 5.x 主线。
- `@types/http-proxy` 补充 `http-proxy` 缺失的类型。
- `@types/babel__traverse` 补充 `@babel/traverse` 的 Visitor 类型精度。
- 运行任何子命令前需先执行 `pnpm build`；`dev` 脚本可用于开发时持续编译。
- 开发前建议先执行 `pnpm clean`，避免 `tsc --watch` 保留已删除/重命名文件的历史产物。
- Vitest 原生支持 TypeScript 测试；测试文件中导入源码仍使用 `.js` 扩展名（如 `import { foo } from '../lib/foo.js'`），Vitest 运行时通过 Node ESM 解析到 `dist/` 产物，类型检查由 TypeScript 通过 `NodeNext` 解析到 `.ts` 源文件。

### 4.4 .gitignore 变更

在原有内容基础上追加：

```
/dist/
```

---

## 5. inject.iife.ts 特殊处理

### 5.1 源文件形式

`lib/inject.iife.ts` 以 TypeScript 模块形式编写，文件顶层是一个立即执行函数表达式：

```ts
/// <reference lib="dom" />

(function shieldInject(): void {
  if ((window as unknown as Record<string, unknown>).__SHIELD_INJECTED__) return;
  (window as unknown as Record<string, unknown>).__SHIELD_INJECTED__ = true;

  // ...
})();
```

### 5.2 类型隔离

- 该文件顶部使用 `/// <reference lib="dom" />` 引入 DOM 类型，不污染全局 `tsconfig.json`。
- 自定义全局属性通过模块内 `declare global` 声明：

```ts
declare global {
  interface Window {
    __SHIELD_SESSION_ID__?: string;
    __SHIELD_ENABLE_REACT_PATCH__?: boolean;
    __shield_emit__?: (event: ShieldEmitEvent) => void;
  }
}
```

### 5.3 运行时产物

- `tsc` 编译后输出 `dist/lib/inject.iife.js`。
- `lib/browser.ts` 运行时通过 `fileURLToPath(new URL('inject.iife.js', import.meta.url))` 读取 `dist/lib/inject.iife.js`，而不是源码路径。

---

## 6. 编码规范

### 6.1 导入导出

- 使用 ESM `import` / `export`。
- 优先使用命名导出；默认导出仅在规则文件等确实需要时允许。
- 相对路径必须带 `.js` 扩展名（运行时产物扩展名）。

### 6.2 命名规范

- 文件/目录命名保持现有小写中横线风格。
- 类型/接口使用 PascalCase。
- 函数与变量使用 camelCase。
- 常量使用 UPPER_SNAKE_CASE。

### 6.3 错误与边界

- 所有可能为 `null` / `undefined` 的外部输入必须显式处理。
- 异步函数返回 `Promise<T>`，错误通过 `throw` 或返回错误结果对象。
- 子进程、文件系统、网络等系统边界必须带类型化的错误处理。

### 6.4 注释

- 关键类型、非直观边界、复杂正则处保留中文注释。
- 不在代码中添加 TODO / 占位注释；未实现功能应在本 spec 或对应阶段 spec 中追踪，而不是代码里。

---

## 7. 迁移步骤

### 步骤 1：工程配置

1. 安装 TypeScript 与类型包：
   ```bash
   pnpm add -D typescript @types/http-proxy @types/babel__traverse
   ```
2. 创建 `tsconfig.json` 与 `tsconfig.test.json`。
3. 更新 `package.json` 的 `bin`、`scripts`、`devDependencies`。
4. 更新 `.gitignore` 忽略 `dist/`。

### 步骤 2：类型骨架

1. 创建 `lib/types.ts`，定义公共日志、规则、配置类型。
2. 创建 `lib/custom-rules/rules/index.ts`，导出规则映射。
3. 将既有占位 `.js` 文件重命名为 `.ts`，保留占位内容。

### 步骤 3：核心工具类型化

1. 将 `lib/utils.ts` 按本 spec 类型规范实现，确保 `pnpm test` 中的 `tests/utils.test.ts` 通过。
2. 将 `tests/utils.test.js` 重命名为 `tests/utils.test.ts`，更新导入路径扩展名。

### 步骤 4：按阶段实现模块

按 `execution-plan.md` 的阶段顺序，依次实现并类型化：

1. 阶段 2：`lib/logger.ts`、`lib/proxy.ts`、`lib/inject.iife.ts`、`lib/browser.ts`、`lib/cli/shield.ts`、`cli.ts`。
2. 阶段 3：`lib/quality.ts`、`lib/custom-rules/*.ts`、规则文件、`lib/cli/quality.ts`。
3. 阶段 4：`lib/analyzer.ts`、`lib/reporter.ts`、`lib/api.ts`、`lib/cli/report.ts`、`lib/cli/api.ts`。
4. 阶段 5：`tests/e2e/*.test.ts`。

### 步骤 5：构建与自检

1. 运行 `pnpm clean && pnpm build`，产物输出到 `dist/`。
2. 运行 `pnpm typecheck`，源码与测试均无类型错误。
3. 运行 `pnpm test`，测试通过。
4. 运行 `node ./dist/cli.js --help` 验证 CLI 入口。

---

## 8. 验收标准

### 8.1 工程层面

- [ ] `tsconfig.json` 与 `tsconfig.test.json` 存在且配置正确。
- [ ] `pnpm build` 成功，输出目录为 `dist/`，包含 `.js`、`.d.ts`、`.js.map`、`.d.ts.map`。
- [ ] `pnpm typecheck` 成功，源码与测试均无类型错误。
- [ ] `dist/` 被 `.gitignore` 忽略。
- [ ] `package.json` 的 `bin` 指向 `./dist/cli.js`。

### 8.2 代码层面

- [ ] 所有源码文件扩展名为 `.ts`（除编译产物外）。
- [ ] 无显式 `any` 类型：执行 `grep -R '\bany\b' lib tests cli.ts bin/cli.ts` 无匹配，且 `pnpm typecheck` 无类型错误。
- [ ] 所有 `export` 函数具有显式返回类型。
- [ ] 相对导入均带 `.js` 扩展名。
- [ ] `lib/types.ts` 定义了所有公共日志与规则类型。

### 8.3 运行层面

- [ ] `node ./dist/cli.js --help` 正常输出。
- [ ] `node ./dist/cli.js shield --help` 正常输出。
- [ ] `pnpm test` 通过。
- [ ] `lib/browser.ts` 能正确加载 `dist/lib/inject.iife.js`。

### 8.4 向后兼容

- [ ] 日志 schema、CLI 参数、API 端点与 `requirements.md` / `design.md` 保持一致。
- [ ] 老项目 `.runtime-log-ignore/` 目录结构与之前一致。

---

## 9. 风险与应对

| 风险 | 影响 | 应对措施 |
|---|---|---|
| `@babel/traverse` 类型不完整 | 中 | 补充 `@types/babel__traverse`，必要时为访问器函数显式标注类型 |
| `http-proxy` 类型缺失 | 中 | 补充 `@types/http-proxy` |
| `inject.iife.ts` DOM 类型污染 Node 模块 | 低 | 使用 `/// <reference lib="dom" />` 隔离 |
| 严格模式导致既有测试/实现大量报错 | 中 | 分阶段迁移：先核心工具，再监控链路，再质量/分析 |
| `dist/` 产物路径与源码引用不一致 | 中 | 所有运行时路径通过 `import.meta.url` 相对解析 |

---

## 10. 依赖关系

- **前置依赖**：阶段 1 工程骨架已完成；`lib/utils.js` 已可用。
- **后续依赖**：所有后续代码实现必须遵循本 spec 的类型、模块、构建约定。
