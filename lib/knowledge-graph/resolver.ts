import { existsSync, statSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';

export interface ResolverOptions {
  /** 项目根目录 */
  projectRoot: string;
  /** tsconfig/jsconfig compilerOptions.baseUrl */
  baseUrl?: string;
  /** tsconfig/jsconfig compilerOptions.paths */
  paths?: Record<string, string[]>;
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
    if (!this.opts.paths) return null;
    for (const [pattern, targets] of Object.entries(this.opts.paths)) {
      // 先转义正则元字符，再替换 * 为捕获组
      const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace('*', '(.*)');
      const regex = new RegExp('^' + escaped + '$');
      const match = spec.match(regex);
      if (match) {
        return targets[0].replace('*', match[1]);
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
 * 从项目根目录读取 tsconfig.json / jsconfig.json，构造 ModuleResolver。
 * 优先读取 tsconfig.json，不存在则读取 jsconfig.json，均不存在时返回无 alias 配置的 resolver。
 */
export function createResolver(projectRoot: string): ModuleResolver {
  const tsconfigPath = join(projectRoot, 'tsconfig.json');
  const jsconfigPath = join(projectRoot, 'jsconfig.json');
  let configPath: string | null = null;
  if (existsSync(tsconfigPath)) {
    configPath = tsconfigPath;
  } else if (existsSync(jsconfigPath)) {
    configPath = jsconfigPath;
  }
  if (!configPath) {
    // 无 tsconfig/jsconfig 的纯 JS 项目，仅支持相对路径与 node_modules 解析
    return new ModuleResolver({ projectRoot });
  }
  try {
    const raw = readFileSync(configPath, 'utf8');
    // 去除 JSON 注释（tsconfig 常见）
    // 使用 [^\n] 限定单行匹配，无需 m 标志即可正确移除每行内的 // 注释
    const cleaned = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const config = JSON.parse(cleaned);
    const compilerOptions = config.compilerOptions ?? {};
    // baseUrl 可能为相对路径（如 "."），需解析为基于 projectRoot 的绝对路径
    const baseUrl: string | undefined = compilerOptions.baseUrl
      ? resolve(projectRoot, compilerOptions.baseUrl)
      : undefined;
    const paths: Record<string, string[]> | undefined = compilerOptions.paths;
    return new ModuleResolver({ projectRoot, baseUrl, paths });
  } catch {
    // 解析失败时降级为无 alias 配置
    return new ModuleResolver({ projectRoot });
  }
}
