# legacy-shield 阶段 1 详细 Spec：项目骨架与依赖初始化

> 文档版本：v1.0
> 对应需求文档：[requirements.md](../requirements.md)
> 对应设计文档：[design.md](../design.md)
> 对应执行计划：[execution-plan.md](../execution-plan.md) 阶段 1
> 状态：已完成 / 已归档（冻结，不再修改）

---

## 1. 阶段目标

完成 `legacy-shield` 独立项目的骨架搭建、依赖安装、通用工具封装以及自身单元测试框架初始化，使后续阶段可以在稳定的工程基础上并行开发。

### 1.1 阶段交付物

| 交付物 | 路径 | 说明 |
|---|---|---|
| 项目目录结构 | `/Users/creayma/personal/legacy-shield/` | 标准目录树 |
| package.json | `/Users/creayma/personal/legacy-shield/package.json` | 元信息、脚本、依赖、引擎约束 |
| .gitignore | `/Users/creayma/personal/legacy-shield/.gitignore` | 忽略规则 |
| 通用工具模块 | `/Users/creayma/personal/legacy-shield/lib/utils.js` | 基础工具函数 |
| 单元测试配置 | `/Users/creayma/personal/legacy-shield/package.json` 中的 test 脚本 + `tests/` 目录 | Vitest 框架 |

### 1.2 阶段边界

- **范围内**：legacy-shield 自身项目初始化、自身依赖安装、自身工具函数、自身单元测试框架。
- **范围外**：老项目运行时监控、代理、浏览器自动化、自定义规则、报告生成、API 服务。

---

## 2. 任务 1.1：创建项目目录结构

### 2.1 目标

建立 `legacy-shield` 的标准目录树，为后续模块提供清晰的物理边界。

### 2.2 输入

- 父目录存在：`/Users/creayma/personal/`
- 无现有 `legacy-shield` 目录冲突（如有冲突需保留并增量创建子目录）。

### 2.3 输出

创建以下目录结构：

```
/Users/creayma/personal/legacy-shield/
├── bin/
│   └── cli.js              # 可执行入口（可选占位；MVP 使用根目录 cli.js，本文件可留空或删除）
├── lib/
│   ├── cli/                # 子命令实现
│   │   ├── shield.js
│   │   ├── quality.js
│   │   ├── report.js
│   │   └── api.js
│   ├── proxy.js
│   ├── browser.js
│   ├── logger.js
│   ├── quality.js
│   ├── analyzer.js
│   ├── reporter.js
│   ├── api.js
│   ├── inject.iife.js
│   ├── utils.js
│   └── custom-rules/
│       ├── index.js
│       ├── scanner.js
│       └── rules/
│           ├── no-dangerous-apis.js
│           ├── no-large-loops.js
│           ├── no-expensive-watcher.js
│           └── no-sync-storage-in-loop.js
├── docs/
│   └── specs/              # 已创建的需求/设计/计划/阶段 spec 文档
├── scripts/                # 手动 benchmark / 辅助脚本（阶段 5）
├── tests/                  # 自身测试
│   ├── e2e/                # 端到端与边界测试（阶段 5）
│   │   ├── shield.e2e.test.js
│   │   ├── boundary.test.js
│   │   └── performance.test.js
│   └── utils.test.js       # 单元测试示例
├── cli.js                  # 主入口
├── package.json
├── .gitignore
└── README.md               # 使用说明（阶段 5 完善）
```

### 2.4 实现步骤

1. 使用 `mkdir -p` 递归创建上述所有目录。
2. 使用 `touch` 或占位文件创建所有叶子文件（阶段 1 不实现内容，仅占位）。
3. 验证目录树深度与文件存在性。

### 2.5 验收标准

- [ ] 所有目录创建完成。
- [ ] 文件列表与 2.3 一致，允许 README.md 为空。
- [ ] 使用 `find /Users/creayma/personal/legacy-shield -type d` 验证目录结构。

### 2.6 测试用例

```bash
# TC-1.1-001：目录结构完整
node -e "
  const fs = require('fs');
  const dirs = [
    'bin','lib/cli','lib/custom-rules/rules',
    'docs/specs','tests'
  ];
  for (const d of dirs) {
    if (!fs.existsSync('/Users/creayma/personal/legacy-shield/' + d)) {
      throw new Error('missing dir: ' + d);
    }
  }
  console.log('PASS');
"
```

---

## 3. 任务 1.2：编写 package.json

### 3.1 目标

定义项目元信息、脚本、依赖和引擎约束，确保项目可安装、可运行、可测试。

### 3.2 输入

- 项目名称：`legacy-shield`
- 版本：`0.1.0`
- 引擎约束：Node.js `>=20.19.0`
- 包管理器：`pnpm@10.33.4`
- 模块类型：`type: "module"`

### 3.3 输出

`/Users/creayma/personal/legacy-shield/package.json`：

```json
{
  "name": "legacy-shield",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "非侵入式老项目护航工具：运行时监控、提交前质量保障、项目状态分析与 AI 接口",
  "bin": {
    "legacy-shield": "./cli.js"
  },
  "engines": {
    "node": ">=20.19.0"
  },
  "packageManager": "pnpm@10.33.4",
  "scripts": {
    "shield": "node ./cli.js shield",
    "quality": "node ./cli.js quality",
    "report": "node ./cli.js report",
    "api": "node ./cli.js api",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "commander": "^11.0.0",
    "http-proxy": "^1.18.1",
    "playwright": "^1.44.0"
  },
  "devDependencies": {
    "@babel/parser": "^7.26.0",
    "@babel/traverse": "^7.26.0",
    "@vue/compiler-sfc": "^3.5.0",
    "@types/node": "^22.0.0",
    "vitest": "^3.0.0"
  }
}
```

### 3.4 关键设计决策

- **不使用 `uuid`**：Node.js 20+ 内置 `crypto.randomUUID()`。
- **不使用 `dayjs`**：日期格式化优先使用原生 `Intl.DateTimeFormat` 或 `toISOString()`。
- **`@types/node`**：避免 TypeScript/JSDoc 检查中出现 `TS2688: Cannot find type definition file for 'node'`。
- **`vitest`**：与 code-quality 技术栈保持一致，使用已稳定发布的 v3 主版本。
- **版本兜底**：`@babel/*` 使用 v7 稳定线；实现前执行 `npm view <pkg> versions --json` 确认版本可用，如遇冲突可微调到最新稳定补丁版。

### 3.5 实现步骤

1. 创建 `package.json` 文件，内容如 3.3 所示。
2. 验证 JSON 格式合法（`node -e "JSON.parse(require('fs').readFileSync(...))"`）。
3. 确认 `engines.node` 符合 `>=20.19.0`。

### 3.6 验收标准

- [ ] `package.json` 包含全部必要字段（name、version、type、bin、engines、scripts、dependencies、devDependencies）。
- [ ] `engines.node` 约束为 `>=20.19.0`。
- [ ] JSON 格式合法，可被 `JSON.parse` 解析。
- [ ] 依赖版本与 code-quality 不冲突（`commander`、`http-proxy`、`playwright`、`vitest` 等）。

### 3.7 测试用例

```bash
# TC-1.2-001：JSON 合法且字段完整
node -e "
  const pkg = JSON.parse(require('fs').readFileSync('/Users/creayma/personal/legacy-shield/package.json'));
  const required = ['name','version','type','bin','engines','scripts','dependencies','devDependencies'];
  for (const k of required) if (!(k in pkg)) throw new Error('missing ' + k);
  if (pkg.engines.node !== '>=20.19.0') throw new Error('engine mismatch');
  console.log('PASS');
"
```

---

## 4. 任务 1.3：初始化 git 与 .gitignore

### 4.1 目标

初始化版本控制并忽略不应提交的文件。

### 4.2 输入

- 项目根目录已创建。

### 4.3 输出

`/Users/creayma/personal/legacy-shield/.gitignore`：

```
node_modules/
*.log
.DS_Store
.vscode/
.idea/
/test-results/
/playwright-report/
/playwright/.cache/
```

`.git/` 目录（由 `git init` 生成，阶段 1 不提交）。

### 4.4 实现步骤

1. 写入 `.gitignore`。
2. 执行 `git init`（仅初始化，不提交）。

### 4.5 验收标准

- [ ] `.gitignore` 创建且包含 `node_modules/`。
- [ ] `git init` 成功（存在 `.git/` 目录）。

### 4.6 测试用例

```bash
# TC-1.3-001：gitignore 生效
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('/Users/creayma/personal/legacy-shield/.gitignore','utf8');
  if (!content.includes('node_modules/')) throw new Error('missing node_modules ignore');
  if (!fs.existsSync('/Users/creayma/personal/legacy-shield/.git')) throw new Error('git not initialized');
  console.log('PASS');
"
```

---

## 5. 任务 1.4：安装项目依赖

### 5.1 目标

完成 `pnpm install`，确保所有声明的依赖可用。

### 5.2 输入

- 有效的 `package.json`。
- 网络环境允许访问 npm registry 和 Playwright 浏览器下载源。

### 5.3 输出

- `node_modules/` 目录完整。
- `node_modules/.bin/playwright` 存在。
- `node_modules/.bin/vitest` 存在。

### 5.4 实现步骤

1. 执行 `cd /Users/creayma/personal/legacy-shield && pnpm install`。
2. 如果 Playwright 浏览器下载失败，配置镜像或手动执行 `npx playwright install chromium`。
3. 验证关键依赖可导入：
   - `node -e "import('commander').then(()=>console.log('commander ok'))"`
   - `node -e "import('http-proxy').then(()=>console.log('http-proxy ok'))"`
   - `node -e "import('playwright').then(()=>console.log('playwright ok'))"`
   - `node -e "import('vitest').then(()=>console.log('vitest ok'))"`

### 5.5 可能阻塞点

- Playwright 需要下载 Chromium 二进制，可能耗时较长。
- 如果下载失败，需要配置 `PLAYWRIGHT_DOWNLOAD_HOST` 或手动 `npx playwright install chromium`。

### 5.6 验收标准

- [ ] `pnpm install` 成功退出。
- [ ] `node_modules/.bin/playwright` 存在。
- [ ] `node_modules/.bin/vitest` 存在。
- [ ] 可运行 `node -e "import('playwright').then(()=>console.log('ok'))"`。

### 5.7 测试用例

```bash
# TC-1.4-001：关键依赖可导入
node -e "
  Promise.all([
    import('commander'),
    import('http-proxy'),
    import('playwright'),
    import('vitest')
  ]).then(() => console.log('PASS')).catch(e => { console.error(e); process.exit(1); });
"
```

---

## 6. 任务 1.5：实现通用工具模块 `lib/utils.js`

### 6.1 目标

提供全项目复用的基础函数。

### 6.2 输入

- 无。

### 6.3 输出

`/Users/creayma/personal/legacy-shield/lib/utils.js`，导出以下函数：

| 函数 | 签名 | 说明 |
|---|---|---|
| `assertLegacyProject` | `(path: string) => void` | 校验路径存在、包含 package.json 和 src/ |
| `ensureDir` | `(dir: string) => void` | 递归创建目录 |
| `today` | `() => string` | 返回 `YYYY-MM-DD` 格式的本地日期 |
| `generateId` | `() => string` | 生成唯一 ID（基于 `crypto.randomUUID`） |
| `readJsonl` | `(filePath: string) => any[]` | 读取 JSONL 文件为对象数组 |
| `safeJsonParse` | `(str: string) => any \| null` | 安全 JSON 解析，失败返回 null |
| `truncateBody` | `(body: Buffer \| string, maxSize?: number) => { body, truncated }` | 截断 body 内容 |
| `redactHeaders` | `(headers: object) => { headers, redactedHeaders }` | headers 已脱敏，redactedHeaders 列出被脱敏的字段名 |
| `redactBody` | `(body: any, fields?: string[]) => any` | 脱敏 body 中的敏感字段 |
| `classifyNetworkSubType` | `(req: IncomingMessage, url: string) => string` | 判定网络请求 subType（xhr/fetch/static-resource） |

### 6.4 详细设计

#### 6.4.1 `assertLegacyProject(path)`

```js
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

export function assertLegacyProject(projectPath) {
  if (!projectPath) throw new Error('老项目路径不能为空');
  if (!existsSync(projectPath)) throw new Error(`路径不存在: ${projectPath}`);
  const stat = statSync(projectPath);
  if (!stat.isDirectory()) throw new Error(`路径不是目录: ${projectPath}`);
  if (!existsSync(resolve(projectPath, 'package.json'))) {
    throw new Error(`未找到 package.json: ${projectPath}`);
  }
  if (!existsSync(resolve(projectPath, 'src'))) {
    throw new Error(`未找到 src/ 目录: ${projectPath}`);
  }
}
```

#### 6.4.2 `ensureDir(dir)`

```js
import { mkdirSync } from 'node:fs';

export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}
```

#### 6.4.3 `today()`

```js
export function today() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
```

#### 6.4.4 `generateId()`

```js
import { randomUUID } from 'node:crypto';

export function generateId() {
  return randomUUID();
}
```

#### 6.4.5 `readJsonl(filePath)`

```js
import { readFileSync } from 'node:fs';

export function readJsonl(filePath) {
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => safeJsonParse(line))
    .filter(Boolean);
}
```

#### 6.4.6 `safeJsonParse(str)`

```js
export function safeJsonParse(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}
```

#### 6.4.7 `truncateBody(body, maxSize = 64 * 1024)`

```js
export function truncateBody(body, maxSize = 64 * 1024) {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
  if (buffer.length <= maxSize) return { body: buffer.toString('utf8'), truncated: false };
  const truncatedBuffer = buffer.subarray(0, maxSize);
  return { body: truncatedBuffer.toString('utf8'), truncated: true };
}
```

#### 6.4.8 `redactHeaders(headers)`

```js
const SENSITIVE_HEADERS = ['cookie', 'authorization', 'x-api-key', 'x-auth-token'];

export function redactHeaders(headers) {
  const redactedHeaders = [];
  const result = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (SENSITIVE_HEADERS.includes(lower)) {
      result[key] = '[REDACTED]';
      redactedHeaders.push(key);
    } else {
      result[key] = value;
    }
  }
  return { headers: result, redactedHeaders };
}
```

#### 6.4.9 `redactBody(body, fields = ['password', 'token', 'phone', 'idCard'])`

```js
export function redactBody(body, fields = ['password', 'token', 'phone', 'idCard']) {
  if (body === null || body === undefined) return body;

  // 对 JSON 字符串尝试解析后脱敏
  if (typeof body === 'string') {
    const trimmed = body.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      const parsed = safeJsonParse(trimmed);
      if (parsed !== null) {
        const redacted = redactBody(parsed, fields);
        return JSON.stringify(redacted);
      }
    }
    return body;
  }

  if (typeof body !== 'object') return body;
  const result = Array.isArray(body) ? [...body] : { ...body };
  for (const key of Object.keys(result)) {
    const lower = key.toLowerCase();
    if (fields.some(f => lower.includes(f.toLowerCase()))) {
      result[key] = '[REDACTED]';
    } else {
      result[key] = redactBody(result[key], fields);
    }
  }
  return result;
}
```

#### 6.4.10 `classifyNetworkSubType(req, url)`

```js
const STATIC_EXTENSIONS = ['.js', '.css', '.png', '.jpg', '.jpeg', '.svg', '.gif', '.woff', '.woff2', '.ttf', '.eot', '.ico'];

export function classifyNetworkSubType(req, url) {
  if (!url) return 'unknown';
  const lowerUrl = url.toLowerCase();
  if (STATIC_EXTENSIONS.some(ext => lowerUrl.endsWith(ext))) return 'static-resource';
  const requestedWith = req.headers?.['x-requested-with'];
  if (requestedWith && requestedWith.toLowerCase() === 'xmlhttprequest') return 'xhr';
  if (req.headers?.['x-shield-request-type'] === 'fetch') return 'fetch';
  return 'unknown';
}
```

### 6.5 错误处理

- `assertLegacyProject` 对非法路径抛出清晰错误。
- `readJsonl` 对不存在的文件返回空数组。
- `safeJsonParse` 解析失败返回 `null`。
- `truncateBody` 对非字符串/Buffer 输入做安全转换。

### 6.6 验收标准

- [ ] 所有工具函数实现完整。
- [ ] `assertLegacyProject` 对非法路径抛出清晰错误。
- [ ] `redactHeaders` 正确脱敏 Cookie、Authorization。
- [ ] `redactBody` 对嵌套对象中的敏感字段递归脱敏。
- [ ] `classifyNetworkSubType` 正确区分 xhr/fetch/static-resource。

### 6.7 测试用例

```js
// tests/utils.test.js
import { describe, it, expect } from 'vitest';
import {
  assertLegacyProject,
  ensureDir,
  today,
  generateId,
  readJsonl,
  safeJsonParse,
  truncateBody,
  redactHeaders,
  redactBody,
  classifyNetworkSubType
} from '../lib/utils.js';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('utils', () => {
  it('assertLegacyProject throws on missing path', () => {
    expect(() => assertLegacyProject('/nonexistent')).toThrow('路径不存在');
  });

  it('assertLegacyProject passes on valid project', () => {
    const dir = mkdtempSync(join(tmpdir(), 'legacy-'));
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'package.json'), '{}');
    expect(() => assertLegacyProject(dir)).not.toThrow();
    rmSync(dir, { recursive: true, force: true });
  });

  it('today returns YYYY-MM-DD format', () => {
    const t = today();
    expect(t).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('generateId returns uuid v4', () => {
    expect(generateId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('safeJsonParse returns null on invalid json', () => {
    expect(safeJsonParse('not json')).toBeNull();
  });

  it('safeJsonParse parses valid json', () => {
    expect(safeJsonParse('{"a":1}')).toEqual({ a: 1 });
  });

  it('truncateBody truncates large body', () => {
    const { body, truncated } = truncateBody('a'.repeat(70000));
    expect(truncated).toBe(true);
    expect(body.length).toBe(64 * 1024);
  });

  it('redactHeaders masks cookie and authorization', () => {
    const { headers, redactedHeaders } = redactHeaders({ Cookie: 'x', Authorization: 'Bearer y', 'Content-Type': 'json' });
    expect(headers.Cookie).toBe('[REDACTED]');
    expect(headers.Authorization).toBe('[REDACTED]');
    expect(redactedHeaders).toContain('Cookie');
    expect(redactedHeaders).toContain('Authorization');
  });

  it('redactBody masks nested sensitive fields', () => {
    const body = { user: { password: 'secret', name: 'Tom' }, token: 'abc' };
    const result = redactBody(body);
    expect(result.user.password).toBe('[REDACTED]');
    expect(result.user.name).toBe('Tom');
    expect(result.token).toBe('[REDACTED]');
  });

  it('redactBody masks sensitive fields in JSON string', () => {
    const body = JSON.stringify({ user: { password: 'secret', name: 'Tom' }, token: 'abc' });
    const result = redactBody(body);
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain('secret');
    expect(result).toContain('Tom');
  });

  it('classifyNetworkSubType detects fetch marker', () => {
    const req = { headers: { 'x-shield-request-type': 'fetch' } };
    expect(classifyNetworkSubType(req, '/api')).toBe('fetch');
  });

  it('classifyNetworkSubType detects static resource', () => {
    const req = { headers: {} };
    expect(classifyNetworkSubType(req, '/app.js')).toBe('static-resource');
  });

  it('classifyNetworkSubType returns unknown when url is empty', () => {
    expect(classifyNetworkSubType({ headers: {} }, '')).toBe('unknown');
  });

  it('classifyNetworkSubType returns unknown for unclassified request', () => {
    expect(classifyNetworkSubType({ headers: {} }, '/api/users')).toBe('unknown');
  });
});
```

---

## 7. 任务 1.6：初始化单元测试框架

### 7.1 目标

为 legacy-shield 自身代码建立单元测试能力。

### 7.2 输入

- 已安装 `vitest`。
- 已创建 `tests/` 目录。

### 7.3 输出

- `package.json` 中包含 `test` 和 `test:watch` 脚本。
- `tests/utils.test.js` 已创建（见 6.7）。
- `pnpm test` 可运行并至少部分通过（依赖 `lib/utils.js` 实现）。

### 7.4 实现步骤

1. 确认 `package.json` 的 `scripts.test` 为 `vitest run`。
2. 创建 `tests/utils.test.js`（内容见 6.7）。
3. 运行 `pnpm test`，确认测试框架可启动。

### 7.5 验收标准

- [ ] `pnpm test` 命令可运行。
- [ ] 至少覆盖 50% 的核心工具函数。
- [ ] CI/本地提交前可执行单元测试。

### 7.6 测试用例

```bash
# TC-1.6-001：测试框架可运行
pnpm test
# 期望：Vitest 启动，utils.test.js 中的用例被执行
```

---

## 8. 阶段 1 集成验收

### 8.1 验收清单

- [ ] 目录结构完整（任务 1.1）。
- [ ] `package.json` 合法且字段完整（任务 1.2）。
- [ ] `.gitignore` 创建且 `git init` 成功（任务 1.3）。
- [ ] `pnpm install` 成功，关键依赖可导入（任务 1.4）。
- [ ] `lib/utils.js` 实现并通过单元测试（任务 1.5 + 1.6）。
- [ ] `pnpm test` 可运行（任务 1.6）。

### 8.2 阶段出口条件

以下全部满足后，方可进入阶段 2：

1. `pnpm test` 在阶段 1 范围内全部通过。
2. `lib/utils.js` 的所有导出函数可被其他模块正常导入。
3. 项目目录结构稳定，不再调整。

### 8.3 阶段交付验证命令

```bash
cd /Users/creayma/personal/legacy-shield
node -e "import('./lib/utils.js').then(m => console.log(Object.keys(m)))"
pnpm test
```

---

## 9. 风险与应对

| 风险 | 影响 | 应对措施 |
|---|---|---|
| Playwright 浏览器下载失败 | 高 | 配置镜像；手动 `npx playwright install chromium` |
| pnpm 版本不匹配 | 中 | 使用 `corepack` 或安装 `pnpm@10.33.4` |
| Node.js 版本低于 20.19.0 | 高 | 使用 nvm/n/fnm 切换 Node 版本 |
| code-quality 依赖冲突 | 低 | 确保 legacy-shield 与 code-quality 独立安装，不共享 node_modules |

---

## 10. 依赖关系

- **前置依赖**：无。
- **后续依赖**：阶段 2、3、4、5 均依赖阶段 1 的目录结构、依赖安装和 `lib/utils.js`。
