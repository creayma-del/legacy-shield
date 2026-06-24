import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createJiti } from 'jiti';

/**
 * Alias 条目：统一表示 webpack/vite 的 alias 配置项。
 * 供 T5 / T6 / T7 使用。
 */
export interface AliasEntry {
  /** 匹配前缀（如 '@'、'~/'） */
  find: string;
  /** 替换路径（绝对路径） */
  replacement: string;
}

/**
 * 使用 jiti 加载 JS/TS 格式的构建配置文件。
 * 支持 ESM（export default）和 CJS（module.exports）互操作。
 * 函数式配置返回 null（REQ-1.6-13 排除）。
 * 加载失败时静默降级返回 null。
 *
 * @param configPath 配置文件绝对路径
 * @returns 配置对象，或 null（加载失败 / 函数式配置 / 非对象配置）
 */
export function loadConfigFile(configPath: string): Record<string, unknown> | null {
  try {
    const jiti = createJiti(configPath, {
      interopDefault: true,
      fsCache: false,
      sourceMaps: false,
    });
    const mod = jiti(configPath) as Record<string, unknown>;
    const config = mod.default ?? mod;
    // 函数式配置排除（如 defineConfig((env) => ({...}))）
    if (typeof config === 'function') return null;
    if (!config || typeof config !== 'object') return null;
    return config as Record<string, unknown>;
  } catch {
    // 加载失败时静默降级为无 alias
    return null;
  }
}

/**
 * 查找构建工具的配置文件。
 * vite 查找顺序：vite.config.ts → vite.config.js → vite.config.mts → vite.config.mjs
 * webpack 查找顺序：webpack.config.ts → webpack.config.js → webpack.config.mts → webpack.config.mjs
 *
 * @param projectRoot 项目根目录
 * @param tool 构建工具类型
 * @returns 配置文件绝对路径，或 null（未找到）
 */
export function findBuildConfig(
  projectRoot: string,
  tool: 'vite' | 'webpack',
): string | null {
  const extensions = ['.ts', '.js', '.mts', '.mjs'];
  for (const ext of extensions) {
    const configPath = join(projectRoot, `${tool}.config${ext}`);
    if (existsSync(configPath)) return configPath;
  }
  return null;
}

/**
 * 将路径解析为绝对路径。
 * - 以 '/' 开头视为绝对路径，直接返回
 * - 否则基于 projectRoot 拼接（相对路径基于项目根目录解析）
 *
 * @param p 路径（可能是绝对路径或相对路径）
 * @param projectRoot 项目根目录
 * @returns 绝对路径
 */
function resolveAbsolutePath(p: string, projectRoot: string): string {
  if (p.startsWith('/')) return p;
  return join(projectRoot, p);
}

/**
 * 解析 vite.config 的 resolve.alias 配置。
 * 支持对象格式 `{ '@': '/src' }` 与数组格式 `[{ find: '@', replacement: '/src' }]`。
 * 正则 alias（find 为 RegExp）跳过（REQ-1.6-13）。
 *
 * @param config vite 配置对象
 * @param projectRoot 项目根目录
 * @returns 统一的 AliasEntry[]
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
    // 数组格式：[{ find: '@', replacement: '/src' }]
    for (const item of alias) {
      if (!item || typeof item !== 'object') continue;
      const obj = item as Record<string, unknown>;
      // 正则 alias 排除（REQ-1.6-13：find 为 RegExp 时 typeof !== 'string'）
      if (typeof obj.find !== 'string') continue;
      if (typeof obj.replacement !== 'string') continue;
      entries.push({
        find: obj.find,
        replacement: resolveAbsolutePath(obj.replacement, projectRoot),
      });
    }
  } else if (alias && typeof alias === 'object') {
    // 对象格式：{ '@': '/src' }
    for (const [find, replacement] of Object.entries(alias as Record<string, unknown>)) {
      if (typeof replacement !== 'string') continue;
      entries.push({
        find,
        replacement: resolveAbsolutePath(replacement, projectRoot),
      });
    }
  }

  return entries;
}

/**
 * 解析 webpack.config 的 resolve.alias 配置。
 * 支持对象格式（含 webpack 5 对象形态 alias）。
 * - string 形态：`{ '@': '/src' }`
 * - 对象形态（webpack 5）：`{ '@': { path: '/src', exact: false } }`（读取 path，忽略 exact 等其他字段）
 *
 * @param config webpack 配置对象
 * @param projectRoot 项目根目录
 * @returns 统一的 AliasEntry[]
 */
export function parseWebpackAlias(
  config: Record<string, unknown>,
  projectRoot: string,
): AliasEntry[] {
  const resolve = config.resolve as Record<string, unknown> | undefined;
  if (!resolve) return [];
  const alias = resolve.alias;
  if (!alias || typeof alias !== 'object' || Array.isArray(alias)) return [];

  const entries: AliasEntry[] = [];

  for (const [find, replacement] of Object.entries(alias as Record<string, unknown>)) {
    if (typeof replacement === 'string') {
      // string 形态：{ '@': '/src' }
      entries.push({
        find,
        replacement: resolveAbsolutePath(replacement, projectRoot),
      });
    } else if (replacement && typeof replacement === 'object') {
      // 对象形态（webpack 5）：{ '@': { path: '/src', exact: false } }
      const aliasObj = replacement as Record<string, unknown>;
      if (typeof aliasObj.path === 'string') {
        entries.push({
          find,
          replacement: resolveAbsolutePath(aliasObj.path, projectRoot),
        });
      }
    }
  }

  return entries;
}

// ============================================================================
// T7: alias 优先级合并 + resolver 集成
// ============================================================================

/**
 * alias 配置聚合结果。
 * - `tsconfig` 字段保留 raw tsconfig 对象用于调试/未来扩展，computeAliasHash 与 createResolver 不消费此字段
 * - `mergedAliases` 为 vite/webpack 按优先级合并后的结果（vite > webpack）
 */
export interface AliasConfig {
  /** raw tsconfig/jsconfig 对象（调试/未来扩展用，不参与 hash 与 resolver 构造） */
  tsconfig: object | null;
  /** tsconfig/jsconfig compilerOptions.baseUrl（已解析为绝对路径） */
  baseUrl?: string;
  /** tsconfig/jsconfig compilerOptions.paths */
  paths?: Record<string, string[]>;
  /** vite resolve.alias 解析结果 */
  viteAliases: AliasEntry[];
  /** webpack resolve.alias 解析结果 */
  webpackAliases: AliasEntry[];
  /** vite/webpack 按优先级合并后的 alias 列表（vite > webpack） */
  mergedAliases: AliasEntry[];
}

/** 模块级缓存（projectRoot → AliasConfig），避免 createResolver 与 computeAliasHash 重复加载 */
const aliasConfigCache = new Map<string, AliasConfig>();

/**
 * 读取 tsconfig.json / jsconfig.json 并返回解析后的 alias 相关字段。
 * 优先读取 tsconfig.json，不存在则读取 jsconfig.json，均不存在时返回 null。
 * baseUrl 解析为基于 projectRoot 的绝对路径。解析失败时返回 null。
 *
 * @param projectRoot 项目根目录
 * @returns 含 raw / baseUrl / paths 的对象，或 null
 */
function loadTsconfigPaths(
  projectRoot: string,
): { raw: object; baseUrl?: string; paths?: Record<string, string[]> } | null {
  const tsconfigPath = join(projectRoot, 'tsconfig.json');
  const jsconfigPath = join(projectRoot, 'jsconfig.json');
  let configPath: string | null = null;
  if (existsSync(tsconfigPath)) {
    configPath = tsconfigPath;
  } else if (existsSync(jsconfigPath)) {
    configPath = jsconfigPath;
  }
  if (!configPath) return null;
  try {
    const raw = readFileSync(configPath, 'utf8');
    // 去除 JSON 注释（tsconfig 常见）
    const cleaned = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const config = JSON.parse(cleaned);
    const compilerOptions = (config as { compilerOptions?: Record<string, unknown> }).compilerOptions ?? {};
    const baseUrl: string | undefined =
      typeof compilerOptions.baseUrl === 'string'
        ? resolve(projectRoot, compilerOptions.baseUrl)
        : undefined;
    const paths = compilerOptions.paths as Record<string, string[]> | undefined;
    return { raw: config, baseUrl, paths };
  } catch {
    return null;
  }
}

/**
 * 按优先级合并 vite 与 webpack alias。
 * 同一 find 字符串（精确匹配）只保留最高优先级的 replacement。
 * 先放入 webpack（低优先级），后放入 vite（高优先级覆盖）。
 *
 * @param viteAliases vite alias 列表（高优先级）
 * @param webpackAliases webpack alias 列表（低优先级）
 * @returns 合并后的 AliasEntry[]
 */
function mergeAliases(viteAliases: AliasEntry[], webpackAliases: AliasEntry[]): AliasEntry[] {
  const map = new Map<string, string>();
  // 先放入 webpack（低优先级）
  for (const { find, replacement } of webpackAliases) {
    if (!map.has(find)) map.set(find, replacement);
  }
  // 后放入 vite（高优先级覆盖）
  for (const { find, replacement } of viteAliases) {
    map.set(find, replacement);
  }
  return Array.from(map, ([find, replacement]) => ({ find, replacement }));
}

/**
 * 加载项目所有 alias 来源（tsconfig + vite + webpack）并按优先级合并。
 * 按 projectRoot 缓存结果，确保 createResolver 与 computeAliasHash 调用时配置文件仅加载一次。
 *
 * 优先级：tsconfig paths（最高）→ vite alias（中）→ webpack alias（最低）
 * tsconfig 优先级在 resolveAlias 中通过匹配顺序保证；vite/webpack 通过 mergeAliases 合并。
 *
 * @param projectRoot 项目根目录
 * @returns AliasConfig 聚合结果
 */
export function loadAliasConfig(projectRoot: string): AliasConfig {
  const cached = aliasConfigCache.get(projectRoot);
  if (cached) return cached;

  // 1. 收集 tsconfig/jsconfig paths（最高优先级）
  const tsconfigResult = loadTsconfigPaths(projectRoot);

  // 2. 收集 vite alias（中优先级）
  const viteConfigPath = findBuildConfig(projectRoot, 'vite');
  let viteAliases: AliasEntry[] = [];
  if (viteConfigPath) {
    const config = loadConfigFile(viteConfigPath);
    if (config) {
      viteAliases = parseViteAlias(config, projectRoot);
    }
  }

  // 3. 收集 webpack alias（最低优先级）
  const webpackConfigPath = findBuildConfig(projectRoot, 'webpack');
  let webpackAliases: AliasEntry[] = [];
  if (webpackConfigPath) {
    const config = loadConfigFile(webpackConfigPath);
    if (config) {
      webpackAliases = parseWebpackAlias(config, projectRoot);
    }
  }

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
