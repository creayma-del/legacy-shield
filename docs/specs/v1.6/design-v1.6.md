# legacy-shield v1.6 设计文档

> 版本：v1.6
> 对应需求文档：[requirements-v1.6.md](requirements-v1.6.md)
> 对应需求分解文档：[requirements-decomposition-v1.6.md](requirements-decomposition-v1.6.md)
> 状态：已完成，已归档（冻结，不再修改）

> 评审记录：
> - 第一轮评审（2026-06-23）：不通过，发现 3 个 P0 + 7 个 P1 问题
> - 第二轮重评（2026-06-23）：通过，含 P2 优化项已现场处理（P2-1 ~ P2-7 共 7 项文档一致性问题已修复）

---

## 1. 总体架构

v1.6 在 v1.4（Pinia/Vuex 错误采集）与 v1.5（知识图谱）基础上进行能力增强，不改变整体架构分层，仅对两个既有模块进行内部增强：

### 1.1 架构分层（不变）

```
┌─────────────────────────────────────────────────────────┐
│                    CLI 层 (src/cli.ts)                   │
├─────────────────────────────────────────────────────────┤
│  运行时采集层 (lib/inject.iife.ts)  │  知识图谱层 (lib/knowledge-graph/) │
│  ┌─────────────────────────────┐    │  ┌────────────────────────────┐  │
│  │ patchApp → patchPinia       │    │  │ createResolver → ModuleResolver │  │
│  │ patchVuex / patchErrorHandler│   │  │ scanner → graph → analyzer │  │
│  └─────────────────────────────┘    │  └────────────────────────────┘  │
├─────────────────────────────────────────────────────────┤
│              分析层 / 报告层 / API 层 (lib/)              │
└─────────────────────────────────────────────────────────┘
```

### 1.2 v1.6 变更范围

| 模块 | 变更类型 | 涉及文件 |
|---|---|---|
| Pinia _p 数组包装 | 内部增强 | `lib/inject.iife.ts`（patchPinia 函数） |
| Vuex strict errorHandler 协同 | 内部增强 | `lib/inject.iife.ts`（patchErrorHandler / patchVuex 函数） |
| jiti 配置加载器 | 新增模块 | `lib/knowledge-graph/config-loader.ts`（新建） |
| vite alias 解析 | 新增模块 | `lib/knowledge-graph/config-loader.ts`（新建） |
| webpack alias 解析 | 新增模块 | `lib/knowledge-graph/config-loader.ts`（新建） |
| alias 优先级合并 + resolver 集成 | 内部增强 | `lib/knowledge-graph/resolver.ts`（createResolver 函数） |
| aliasHash 扩展 | 内部增强 | `lib/knowledge-graph/scanner.ts`（computeAliasHash 函数）+ `lib/knowledge-graph/index.ts`（readTsconfig 调用点） |
| 依赖提升 | 配置变更 | `package.json`（jiti 从 devDependencies 移至 dependencies） |

### 1.3 设计原则

1. **零侵入**：不改变业务系统使用方式，不新增 CLI 参数。
2. **防御性降级**：所有私有 API 访问（`_p`、`_s`、`_committing`）均含类型与存在性检查，失败时静默降级。
3. **去重协同**：复用现有 `__shield_emitted__` 标记机制，避免多通道重复落盘。
4. **优先级合并**：alias 来源按 tsconfig > vite > webpack 优先级合并，高优先级不被低优先级覆盖。
5. **性能约束**：配置文件解析耗时 < 500ms，仅执行一次，不进入并发扫描阶段。

---

## 2. 模块详细设计

### 2.1 Pinia _p 数组包装（T1）

#### 2.1.1 职责

在 `patchPinia` 中访问 Pinia 2.x 内部 `_p` 数组（已注册但尚未 install 的 plugin 列表），逐个包装 plugin function 为 try/catch，使 plugin install 阶段抛错能被 shield 捕获并落盘为 `pinia-plugin-error`。

#### 2.1.2 问题根因

Pinia 2.x 的 `pinia.use(plugin)` 仅将 plugin push 至内部 `_p` 数组。Plugin 的 install 在 store 首次实例化时由 Pinia store 工厂内部遍历 `_p` 调用。当前 `patchPinia` 的 `pinia.use` 包装层（L784-796）仅能捕获 `originalUse(plugin)` 自身的同步抛错，无法捕获 store 实例化时遍历 `_p` 调用 plugin install 的异步路径异常。

#### 2.1.3 内部关键设计

**修改位置**：`lib/inject.iife.ts` 的 `patchPinia` 函数（L774-836），在现有「3) 兜底：补登已注册 store」之前新增「2.5) 包装 `_p` 数组中的 plugin」。

**包装策略**：

```typescript
// 2.5) v1.6：遍历 _p 数组，逐个包装 plugin 为 try/catch
//      覆盖 plugin install 在 store 实例化时异步调用的路径
//      Pinia plugin 支持两种形态：function 形态与 { install: Function } 对象形态
const plugins = pinia._p as unknown[] | undefined;
if (Array.isArray(plugins)) {
  for (let i = 0; i < plugins.length; i++) {
    const originalPlugin = plugins[i];
    // 避免重复包装（__shield_wrapped_plugin__ 标记）
    if (originalPlugin && typeof (originalPlugin as Record<string, unknown>).__shield_wrapped_plugin__ === true) continue;

    if (typeof originalPlugin === 'function') {
      // function 形态：包装为 shieldWrappedPlugin
      const wrappedPlugin = function shieldWrappedPlugin(...args: unknown[]): unknown {
        try {
          return (originalPlugin as (...a: unknown[]) => unknown).apply(this, args);
        } catch (err) {
          if (!isShieldEmitted(err)) {
            markShieldEmitted(err);
            emitRuntime('pinia-plugin-error', buildPiniaPluginErrorDetail(err, originalPlugin, appId), 'error');
          }
          throw err;
        }
      };
      (wrappedPlugin as Record<string, unknown>).__shield_wrapped_plugin__ = true;
      (wrappedPlugin as Record<string, unknown>).__shield_original_plugin__ = originalPlugin;
      plugins[i] = wrappedPlugin;
    } else if (originalPlugin && typeof (originalPlugin as Record<string, unknown>).install === 'function') {
      // 对象形态：包装 install 方法
      const obj = originalPlugin as Record<string, unknown>;
      const originalInstall = obj.install as (...a: unknown[]) => unknown;
      obj.install = function shieldWrappedInstall(...args: unknown[]): unknown {
        try { return originalInstall.apply(this, args); }
        catch (err) {
          if (!isShieldEmitted(err)) {
            markShieldEmitted(err);
            emitRuntime('pinia-plugin-error', buildPiniaPluginErrorDetail(err, originalPlugin, appId), 'error');
          }
          throw err;
        }
      };
      obj.__shield_wrapped_plugin__ = true;
    }
  }
}
```

**关键设计决策**：

1. **function 形态与对象形态统一处理**：Pinia plugin 可以是 function 或 `{ install: Function }` 对象。上述代码通过 `if/else if` 分支统一处理两种形态，确保所有 plugin install 抛错均被捕获。

2. **与 `pinia.use` 包装层协同**：`pinia.use` 包装层（L784-796）在 plugin 被 push 到 `_p` 之前捕获同步抛错；`_p` 包装层在 plugin 被 store 工厂遍历调用时捕获 install 抛错。两者通过 `__shield_emitted__` 去重，不会重复落盘。

3. **包装后 plugin push 顺序不变**：原地替换 `plugins[i]`（function 形态）或修改 `obj.install`（对象形态），不改变 `_p` 数组长度与顺序，不影响 Pinia store 工厂遍历逻辑。

4. **`__shield_wrapped_plugin__` 防重复标记**：避免 `patchPinia` 被多次调用时重复包装同一 plugin。

#### 2.1.4 对外接口

无新增接口。`patchPinia` 签名不变：`(pinia: Record<string, unknown>, appId: string): void`。

#### 2.1.5 数据结构

无新增数据结构。复用现有 `buildPiniaPluginErrorDetail`、`isShieldEmitted`、`markShieldEmitted`、`emitRuntime`。

---

### 2.2 Vuex strict errorHandler 协同（T2）

#### 2.2.1 职责

在 `patchVuex` 阶段注册 Vue `app.config.errorHandler` 协同捕获链路，使 Vuex 4 strict mode 通过 Vue 3 异步 watcher 触发的违规错误能被 shield 捕获并落盘为 `vuex-strict-violation`。

#### 2.2.2 问题根因

Vuex 4 strict mode 通过 `store._withCommit` 内部 `watch(state, () => { if (!store._committing) assert() })` 实现。当 state 在 mutation 外被修改时，watcher 在 Vue 3 reactivity 默认 flush 时机（异步微任务）触发，抛出的错误逃出 commit 包装的 try/catch，落入 Vue `app.config.errorHandler`。当前 `patchErrorHandler`（L491-502）仅 emit `vue-render-error`，未识别 Vuex strict 违规。

#### 2.2.3 内部关键设计

**修改位置 1**：`lib/inject.iife.ts` 的 `patchVuex` 函数（L931），新增 strict store 注册表。

**修改位置 2**：`lib/inject.iife.ts` 的 `patchErrorHandler` 函数（L491-502），新增 Vuex strict 违规识别逻辑。

**设计 A：strict store 注册表**

在 `patchVuex` 中将 strict store 注册到模块级 Map，供 errorHandler 查询：

```typescript
// 模块级 strict store 注册表（appId → store[]）
// 注意：inject.iife.ts 运行在浏览器 window 上下文，WeakRef 是 ES2021 特性
// （Chrome 84+/Firefox 84+/Safari 14.1+），不支持时降级为不注册（errorHandler 仍可 emit）
const strictStoresByApp = typeof WeakRef !== 'undefined'
  ? new Map<string, WeakRef<Record<string, unknown>>[]>()
  : null;
```

> 使用 `WeakRef` 避免 shield 注册表阻止 store 被 GC 回收。注册表仅存储「strict === true」的 store。浏览器不支持 `WeakRef` 时（ES2021 之前的老项目），`strictStoresByApp` 为 null，`findStrictStore` 返回 null，errorHandler 仍可 emit `vuex-strict-violation`（detail 中 store 上下文为空）。

在 `patchVuex` 末尾新增注册逻辑：

```typescript
// 5) v1.6：若 store.strict === true，注册到 strictStoresByApp 供 errorHandler 协同识别
if (store.strict === true && strictStoresByApp !== null) {
  const list = strictStoresByApp.get(appId) ?? [];
  list.push(new WeakRef(store));
  strictStoresByApp.set(appId, list);
}
```

**设计 B：patchErrorHandler 增强**

修改 `patchErrorHandler`，遵循 REQ-1.6-5「先调用业务 errorHandler 再执行 shield 识别逻辑」的链式调用顺序，在 emit `vue-render-error` 之前增加 Vuex strict 违规识别：

```typescript
function patchErrorHandler(config: Record<string, unknown>, appId: string): void {
  const originalErrorHandler = config.errorHandler as ((err: unknown, instance: unknown, info: string) => void) | undefined;
  config.errorHandler = (err: unknown, instance: unknown, info: string): void => {
    // 1) 先调用业务 errorHandler（REQ-1.6-5 链式调用保障，不吞错）
    if (typeof originalErrorHandler === 'function') {
      try { originalErrorHandler(err, instance, info); } catch { /* 用户 handler 抛错不阻断 emit */ }
    } else {
      // 无原始 handler 时保留 Vue 默认控制台输出
      originalConsole.error(err, info);
    }
    // 2) v1.6：Vuex strict 违规协同识别（shield 识别逻辑在业务 handler 之后）
    if (tryEmitVuexStrictViolation(err, appId)) {
      return; // strict 违规已 emit，不再重复 emit vue-render-error
    }
    // 3) 既有逻辑：emit vue-render-error
    emitRuntime('vue-render-error', buildVueErrorDetail(err, instance, info, appId), 'error');
  };
}
```

**设计 C：tryEmitVuexStrictViolation 辅助函数**

```typescript
/**
 * v1.6：识别 Vuex strict 违规并 emit vuex-strict-violation。
 * 匹配条件：err 为 Error 且 message 匹配 Vuex strict 固定语义。
 * 关联 store：从 strictStoresByApp 中查找 strict === true 且 _committing === false 的 store。
 * @returns true 表示这是 strict 违规（已 emit 或已被其他通道 emit，调用方不应再 emit vue-render-error）；
 *          false 表示非 strict 违规，调用方继续既有逻辑
 */
function tryEmitVuexStrictViolation(err: unknown, appId: string): boolean {
  if (!(err instanceof Error)) return false;
  const STRICT_MSG = /do not mutate vuex store state outside mutation handlers/i;
  if (!STRICT_MSG.test(err.message)) return false;
  // 去重：已被其他通道（如 commit 包装层）emit 的 strict 违规不再重复落盘，
  // 但仍返回 true 以阻止 errorHandler 重复 emit vue-render-error
  if (isShieldEmitted(err)) return true;
  markShieldEmitted(err);
  // 从注册表查找关联 store（best-effort，找不到时仍 emit，detail 中 store 上下文为空）
  const store = findStrictStore(appId);
  const detail = buildVuexStrictViolationDetail(err, store, appId);
  emitRuntime('vuex-strict-violation', detail, 'error');
  return true;
}
```

**设计 D：findStrictStore 辅助函数**

```typescript
/**
 * 从 strictStoresByApp 注册表中查找有效的 strict store。
 * 清理已被 GC 回收的 WeakRef。
 * 浏览器不支持 WeakRef 时（strictStoresByApp 为 null），返回 null。
 */
function findStrictStore(appId: string): Record<string, unknown> | null {
  if (!strictStoresByApp) return null; // 浏览器不支持 WeakRef
  const list = strictStoresByApp.get(appId);
  if (!list || list.length === 0) return null;
  for (let i = list.length - 1; i >= 0; i--) {
    const ref = list[i];
    const store = ref.deref();
    if (!store) {
      // WeakRef 已被 GC，清理
      list.splice(i, 1);
      continue;
    }
    // 二次确认 store 仍为 strict 且当前不在 mutation 上下文
    if (store.strict === true && (store as { _committing?: unknown })._committing === false) {
      return store;
    }
  }
  // 未找到 _committing === false 的 store 时，返回第一个有效 strict store（best-effort）
  for (const ref of list) {
    const store = ref.deref();
    if (store && store.strict === true) return store;
  }
  return null;
}
```

**设计 E：buildVuexStrictViolationDetail 辅助函数**

```typescript
/**
 * v1.6：构建 vuex-strict-violation 的 detail 结构。
 * 与 v1.4 commit 包装路径产出的 vuex-strict-violation detail 结构对齐。
 */
function buildVuexStrictViolationDetail(
  err: unknown,
  store: Record<string, unknown> | null,
  appId: string,
): Record<string, unknown> {
  return {
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack ?? '' : '',
    source: 'vuex-strict-errorhandler',
    context: {
      appId,
      ...(store ? {
        modulePath: '',
        mutatedKeyPath: 'unknown',
        ...buildStateSummary(store.state),
      } : {}),
    },
  };
}
```

> `source: 'vuex-strict-errorhandler'` 用于区分经 errorHandler 协同捕获（v1.6）与经 commit 包装捕获（v1.4）两条路径。`mutatedKeyPath: 'unknown'` 因 errorHandler 路径无 mutation 上下文，无法推断具体 key path（与 v1.4 设计一致，Proxy 精确定位不在范围内）。

#### 2.2.4 关键设计决策

1. **errorHandler 链式调用顺序**：遵循 REQ-1.6-5「先调用业务 errorHandler 再执行 shield 识别逻辑」。先调用 `originalErrorHandler`（业务 handler），再执行 `tryEmitVuexStrictViolation`（shield 识别）。理由：与现有 `patchErrorHandler` 的既有模式一致（先调用业务 handler 再 emit），业务 handler 的执行结果不影响 shield 识别逻辑；若业务 handler 抛错，shield 仍能完成识别与 emit。

2. **strict 违规不再重复 emit vue-render-error**：`tryEmitVuexStrictViolation` 返回 true 时，errorHandler 提前 return，不再走 `emitRuntime('vue-render-error', ...)`。通过 `__shield_emitted__` 标记确保即使其他通道（commit 包装层）也捕获到同一错误时不会重复落盘。

3. **WeakRef 防内存泄漏**：strict store 注册表使用 `WeakRef`，避免 shield 注册表阻止业务 store 被 GC 回收。`findStrictStore` 在查找时清理已被 GC 的 WeakRef。

4. **patchErrorHandler 与 patchVuex 执行顺序**：`patchApp`（L478-489）先调用 `patchErrorHandler`，后经 `patchAppUse` → `patchVuex`。因此 `patchErrorHandler` 包装 errorHandler 时，`strictStoresByApp` 可能为空（Vuex 尚未 patch）。这不是问题：errorHandler 是闭包，在 strict 违规实际触发时（运行期）才查询 `strictStoresByApp`，此时 patchVuex 已完成注册。

5. **与 commit 包装层去重**：若 strict 违规同时被 commit 包装层（同步路径）和 errorHandler（异步路径）捕获，`__shield_emitted__` 标记确保只落盘一次。commit 包装层先标记（同步），errorHandler 后检查（异步），不会重复。

#### 2.2.5 对外接口

无新增接口。`patchVuex` 与 `patchErrorHandler` 签名不变。

#### 2.2.6 数据结构

| 数据结构 | 类型 | 作用域 | 说明 |
|---|---|---|---|
| `strictStoresByApp` | `Map<string, WeakRef<Record<string, unknown>>[]> \| null` | 模块级 | appId → strict store WeakRef 列表（浏览器不支持 WeakRef 时为 null） |

---

### 2.3 jiti 配置加载器（T4）

#### 2.3.1 职责

新建 `lib/knowledge-graph/config-loader.ts`，实现 `loadConfigFile` 函数，使用 jiti 加载 JS/TS 格式的构建配置文件（webpack.config / vite.config），处理 ESM/CJS 互操作，加载失败时静默降级。

#### 2.3.2 内部关键设计

**新建文件**：`lib/knowledge-graph/config-loader.ts`

**核心函数**：

```typescript
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createJiti } from 'jiti';

/**
 * 使用 jiti 加载 JS/TS 配置文件。
 * 支持 ESM/CJS 互操作：jiti 会自动处理 export default / module.exports / exports.xxx。
 *
 * @param configPath 配置文件绝对路径
 * @returns 解析后的配置对象，或 null（加载失败时静默降级）
 */
export function loadConfigFile(configPath: string): Record<string, unknown> | null {
  if (!existsSync(configPath)) return null;
  try {
    const jiti = createJiti(configPath, {
      // 互操作选项：自动处理 ESM/CJS 默认导出
      interopDefault: true,
      // 不缓存编译结果到磁盘（配置文件仅加载一次，无需缓存）
      fsCache: false,
      // 不启用 source map（配置文件无需调试）
      sourceMaps: false,
    });
    const mod = jiti(configPath);
    // jiti 互操作后，mod 可能为：
    // - { default: {...} }（ESM export default）
    // - {...}（CJS module.exports）
    // - { default: fn, ... }（函数式配置，本任务不支持，返回 null）
    const config = (mod as { default?: unknown }).default ?? mod;
    if (typeof config === 'function') {
      // 函数式配置不支持（REQ-1.6-13 排除项）
      return null;
    }
    if (config && typeof config === 'object') {
      return config as Record<string, unknown>;
    }
    return null;
  } catch {
    // 加载失败时静默降级为无 alias
    return null;
  }
}

/**
 * 在项目根目录下查找构建配置文件。
 * 查找顺序：vite.config.ts → vite.config.js → webpack.config.ts → webpack.config.js
 *
 * @param projectRoot 项目根目录
 * @param tool 目标构建工具 ('vite' | 'webpack')
 * @returns 配置文件绝对路径，或 null（未找到）
 */
export function findBuildConfig(
  projectRoot: string,
  tool: 'vite' | 'webpack',
): string | null {
  const candidates =
    tool === 'vite'
      ? ['vite.config.ts', 'vite.config.js', 'vite.config.mts', 'vite.config.mjs']
      : ['webpack.config.ts', 'webpack.config.js', 'webpack.config.mts', 'webpack.config.mjs'];
  for (const name of candidates) {
    const path = join(projectRoot, name);
    if (existsSync(path)) return path;
  }
  return null;
}
```

**关键设计决策**：

1. **jiti 版本**：使用项目已有的 `jiti@^2.6.1`（当前在 devDependencies，T4 移至 dependencies）。jiti 2.x API 为 `createJiti(filename, options)` 返回 jiti 实例，再调用 `jiti(filename)` 加载模块。

2. **interopDefault: true**：vite.config.ts 通常使用 `export default defineConfig({...})`，jiti 互操作后 `mod.default` 即为配置对象。webpack.config.js 通常使用 `module.exports = {...}`，jiti 互操作后 `mod` 本身即为配置对象。`mod.default ?? mod` 统一处理两种情况。

3. **函数式配置排除**：`defineConfig((env) => ({...}))` 返回函数，REQ-1.6-13 明确排除函数式配置。检测到 `typeof config === 'function'` 时返回 null。

4. **缓存策略**：`fsCache: false`（jiti 2.x 中 `cache` 已废弃，使用 `fsCache`），配置文件仅加载一次，无需缓存编译结果。

5. **jiti __dirname 语义**：jiti 在加载配置文件时，配置文件内的 `__dirname` 会被正确设置为配置文件所在目录。因此 webpack.config.js 中的 `path.resolve(__dirname, 'src')` 能正确解析为项目根目录下的 `src` 绝对路径。

#### 2.3.3 对外接口

| 接口 | 输入 | 输出 | 异常 | 备注 |
|---|---|---|---|---|
| `loadConfigFile(configPath)` | 配置文件绝对路径 | 配置对象 或 null | 无（catch 降级） | 静默降级 |
| `findBuildConfig(projectRoot, tool)` | 项目根目录、目标工具 | 配置文件路径 或 null | 无 | 查找顺序固定 |

#### 2.3.4 数据结构

无新增数据结构。

---

### 2.4 vite alias 解析（T5）

#### 2.4.1 职责

解析 vite.config 的 `resolve.alias` 配置，支持对象格式与数组格式，输出统一的 `AliasEntry[]` 结构。

#### 2.4.2 内部关键设计

**新建函数**（位于 `lib/knowledge-graph/config-loader.ts`）：

```typescript
export interface AliasEntry {
  /** alias 前缀（如 '@'、'~/') */
  find: string;
  /** 替换目标绝对路径 */
  replacement: string;
}

/**
 * 从 vite 配置对象中提取 resolve.alias。
 * 支持两种格式：
 * - 对象格式：{ '@': '/src', '~/': '/src' }
 * - 数组格式：[{ find: '@', replacement: '/src' }, ...]
 *
 * @param config vite 配置对象
 * @param projectRoot 项目根目录（用于将相对路径解析为绝对路径）
 * @returns AliasEntry[]，或空数组（无 alias 或解析失败）
 */
export function parseViteAlias(
  config: Record<string, unknown>,
  projectRoot: string,
): AliasEntry[] {
  const resolve = config.resolve as Record<string, unknown> | undefined;
  if (!resolve) return [];
  const alias = resolve.alias;
  if (!alias) return [];

  const entries: AliasEntry[] = [];

  if (Array.isArray(alias)) {
    // 数组格式：[{ find, replacement }, ...]
    for (const item of alias) {
      if (!item || typeof item !== 'object') continue;
      const find = (item as Record<string, unknown>).find;
      const replacement = (item as Record<string, unknown>).replacement;
      if (typeof find === 'string' && typeof replacement === 'string') {
        entries.push({
          find,
          replacement: resolveAbsolutePath(replacement, projectRoot),
        });
      }
    }
  } else if (alias && typeof alias === 'object') {
    // 对象格式：{ '@': '/src', '~/': '/src' }
    for (const [find, replacement] of Object.entries(alias as Record<string, unknown>)) {
      if (typeof replacement === 'string') {
        entries.push({
          find,
          replacement: resolveAbsolutePath(replacement, projectRoot),
        });
      }
    }
  }

  return entries;
}

/**
 * 将 alias replacement 路径解析为绝对路径。
 * vite alias replacement 通常为绝对路径或项目相对路径。
 */
function resolveAbsolutePath(p: string, projectRoot: string): string {
  if (p.startsWith('/')) return p; // 已是绝对路径
  return join(projectRoot, p);
}
```

**关键设计决策**：

1. **对象格式与数组格式均支持**：vite 官方两种格式均常见，必须全支持。

2. **replacement 路径解析**：vite alias 的 replacement 通常为绝对路径（如 `path.resolve(__dirname, 'src')`，经 jiti 加载后 `__dirname` 已正确求值）。但也可能为相对路径（如 `'./src'`），统一用 `resolveAbsolutePath` 处理。

3. **正则 alias 排除**：vite 数组格式支持 `find` 为 RegExp（如 `find: /^@\/components\//`）。REQ-1.6-13 明确排除正则 alias。检测 `typeof find !== 'string'` 时跳过。

4. **输出统一 AliasEntry[]**：与 webpack alias 解析输出统一，便于 T7 优先级合并。

#### 2.4.3 对外接口

| 接口 | 输入 | 输出 | 异常 | 备注 |
|---|---|---|---|---|
| `parseViteAlias(config, projectRoot)` | vite 配置对象、项目根目录 | `AliasEntry[]` | 无 | 静默降级返回空数组 |

---

### 2.5 webpack alias 解析（T6）

#### 2.5.1 职责

解析 webpack.config 的 `resolve.alias` 配置，支持对象格式，输出统一的 `AliasEntry[]` 结构。

#### 2.5.2 内部关键设计

**新建函数**（位于 `lib/knowledge-graph/config-loader.ts`）：

```typescript
/**
 * 从 webpack 配置对象中提取 resolve.alias。
 * 支持对象格式：{ '@': path.resolve(__dirname, 'src') }
 *
 * 注意：webpack resolve.alias 仅支持对象格式（数组格式为 resolve.plugins 中的插件，不在范围内）。
 * webpack.config.js 中的 path.resolve(__dirname, 'src') 已在 jiti 加载时正确求值为绝对路径。
 *
 * @param config webpack 配置对象
 * @param projectRoot 项目根目录（用于将相对路径解析为绝对路径，兜底）
 * @returns AliasEntry[]，或空数组（无 alias 或解析失败）
 */
export function parseWebpackAlias(
  config: Record<string, unknown>,
  projectRoot: string,
): AliasEntry[] {
  const resolve = config.resolve as Record<string, unknown> | undefined;
  if (!resolve) return [];
  const alias = resolve.alias;
  if (!alias || typeof alias !== 'object') return [];

  const entries: AliasEntry[] = [];

  for (const [find, replacement] of Object.entries(alias as Record<string, unknown>)) {
    if (typeof replacement === 'string') {
      entries.push({
        find,
        replacement: resolveAbsolutePath(replacement, projectRoot),
      });
    } else if (replacement && typeof replacement === 'object') {
      // webpack 5 支持对象形态 alias：{ alias: { '@': { path: '/src', exact: false } } }
      const aliasObj = replacement as Record<string, unknown>;
      const path = aliasObj.path;
      if (typeof path === 'string') {
        entries.push({
          find,
          replacement: resolveAbsolutePath(path, projectRoot),
        });
      }
    }
  }

  return entries;
}
```

**关键设计决策**：

1. **对象格式为主**：webpack `resolve.alias` 官方仅支持对象格式。数组格式属于 `resolve.plugins`（AliasPlugin），不在范围内。

2. **对象形态 alias 兼容**：webpack 5 支持 `{ '@': { path: '/src', exact: false } }` 对象形态。检测 `replacement.path` 字段。`exact` 等其他字段忽略（不影响路径解析）。

3. **path.resolve 已求值**：webpack.config.js 中的 `path.resolve(__dirname, 'src')` 在 jiti 加载配置文件时已被执行，`alias` 对象的 value 已是绝对路径字符串。`resolveAbsolutePath` 仅作兜底（处理意外相对路径）。

4. **正则 alias 排除**：webpack 支持 `alias` key 为 RegExp（通过 `resolve.plugins` 的 AliasPlugin）。对象格式 `resolve.alias` 的 key 始终为 string，无需额外检测。

#### 2.5.3 对外接口

| 接口 | 输入 | 输出 | 异常 | 备注 |
|---|---|---|---|---|
| `parseWebpackAlias(config, projectRoot)` | webpack 配置对象、项目根目录 | `AliasEntry[]` | 无 | 静默降级返回空数组 |

---

### 2.6 alias 优先级合并 + resolver 集成（T7）

#### 2.6.1 职责

修改 `createResolver`，自动检测 tsconfig/jsconfig、vite.config、webpack.config，按 tsconfig > vite > webpack 优先级合并 alias，构造支持多来源 alias 的 `ModuleResolver`。

#### 2.6.2 内部关键设计

**修改位置**：`lib/knowledge-graph/resolver.ts` 的 `createResolver` 函数（L100-130）。

**扩展 ResolverOptions**：

```typescript
export interface ResolverOptions {
  projectRoot: string;
  baseUrl?: string;
  paths?: Record<string, string[]>;
  /** v1.6 新增：来自 vite/webpack 的 alias 列表（已按优先级合并） */
  aliases?: AliasEntry[];
}
```

**扩展 ModuleResolver.resolveAlias**：

为确保 tsconfig paths 最高优先级（REQ-1.6-12），`resolveAlias` 先匹配 `paths`（tsconfig），再匹配 `aliases`（vite/webpack 合并后）：

```typescript
private resolveAlias(spec: string): string | null {
  // v1.6：优先匹配 tsconfig paths（最高优先级）
  if (this.opts.paths) {
    for (const [pattern, targets] of Object.entries(this.opts.paths)) {
      const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace('*', '(.*)');
      const regex = new RegExp('^' + escaped + '$');
      const match = spec.match(regex);
      if (match) {
        return targets[0].replace('*', match[1]);
      }
    }
  }
  // v1.6：再匹配 vite/webpack alias（合并后，vite > webpack）
  if (this.opts.aliases) {
    for (const { find, replacement } of this.opts.aliases) {
      if (spec === find || spec.startsWith(find + '/')) {
        const suffix = spec.slice(find.length);
        return replacement + suffix;
      }
    }
  }
  return null;
}
```

**重写 createResolver**：

为避免 `createResolver` 与 `computeAliasHash`（§2.6.3）重复加载配置文件，引入 `loadAliasConfig` 函数并按 `projectRoot` 缓存结果：

```typescript
import { loadAliasConfig } from './config-loader.js';

export function createResolver(projectRoot: string): ModuleResolver {
  // loadAliasConfig 内部加载所有 alias 来源（tsconfig + vite + webpack），并按 projectRoot 缓存
  const aliasConfig = loadAliasConfig(projectRoot);

  return new ModuleResolver({
    projectRoot,
    baseUrl: aliasConfig.baseUrl,
    paths: aliasConfig.paths,
    aliases: aliasConfig.mergedAliases,
  });
}
```

`loadAliasConfig` 在 `config-loader.ts` 中实现，加载所有 alias 来源并缓存：

```typescript
// 模块级缓存（projectRoot → AliasConfig），避免 createResolver 与 computeAliasHash 重复加载
const aliasConfigCache = new Map<string, AliasConfig>();

export interface AliasConfig {
  tsconfig: object | null;
  baseUrl?: string;
  paths?: Record<string, string[]>;
  viteAliases: AliasEntry[];
  webpackAliases: AliasEntry[];
  mergedAliases: AliasEntry[];
}

export function loadAliasConfig(projectRoot: string): AliasConfig {
  const cached = aliasConfigCache.get(projectRoot);
  if (cached) return cached;

  // 1. 收集 tsconfig/jsconfig paths（最高优先级）
  const tsconfigResult = loadTsconfigPaths(projectRoot);

  // 2. 收集 vite alias（中优先级）
  const viteConfigPath = findBuildConfig(projectRoot, 'vite');
  const viteAliases = viteConfigPath
    ? (() => {
        const config = loadConfigFile(viteConfigPath);
        return config ? parseViteAlias(config, projectRoot) : [];
      })()
    : [];

  // 3. 收集 webpack alias（最低优先级）
  const webpackConfigPath = findBuildConfig(projectRoot, 'webpack');
  const webpackAliases = webpackConfigPath
    ? (() => {
        const config = loadConfigFile(webpackConfigPath);
        return config ? parseWebpackAlias(config, projectRoot) : [];
      })()
    : [];

  // 4. 按优先级合并：vite > webpack（tsconfig 优先级在 resolveAlias 中通过匹配顺序保证）
  const mergedAliases = mergeAliases(viteAliases, webpackAliases);

  const result: AliasConfig = {
    tsconfig: tsconfigResult?.raw ?? null,
    baseUrl: tsconfigResult?.baseUrl,
    paths: tsconfigResult?.paths,
    viteAliases,
    webpackAliases,
    mergedAliases,
  };
  aliasConfigCache.set(projectRoot, result);
  return result;
}

/**
 * 按优先级合并 vite 与 webpack alias。
 * 同一 find 前缀只保留最高优先级的 replacement。
 */
function mergeAliases(viteAliases: AliasEntry[], webpackAliases: AliasEntry[]): AliasEntry[] {
  const map = new Map<string, string>();
  // 先放入 webpack（低优先级），后放入 vite（高优先级覆盖）
  for (const { find, replacement } of webpackAliases) {
    if (!map.has(find)) map.set(find, replacement);
  }
  for (const { find, replacement } of viteAliases) {
    map.set(find, replacement); // vite 覆盖 webpack
  }
  return Array.from(map, ([find, replacement]) => ({ find, replacement }));
}
```

> **缓存策略**：`loadAliasConfig` 按 `projectRoot` 缓存结果，确保 `createResolver` 和 `computeAliasHash` 调用时配置文件仅加载一次。缓存为模块级 Map，同一进程内同一项目不会重复加载。

**loadTsconfigPaths 辅助函数**（提取自现有 createResolver 逻辑）：

```typescript
function loadTsconfigPaths(projectRoot: string): { raw: object; baseUrl?: string; paths?: Record<string, string[]> } | null {
  const tsconfigPath = join(projectRoot, 'tsconfig.json');
  const jsconfigPath = join(projectRoot, 'jsconfig.json');
  let configPath: string | null = null;
  if (existsSync(tsconfigPath)) configPath = tsconfigPath;
  else if (existsSync(jsconfigPath)) configPath = jsconfigPath;
  if (!configPath) return null;
  try {
    const raw = readFileSync(configPath, 'utf8');
    const cleaned = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const config = JSON.parse(cleaned);
    const compilerOptions = config.compilerOptions ?? {};
    const baseUrl = compilerOptions.baseUrl ? resolve(projectRoot, compilerOptions.baseUrl) : undefined;
    const paths = compilerOptions.paths;
    return { raw: config, baseUrl, paths };
  } catch {
    return null;
  }
}
```

#### 2.6.3 aliasHash 扩展

`computeAliasHash`（scanner.ts L106-111）当前仅基于 tsconfig paths + baseUrl 计算 hash。v1.6 需扩展为包含 vite/webpack alias，否则 alias 配置变更后缓存不会失效。

**修改 `lib/knowledge-graph/index.ts`**：

将 `readTsconfig` 替换为 `loadAliasConfig`（来自 config-loader.ts），复用 `createResolver` 已缓存的配置，避免重复加载：

```typescript
import { loadAliasConfig } from './config-loader.js';

// runSinglePackageFlow 中修改（既有 readTsconfig + computeAliasHash 替换为）：
const aliasConfig = loadAliasConfig(projectRoot); // 复用 createResolver 的缓存
const aliasHash = computeAliasHash(aliasConfig);
```

**修改 `computeAliasHash`**（scanner.ts）：

```typescript
import type { AliasConfig } from './config-loader.js';

export function computeAliasHash(aliasConfig: AliasConfig | null): string {
  if (!aliasConfig) return 'none';
  const paths = aliasConfig.paths ? aliasConfig.paths : {};
  const baseUrl = aliasConfig.baseUrl ?? '';
  return createHash('md5').update(JSON.stringify({
    paths,
    baseUrl,
    viteAliases: aliasConfig.viteAliases,
    webpackAliases: aliasConfig.webpackAliases,
  })).digest('hex');
}
```

> **注意**：`computeAliasHash` 签名从 `(tsconfig: object | null)` 变为 `(aliasConfig: AliasConfig | null)`，参数语义扩展。调用方 `runSinglePackageFlow`（index.ts L94-95）需同步修改。`loadAliasConfig` 按 `projectRoot` 缓存，`createResolver`（L87）和 `computeAliasHash`（L95）调用时配置文件仅加载一次。

#### 2.6.4 对外接口

| 接口 | 输入 | 输出 | 异常 | 备注 |
|---|---|---|---|---|
| `createResolver(projectRoot)` | 项目根目录 | `ModuleResolver` | 无 | 自动检测所有配置文件 |
| `ModuleResolver.resolve(spec, importer)` | import spec、importer 路径 | 文件绝对路径 或 null | 无 | 优先级：tsconfig > vite > webpack |

#### 2.6.5 数据结构

| 数据结构 | 类型 | 作用域 | 说明 |
|---|---|---|---|
| `AliasEntry` | `{ find: string; replacement: string }` | 模块导出 | 统一 alias 条目结构 |
| `ResolverOptions.aliases` | `AliasEntry[]` | ResolverOptions | vite/webpack 合并后的 alias 列表 |

---

### 2.7 测试恢复策略（T3）

#### 2.7.1 职责

取消 TC-3 / TC-8 / TC-8a1 的 `it.skip`，恢复为活跃测试用例，验证 v1.6 补强的捕获链路正确工作。

#### 2.7.2 测试场景设计

| 测试用例 | 文件 | 验证点 | 依赖 |
|---|---|---|---|
| TC-3 | `tests/pinia-monitor.test.ts` L196 | plugin install 抛错被 `_p` 包装层捕获，落盘为 `pinia-plugin-error`；`pluginName` 字段可选 | T1 |
| TC-8 | `tests/vuex-monitor.test.ts` L210 | mutation 外修改 state 触发 strict 违规，经 errorHandler 协同捕获，落盘为 `vuex-strict-violation` | T2 |
| TC-8a1 | `tests/vuex-monitor.test.ts` L221 | legal mutation 后 strict 违规，`mutatedKeyPath` 非空 | T2 |

#### 2.7.3 实现步骤

1. 将 `it.skip('TC-3: ...')` 改为 `it('TC-3: ...')`
2. 将 `it.skip('TC-8: ...')` 改为 `it('TC-8: ...')`
3. 将 `it.skip('TC-8a1: ...')` 改为 `it('TC-8a1: ...')`
4. 更新测试注释：移除「待 T7 补强」说明，更新为「v1.6 已通过 _p 包装 / errorHandler 协同补强」
5. 确认测试夹具 HTML 文件存在且正确（`vue-pinia-plugin-error.html`、`vue-vuex-strict.html`）

---

### 2.8 测试夹具设计（T8）

#### 2.8.1 职责

新增 webpack-alias-project / vite-alias-project 测试夹具，验证端到端 alias 解析正确性；扩展 resolver / integration / performance 测试。

#### 2.8.2 夹具目录结构

**webpack-alias-project**：

```
tests/knowledge-graph/fixtures/webpack-alias-project/
├── src/
│   ├── utils/
│   │   └── helper.ts      # 被 alias 引用的模块
│   └── main.ts             # import { helper } from '@/utils/helper'
├── webpack.config.js       # resolve.alias: { '@': path.resolve(__dirname, 'src') }
└── package.json
```

**vite-alias-project**：

```
tests/knowledge-graph/fixtures/vite-alias-project/
├── src/
│   ├── utils/
│   │   └── helper.ts      # 被 alias 引用的模块
│   └── main.ts             # import { helper } from '@/utils/helper'
├── vite.config.ts          # resolve.alias: { '@': '/src' }（对象格式）
└── package.json
```

**vite-alias-project-array**（数组格式夹具）：

```
tests/knowledge-graph/fixtures/vite-alias-project-array/
├── src/
│   ├── components/
│   │   └── Button.ts
│   └── main.ts             # import Button from '@/components/Button'
├── vite.config.ts          # resolve.alias: [{ find: '@', replacement: '/src' }]
└── package.json
```

#### 2.8.3 测试用例设计

| 测试文件 | 测试用例 | 验证点 |
|---|---|---|
| `tests/knowledge-graph/resolver.test.ts` | webpack alias 解析 | `@/utils/helper` → `<project>/src/utils/helper.ts` |
| `tests/knowledge-graph/resolver.test.ts` | vite 对象格式 alias 解析 | `@/utils/helper` → `<project>/src/utils/helper.ts` |
| `tests/knowledge-graph/resolver.test.ts` | vite 数组格式 alias 解析 | `@/components/Button` → `<project>/src/components/Button.ts` |
| `tests/knowledge-graph/resolver.test.ts` | 多来源优先级 | tsconfig paths > vite alias > webpack alias |
| `tests/knowledge-graph/integration.test.ts` | webpack alias 端到端 | 依赖图中 `@/utils/helper` 边正确解析 |
| `tests/knowledge-graph/integration.test.ts` | vite alias 端到端 | 依赖图中 `@/utils/helper` 边正确解析 |
| `tests/knowledge-graph/performance.test.ts` | 配置解析耗时 | 单次配置解析 < 500ms |
| `tests/knowledge-graph/performance.test.ts` | 全量扫描性能 | 5000 文件全量 < 30s（v1.5 基线不变） |

---

### 2.9 文档更新（T9）

#### 2.9.1 职责

更新 README / api.md，移除 v1.5 遗留的「不支持 webpack/vite resolve.alias」说明，补充 v1.6 新增能力说明。

#### 2.9.2 README 变更点

1. 知识图谱章节：移除「不支持 webpack/vite resolve.alias 配置解析」限制说明
2. 补充 v1.6 新增能力说明：支持 webpack `resolve.alias`（对象格式）与 vite `resolve.alias`（对象格式 + 数组格式）解析
3. 补充 alias 优先级说明：tsconfig paths > vite alias > webpack alias
4. 补充 Pinia plugin install 异常捕获增强说明（v1.4 R-1 闭环）
5. 补充 Vuex strict 违规 errorHandler 协同捕获说明（v1.4 R-2 闭环）

#### 2.9.3 api.md 变更点

1. 知识图谱 `graph` 子命令说明：补充 webpack/vite alias 支持
2. 运行时采集子类型说明：`pinia-plugin-error` / `vuex-strict-violation` 的 source 字段新增值（`vuex-strict-errorhandler`）

---

## 3. 数据流与状态变更

### 3.1 Pinia plugin install 异常捕获数据流

```
业务代码: pinia.use(badPlugin)
  → patchPinia.pinia.use 包装层: push badPlugin 到 _p（同步路径，无抛错）
  → 业务代码: useFooStore()
  → Pinia store 工厂: 遍历 _p，调用 plugin(context)
  → shieldWrappedPlugin: try { originalPlugin(context) } catch (err)
  → markShieldEmitted(err)
  → emitRuntime('pinia-plugin-error', buildPiniaPluginErrorDetail(err, originalPlugin, appId), 'error')
  → throw err（错误继续冒泡到 useFooStore() 调用点）
```

### 3.2 Vuex strict 违规 errorHandler 协同数据流

```
业务代码: store.state.foo = 'bar'（mutation 外修改）
  → Vuex strict watcher（异步微任务）: assert() 抛错
  → Vue app.config.errorHandler(err, instance, info)
  → shield wrapped errorHandler:
    → 调用业务 originalErrorHandler(err, instance, info)（先调用业务 handler，不吞错）
    → tryEmitVuexStrictViolation(err, appId)（shield 识别逻辑在业务 handler 之后）
      → STRICT_MSG.test(err.message) === true
      → isShieldEmitted(err) === false
      → markShieldEmitted(err)
      → findStrictStore(appId) → 返回关联 store
      → emitRuntime('vuex-strict-violation', buildVuexStrictViolationDetail(err, store, appId), 'error')
      → return true
    → return（不再 emit vue-render-error）
```

### 3.3 alias 解析数据流

```
createResolver(projectRoot)
  → loadTsconfigPaths(projectRoot) → { baseUrl, paths }
  → findBuildConfig(projectRoot, 'vite') → vite.config.ts
  → loadConfigFile(vite.config.ts) → config 对象
  → parseViteAlias(config, projectRoot) → AliasEntry[]
  → findBuildConfig(projectRoot, 'webpack') → webpack.config.js
  → loadConfigFile(webpack.config.js) → config 对象
  → parseWebpackAlias(config, projectRoot) → AliasEntry[]
  → mergeAliases(viteAliases, webpackAliases) → AliasEntry[]（vite > webpack）
  → new ModuleResolver({ projectRoot, baseUrl, paths, aliases })

ModuleResolver.resolve('@/utils/helper', '/src/main.ts')
  → resolveAlias('@/utils/helper')
    → 1. 匹配 tsconfig paths '@/*' → 命中 → 返回 'src/utils/helper'
    → （若 tsconfig 未命中）2. 匹配 aliases '@' → 命中 → 返回 '/src/utils/helper'
  → resolveRelative(aliasResolved, baseUrl ?? projectRoot)
  → tryExtensions(basePath) → '/src/utils/helper.ts'
```

### 3.4 aliasHash 缓存失效数据流

```
runSinglePackageFlow(projectRoot)
  → loadAliasConfig(projectRoot) → { tsconfig, viteAliases, webpackAliases }
  → computeAliasHash(aliasConfig) → MD5 hash（含所有 alias 来源）
  → scanWithCache(filePaths, resolver, concurrency, projectRoot, aliasHash, fresh)
    → 若 cache.aliasHash !== aliasHash → 全量重新扫描
    → 若 cache.aliasHash === aliasHash → 增量扫描（按 mtime）
```

---

## 4. 接口设计

### 4.1 新增接口

| 接口 | 文件 | 输入 | 输出 | 异常 | 备注 |
|---|---|---|---|---|---|
| `loadConfigFile(configPath)` | config-loader.ts | 配置文件绝对路径 | 配置对象 或 null | 无（catch 降级） | jiti 加载 JS/TS |
| `findBuildConfig(projectRoot, tool)` | config-loader.ts | 项目根目录、工具名 | 配置路径 或 null | 无 | 查找 vite/webpack 配置 |
| `parseViteAlias(config, projectRoot)` | config-loader.ts | vite 配置对象、项目根目录 | `AliasEntry[]` | 无 | 对象+数组格式 |
| `parseWebpackAlias(config, projectRoot)` | config-loader.ts | webpack 配置对象、项目根目录 | `AliasEntry[]` | 无 | 对象格式 |
| `AliasEntry` | config-loader.ts | - | `{ find: string; replacement: string }` | - | 统一 alias 结构 |

### 4.2 修改接口

| 接口 | 文件 | 变更内容 | 向后兼容 |
|---|---|---|---|
| `createResolver(projectRoot)` | resolver.ts | 内部扩展为多来源 alias 检测，签名不变 | 是 |
| `ModuleResolver.resolveAlias(spec)` | resolver.ts | 新增 aliases 匹配分支，优先匹配 tsconfig paths | 是 |
| `ResolverOptions` | resolver.ts | 新增 `aliases?: AliasEntry[]` 字段 | 是（可选字段） |
| `computeAliasHash(aliasConfig)` | scanner.ts | 参数从 tsconfig 对象扩展为 alias 配置对象 | 否（参数语义变更，调用方需同步修改） |

### 4.3 不变接口

| 接口 | 文件 | 说明 |
|---|---|---|
| `patchPinia(pinia, appId)` | inject.iife.ts | 签名不变，内部新增 _p 包装 |
| `patchVuex(store, appId)` | inject.iife.ts | 签名不变，内部新增 strict store 注册 |
| `patchErrorHandler(config, appId)` | inject.iife.ts | 签名不变，内部新增 strict 违规识别 |
| `ModuleResolver.resolve(spec, importer)` | resolver.ts | 签名不变，内部 alias 匹配逻辑增强 |
| `runKnowledgeGraph(options)` | index.ts | 签名不变 |
| `RuntimeSubType` | types.ts | 不变（pinia-plugin-error / vuex-strict-violation 已存在） |

---

## 5. 依赖与集成

### 5.1 外部依赖

| 依赖 | 版本 | 用途 | 变更 |
|---|---|---|---|
| jiti | ^2.6.1 | JS/TS 配置文件加载器 | devDependencies → dependencies（T4） |

**jiti 依赖提升影响评估**：

- jiti 为轻量级库（无传递依赖风险），已在 devDependencies 中用于开发期配置加载。
- 提升至 dependencies 后，`pnpm install` 会将其安装至生产环境 node_modules。
- jiti 仅在 `graph` 子命令执行时被动态 import（`createJiti`），不影响 `shield` / `quality` 子命令的运行时性能。
- 构建产物（dist/）中 config-loader.ts 编译后的 JS 会 `require('jiti')`，需确保 jiti 不被 bundle 排除。

### 5.2 与现有系统的集成点

| 集成点 | 模块 | 集成方式 |
|---|---|---|
| patchPinia _p 包装 | inject.iife.ts | 在 patchPinia 函数内新增步骤 2.5 |
| patchVuex strict 注册 | inject.iife.ts | 在 patchVuex 函数末尾新增步骤 5 |
| patchErrorHandler strict 识别 | inject.iife.ts | 在 errorHandler 包装函数内新增 tryEmitVuexStrictViolation 调用 |
| createResolver 多来源 alias | resolver.ts | 重写 createResolver，扩展 ResolverOptions |
| computeAliasHash 扩展 | scanner.ts + index.ts | 修改 readTsconfig → loadAliasConfig，扩展 hash 输入 |
| ModuleResolver.resolveAlias | resolver.ts | 新增 aliases 匹配分支 |

### 5.3 兼容性考虑

1. **向后兼容**：所有新增字段（`ResolverOptions.aliases`）为可选，未传入时 `resolveAlias` 跳过 aliases 匹配，行为与 v1.5 一致。
2. **无 tsconfig/vite/webpack 配置的项目**：`createResolver` 返回无 alias 配置的 `ModuleResolver`，行为与 v1.5 一致。
3. **配置文件解析失败**：`loadConfigFile` 返回 null，`createResolver` 跳过该来源 alias，降级为其他来源或无 alias。
4. **jiti 加载失败**：catch 降级返回 null，不影响知识图谱其他功能（scanner / graph / analyzer 正常执行，仅 alias 解析降级）。
5. **Pinia _p 不存在或非数组**：`Array.isArray(plugins)` 检查失败，跳过 _p 包装，行为与 v1.4 一致。
6. **Vuex store 非 strict**：`store.strict !== true`，不注册到 `strictStoresByApp`，errorHandler 不会误识别。

---

## 6. 非功能性设计

### 6.1 性能

| 指标 | 约束 | 验证方式 |
|---|---|---|
| 配置文件解析耗时 | < 500ms | T8 性能测试用例 |
| 知识图谱全量扫描（5000 文件） | < 30s（v1.5 基线不变） | T8 性能测试用例 |
| Pinia _p 包装开销 | 可忽略（仅 patchPinia 时执行一次） | 无需单独测试 |
| Vuex errorHandler 开销 | 可忽略（仅 strict 违规时执行） | 无需单独测试 |

**性能保障措施**：
- 配置文件解析仅在 `createResolver` 调用时执行一次，不进入并发扫描阶段。
- jiti `fsCache: false` 避免磁盘缓存开销。
- `strictStoresByApp` 使用 `WeakRef`，`findStrictStore` 在查找时清理 GC 回收的引用，避免注册表膨胀。

### 6.2 安全

- alias replacement 路径解析为绝对路径，防止路径穿越（path traversal）。
- jiti 加载配置文件在 Node.js 进程中执行，配置文件来源为项目根目录（可信来源），无远程加载风险。
- `_p` 数组包装不修改 plugin 的执行语义（仅包裹 try/catch），不影响业务逻辑。

### 6.3 可观测性

- `pinia-plugin-error` 的 `source` 字段为 `'pinia-plugin'`（既有），不变。
- `vuex-strict-violation` 的 `source` 字段：
  - 经 commit 包装捕获（v1.4）：`'vuex-store-patch'`（既有）
  - 经 errorHandler 协同捕获（v1.6）：`'vuex-strict-errorhandler'`（新增）
- 通过 `source` 字段可区分两条捕获路径，便于排障与监控。

### 6.4 可维护性

- `config-loader.ts` 独立模块，职责单一（加载配置 + 解析 alias）。
- `AliasEntry` 统一数据结构，vite/webpack alias 解析输出一致。
- `loadTsconfigPaths` 提取为独立函数，与 `createResolver` 解耦。
- 所有新增函数均有 JSDoc 注释，说明输入输出与降级行为。

---

## 7. 风险与回滚方案

| 风险 | 影响 | 应对措施 / 回滚方案 |
|---|---|---|
| Pinia 2.x `_p` 私有 API 变更 | `_p` 数组结构在 Pinia 后续版本可能变更，导致包装失败 | 防御性检查 `Array.isArray(plugins)`；失败时静默降级为 errorHandler 兜底（v1.4 既有行为） |
| Vue errorHandler 已被业务覆盖 | 业务系统可能已设置 `app.config.errorHandler`，shield 包装层需先调用业务 handler | 现有 `patchErrorHandler` 已实现链式调用（先调用业务 handler 再执行 shield 识别），v1.6 延续此模式 |
| jiti 运行时加载性能 | 大型项目配置文件可能含复杂导入链，加载耗时超 500ms | T8 性能测试用例验证；超时时 catch 降级为无 alias（不影响知识图谱其他功能） |
| jiti 依赖提升影响 | jiti 从 devDependencies 移至 dependencies 改变依赖边界 | jiti 为轻量级库无传递依赖风险；构建配置需确保 jiti 不被 bundle 排除 |
| webpack `path.resolve` 调用 | webpack.config.js 中 `path.resolve(__dirname, 'src')` 需被 jiti 正确求值 | jiti 在加载时执行配置文件，`__dirname` 会被正确设置为配置文件所在目录；T8 测试夹具验证 |
| T1/T2 同文件修改冲突 | T1（patchPinia）和 T2（patchErrorHandler/patchVuex）均修改 inject.iife.ts | 修改不同函数，无逻辑冲突；开发时按批次顺序执行（T1 → T2）避免合并冲突 |
| alias 优先级合并错误 | tsconfig/vite/webpack 同一 alias 前缀的 replacement 冲突 | `resolveAlias` 先匹配 tsconfig paths（最高优先级），再匹配合并后的 aliases（vite > webpack）；T8 测试夹具验证多来源场景 |
| computeAliasHash 签名变更 | 参数从 tsconfig 对象扩展为 alias 配置对象，调用方需同步修改 | 仅 `runSinglePackageFlow`（index.ts）一个调用方；T7 同步修改 |
| WeakRef 浏览器兼容性 | inject.iife.ts 运行在浏览器 window 上下文，WeakRef 是 ES2021 特性（Chrome 84+/Firefox 84+/Safari 14.1+），老项目可能不支持 | `strictStoresByApp` 初始化时检查 `typeof WeakRef !== 'undefined'`，不支持时降级为 null（不注册 strict store，errorHandler 仍可 emit，detail 中 store 上下文为空） |

### 回滚方案

若 v1.6 上线后发现严重问题，可按模块独立回滚：

1. **Pinia _p 包装回滚**：移除 patchPinia 中步骤 2.5 的 `_p` 遍历包装代码，恢复 v1.4 行为（errorHandler 兜底）。
2. **Vuex strict errorHandler 回滚**：移除 patchErrorHandler 中 `tryEmitVuexStrictViolation` 调用与 `strictStoresByApp` 注册表，恢复 v1.4 行为（commit 包装层主路径）。
3. **alias 解析回滚**：将 `createResolver` 恢复为仅读取 tsconfig/jsconfig，移除 `config-loader.ts` 与 `aliases` 字段，恢复 v1.5 行为。
4. **jiti 依赖回滚**：将 jiti 移回 devDependencies（仅在 alias 解析回滚后执行）。

各模块回滚互不影响，可独立执行。
