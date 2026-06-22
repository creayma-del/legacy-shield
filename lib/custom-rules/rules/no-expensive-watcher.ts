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

function getMemberDepth(node: t.Node | null | undefined): number {
  if (node?.type !== 'MemberExpression') return 0;
  return 1 + getMemberDepth(node.object);
}

function hasShallowTrue(options: t.Node | null | undefined): boolean {
  if (!options) return false;

  if (options.type === 'ObjectExpression') {
    return options.properties.some((prop) => {
      if (prop.type !== 'ObjectProperty' && prop.type !== 'ObjectMethod') return false;
      const key = prop.key;
      const value = prop.type === 'ObjectProperty' ? prop.value : null;
      return (
        (isIdentifier(key, 'shallow') || (key.type === 'StringLiteral' && key.value === 'shallow')) &&
        value?.type === 'BooleanLiteral' &&
        value.value === true
      );
    });
  }

  return false;
}

const rule: ShieldRule = {
  id: 'SHIELD-003',
  name: 'no-expensive-watcher',
  severity: 'warning',
  description: '检测昂贵的 Vue watcher（监听大对象/深层属性链/数组未 shallow）',
  visitor: (hits: RuleHit[], filePath: string): Visitor => ({
    CallExpression(path: NodePath<t.CallExpression>) {
      const { node } = path;
      if (!isIdentifier(node.callee, 'watch') || node.arguments.length < 2) return;

      const source = node.arguments[0];
      const optionsArg = node.arguments[2];

      if (source.type === 'ObjectExpression') {
        addHit(hits, rule, filePath, node, '发现昂贵的 Vue watcher（监听大对象/深层属性链/数组未 shallow）');
        return;
      }

      if (source.type === 'MemberExpression' && getMemberDepth(source) >= 2) {
        addHit(hits, rule, filePath, node, '发现昂贵的 Vue watcher（监听大对象/深层属性链/数组未 shallow）');
        return;
      }

      if (source.type === 'ArrayExpression' && !hasShallowTrue(optionsArg)) {
        addHit(hits, rule, filePath, node, '发现昂贵的 Vue watcher（监听大对象/深层属性链/数组未 shallow）');
      }
    },
  }),
};

export default rule;
