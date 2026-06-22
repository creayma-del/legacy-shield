# T1：types / 子类型 / 工具函数 / browser.ts 注入 redactFields

> 版本：v1.4
> 任务编号：T1
> 对应阶段 Spec：[phase-v1.4-spec.md](phase-v1.4-spec.md)
> 对应设计文档：[design-v1.4.md](../design-v1.4.md)
> 对应执行计划：[execution-plan-v1.4.md](../execution-plan-v1.4.md)
> 依赖任务：无
> 状态：已通过
> 评审记录：见本文档末尾（轮次 1 不通过、轮次 2 通过）

---

## 1. 任务目标

为后续 Pinia / Vuex patch 提供底层类型、工具函数、脱敏字段名单注入链路。具体包括：
- 扩展 `RuntimeSubType` 枚举与 `StartBrowserOptions`；
- 实现 `inject.iife.ts` 内的 `buildStateSummary` / `safeStringify` / `redactValue` / `normalizeVuexArgs` 工具函数骨架；
- 打通脱敏字段名单的完整链路 `cli → StartBrowserOptions → browser.ts addInitScript → window.__SHIELD_REDACT_FIELDS__`。

对应阶段 Spec §3.5、§3.6 与交付物 D1 / D2 / D3 / D4 的工具函数部分。

---

## 2. 对应需求与验收标准

| 需求编号 | 需求描述 | 本任务验收标准 |
|---|---|---|
| REQ-1.4-7 | 错误上下文 detail 包含脱敏后的 args / payload；脱敏字段名单复用 `--redact-body-fields` | `redactValue` 行为与 `utils.redactBody` 对齐；`__SHIELD_REDACT_FIELDS__` 完整链路打通 |
| REQ-1.4-8 | state 快照仅记录 keys + 体积；>64KB 标记截断 | `buildStateSummary` 返回 `stateKeys/stateSizeBytes/stateTruncated/stateUnserializable?`；64KB 阈值生效 |
| REQ-1.4-10 | 默认开启 Pinia / Vuex 采集，无新增 CLI 参数 | 不新增任何子命令；不新增 `--enable-pinia` / `--enable-vuex` 类开关 |

---

## 3. 实现步骤

### 3.1 扩展 `lib/types.ts`

- `RuntimeSubType` 联合类型新增 4 个字面量：`'pinia-error'` / `'pinia-plugin-error'` / `'vuex-error'` / `'vuex-strict-violation'`，位置与现有 `vue-render-error` 等同列。
- `StartBrowserOptions` 接口新增可选字段：`redactBodyFields?: string[]`。

### 3.2 扩展 `lib/browser.ts`

- 在 `startBrowser` 函数（[lib/browser.ts#L14-L26](file:///Users/creayma/personal/legacy-shield/lib/browser.ts#L14)）从 `options` 解构出 `redactBodyFields`，**不设置默认值**，保留 `undefined`，下游通过 optional chain (`redactBodyFields?.length`) 安全判空：

  ```typescript
  const {
    proxyUrl,
    startPage,
    headless,
    logger,
    sessionId,
    enableReactPatch = false,
    skipInject = false,
    skipProxy = false,
    viewport = { width: 1440, height: 900 },
    userAgent = 'legacy-shield/1.0',
    redactBodyFields,
  } = options;
  ```

- **注入位置锚点**：在现网 `lib/browser.ts` 的 `enableReactPatch` 注入块（[L50-L54](file:///Users/creayma/personal/legacy-shield/lib/browser.ts#L50)）**之后**、`const recentResourceErrors = new Map<...>` 声明（[L56](file:///Users/creayma/personal/legacy-shield/lib/browser.ts#L56)）**之前**，与 `enableReactPatch` 注入块并列插入新分支：

  ```typescript
  if (redactBodyFields?.length) {
    await page.addInitScript({
      content: `window.__SHIELD_REDACT_FIELDS__ = ${JSON.stringify(redactBodyFields)};`,
    });
  }
  ```

- 仅当字段名单非空时注入，避免 `undefined` 污染页面 window。

### 3.3 调整 `lib/cli/shield.ts` 透传 redactBodyFields

- 定位 `startBrowser({ ... })` 调用点，将已解析的 `redactBodyFields`（现网 `lib/cli/shield.ts` 中已用于 `startProxy`）一并传入 `startBrowser`。
- 不修改 `--redact-body-fields` 参数定义本身（已存在）。

### 3.4 在 `lib/inject.iife.ts` 新增工具函数骨架

> 本步骤仅落实工具函数本身；`patchPinia` / `patchVuex` 由 T2 / T3 实现。函数命名空间放在 inject.iife.ts 顶部「公共工具」区，复用同文件已有的 `markShieldEmitted` / `isShieldEmitted` 等工具。
>
> **字段名以设计 §2.2 ContextStateSummary 为准**：`buildStateSummary` 返回字段统一使用 `stateKeys` / `stateSizeBytes` / `stateTruncated` / `stateUnserializable?`，**不**使用设计 §3.4 代码片段中 `keys` / `sizeBytes` / `truncated` / `unserializable` 的简写形式（设计 §3.4 简写仅为伪代码示意，规范以 §2.2 为准）。

- `safeStringify(input)`：通过 WeakSet replacer 处理循环引用；BigInt 转 `${val}n` 字符串；Symbol 转 `val.toString()`；Function 转 `'[Function]'`；异常返回 `null`。
- `buildStateSummary(rawState)`：
  - `stateKeys = Object.keys(rawState || {}).slice(0, 50)`，try/catch 容错；
  - `json = safeStringify(rawState)`；
  - `json === null` → 返回 `{ stateKeys, stateSizeBytes: -1, stateTruncated: true, stateUnserializable: true }`；
  - 否则返回 `{ stateKeys, stateSizeBytes: json.length, stateTruncated: json.length > 64 * 1024 }`。
- `redactValue(value, fields)`：递归实现，行为与 [utils.redactBody](file:///Users/creayma/personal/legacy-shield/lib/utils.ts#L118) 对齐；
  - `fields` 为空 / 非数组 → 原值返回；
  - `null/undefined/非 object` → 原值返回；
  - 数组 → `value.map((v) => redactValue(v, fields))`；
  - object → 浅拷贝后逐字段：`key.toLowerCase().includes(field.toLowerCase())` 命中则置 `'[REDACTED]'`，否则递归；
  - `Map / Set / Date / Class 实例` → 不展开递归，直接保留引用（由 safeStringify 后续阶段处理）。
- `normalizeVuexArgs(typeOrAction, payload)`：返回 `{ type, payload }`：
  - 若 `typeOrAction` 是字符串 → `{ type: typeOrAction, payload }`；
  - 若 `typeOrAction` 是对象 → `{ type: typeOrAction.type, payload: { ...typeOrAction } }`（对象签名时 payload 等于完整浅拷贝（含 type），与 Vuex 4 官方语义对齐）；
  - 兜底返回 `{ type: String(typeOrAction), payload }`。

### 3.5 在 inject.iife.ts 顶部读取 `__SHIELD_REDACT_FIELDS__`

- 在文件顶部通过 `declare global` 扩展 window 类型，避免 `(window as any)` 类型逃逸：

  ```typescript
  declare global {
    interface Window {
      __SHIELD_REDACT_FIELDS__?: string[];
    }
  }

  const SHIELD_REDACT_FIELDS: string[] = window.__SHIELD_REDACT_FIELDS__ ?? [];
  ```

- 后续 `redactValue(value, SHIELD_REDACT_FIELDS)` 调用统一使用该常量。
- 字段名单为空时 `redactValue` 静默返回原值（脱敏降级）。

---

## 4. 测试计划

### 4.1 单元测试

> T1 单元测试集中在 `tests/`。inject.iife.ts 的工具函数在 T6 中通过 page.evaluate 浏览器端断言覆盖，或拆出独立 lib/inject-utils.ts 模块供 ESM import + inject.iife.ts 内通过 IIFE 内引用。本任务的 verification 主要通过 typecheck + 编辑器后构建产物比对 + 简单 smoke 测试。

- **类型测试**：`pnpm typecheck` 零错误。
- **构建**：`pnpm build` 成功生成 `lib/inject.iife.js`（IIFE 产物）。
- **smoke**：启动 shield 子命令，传入 `--redact-body-fields=password,token`，在浏览器中通过 `page.evaluate(() => (window as any).__SHIELD_REDACT_FIELDS__)` 校验为 `['password','token']`；不传时为 `undefined`。
- **工具函数行为**（在 T6 浏览器端断言）：
  - `redactValue({ password: '123', nested: { token: 'abc' } }, ['password','token'])` → `{ password: '[REDACTED]', nested: { token: '[REDACTED]' } }`
  - `redactValue([{ token: 'x' }], ['token'])` → `[{ token: '[REDACTED]' }]`
  - **TC-11b 边界补充**：
    - `redactValue([], ['token'])` → `[]`（空数组返回空数组）
    - `redactValue({ password: 'a\n"b\\c\u0000' }, ['password'])` → `{ password: '[REDACTED]' }`，且经 `safeStringify` 后 JSON 合法（特殊字符序列化不抛错）
    - `redactValue(new Map([['token','x']]), ['token'])` → 返回原 Map 引用（不展开递归）
    - `redactValue(new Set(['token']), ['token'])` → 返回原 Set 引用
    - `redactValue(new Date('2026-06-22'), ['date'])` → 返回原 Date 引用
  - `buildStateSummary({ a: 1, b: 2 })` → `stateKeys === ['a','b']`、`typeof stateSizeBytes === 'number'`、`stateSizeBytes > 0`、`stateTruncated === false`
  - `buildStateSummary(circular)` → `stateUnserializable === true` 且 `stateKeys` 仍正确
  - `normalizeVuexArgs('foo/bar', { x: 1 })` → `{ type: 'foo/bar', payload: { x: 1 } }`
  - `normalizeVuexArgs({ type: 'foo/bar', x: 1 })` → `{ type: 'foo/bar', payload: { type: 'foo/bar', x: 1 } }`

### 4.2 集成测试 / 端到端测试

- 不涉及，由 T6 在浏览器侧通过 fixture 综合验证。

### 4.3 回归测试

- 既有 `tests/utils.test.ts` 全绿（`redactBody` 行为未被本任务改动）；
- 既有 `tests/start-page.test.ts` / `tests/vue3-monitor.test.ts` 全绿（`addInitScript` 顺序未被本任务破坏）。

---

## 5. 风险与依赖

| 风险 / 依赖 | 影响 | 应对措施 |
|---|---|---|
| `redactValue` 与 `redactBody` 行为不一致 | 服务端与浏览器端脱敏结果不同源 | 严格按 [utils.redactBody](file:///Users/creayma/personal/legacy-shield/lib/utils.ts#L118) 实现递归 + includes + toLowerCase，T6 用同一字段集合横向断言 |
| inject.iife.ts 中工具函数体积增大 | IIFE 注入耗时增加 | 工具函数控制在 50 行内；构建后 inject.iife.js 体积监控（不超过 +5KB） |
| `Map/Set` 等非 plain object 进入 redactValue | 浅拷贝失真 | 显式跳过非 plain object 的展开（保留引用），交由 safeStringify 处理；TC-13/14 覆盖 |

---

## 6. 变更范围

- **本任务范围内**：types.ts、browser.ts、cli/shield.ts、inject.iife.ts 的「工具函数 + addInitScript 顶部读取」部分。
- **不在本任务范围内**：
  - `patchPinia` / `patchVuex` 实现（由 T2 / T3 负责）；
  - `logger.ts` / `analyzer.ts` 白名单扩展（由 T5 负责）；
  - 测试夹具 HTML 与 vendor 文件（由 T6 负责）；
  - **不修改 `lib/proxy.ts` 中 `redactBodyFields` 解析逻辑**（已在现网正常工作，本任务仅复用其字段名单透传至浏览器端）。

---

## 7. 评审记录

| 轮次 | 日期 | 结论 | P0/P1 问题 | 修复方案 |
|---|---|---|---|---|
| 1 | 2026-06-22 | 不通过 → 修订后待重评 | P0-1 §3.4 buildStateSummary 返回字段与设计 §2.2 ContextStateSummary 不一致（简写 keys/sizeBytes/truncated）；P0-2 §4.1 "拆分实现 + 单独 export 给测试" 方案对 IIFE 内函数不可行（vitest 无法 import IIFE 内部符号）；P1-2 §3.2 addInitScript 注入位置缺少行号锚点；P1-3 §3.2 StartBrowserOptions 解构未给出代码片段；P1-4 §4.1 TC-11b 缺少空数组 / 特殊字符 / Map/Set/Date 边界；P1-5 §3.4 normalizeVuexArgs 对象签名注释"去除 type 后剩余为 payload"与代码及 Vuex 4 语义不一致；P2-3 §3.5 使用 `(window as any)` 类型逃逸；P2-6 §6 未声明 `lib/proxy.ts` 解析逻辑保持不动 | P0-1 §3.4 增加「字段名以设计 §2.2 为准」显式声明，统一使用 stateKeys/stateSizeBytes/stateTruncated/stateUnserializable；P0-2 §4.1 删除「拆分实现 + 单独 export」描述，改为「T6 page.evaluate 浏览器端断言」或「拆出独立 lib/inject-utils.ts 模块 ESM import + IIFE 内引用」；P1-2 §3.2 显式锚定 enableReactPatch 注入块（L50-L54）之后、recentResourceErrors 声明（L56）之前；P1-3 §3.2 给出完整解构代码片段，`redactBodyFields` 不带默认值；P1-4 §4.1 TC-11b 补充空数组、特殊字符序列化、Map/Set/Date 返回原值用例；P1-5 §3.4 注释改为「对象签名时 payload 等于完整浅拷贝（含 type），与 Vuex 4 官方语义对齐」；P2-3 §3.5 增加 `declare global { interface Window { __SHIELD_REDACT_FIELDS__?: string[] } }` 类型扩展，使用 `?? []`；P2-6 §6 「不在本任务范围内」补充「不修改 lib/proxy.ts 中 redactBodyFields 解析逻辑」 |
