import { readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import { parse as parseSFC } from '@vue/compiler-sfc';
import { RULE_IMPLEMENTATIONS } from './rules/index.js';
import type { RuleHit, ScanOptions } from '../types.js';

const traverse =
  typeof _traverse === 'function'
    ? (_traverse as (...args: unknown[]) => void)
    : (_traverse as unknown as { default: (...args: unknown[]) => void }).default;

const DEFAULT_INCLUDE = ['.js', '.jsx', '.ts', '.tsx', '.vue'];
const DEFAULT_EXCLUDE = ['node_modules', 'dist', 'build', '.runtime-log-ignore'];

export async function scanFiles(
  legacyRoot: string,
  ruleName: string,
  options: ScanOptions = {},
): Promise<RuleHit[]> {
  const include = options.include ?? DEFAULT_INCLUDE;
  const exclude = new Set(options.exclude ?? DEFAULT_EXCLUDE);
  const filePaths = collectFiles(legacyRoot, legacyRoot, include, exclude);

  const hits: RuleHit[] = [];
  for (const filePath of filePaths) {
    const fileHits = await scanFile(filePath, ruleName);
    hits.push(...fileHits);
  }
  return hits;
}

function collectFiles(
  root: string,
  dir: string,
  include: string[],
  exclude: Set<string>,
): string[] {
  const results: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!exclude.has(entry.name)) {
        results.push(...collectFiles(root, fullPath, include, exclude));
      }
    } else if (entry.isFile()) {
      if (include.some((ext) => fullPath.endsWith(ext))) {
        results.push(fullPath);
      }
    }
  }

  return results;
}

export async function scanFile(filePath: string, ruleName: string): Promise<RuleHit[]> {
  const rule = RULE_IMPLEMENTATIONS[ruleName];
  if (!rule) throw new Error(`未知规则: ${ruleName}`);

  let code: string;
  try {
    code = await readFile(filePath, 'utf8');
  } catch (err) {
    console.warn(`[scanner] 读取文件失败: ${filePath}`, err instanceof Error ? err.message : String(err));
    return [];
  }

  let ast;
  try {
    ast = parseCode(filePath, code);
  } catch (err) {
    console.warn(`[scanner] 解析失败: ${filePath}`, err instanceof Error ? err.message : String(err));
    return [];
  }

  const hits: RuleHit[] = [];
  try {
    traverse(ast, rule.visitor(hits, filePath));
  } catch (err) {
    console.warn(
      `[scanner] 规则遍历失败: ${filePath}`,
      err instanceof Error ? err.message : String(err),
    );
    return hits;
  }

  return hits;
}

function parseCode(filePath: string, code: string) {
  if (filePath.endsWith('.vue')) {
    const { descriptor } = parseSFC(code);
    const script = descriptor.script?.content || descriptor.scriptSetup?.content;
    const isTs = descriptor.script?.lang === 'ts' || descriptor.scriptSetup?.lang === 'ts';
    if (!script) {
      throw new Error('empty script');
    }
    return parse(script, {
      sourceType: 'module',
      plugins: isTs ? ['jsx', 'typescript'] : ['jsx'],
    });
  }

  return parse(code, {
    sourceType: 'module',
    plugins: ['jsx', 'typescript'],
  });
}
