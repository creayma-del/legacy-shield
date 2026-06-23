import { parse as babelParse } from '@babel/parser';
import babelTraverseModule from '@babel/traverse';
import { parse as parseSFC } from '@vue/compiler-sfc';
import type { File } from '@babel/types';
import { extname } from 'node:path';
import type { ModuleResolver } from './resolver.js';

// @babel/traverse v7 在 ESM 下默认导出在 .default 属性上，按版本兜底取值
const traverse = ((babelTraverseModule as any).default ?? babelTraverseModule) as any;

export interface CollectedDependency {
  /** import 路径（如 './foo', '@/utils/bar', '<dynamic>'） */
  spec: string;
  /** 依赖类型 */
  kind: 'import' | 're-export' | 'require' | 'dynamic-import';
  /** import 的符号列表（仅 import/require 边有值，re-export 为导出符号） */
  symbols: string[];
  /** 是否为未解析的边（动态 import、变量 require、路径解析失败） */
  unresolved: boolean;
  /** 源码行号 */
  line: number;
}

/** 文件收集结果：依赖列表 + 导出符号列表 */
export interface CollectedFile {
  /** 依赖列表 */
  dependencies: CollectedDependency[];
  /** 本文件导出的符号列表（本地导出，含默认导出 'default'） */
  exports: string[];
}

function pluginsFor(ext: string): string[] {
  const base = ['dynamicImport', 'importAssertions', 'topLevelAwait'];
  if (ext === '.js' || ext === '.jsx') return ['jsx', ...base];
  if (ext === '.ts') return ['typescript', ...base];
  if (ext === '.tsx') return ['typescript', 'jsx', ...base];
  return ['jsx', ...base];
}

/**
 * 解析 Vue SFC 文件，提取 <script> 或 <script setup> 内容后用 Babel 解析。
 * 参考 scanner.ts 的 parseCode 实现思路独立实现。
 */
function parseVueSFC(filePath: string, code: string): { ast: File; isTs: boolean } {
  const { descriptor, errors } = parseSFC(code, { filename: filePath });
  if (errors && errors.length > 0) {
    // SFC 解析告警不阻断，交由后续流程处理
    console.warn(`[collector] SFC 解析存在告警：${filePath}\n${errors.map((e: any) => e.message).join('\n')}`);
  }

  // 与 scanner.ts 的 parseCode 顺序对齐——优先 script，其次 scriptSetup
  const script = descriptor.script ?? descriptor.scriptSetup;
  const scriptContent = script?.content ?? '';
  // isTs 判定与 scanner.ts 对齐：两个 script 块的 lang 都检查
  const isTs = descriptor.script?.lang === 'ts' || descriptor.script?.lang === 'tsx'
    || descriptor.scriptSetup?.lang === 'ts' || descriptor.scriptSetup?.lang === 'tsx';

  if (!scriptContent) {
    // 无 script 内容的 Vue 文件，返回空 AST（解析为空程序）
    const emptyAst = babelParse('', {
      sourceType: 'module',
      errorRecovery: true,
      plugins: ['jsx', 'typescript', 'dynamicImport', 'importAssertions', 'topLevelAwait'],
    });
    return { ast: emptyAst, isTs };
  }

  const ast = babelParse(scriptContent, {
    sourceType: 'module',
    allowReturnOutsideFunction: true,
    allowAwaitOutsideFunction: true,
    errorRecovery: true,
    plugins: isTs
      ? ['typescript', 'jsx', 'dynamicImport', 'importAssertions', 'topLevelAwait']
      : ['jsx', 'dynamicImport', 'importAssertions', 'topLevelAwait'],
  });
  return { ast, isTs };
}

/**
 * 解析文件为 AST，返回 AST 与是否为 TypeScript
 * @param filePath 文件绝对路径
 * @param code 文件内容
 * @returns { ast: File; isTs: boolean }
 */
export function parseFile(filePath: string, code: string): { ast: File; isTs: boolean } {
  const ext = extname(filePath);

  // .vue 文件先用 @vue/compiler-sfc 提取 script 内容再解析
  if (ext === '.vue') {
    return parseVueSFC(filePath, code);
  }

  // .js / .jsx / .ts / .tsx 文件直接 Babel 解析
  const isTs = ext === '.ts' || ext === '.tsx';
  const ast = babelParse(code, {
    sourceType: 'module',
    allowReturnOutsideFunction: true,
    allowAwaitOutsideFunction: true,
    errorRecovery: true,
    plugins: pluginsFor(ext) as any,
  });
  return { ast, isTs };
}

export function collectDependencies(
  filePath: string,
  code: string,
  resolver: ModuleResolver,
): CollectedFile {
  const deps: CollectedDependency[] = [];
  const exports: string[] = [];

  // parseFile 启用 errorRecovery: true，大部分语法错误不抛异常
  // 严重语法错误（errorRecovery 仍无法处理）在此捕获，返回空依赖
  let result: { ast: File; isTs: boolean };
  try {
    result = parseFile(filePath, code);
  } catch (err) {
    console.warn(
      `[collector] 解析失败: ${filePath}`,
      err instanceof Error ? err.message : String(err),
    );
    return { dependencies: [], exports: [] };
  }
  const ast = result.ast;

  traverse(ast, {
    // import { foo } from './bar'
    // import bar from './bar'
    // import * as bar from './bar'
    ImportDeclaration(path: any) {
      const spec = path.node.source.value;
      const symbols = path.node.specifiers
        .map((s: any) => s.local?.name)
        .filter(Boolean);
      deps.push({
        spec,
        kind: 'import',
        symbols,
        unresolved: false,
        line: path.node.loc?.start.line ?? 0,
      });
    },

    // export { foo } from './bar'  (re-export，有 source)
    // export { foo }               (本地导出，无 source)
    // export const foo = ... / export function foo() ... (声明形式)
    ExportNamedDeclaration(path: any) {
      if (path.node.source) {
        // re-export：记录依赖，不计入本文件 exports
        const spec = path.node.source.value;
        const symbols = path.node.specifiers
          .map((s: any) => s.exported?.name)
          .filter(Boolean);
        deps.push({
          spec,
          kind: 're-export',
          symbols,
          unresolved: false,
          line: path.node.loc?.start.line ?? 0,
        });
      } else {
        // 本地导出：收集导出符号
        for (const specifier of path.node.specifiers) {
          const name = specifier?.exported?.name;
          if (name) exports.push(name);
        }
        // export const foo = ... / export function foo() ... 等声明形式
        const declaration = path.node.declaration;
        if (declaration) {
          if (declaration.type === 'VariableDeclaration') {
            for (const decl of declaration.declarations) {
              if (decl.id?.type === 'Identifier' && decl.id.name) {
                exports.push(decl.id.name);
              }
            }
          } else if (
            declaration.type === 'FunctionDeclaration' ||
            declaration.type === 'ClassDeclaration'
          ) {
            if (declaration.id?.name) exports.push(declaration.id.name);
          }
        }
      }
    },

    // export * from './bar'
    ExportAllDeclaration(path: any) {
      const spec = path.node.source.value;
      deps.push({
        spec,
        kind: 're-export',
        symbols: ['*'],
        unresolved: false,
        line: path.node.loc?.start.line ?? 0,
      });
    },

    // export default ... / export default function foo() {}
    ExportDefaultDeclaration() {
      exports.push('default');
    },

    // require('./bar') / require(varName) / import('./bar') / import(varName)
    // 注意：某些 Babel 版本将 import() 解析为 CallExpression（callee.type === 'Import'），
    // 而非 ImportExpression，因此在此统一处理
    CallExpression(path: any) {
      const callee = path.node.callee;
      if (callee.type === 'Identifier' && callee.name === 'require') {
        const arg = path.node.arguments[0];
        if (arg && arg.type === 'StringLiteral') {
          deps.push({
            spec: arg.value,
            kind: 'require',
            symbols: [],
            unresolved: false,
            line: path.node.loc?.start.line ?? 0,
          });
        } else {
          // 变量 require：标记为未解析
          deps.push({
            spec: '<dynamic>',
            kind: 'require',
            symbols: [],
            unresolved: true,
            line: path.node.loc?.start.line ?? 0,
          });
        }
      } else if (callee.type === 'Import') {
        // dynamic import：import('./bar') / import(varName)
        const arg = path.node.arguments[0];
        if (arg && arg.type === 'StringLiteral') {
          deps.push({
            spec: arg.value,
            kind: 'dynamic-import',
            symbols: [],
            unresolved: false,
            line: path.node.loc?.start.line ?? 0,
          });
        } else {
          // 变量 dynamic import：标记为未解析
          deps.push({
            spec: '<dynamic>',
            kind: 'dynamic-import',
            symbols: [],
            unresolved: true,
            line: path.node.loc?.start.line ?? 0,
          });
        }
      }
    },

    // import('./bar') / import(varName) — ImportExpression 节点（新版 Babel）
    ImportExpression(path: any) {
      const arg = path.node.source;
      if (arg && arg.type === 'StringLiteral') {
        deps.push({
          spec: arg.value,
          kind: 'dynamic-import',
          symbols: [],
          unresolved: false,
          line: path.node.loc?.start.line ?? 0,
        });
      } else {
        // 变量 dynamic import：标记为未解析
        deps.push({
          spec: '<dynamic>',
          kind: 'dynamic-import',
          symbols: [],
          unresolved: true,
          line: path.node.loc?.start.line ?? 0,
        });
      }
    },
  });

  // 解析路径：对每个 dep 调用 resolver.resolve，解析失败标记 unresolved: true
  const resolvedDeps = deps.map((dep) => {
    if (dep.unresolved || dep.spec === '<dynamic>') return dep;
    const resolved = resolver.resolve(dep.spec, filePath);
    return { ...dep, unresolved: resolved === null };
  });

  return { dependencies: resolvedDeps, exports };
}
