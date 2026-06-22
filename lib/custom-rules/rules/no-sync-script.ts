import type { RuleHit, ShieldRule } from '../../types.js';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

function isSyncScriptInHead(tag: string): boolean {
  const lower = tag.toLowerCase();
  if (!lower.startsWith('<script')) return false;
  // async / defer / type="module" / type='module' 不算同步脚本
  if (/\basync\b/.test(lower)) return false;
  if (/\bdefer\b/.test(lower)) return false;
  if (/type\s*=\s*["']module["']/.test(lower)) return false;
  return true;
}

function extractSrc(tag: string): string | undefined {
  const match = tag.match(/src\s*=\s*["']([^"']+)["']/i);
  return match?.[1];
}

function computePosition(content: string, index: number): { line: number; column: number } {
  const lines = content.slice(0, index).split('\n');
  const line = lines.length;
  const column = lines[lines.length - 1].length + 1;
  return { line, column };
}

const rule: ShieldRule = {
  id: 'SHIELD-008',
  name: 'no-sync-script',
  severity: 'warning',
  description: '检测入口 HTML <head> 中阻塞渲染的同步 <script> 标签',
  visitor: (_hits: RuleHit[], _filePath: string): never => {
    // 该规则不通过 AST 遍历，而是在 runCustomRules 中由 scanner 特殊处理 HTML 文件
    throw new Error('no-sync-script 规则应通过 scanHtmlFiles 调用，不应直接遍历 JS/Vue AST');
  },
};

export function scanHtmlForSyncScripts(projectPath: string): RuleHit[] {
  const candidates = ['index.html', 'public/index.html', 'src/index.html'];
  const hits: RuleHit[] = [];

  for (const candidate of candidates) {
    const fullPath = resolve(projectPath, candidate);
    if (!existsSync(fullPath)) continue;

    try {
      const content = readFileSync(fullPath, 'utf8');
      const headMatch = content.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
      if (!headMatch) continue;

      const headOpenEnd = (headMatch.index ?? 0) + headMatch[0].indexOf('>') + 1;
      const headContent = headMatch[1];
      const scriptTagRegex = /<script[^>]*>/gi;
      let match: RegExpExecArray | null;

      while ((match = scriptTagRegex.exec(headContent)) !== null) {
        const tag = match[0];
        if (!isSyncScriptInHead(tag)) continue;
        const absoluteIndex = headOpenEnd + match.index;
        const { line, column } = computePosition(content, absoluteIndex);
        const src = extractSrc(tag);
        hits.push({
          ruleId: rule.id,
          ruleName: rule.name,
          filePath: fullPath,
          line,
          column,
          message: src ? `发现同步 <script> 阻塞渲染: ${src}` : '发现内联同步 <script> 阻塞渲染',
          severity: rule.severity,
          riskType: 'resource-load',
          context: src ? { src } : undefined,
        });
      }
    } catch {
      // ignore read errors
    }
  }

  return hits;
}

export default rule;
