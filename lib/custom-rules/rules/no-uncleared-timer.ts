import type { NodePath, Visitor } from '@babel/traverse';
import type * as t from '@babel/types';
import type { RuleHit, ShieldRule } from '../../types.js';

function addHit(hits: RuleHit[], rule: ShieldRule, filePath: string, node: t.Node, message: string, context?: Record<string, unknown>) {
  hits.push({
    ruleId: rule.id,
    ruleName: rule.name,
    filePath,
    line: node.loc?.start.line ?? 0,
    column: (node.loc?.start.column ?? 0) + 1,
    message,
    severity: rule.severity,
    riskType: 'memory-leak',
    context,
  });
}

function isSetTimerCall(node: t.Node | null | undefined): 'setInterval' | 'setTimeout' | false {
  if (node?.type !== 'CallExpression') return false;
  const callee = node.callee;
  if (callee.type === 'Identifier') {
    if (callee.name === 'setInterval') return 'setInterval';
    if (callee.name === 'setTimeout') return 'setTimeout';
  }
  if (callee.type === 'MemberExpression') {
    if (isIdentifier(callee.property, 'setInterval')) return 'setInterval';
    if (isIdentifier(callee.property, 'setTimeout')) return 'setTimeout';
  }
  return false;
}

function isClearTimerCall(node: t.Node | null | undefined): boolean {
  if (node?.type !== 'CallExpression') return false;
  const callee = node.callee;
  if (callee.type === 'Identifier') {
    return callee.name === 'clearInterval' || callee.name === 'clearTimeout';
  }
  if (callee.type === 'MemberExpression') {
    return isIdentifier(callee.property, 'clearInterval') || isIdentifier(callee.property, 'clearTimeout');
  }
  return false;
}

function containsClearTimer(node: t.Node | null | undefined): boolean {
  if (!node) return false;
  let found = false;

  function walk(n: t.Node | null | undefined, inCleanupFunction: boolean = false): void {
    if (!n || found) return;

    if (isClearTimerCall(n)) {
      found = true;
      return;
    }

    const record = n as unknown as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      const value = record[key];
      if (!value || typeof value !== 'object') continue;

      if (Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item === 'object' && (item as t.Node).type) {
            const child = item as t.Node;
            const enterNested = inCleanupFunction || isReturnedCleanupFunction(n, child);
            if (enterNested || !isFunctionNode(child)) {
              walk(child, enterNested);
            }
          }
        }
      } else if ((value as t.Node).type) {
        const child = value as t.Node;
        const enterNested = inCleanupFunction || isReturnedCleanupFunction(n, child);
        if (enterNested || !isFunctionNode(child)) {
          walk(child, enterNested);
        }
      }
    }
  }

  walk(node);
  return found;
}

function isFunctionNode(node: t.Node): boolean {
  return node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression' || node.type === 'FunctionDeclaration';
}

function isReturnedCleanupFunction(parent: t.Node, child: t.Node): boolean {
  return isFunctionNode(child) && parent.type === 'ReturnStatement';
}

function isIdentifier(node: t.Node | null | undefined, name: string): boolean {
  return node?.type === 'Identifier' && node.name === name;
}

const rule: ShieldRule = {
  id: 'SHIELD-006',
  name: 'no-uncleared-timer',
  severity: 'warning',
  description: '检测未清除的 setInterval/setTimeout（组件/页面未卸载时未 clear）',
  visitor: (hits: RuleHit[], filePath: string): Visitor => ({
    CallExpression(path: NodePath<t.CallExpression>) {
      const timerType = isSetTimerCall(path.node);
      if (!timerType) return;

      let scope: NodePath | null = path;
      while (scope) {
        if (
          scope.isFunctionExpression() ||
          scope.isArrowFunctionExpression() ||
          scope.isFunctionDeclaration() ||
          scope.node.type === 'ClassMethod' ||
          scope.node.type === 'ObjectMethod'
        ) {
          break;
        }
        scope = scope.parentPath;
      }

      const body = scope?.isFunction() ? (scope.node.body as t.BlockStatement) : undefined;

      if (body && containsClearTimer(body)) {
        return;
      }

      addHit(
        hits,
        rule,
        filePath,
        path.node,
        `发现未清除的 ${timerType}，可能存在内存泄漏`,
        { timerType },
      );
    },
  }),
};

export default rule;
