import type { NodePath, Visitor } from '@babel/traverse';
import type * as t from '@babel/types';
import type { RuleHit, ShieldRule } from '../../types.js';

function addHit(hits: RuleHit[], rule: ShieldRule, filePath: string, node: t.Node, message: string) {
  hits.push({
    ruleId: rule.id,
    ruleName: rule.name,
    filePath,
    line: node.loc?.start.line ?? 0,
    column: (node.loc?.start.column ?? 0) + 1,
    message,
    severity: rule.severity,
  });
}

function isIdentifier(node: t.Node | null | undefined, name: string): boolean {
  return node?.type === 'Identifier' && node.name === name;
}

const STORAGE_METHODS = new Set(['getItem', 'setItem', 'removeItem']);

function isSyncStorageCall(node: t.Node | null | undefined): boolean {
  if (node?.type !== 'CallExpression') return false;
  const callee = node.callee;
  if (callee.type !== 'MemberExpression') return false;

  const objectName = isIdentifier(callee.object, 'localStorage')
    ? 'localStorage'
    : isIdentifier(callee.object, 'sessionStorage')
      ? 'sessionStorage'
      : null;
  if (!objectName) return false;

  const methodName =
    callee.property.type === 'Identifier'
      ? callee.property.name
      : callee.property.type === 'StringLiteral'
        ? callee.property.value
        : null;

  return methodName !== null && STORAGE_METHODS.has(methodName);
}

function containsStorageCall(body: t.Statement | null | undefined): boolean {
  if (!body) return false;

  let found = false;

  function walk(node: t.Node | null | undefined): void {
    if (!node || found) return;

    if (isSyncStorageCall(node)) {
      found = true;
      return;
    }

    // 不进入嵌套函数
    if (node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
      return;
    }

    // 不进入嵌套循环（避免重复报告）
    if (node.type === 'ForStatement' || node.type === 'WhileStatement' || node.type === 'DoWhileStatement') {
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const key of Object.keys(node)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const value = (node as any)[key];
      if (value && typeof value === 'object') {
        if (Array.isArray(value)) {
          for (const item of value) {
            if (item && typeof item === 'object' && item.type) walk(item);
          }
        } else if (value.type) {
          walk(value);
        }
      }
    }
  }

  walk(body);
  return found;
}

const rule: ShieldRule = {
  id: 'SHIELD-004',
  name: 'no-sync-storage-in-loop',
  severity: 'error',
  description: '检测循环内 localStorage/sessionStorage 同步读写',
  visitor: (hits: RuleHit[], filePath: string): Visitor => ({
    ForStatement(path: NodePath<t.ForStatement>) {
      const { node } = path;
      if (containsStorageCall(node.body)) {
        addHit(hits, rule, filePath, node, '发现循环内 localStorage/sessionStorage 同步读写');
      }
    },
    WhileStatement(path: NodePath<t.WhileStatement>) {
      const { node } = path;
      if (containsStorageCall(node.body)) {
        addHit(hits, rule, filePath, node, '发现循环内 localStorage/sessionStorage 同步读写');
      }
    },
    DoWhileStatement(path: NodePath<t.DoWhileStatement>) {
      const { node } = path;
      if (containsStorageCall(node.body)) {
        addHit(hits, rule, filePath, node, '发现循环内 localStorage/sessionStorage 同步读写');
      }
    },
  }),
};

export default rule;
