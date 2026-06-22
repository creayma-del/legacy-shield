import type { NodePath, Visitor } from '@babel/traverse';
import type * as t from '@babel/types';
import { statSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { RuleHit, ShieldRule } from '../../types.js';

const DEFAULT_SIZE_THRESHOLD_BYTES = 1024 * 1024;

function addHit(
  hits: RuleHit[],
  rule: ShieldRule,
  filePath: string,
  node: t.Node,
  message: string,
  context?: Record<string, unknown>,
) {
  hits.push({
    ruleId: rule.id,
    ruleName: rule.name,
    filePath,
    line: node.loc?.start.line ?? 0,
    column: (node.loc?.start.column ?? 0) + 1,
    message,
    severity: rule.severity,
    riskType: 'resource-load',
    context,
  });
}

const RESOURCE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.webp',
  '.bmp',
  '.ico',
  '.mp4',
  '.webm',
  '.mov',
  '.mp3',
  '.wav',
  '.ogg',
  '.pdf',
  '.zip',
  '.ttf',
  '.woff',
  '.woff2',
  '.eot',
]);

function looksLikeStaticResource(value: string): boolean {
  const lower = value.toLowerCase();
  return Array.from(RESOURCE_EXTENSIONS).some((ext) => lower.endsWith(ext)) || lower.startsWith('data:');
}

function isUrl(value: string): boolean {
  return /^([a-z][a-z0-9+.-]*:)?\/\//i.test(value) || value.startsWith('data:');
}

function isRelativePath(value: string): boolean {
  return value.startsWith('./') || value.startsWith('../');
}

function resolveResourcePath(resourcePath: string, sourceFilePath: string): string | undefined {
  if (isUrl(resourcePath)) return undefined;
  if (!isRelativePath(resourcePath)) return undefined;
  const baseDir = dirname(sourceFilePath);
  const resolved = resolve(baseDir, resourcePath);
  return existsSync(resolved) ? resolved : undefined;
}

function getFileSizeBytes(filePath: string): number | undefined {
  try {
    return statSync(filePath).size;
  } catch {
    return undefined;
  }
}

function extractResourceUrl(node: t.Node | null | undefined): string | undefined {
  if (!node) return undefined;

  if (node.type === 'StringLiteral' || node.type === 'TemplateLiteral') {
    const value = node.type === 'StringLiteral' ? node.value : node.quasis[0]?.value.cooked ?? '';
    if (looksLikeStaticResource(value)) return value;
  }

  if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'require') {
    const arg = node.arguments[0];
    if (arg?.type === 'StringLiteral' && looksLikeStaticResource(arg.value)) return arg.value;
  }

  return undefined;
}

function isIdentifier(node: t.Node | null | undefined, name: string): boolean {
  return node?.type === 'Identifier' && node.name === name;
}

const rule: ShieldRule = {
  id: 'SHIELD-007',
  name: 'no-large-resource',
  severity: 'warning',
  description: '检测代码中引用的超过 1024KB 的本地静态资源（图片、视频、字体等），提示运行时加载风险',
  visitor: (hits: RuleHit[], filePath: string): Visitor => ({
    ImportDeclaration(path: NodePath<t.ImportDeclaration>) {
      const source = path.node.source.value;
      if (!looksLikeStaticResource(source)) return;
      const resolved = resolveResourcePath(source, filePath);
      if (!resolved) return;
      const size = getFileSizeBytes(resolved);
      if (size === undefined) return;
      if (size >= DEFAULT_SIZE_THRESHOLD_BYTES) {
        addHit(hits, rule, filePath, path.node, `发现大体积静态资源引用: ${source} (${formatBytes(size)})`, {
          resourcePath: source,
          resolvedPath: resolved,
          sizeBytes: size,
        });
      }
    },
    CallExpression(path: NodePath<t.CallExpression>) {
      const url = extractResourceUrl(path.node);
      if (!url) return;
      const resolved = resolveResourcePath(url, filePath);
      if (!resolved) return;
      const size = getFileSizeBytes(resolved);
      if (size === undefined) return;
      if (size >= DEFAULT_SIZE_THRESHOLD_BYTES) {
        addHit(hits, rule, filePath, path.node, `发现大体积静态资源引用: ${url} (${formatBytes(size)})`, {
          resourcePath: url,
          resolvedPath: resolved,
          sizeBytes: size,
        });
      }
    },
    JSXAttribute(path: NodePath<t.JSXAttribute>) {
      if (!isIdentifier(path.node.name, 'src')) return;
      const value = path.node.value;
      if (!value) return;
      const url = extractResourceUrl(value.type === 'StringLiteral' ? value : value.type === 'JSXExpressionContainer' ? value.expression : null);
      if (!url) return;
      const resolved = resolveResourcePath(url, filePath);
      if (!resolved) return;
      const size = getFileSizeBytes(resolved);
      if (size === undefined) return;
      if (size >= DEFAULT_SIZE_THRESHOLD_BYTES) {
        addHit(hits, rule, filePath, path.node, `发现大体积静态资源引用: ${url} (${formatBytes(size)})`, {
          resourcePath: url,
          resolvedPath: resolved,
          sizeBytes: size,
        });
      }
    },
  }),
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export default rule;
