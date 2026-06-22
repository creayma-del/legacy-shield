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

function hasEarlyExit(body: t.Statement | null | undefined): boolean {
  if (!body) return false;

  let found = false;

  function walk(node: t.Node | null | undefined): void {
    if (!node || found) return;

    if (
      node.type === 'BreakStatement' ||
      node.type === 'ReturnStatement' ||
      node.type === 'ThrowStatement'
    ) {
      found = true;
      return;
    }

    // 进入子节点但不进入嵌套函数
    if (node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
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

function hasLengthCondition(test: t.Expression | null | undefined): boolean {
  if (!test) return false;

  let found = false;

  function walk(node: t.Node | null | undefined): void {
    if (!node || found) return;

    if (
      node.type === 'MemberExpression' &&
      (isIdentifier(node.property, 'length') ||
        (node.property.type === 'StringLiteral' && node.property.value === 'length'))
    ) {
      found = true;
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

  walk(test);
  return found;
}

function isIdentifier(node: t.Node | null | undefined, name: string): boolean {
  return node?.type === 'Identifier' && node.name === name;
}

const rule: ShieldRule = {
  id: 'SHIELD-002',
  name: 'no-large-loops',
  severity: 'warning',
  description: '检测可能无 break 的大循环（遍历数组长度且无早期退出）',
  visitor: (hits: RuleHit[], filePath: string): Visitor => ({
    ForStatement(path: NodePath<t.ForStatement>) {
      const { node } = path;
      if (hasLengthCondition(node.test) && !hasEarlyExit(node.body)) {
        addHit(hits, rule, filePath, node, '发现可能无 break 的大循环（遍历数组长度且无早期退出）');
      }
    },
    WhileStatement(path: NodePath<t.WhileStatement>) {
      const { node } = path;
      if (hasLengthCondition(node.test) && !hasEarlyExit(node.body)) {
        addHit(hits, rule, filePath, node, '发现可能无 break 的大循环（遍历数组长度且无早期退出）');
      }
    },
  }),
};

export default rule;
