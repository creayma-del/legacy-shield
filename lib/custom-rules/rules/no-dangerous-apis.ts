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

function isMemberExpression(
  node: t.Node | null | undefined,
  objectName: string,
  propertyName: string,
): boolean {
  return (
    node?.type === 'MemberExpression' &&
    isIdentifier(node.object, objectName) &&
    (isIdentifier(node.property, propertyName) ||
      (node.property.type === 'StringLiteral' && node.property.value === propertyName))
  );
}

const rule: ShieldRule = {
  id: 'SHIELD-001',
  name: 'no-dangerous-apis',
  severity: 'error',
  description: '检测 eval、new Function、innerHTML、document.write',
  visitor: (hits: RuleHit[], filePath: string): Visitor => ({
    CallExpression(path: NodePath<t.CallExpression>) {
      const { node } = path;
      if (isIdentifier(node.callee, 'eval')) {
        addHit(hits, rule, filePath, node, '发现 eval 调用');
      } else if (isMemberExpression(node.callee, 'document', 'write')) {
        addHit(hits, rule, filePath, node, '发现 document.write 调用');
      }
    },
    NewExpression(path: NodePath<t.NewExpression>) {
      const { node } = path;
      if (isIdentifier(node.callee, 'Function')) {
        addHit(hits, rule, filePath, node, '发现 new Function 调用');
      }
    },
    AssignmentExpression(path: NodePath<t.AssignmentExpression>) {
      const { node } = path;
      if (
        node.left.type === 'MemberExpression' &&
        (isIdentifier(node.left.property, 'innerHTML') ||
          (node.left.property.type === 'StringLiteral' && node.left.property.value === 'innerHTML'))
      ) {
        addHit(hits, rule, filePath, node, '发现 innerHTML 赋值');
      }
    },
  }),
};

export default rule;
