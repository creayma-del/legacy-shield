import { existsSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import type { AliasEntry } from './config-loader.js';
import { loadAliasConfig } from './config-loader.js';

export interface ResolverOptions {
  /** 项目根目录 */
  projectRoot: string;
  /** tsconfig/jsconfig compilerOptions.baseUrl */
  baseUrl?: string;
  /** tsconfig/jsconfig compilerOptions.paths */
  paths?: Record<string, string[]>;
  /** v1.6 新增：来自 vite/webpack 的 alias 列表（已按优先级合并，vite > webpack） */
  aliases?: AliasEntry[];
}

export class ModuleResolver {
  constructor(private opts: ResolverOptions) {}

  /**
   * 将 import spec 解析为目标文件绝对路径
   * @param spec import 路径（如 './foo', '@/utils/bar', 'lodash'）
   * @param importer 导入文件的绝对路径
   * @returns 解析后的文件绝对路径，或 null（无法解析）
   */
  resolve(spec: string, importer: string): string | null {
    // 1. 相对路径（./ 或 ../）
    if (spec.startsWith('.')) {
      // importer 为文件路径，需取其目录作为解析基准
      return this.resolveRelative(spec, dirname(importer));
    }

    // 2. alias 路径（@/ ~/ 等）
    const aliasResolved = this.resolveAlias(spec);
    if (aliasResolved) {
      return this.resolveRelative(aliasResolved, this.opts.baseUrl ?? this.opts.projectRoot);
    }

    // 3. node_modules 包路径
    return this.resolveNodeModules(spec, importer);
  }

  private resolveRelative(spec: string, baseDir: string): string | null {
    const basePath = resolve(baseDir, spec);
    return this.tryExtensions(basePath);
  }

  private resolveAlias(spec: string): string | null {
    // v1.6：优先匹配 tsconfig paths（最高优先级）
    if (this.opts.paths) {
      for (const [pattern, targets] of Object.entries(this.opts.paths)) {
        // 先转义正则元字符，再替换 * 为捕获组
        const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace('*', '(.*)');
        const regex = new RegExp('^' + escaped + '$');
        const match = spec.match(regex);
        if (match) {
          return targets[0].replace('*', match[1]);
        }
      }
    }
    // v1.6：再匹配 vite/webpack alias（合并后，vite > webpack）
    // 注意：find 可能以 '/' 结尾（如 webpack 的 '~/'), 此时 startsWith(find + '/') 会
    // 变成 startsWith('~//') 导致无法匹配；需按 find 是否以 '/' 结尾分支处理。
    // 路径拼接使用 join 而非字符串拼接，避免 find 以 '/' 结尾时 suffix 缺少分隔符。
    if (this.opts.aliases) {
      for (const { find, replacement } of this.opts.aliases) {
        const matched = find.endsWith('/')
          ? spec.startsWith(find)
          : spec === find || spec.startsWith(find + '/');
        if (matched) {
          const suffix = spec.slice(find.length);
          return join(replacement, suffix);
        }
      }
    }
    return null;
  }

  private resolveNodeModules(spec: string, importer: string): string | null {
    // 纯包名无子路径（如 'lodash'），跳过
    if (!spec.includes('/')) return null;
    const parts = spec.split('/');
    // scoped 包名含斜杠（如 @vue/compiler-sfc/foo，取前两段为包名）
    const packageName = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
    const subPath = (spec.startsWith('@') ? parts.slice(2) : parts.slice(1)).join('/');
    if (!subPath) return null;
    let dir = dirname(importer);
    while (true) {
      const candidate = join(dir, 'node_modules', packageName, subPath);
      const resolved = this.tryExtensions(candidate);
      if (resolved) return resolved;
      const parent = dirname(dir);
      // 根目录检查：dirname(dir) === dir 时终止向上查找
      if (parent === dir) break;
      dir = parent;
    }
    return null;
  }

  private tryExtensions(basePath: string): string | null {
    const extensions = ['.ts', '.tsx', '.js', '.jsx', '.vue'];
    // 1. 直接匹配
    if (existsSync(basePath) && statSync(basePath).isFile()) return basePath;
    // 2. 补全扩展名
    for (const ext of extensions) {
      if (existsSync(basePath + ext)) return basePath + ext;
    }
    // 3. index 文件
    for (const ext of extensions) {
      const indexFile = join(basePath, 'index' + ext);
      if (existsSync(indexFile)) return indexFile;
    }
    return null;
  }
}

/**
 * 从项目根目录自动检测 tsconfig/jsconfig、vite.config、webpack.config，
 * 按优先级合并 alias，构造 ModuleResolver。
 * 优先级：tsconfig paths（最高）→ vite alias（中）→ webpack alias（最低）
 * 配置文件仅加载一次（loadAliasConfig 按 projectRoot 缓存）。
 */
export function createResolver(projectRoot: string): ModuleResolver {
  const aliasConfig = loadAliasConfig(projectRoot);
  return new ModuleResolver({
    projectRoot,
    baseUrl: aliasConfig.baseUrl,
    paths: aliasConfig.paths,
    aliases: aliasConfig.mergedAliases,
  });
}
