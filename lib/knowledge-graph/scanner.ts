import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { ModuleResolver } from './resolver.js';
import type { CollectedDependency, CollectedFile } from './collector.js';
import { collectDependencies } from './collector.js';

export interface CacheEntry {
  /** 文件路径 */
  path: string;
  /** 文件 mtime（毫秒时间戳） */
  mtime: number;
  /** alias 配置 hash（用于检测 alias 变更） */
  aliasHash: string;
  /** 解析结果（依赖列表） */
  dependencies: CollectedDependency[];
  /** 导出符号列表 */
  exports: string[];
}

export interface CacheFile {
  /** 缓存版本 */
  version: string;
  /** 生成时间（ISO 8601 格式） */
  generatedAt: string;
  /** alias 配置 hash */
  aliasHash: string;
  /** 缓存条目（以文件路径为 key，确保 JSON 可序列化） */
  entries: Record<string, CacheEntry>;
}

const CACHE_VERSION = '1';
const CACHE_DIR = '.legacy-shield/knowledge-graph';
const CACHE_FILE = '.cache.json';

export async function scanFilesConcurrent(
  filePaths: string[],
  resolver: ModuleResolver,
  concurrency: number,
): Promise<Map<string, CollectedFile>> {
  const results = new Map<string, CollectedFile>();
  let cursor = 0;

  const workers = Array.from({ length: concurrency }, async () => {
    while (cursor < filePaths.length) {
      const filePath = filePaths[cursor++];
      if (!filePath) break;
      try {
        const code = await readFile(filePath, 'utf8');
        const deps = collectDependencies(filePath, code, resolver);
        results.set(filePath, deps);
      } catch (err) {
        // 单文件失败仅告警并写入空依赖，不影响整体扫描
        console.warn(
          `[scanner] 处理文件失败: ${filePath}`,
          err instanceof Error ? err.message : String(err),
        );
        results.set(filePath, { dependencies: [], exports: [] });
      }
    }
  });

  await Promise.all(workers);
  return results;
}

/**
 * 读取 mtime 缓存。
 * @param projectRoot 项目根目录
 * @returns 缓存对象，或 null（缓存文件不存在 / 解析失败 / 版本不匹配）
 */
export async function loadCache(projectRoot: string): Promise<CacheFile | null> {
  const cachePath = join(projectRoot, CACHE_DIR, CACHE_FILE);
  if (!existsSync(cachePath)) return null;
  try {
    const raw = await readFile(cachePath, 'utf8');
    const cache = JSON.parse(raw) as CacheFile;
    // 版本不匹配视为无缓存
    if (cache.version !== CACHE_VERSION) return null;
    return cache;
  } catch {
    // 解析失败视为无缓存
    return null;
  }
}

/**
 * 写入 mtime 缓存。
 * @param projectRoot 项目根目录
 * @param cache 缓存对象
 */
export async function saveCache(projectRoot: string, cache: CacheFile): Promise<void> {
  const cacheDir = join(projectRoot, CACHE_DIR);
  const cachePath = join(cacheDir, CACHE_FILE);
  // 确保目录存在
  await mkdir(cacheDir, { recursive: true });
  await writeFile(cachePath, JSON.stringify(cache, null, 2), 'utf8');
}

/**
 * 计算 alias 配置 hash。
 * @param tsconfig tsconfig/jsconfig 对象，或 null（无配置文件）
 * @returns MD5 hash 字符串，或 'none'（无配置文件时）
 */
export function computeAliasHash(tsconfig: object | null): string {
  if (!tsconfig) return 'none';
  const paths = (tsconfig as any).compilerOptions?.paths ?? {};
  const baseUrl = (tsconfig as any).compilerOptions?.baseUrl ?? '';
  return createHash('md5').update(JSON.stringify({ paths, baseUrl })).digest('hex');
}

/**
 * 带缓存的并发扫描。根据 mtime 与 aliasHash 判断是否命中缓存，未命中则重新解析。
 *
 * @param filePaths 文件路径列表
 * @param resolver ModuleResolver 实例
 * @param concurrency 并发数
 * @param projectRoot 项目根目录（用于缓存读写）
 * @param aliasHash 当前 alias 配置 hash
 * @param fresh 是否强制全量重建（忽略缓存）
 * @returns 扫描结果 Map（key 为文件绝对路径）
 */
export async function scanWithCache(
  filePaths: string[],
  resolver: ModuleResolver,
  concurrency: number,
  projectRoot: string,
  aliasHash: string,
  fresh: boolean,
): Promise<Map<string, CollectedFile>> {
  // 1. 加载缓存（fresh=true 或缓存不存在时跳过）
  const cache = fresh ? null : await loadCache(projectRoot);

  const results = new Map<string, CollectedFile>();
  const pendingFiles: string[] = [];
  // 缓存命中时复用已 stat 的 mtime，避免更新缓存时重复 stat
  const mtimeCache = new Map<string, number>();

  if (cache && cache.aliasHash === aliasHash) {
    // 2. 缓存命中判断：aliasHash 一致时逐文件检查 mtime
    for (const filePath of filePaths) {
      const entry = cache.entries[filePath];
      if (entry) {
        try {
          const currentMtime = statSync(filePath).mtimeMs;
          if (entry.mtime === currentMtime) {
            // mtime 一致，命中缓存，直接复用
            results.set(filePath, {
              dependencies: entry.dependencies,
              exports: entry.exports,
            });
            // 缓存命中时记录 mtime，避免更新缓存时重复 stat
            mtimeCache.set(filePath, currentMtime);
            continue;
          }
          // mtime 变更，记录新 mtime 供后续缓存更新使用
          mtimeCache.set(filePath, currentMtime);
        } catch {
          // 文件不存在或 stat 失败，加入待扫描列表
        }
      }
      pendingFiles.push(filePath);
    }
  } else {
    // aliasHash 变更或无缓存，全部文件待扫描
    pendingFiles.push(...filePaths);
  }

  // 3. 并发扫描待扫描文件
  if (pendingFiles.length > 0) {
    const freshResults = await scanFilesConcurrent(
      pendingFiles,
      resolver,
      concurrency,
    );
    for (const [filePath, collected] of freshResults) {
      results.set(filePath, collected);
    }
  }

  // 4. 更新并保存缓存
  //    复用 mtimeCache 中已 stat 的 mtime，仅对未 stat 的文件 stat
  const newEntries: Record<string, CacheEntry> = {};
  for (const [filePath, collected] of results) {
    try {
      // 优先复用已 stat 的 mtime，避免重复 stat
      const mtime = mtimeCache.get(filePath) ?? statSync(filePath).mtimeMs;
      newEntries[filePath] = {
        path: filePath,
        mtime,
        aliasHash,
        dependencies: collected.dependencies,
        exports: collected.exports,
      };
    } catch {
      // 文件 stat 失败时跳过缓存写入
    }
  }
  const newCache: CacheFile = {
    version: CACHE_VERSION,
    generatedAt: new Date().toISOString(),
    aliasHash,
    entries: newEntries,
  };
  await saveCache(projectRoot, newCache);

  return results;
}
