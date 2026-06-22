# legacy-shield 阶段 3 详细 Spec：质量保障与自定义规则

> 文档版本：v1.0
> 对应需求文档：[requirements.md](../requirements.md)
> 对应设计文档：[design.md](../design.md)
> 对应执行计划：[execution-plan.md](../execution-plan.md) 阶段 3
> 状态：已完成 / 已归档（冻结，不再修改）

---

## 1. 阶段目标

实现 legacy-shield 的提交前质量保障能力，包括复用 code-quality 执行类型检查/ESLint/Vitest/测试生成，以及实现基于 AST 的自定义规则扫描。阶段结束时，用户可以通过 `node ./dist/cli.js quality` 执行全量质量检查，并将结果写入老项目的 `.runtime-log-ignore/quality/` 目录。

### 1.1 阶段交付物

| 交付物 | 路径 | 说明 |
|---|---|---|
| 质量保障模块 | `lib/quality.ts` | 调用 code-quality 并汇总结果 |
| AST 扫描器 | `lib/custom-rules/scanner.ts` | 文件遍历与 AST 解析框架 |
| 规则注册器 | `lib/custom-rules/index.ts` | 规则加载与配置接口 |
| 危险 API 规则 | `lib/custom-rules/rules/no-dangerous-apis.ts` | SHIELD-001 |
| 大循环规则 | `lib/custom-rules/rules/no-large-loops.ts` | SHIELD-002 |
| 昂贵 Watcher 规则 | `lib/custom-rules/rules/no-expensive-watcher.ts` | SHIELD-003 |
| 循环内同步存储规则 | `lib/custom-rules/rules/no-sync-storage-in-loop.ts` | SHIELD-004 |
| quality 子命令 | `lib/cli/quality.ts` | quality 子命令编排 |
| 集成测试 | `tests/quality.integration.test.ts` | quality 命令端到端测试 |

> 说明：本阶段所有源码文件使用 `.ts` 后缀；构建后输出到 `dist/`，CLI 运行时通过 `node ./dist/cli.js quality` 调用。运行示例命令前需先执行 `pnpm build`。

### 1.2 阶段边界

- **范围内**：调用 code-quality、自定义 AST 规则扫描、quality 子命令编排。
- **范围外**：运行时监控、报告生成、API 服务。

---

## 2. 任务 3.1：实现 `lib/quality.ts`

### 2.1 目标

封装对 code-quality 的调用，支持 `all`/`module`/`diff` 三种模式，并返回结构化结果。

### 2.2 输入

```ts
export interface RunCodeQualityOptions {
  targets?: string[];
  base?: string;
  skipList?: string[];
}

export async function runCodeQuality(
  legacyRoot: string,
  options: RunCodeQualityOptions,
): Promise<CodeQualityResult>
```

- `legacyRoot`：老项目根路径。
- `options.targets`：字符串数组，指定文件列表。
- `options.base`：git diff 基准 ref。
- `options.skipList`：要跳过的步骤数组（`type-check`、`lint`、`test`）。
- 环境变量 `CODE_QUALITY_ROOT`：覆盖 code-quality 根路径（默认 `/Users/creayma/personal/code-quality`）。

### 2.3 输出

返回对象类型：

```ts
export interface CodeQualitySummary {
  exitCode: number;
  testStatus: 'passed' | 'failed' | 'unknown';
  eslintIssueCount: number;
  typeCheckStatus: 'passed' | 'failed' | 'skipped' | 'unknown';
}

export interface CodeQualityResult {
  command: string;
  code: number;
  stdout: string;
  stderr: string;
  legacyRoot: string;
  executedAt: string;
  summary: CodeQualitySummary;
}
```

`runCodeQuality` 需解析 `stdout` 提取测试状态、ESLint 问题数、类型检查状态，存入 `summary`。

> 类型说明：上述接口需同步写入 `lib/types.ts`。

### 2.4 stdout 解析规则

`code-quality` 的 `stdout` 按固定分隔线输出摘要，解析逻辑如下：

```js
function parseSummary(stdout) {
  const summary = {
    exitCode: 0,
    testStatus: 'unknown',
    eslintIssueCount: 0,
    typeCheckStatus: 'unknown'
  };

  // 测试状态：匹配 Vitest 输出或自定义测试摘要
  if (/Tests\s+\d+\s+passed|test passed|Tests passed/i.test(stdout)) {
    summary.testStatus = 'passed';
  } else if (/Tests\s+\d+\s+failed|test failed|Tests failed/i.test(stdout)) {
    summary.testStatus = 'failed';
  }

  // ESLint 问题数：匹配 "X problems" 或 "X errors" 或 "X warnings"
  const problemMatch = stdout.match(/(\d+) problem/i);
  if (problemMatch) summary.eslintIssueCount = parseInt(problemMatch[1], 10);

  // 类型检查状态：匹配 "Type check passed" / "Type check failed" / "type-check skipped"
  if (/Type check passed|type-check passed/i.test(stdout)) {
    summary.typeCheckStatus = 'passed';
  } else if (/Type check failed|type-check failed/i.test(stdout)) {
    summary.typeCheckStatus = 'failed';
  } else if (/type-check skipped|--skip type-check/i.test(stdout)) {
    summary.typeCheckStatus = 'skipped';
  }

  return summary;
}
```

> 说明：若 code-quality 后续提供结构化 JSON 摘要，应优先解析 JSON 并回退到正则匹配。

### 2.5 调用矩阵

| 用户参数 | 调用 code-quality 命令 |
|---|---|
| 无 `--target` / `--base` | `all --project <legacy-root>` |
| `--target a.js --target b.js` | `module --project <legacy-root> --target a.js --target b.js` |
| `--base origin/main` | `diff --project <legacy-root> --base origin/main` |

### 2.6 实现步骤

1. 读取 `CODE_QUALITY_ROOT` 环境变量，默认 `/Users/creayma/personal/code-quality`。
2. 校验 code-quality 路径存在且包含 `cli.js`。
3. 根据 `targets` / `base` 选择子命令。
4. 使用 `spawn` 执行 `node ${CODE_QUALITY_ROOT}/cli.js <command> --project <legacyRoot> ... --skip <step> --skip <step> ...`。`skipList` 中每个元素对应一个独立的 `--skip` 参数。
5. 捕获 stdout、stderr、退出码。
6. 返回结构化结果。

### 2.7 错误处理

- code-quality 路径不存在：提示配置 `CODE_QUALITY_ROOT`。
- code-quality 未安装依赖：提示先 `pnpm install`。
- 子进程退出码非零：保留 code，由调用方决定是否返回非零退出码。

### 2.8 验收标准

- [ ] 调用 `node ./dist/cli.js quality --project <legacy>` 能执行 code-quality `all`。
- [ ] `node ./dist/cli.js quality --target src/foo.js` 调用 code-quality `module`。
- [ ] `node ./dist/cli.js quality --base origin/main` 调用 code-quality `diff`。
- [ ] code-quality 结果写入 `<legacy>/.runtime-log-ignore/quality/YYYY-MM-DD.jsonl`。
- [ ] `--skip type-check` 等参数正确透传。

### 2.9 测试用例

```ts
// tests/quality.test.ts
import { describe, it, expect } from 'vitest';
import { runCodeQuality } from '../lib/quality.js';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('quality', () => {
  let fakeLegacy;

  beforeEach(() => {
    fakeLegacy = mkdtempSync(join(tmpdir(), 'shield-quality-'));
    mkdirSync(join(fakeLegacy, 'src'));
    writeFileSync(join(fakeLegacy, 'package.json'), JSON.stringify({ name: 'fake-legacy' }));
  });

  afterEach(() => {
    rmSync(fakeLegacy, { recursive: true, force: true });
  });

  it('returns structured result for all mode', async () => {
    const result = await runCodeQuality(fakeLegacy, {});
    expect(result.command).toBe('all');
    expect(typeof result.code).toBe('number');
    expect(typeof result.stdout).toBe('string');
    expect(result.summary).toBeDefined();
  });

  it('selects module mode when targets provided', async () => {
    const result = await runCodeQuality(fakeLegacy, { targets: ['src/App.vue'] });
    expect(result.command).toBe('module');
  });

  it('selects diff mode when base provided', async () => {
    const result = await runCodeQuality(fakeLegacy, { base: 'origin/main' });
    expect(result.command).toBe('diff');
  });
});
```

---

## 3. 任务 3.2：实现 `lib/custom-rules/scanner.ts`

### 3.1 目标

实现 AST 扫描器基础框架，支持遍历老项目源码并应用自定义规则。

### 3.2 输入

```ts
export interface ScanOptions {
  include?: string[];
  exclude?: string[];
}

export async function scanFiles(
  legacyRoot: string,
  ruleName: string,
  options?: ScanOptions,
): Promise<RuleHit[]>
```

- `legacyRoot`：老项目根路径。
- `ruleName`：规则名称，对应 `lib/custom-rules/rules/` 下的文件。
- `options.include`：字符串数组，要扫描的扩展名（默认 `['.js','.jsx','.ts','.tsx','.vue']`）。
- `options.exclude`：字符串数组，要排除的目录（默认 `['node_modules','dist','build','.runtime-log-ignore']`）。

### 3.3 输出

返回命中数组：

```ts
[
  {
    ruleId: 'SHIELD-001',
    ruleName: 'no-dangerous-apis',
    filePath: '/abs/path/src/app.js',
    line: 12,
    column: 3,
    message: '发现 eval 调用',
    severity: 'error'
  }
]
```

### 3.4 文件解析策略

- `.js`、`.jsx`、`.ts`、`.tsx`：使用 `@babel/parser`，插件包含 `jsx`、`typescript`。
- `.vue`：使用 `@vue/compiler-sfc` 提取 `descriptor.script?.content` 或 `descriptor.scriptSetup?.content`，再用 `@babel/parser` 解析。若 `descriptor.script?.lang === 'ts'` 或 `descriptor.scriptSetup?.lang === 'ts'`，解析插件需追加 `typescript`。

### 3.5 遍历策略

1. 使用 `fs.readdirSync` 递归遍历 `legacyRoot`。
2. 排除 `exclude` 中的目录。
3. 仅处理 `include` 中的扩展名。
4. 对每个文件调用 `scanFile(filePath, ruleName)`。
5. 汇总所有命中结果。

### 3.6 `scanFile(filePath, ruleName)` 实现

```ts
import { readFile } from 'node:fs/promises';
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import { parse as parseSFC } from '@vue/compiler-sfc';
import { RULE_IMPLEMENTATIONS } from './rules/index.js';

const traverse = typeof _traverse === 'function' ? _traverse : (_traverse as unknown as { default: typeof _traverse }).default;

export async function scanFile(filePath: string, ruleName: string): Promise<RuleHit[]> {
  const code = await readFile(filePath, 'utf8');
  let ast;
  if (filePath.endsWith('.vue')) {
    const { descriptor } = parseSFC(code);
    const script = descriptor.script?.content || descriptor.scriptSetup?.content;
    const isTs = descriptor.script?.lang === 'ts' || descriptor.scriptSetup?.lang === 'ts';
    if (!script) return [];
    ast = parse(script, { sourceType: 'module', plugins: isTs ? ['jsx', 'typescript'] : ['jsx'] });
  } else {
    ast = parse(code, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
  }

  const hits: RuleHit[] = [];
  const rule = RULE_IMPLEMENTATIONS[ruleName];
  if (!rule) throw new Error(`未知规则: ${ruleName}`);
  traverse(ast, rule.visitor(hits, filePath));
  return hits;
}
```

### 3.7 错误处理

- 文件读取失败：记录警告，跳过该文件。
- 解析失败：记录警告，跳过该文件。
- 规则不存在：抛出错误。

### 3.8 验收标准

- [ ] 能扫描老项目 src 下所有支持扩展名文件。
- [ ] 能正确解析 Vue SFC 的 script 部分。
- [ ] 返回结果包含 filePath 和 line。
- [ ] 排除 node_modules/dist 目录。

### 3.9 测试用例

```ts
// tests/scanner.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { scanFiles } from '../lib/custom-rules/scanner.js';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('scanner', () => {
  let dir;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'shield-scan-'));
    mkdirSync(join(dir, 'src'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('scans js file with eval', async () => {
    writeFileSync(join(dir, 'src', 'app.js'), 'eval("1+1");');
    const hits = await scanFiles(dir, 'no-dangerous-apis');
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0].ruleName).toBe('no-dangerous-apis');
  });

  it('scans vue file script', async () => {
    writeFileSync(join(dir, 'src', 'App.vue'), `
      <template><div></div></template>
      <script>
        eval("x");
      </script>
    `);
    const hits = await scanFiles(dir, 'no-dangerous-apis');
    expect(hits.some(h => h.filePath.endsWith('App.vue'))).toBe(true);
  });

  it('excludes node_modules', async () => {
    mkdirSync(join(dir, 'node_modules'));
    writeFileSync(join(dir, 'node_modules', 'evil.js'), 'eval("x");');
    const hits = await scanFiles(dir, 'no-dangerous-apis');
    expect(hits.some(h => h.filePath.includes('node_modules'))).toBe(false);
  });
});
```

---

## 4. 任务 3.3：实现 4 条 MVP 自定义规则

### 4.1 目标

覆盖常见安全和性能反模式。

### 4.2 规则清单

#### 4.2.1 SHIELD-001 `no-dangerous-apis`

**严重级别**：`error`

**检测模式**：
- `eval(...)`
- `new Function(...)`
- `element.innerHTML = ...`
- `document.write(...)`

**实现提示**：
- `eval` 和 `new Function` 通过 `CallExpression` / `NewExpression` 检测。
- `innerHTML = ...` 通过 `AssignmentExpression` 检测左值为 `MemberExpression` 且 property 为 `innerHTML`。
- `document.write(...)` 通过 `CallExpression` 检测 callee 为 `document.write`。

**命中消息**：
- `发现 eval 调用`
- `发现 new Function 调用`
- `发现 innerHTML 赋值`
- `发现 document.write 调用`

#### 4.2.2 SHIELD-002 `no-large-loops`

**严重级别**：`warning`

**检测模式（MVP 启发式）**：
- `for` / `while` 循环体中无 `break`、无 `return`、无 `throw` 等早期退出。
- 且循环条件涉及数组长度（如 `i < arr.length`）。

> 说明：本规则在 MVP 阶段将“大循环”简化为“遍历整个数组且无早期退出”的循环。该启发式用于发现潜在的性能热点，可能存在误报；后续阶段可引入常量阈值、调用图分析等手段降低误报。

**实现提示**：
- 遍历 `ForStatement`、`WhileStatement`。
- 检查循环体 AST 中是否存在 `BreakStatement`、`ReturnStatement`、`ThrowStatement`。
- 检查测试条件中是否包含 `MemberExpression` 且 property 为 `length`。

**命中消息**：
- `发现可能无 break 的大循环（遍历数组长度且无早期退出）`

#### 4.2.3 SHIELD-003 `no-expensive-watcher`

**严重级别**：`warning`

**检测模式**：
- Vue `watch` 第一个参数为对象字面量或深层属性链。
- 或监听数组但未使用 `shallow: true`。

**实现提示**：
- 检测 `watch(source, callback, options)` 调用。
- 如果 `source` 是 `ObjectExpression` 或深层 `MemberExpression`（深度 >= 2），命中。深度按 `MemberExpression` 嵌套层数计算，例如 `a.b.c` 为深度 2（`a.b` 深度 1，再取 `.c` 深度 2）。
- 如果 `source` 是数组字面量且 `options` 中无 `shallow: true`，命中。

**命中消息**：
- `发现昂贵的 Vue watcher（监听大对象/深层属性链/数组未 shallow）`

#### 4.2.4 SHIELD-004 `no-sync-storage-in-loop`

**严重级别**：`error`

**检测模式**：
- 循环体内部调用 `localStorage.getItem/setItem/removeItem` 或 `sessionStorage.getItem/setItem/removeItem`。

**实现提示**：
- 遍历 `ForStatement`、`WhileStatement`、`DoWhileStatement`。
- 在循环体中查找 `CallExpression`，callee 为 `localStorage.xxx` 或 `sessionStorage.xxx`。

**命中消息**：
- `发现循环内 localStorage/sessionStorage 同步读写`

### 4.3 规则统一结构

每条规则导出：

```ts
export default {
  id: 'SHIELD-001',
  name: 'no-dangerous-apis',
  severity: 'error',
  description: '检测 eval、new Function、innerHTML、document.write',
  visitor: (hits: RuleHit[], filePath: string) => ({
    CallExpression(path) {
      // 检测逻辑
      hits.push({ ruleId: 'SHIELD-001', ruleName: 'no-dangerous-apis', filePath, line: path.node.loc.start.line, column: path.node.loc.start.column, message: '...', severity: 'error' });
    }
  })
};
```

> `severity` 取值统一为 `'error' | 'warning'`，与 `lib/types.ts` 中的 `RuleHit.severity` 保持一致。

### 4.4 规则注册

`lib/custom-rules/rules/index.ts`：

```ts
import noDangerousApis from './no-dangerous-apis.js';
import noLargeLoops from './no-large-loops.js';
import noExpensiveWatcher from './no-expensive-watcher.js';
import noSyncStorageInLoop from './no-sync-storage-in-loop.js';

export const RULE_IMPLEMENTATIONS: Record<string, ShieldRule> = {
  'no-dangerous-apis': noDangerousApis,
  'no-large-loops': noLargeLoops,
  'no-expensive-watcher': noExpensiveWatcher,
  'no-sync-storage-in-loop': noSyncStorageInLoop,
};
```

### 4.5 规则注册器 `lib/custom-rules/index.ts`

`lib/custom-rules/index.ts` 暴露 `runCustomRules(legacyRoot, options)`，负责加载全部规则、调用 `scanFiles`、汇总命中结果。

```ts
import { scanFiles } from './scanner.js';
import { RULE_IMPLEMENTATIONS } from './rules/index.js';

export async function runCustomRules(
  legacyRoot: string,
  options: { disabled?: string[]; scanOptions?: ScanOptions } = {},
): Promise<CustomRulesResult> {
  const disabled = new Set(options.disabled || []);
  const allHits: RuleHit[] = [];

  for (const [ruleName, rule] of Object.entries(RULE_IMPLEMENTATIONS)) {
    if (disabled.has(rule.id) || disabled.has(ruleName)) continue;
    const hits = await scanFiles(legacyRoot, ruleName, options.scanOptions);
    allHits.push(...hits);
  }

  return {
    hits: allHits,
    summary: {
      total: allHits.length,
      errors: allHits.filter((h) => h.severity === 'error').length,
      warnings: allHits.filter((h) => h.severity === 'warning').length,
      files: new Set(allHits.map((h) => h.filePath)).size,
    },
  };
}
```

> 类型说明：`CustomRulesResult` 与 `RuleHit` 需同步写入 `lib/types.ts`；`severity` 统一使用 `'warning'`。

### 4.6 验收标准

- [ ] 每条规则能在测试代码中命中预期模式。
- [ ] 每条规则不会误报常见合法写法。
- [ ] 结果统一写入 quality 日志。
- [ ] 规则可配置开启/关闭。

### 4.7 测试用例

```ts
// tests/custom-rules.test.ts
import { describe, it, expect } from 'vitest';
import { scanFiles } from '../lib/custom-rules/scanner.js';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function createProject(files) {
  const dir = mkdtempSync(join(tmpdir(), 'shield-rules-'));
  mkdirSync(join(dir, 'src'));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, 'src', name), content);
  }
  return dir;
}

describe('custom rules', () => {
  it('SHIELD-001 detects eval and new Function', async () => {
    const dir = createProject({ 'bad.js': 'eval("x"); new Function("a", "return a");' });
    const hits = await scanFiles(dir, 'no-dangerous-apis');
    expect(hits.length).toBe(2);
    rmSync(dir, { recursive: true, force: true });
  });

  it('SHIELD-002 detects large loop without break', async () => {
    const dir = createProject({ 'loop.js': 'for(let i=0;i<arr.length;i++){ console.log(i); }' });
    const hits = await scanFiles(dir, 'no-large-loops');
    expect(hits.length).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });

  it('SHIELD-003 detects expensive watcher', async () => {
    const dir = createProject({ 'watch.js': 'watch(someObj.deep.prop, () => {});' });
    const hits = await scanFiles(dir, 'no-expensive-watcher');
    expect(hits.length).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });

  it('SHIELD-004 detects localStorage in loop', async () => {
    const dir = createProject({ 'storage.js': 'for(let i=0;i<10;i++){ localStorage.setItem("k", i); }' });
    const hits = await scanFiles(dir, 'no-sync-storage-in-loop');
    expect(hits.length).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });
});
```

---

## 5. 任务 3.4：实现 `lib/cli/quality.ts`

### 5.1 目标

实现 `quality` 子命令 orchestrator，串联 code-quality 调用和自定义规则扫描。

### 5.2 输入

命令行参数：

- `--project <legacy-root>`（必填）
- `--target <file>`（可多次指定）
- `--base <git-ref>`
- `--skip <step>`（可多次指定，支持 `type-check`、`lint`、`test`）
- `--disable-rule <rule-id>`（可多次指定，按规则 ID 或规则名称禁用）
- `--log-retention-days <days>`（默认 7）

### 5.3 输出

- 控制台输出 quality 摘要。
- 将 code-quality 结果和自定义规则结果写入 `<legacy>/.runtime-log-ignore/quality/YYYY-MM-DD.jsonl`。
- 退出码：0（全部通过）或 1（存在失败）。

### 5.4 执行流程

1. 解析命令行参数。
2. 调用 `assertLegacyProject(project)`。
3. 创建 quality 日志目录。
4. 创建 logger（复用阶段 2 的 `createLogger`）。
5. 调用 `runCodeQuality(legacyRoot, { targets, base, skipList })`。
6. 调用 `runCustomRules(legacyRoot, { disabled })`。
7. 将 code-quality 结果和自定义规则结果写入 quality 日志。写入策略如下：
   - 自动生成一个 `sessionId`。
   - code-quality 结果写一条 `subType: 'code-quality'` 的 quality 日志。
   - 自定义规则结果写一条 `subType: 'custom-rule'` 的 quality 日志，将命中列表序列化到 `customRuleHits` 字段。
   - 两条日志共享同一个 `sessionId` 和同一个日期文件。
8. 控制台输出摘要：
   - code-quality 退出码
   - 自定义规则命中数
   - 日志文件路径
9. 如果 code-quality 退出码非零或自定义规则存在 error 级别命中，返回退出码 1；否则返回 0。

### 5.5 Quality 日志结构

```json
{
  "type": "quality",
  "subType": "code-quality|custom-rule",
  "sessionId": "uuid",
  "timestamp": "2026-06-17T10:00:00.000Z",
  "level": "info|warn|error",
  "command": "all",
  "code": 0,
  "stdout": "...",
  "stderr": "...",
  "summary": {
    "exitCode": 0,
    "testStatus": "passed",
    "eslintIssueCount": 0,
    "typeCheckStatus": "passed"
  },
  "customRuleHits": []
}
```

### 5.6 错误处理

- 老项目路径非法：退出码 1。
- code-quality 调用失败：记录到 quality 日志，退出码 1。
- 自定义规则扫描失败：记录到 quality 日志，退出码 1。

### 5.7 验收标准

- [ ] `node ./dist/cli.js quality --project <legacy>` 同时执行 code-quality 和自定义规则。
- [ ] `node ./dist/cli.js quality --project <legacy> --target src/foo.js` 为指定文件生成测试。
- [ ] `node ./dist/cli.js quality --project <legacy> --base origin/main` 基于 diff 生成测试。
- [ ] 失败时返回非零退出码。
- [ ] 结果写入 quality 日志。

### 5.8 测试用例

见 6.1 集成测试。

---

## 6. 任务 3.5：质量保障集成测试

### 6.1 目标

验证 quality 命令端到端可用。

### 6.2 测试环境

准备一个包含故意问题的小老项目：

```
tmp-legacy/
├── package.json
├── src/
│   ├── app.js        // 包含 eval
│   └── loop.js       // 包含无 break 大循环
```

### 6.3 测试步骤

1. 创建临时老项目目录。
2. 写入包含问题的源码文件。
3. 运行 `node ./dist/cli.js quality --project <dir>`。
4. 检查控制台输出和 quality 日志。

### 6.4 验收标准

- [ ] code-quality 输出被正确捕获。
- [ ] 自定义规则能命中测试代码中的问题。
- [ ] 最终退出码正确。
- [ ] quality 日志文件非空。

### 6.5 测试用例

```ts
// tests/quality.integration.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

describe('quality integration', () => {
  let dir: string;
  const cliPath = resolve('dist/cli.js');

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'shield-quality-'));
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fake-legacy' }));
    writeFileSync(
      join(dir, 'src', 'bad.js'),
      'eval("x");\nfor(let i=0;i<arr.length;i++){ console.log(i); }\nfor(let i=0;i<10;i++){ localStorage.setItem("k", i); }',
    );
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('runs custom rules and writes quality log', () => {
    const result = spawnSync('node', [
      cliPath, 'quality',
      '--project', dir,
      '--skip', 'type-check', '--skip', 'lint', '--skip', 'test',
    ], { encoding: 'utf8' });

    const qualityDir = join(dir, '.runtime-log-ignore', 'quality');
    expect(existsSync(qualityDir)).toBe(true);
    const files = readdirSync(qualityDir);
    expect(files.length).toBeGreaterThanOrEqual(1);
    const content = readFileSync(join(qualityDir, files[0]), 'utf8');
    expect(content).toContain('custom-rule');
  });

  it('invokes code-quality via CODE_QUALITY_ROOT mock', () => {
    // 构造一个最小 mock code-quality，输出固定摘要
    const mockRoot = mkdtempSync(join(tmpdir(), 'shield-mock-cq-'));
    const mockCli = join(mockRoot, 'cli.js');
    writeFileSync(mockCli, `
      console.log('Type check passed');
      console.log('Tests 1 passed');
      process.exit(0);
    `);

    const result = spawnSync('node', [
      cliPath, 'quality',
      '--project', dir,
    ], {
      encoding: 'utf8',
      env: { ...process.env, CODE_QUALITY_ROOT: mockRoot },
    });

    const qualityDir = join(dir, '.runtime-log-ignore', 'quality');
    const files = readdirSync(qualityDir);
    const content = readFileSync(join(qualityDir, files[files.length - 1]), 'utf8');
    expect(content).toContain('code-quality');
    expect(content).toContain('Type check passed');
    rmSync(mockRoot, { recursive: true, force: true });
  });
});
```

---

## 7. 阶段 3 集成验收

### 7.1 验收清单

- [ ] `lib/quality.ts` 能正确调用 code-quality 的 `all`/`module`/`diff` 子命令（任务 3.1）。
- [ ] `lib/custom-rules/scanner.ts` 能扫描 `.js`、`.vue`、`.ts`、`.tsx` 文件（任务 3.2）。
- [ ] 4 条 MVP 规则能命中预期模式（任务 3.3）。
- [ ] `lib/cli/quality.ts` 能编排完整 quality 流程（任务 3.4）。
- [ ] quality 集成测试通过（任务 3.5）。

### 7.2 阶段出口条件

以下全部满足后，方可进入阶段 4：

1. `pnpm test` 在阶段 3 范围内全部通过。
2. `node ./dist/cli.js quality --project <legacy>` 能正常运行。
3. 自定义规则在测试老项目中命中预期问题。
4. quality 日志文件非空。

### 7.3 阶段交付验证命令

```bash
cd /Users/creayma/personal/legacy-shield
pnpm build
pnpm test
node ./dist/cli.js quality --help
node ./dist/cli.js quality --project /Users/creayma/work/sichuan/event --skip type-check
```

---

## 8. 风险与应对

| 风险 | 影响 | 应对措施 |
|---|---|---|
| code-quality 未安装依赖 | 高 | 文档说明需先 `pnpm install`；运行前检查 |
| code-quality 路径不一致 | 中 | 支持 `CODE_QUALITY_ROOT` 环境变量 |
| AST 解析 Vue SFC 失败 | 中 | 捕获解析异常，跳过该文件 |
| 自定义规则误报 | 中 | 为每条规则编写正面/负面测试用例 |

---

## 9. 依赖关系

- **前置依赖**：阶段 1（项目骨架、utils.ts）、阶段 2（logger.ts）。
- **后续依赖**：阶段 4（report/api 读取 quality 日志）。
