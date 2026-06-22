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

function isAddEventListenerCall(node: t.Node | null | undefined): { target?: string; event?: string } | false {
  if (node?.type !== 'CallExpression') return false;
  const callee = node.callee;
  if (callee.type !== 'MemberExpression') return false;
  if (!isIdentifier(callee.property, 'addEventListener')) return false;
  const target = callee.object.type === 'Identifier' ? callee.object.name : 'window';
  const event = node.arguments[0]?.type === 'StringLiteral' ? node.arguments[0].value : undefined;
  return { target, event };
}

function isRemoveEventListenerCall(node: t.Node | null | undefined): boolean {
  if (node?.type !== 'CallExpression') return false;
  const callee = node.callee;
  if (callee.type !== 'MemberExpression') return false;
  return isIdentifier(callee.property, 'removeEventListener');
}

function hasMatchingRemoveListener(functionBody: t.Statement | null | undefined, event: string | undefined): boolean {
  if (!functionBody) return false;
  let found = false;

  function walk(node: t.Node | null | undefined, inCleanupFunction: boolean = false): void {
    if (!node || found) return;

    if (node.type === 'CallExpression' && isRemoveEventListenerCall(node)) {
      const removedEvent = node.arguments[0]?.type === 'StringLiteral' ? node.arguments[0].value : undefined;
      if (removedEvent === event) {
        found = true;
        return;
      }
    }

    const record = node as unknown as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      const value = record[key];
      if (!value || typeof value !== 'object') continue;

      if (Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item === 'object' && (item as t.Node).type) {
            const child = item as t.Node;
            const enterNested = inCleanupFunction || isReturnedCleanupFunction(node, child);
            if (enterNested || !isFunctionNode(child)) {
              walk(child, enterNested);
            }
          }
        }
      } else if ((value as t.Node).type) {
        const child = value as t.Node;
        const enterNested = inCleanupFunction || isReturnedCleanupFunction(node, child);
        if (enterNested || !isFunctionNode(child)) {
          walk(child, enterNested);
        }
      }
    }
  }

  walk(functionBody);
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
  id: 'SHIELD-005',
  name: 'no-leaked-listener',
  severity: 'warning',
  description: '检测未移除的 addEventListener 事件监听（组件/页面未卸载时未 removeEventListener）',
  visitor: (hits: RuleHit[], filePath: string): Visitor => ({
    CallExpression(path: NodePath<t.CallExpression>) {
      const info = isAddEventListenerCall(path.node);
      if (!info) return;

      // 向上查找所属的函数或方法
      let parentFunction: NodePath | null = path;
      while (parentFunction) {
        if (
          parentFunction.isFunctionExpression() ||
          parentFunction.isArrowFunctionExpression() ||
          parentFunction.isFunctionDeclaration() ||
          parentFunction.node.type === 'ClassMethod' ||
          parentFunction.node.type === 'ObjectMethod'
        ) {
          break;
        }
        parentFunction = parentFunction.parentPath;
      }

      const body = parentFunction?.isFunction()
        ? (parentFunction.node.body as t.BlockStatement)
        : undefined;

      if (body && hasMatchingRemoveListener(body, info.event)) {
        return;
      }

      addHit(
        hits,
        rule,
        filePath,
        path.node,
        `发现未配对的 addEventListener（事件: ${info.event ?? 'unknown'}），可能存在内存泄漏`,
        { target: info.target, event: info.event },
      );
    },
  }),
};

export default rule;
