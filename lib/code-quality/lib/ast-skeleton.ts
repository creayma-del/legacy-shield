// legacy-shield / lib/code-quality / lib / ast-skeleton.ts
// ------------------------------------------------------------
// 根据老项目源码（.js / .jsx / .ts / .tsx / .vue）生成最小可运行的 Vitest 骨架字符串。
// 骨架包含 AI-FILL-BEGIN/END 区块，作为 LLM 仅可填充的边界。
// ------------------------------------------------------------

import { basename, extname } from 'node:path';
import { parse as babelParse } from '@babel/parser';
import babelTraverseModule from '@babel/traverse';
import { parse as parseSFC } from '@vue/compiler-sfc';
import { relativeImportFromSpec, SUPPORTED_SCRIPT_EXTS } from './paths.js';

// @babel/traverse v7 在 ESM 下默认导出在 .default 属性上，按版本兜底取值
const traverse = ((babelTraverseModule as any).default ?? babelTraverseModule) as any;

export const FILL_BEGIN = '/* >>> AI-FILL-BEGIN (LLM 仅可在此区域内补全断言) */';
export const FILL_END = '/* <<< AI-FILL-END */';

export interface SkeletonOptions {
  srcAbs: string;
  specAbs: string;
  sourceCode: string;
}

export interface SkeletonResult {
  skeleton: string;
  exports: string[];
  kind: 'script' | 'vue';
}

/**
 * 主入口：根据 srcAbs 与 specAbs 生成 spec 文件骨架。
 */
export function buildSkeleton(opts: SkeletonOptions): SkeletonResult {
  const { srcAbs, specAbs, sourceCode } = opts;
  const ext = extname(srcAbs);
  if (ext === '.vue') {
    return buildVueSkeleton({ srcAbs, specAbs, sourceCode });
  }
  if (SUPPORTED_SCRIPT_EXTS.includes(ext)) {
    return buildScriptSkeleton({ srcAbs, specAbs, sourceCode, ext });
  }
  throw new Error(`[ast-skeleton] 不支持的后缀：${ext}（${srcAbs}）`);
}

// ---------------------- .js / .jsx / .ts / .tsx ----------------------

/**
 * 根据后缀决定 babel parser 插件组合：
 *   - .js / .jsx：jsx + importAssertions + topLevelAwait
 *   - .ts / .tsx：在上面基础上叠加 typescript（.tsx 仍含 jsx）
 */
function pluginsFor(ext: string): any[] {
  const base = ['importAssertions', 'topLevelAwait'];
  if (ext === '.js') return ['jsx', ...base];
  if (ext === '.jsx') return ['jsx', ...base];
  if (ext === '.ts') return ['typescript', ...base];
  if (ext === '.tsx') return ['typescript', 'jsx', ...base];
  return ['jsx', ...base];
}

interface ScriptSkeletonOptions {
  srcAbs: string;
  specAbs: string;
  sourceCode: string;
  ext: string;
}

function buildScriptSkeleton(opts: ScriptSkeletonOptions): SkeletonResult {
  const { srcAbs, specAbs, sourceCode, ext } = opts;
  const ast = babelParse(sourceCode, {
    sourceType: 'module',
    allowReturnOutsideFunction: true,
    allowAwaitOutsideFunction: true,
    errorRecovery: true,
    plugins: pluginsFor(ext) as any
  });

  const named = new Set<string>();
  let hasDefault = false;
  let defaultName: string | null = null;

  traverse(ast, {
    ExportNamedDeclaration(path: any) {
      const node = path.node;
      if (node.declaration) {
        const decl = node.declaration;
        if (decl.type === 'FunctionDeclaration' || decl.type === 'ClassDeclaration') {
          if (decl.id?.name) named.add(decl.id.name);
        } else if (decl.type === 'VariableDeclaration') {
          for (const v of decl.declarations) {
            if (v.id?.type === 'Identifier') named.add(v.id.name);
          }
        }
      }
      if (node.specifiers) {
        for (const s of node.specifiers) {
          if (s.exported?.name) named.add(s.exported.name);
        }
      }
    },
    ExportDefaultDeclaration(path: any) {
      hasDefault = true;
      const decl = path.node.declaration;
      if (decl.type === 'Identifier') defaultName = decl.name;
      else if (decl.id?.name) defaultName = decl.id.name;
    }
  });

  const exportsList = [...named];
  if (hasDefault) exportsList.push(defaultName ?? 'default');

  const importPath = relativeImportFromSpec(specAbs, srcAbs);

  // 处理默认导出与具名导出同名的边界（如 `export const X` + `export default X`）：
  //   -> 默认 import 用一个不冲突的本地别名 defaultExport
  let importLocal: string | null = null;
  if (hasDefault) {
    const candidate = defaultName ?? 'defaultExport';
    importLocal = named.has(candidate) ? 'defaultExport' : candidate;
  }
  const importParts: string[] = [];
  if (importLocal) importParts.push(importLocal);
  if (named.size > 0) importParts.push(`{ ${[...named].join(', ')} }`);
  const importLine = importParts.length
    ? `import ${importParts.join(', ')} from '${importPath}';`
    : `// 源文件无显式 export；如需测试请手动调整 import\nimport * as mod from '${importPath}';`;

  // 用于生成 it 块的"待断言"名字列表（去重 + 默认导出用本地别名）
  const itNames = [...named];
  if (hasDefault && importLocal && !named.has(importLocal)) {
    itNames.push(importLocal);
  }

  // 构造 describe / it 占位
  const itBlocks = itNames.length
    ? itNames.map((name) => buildItBlock(name)).join('\n\n')
    : buildItBlock('mod');

  const fileName = basename(srcAbs);
  return {
    kind: 'script',
    exports: exportsList,
    skeleton: `// 由 code-quality 自动生成，请勿手动修改 AI-FILL 标记之外的结构
import { describe, it, expect } from 'vitest';
${importLine}

describe('${fileName}', () => {
${FILL_BEGIN}
${itBlocks}
${FILL_END}
});
`
  };
}

function buildItBlock(name: string): string {
  return `  it('${name} 行为校验（待 LLM 补全）', () => {
    // TODO: LLM 在此补全针对 ${name} 的 expect 断言
    expect(typeof ${name === 'mod' ? 'mod' : name}).not.toBe('undefined');
  });`;
}

// ---------------------- .vue ----------------------

interface VueSkeletonOptions {
  srcAbs: string;
  specAbs: string;
  sourceCode: string;
}

function buildVueSkeleton(opts: VueSkeletonOptions): SkeletonResult {
  const { srcAbs, specAbs, sourceCode } = opts;
  const { descriptor, errors } = parseSFC(sourceCode, { filename: srcAbs });
  if (errors && errors.length > 0) {
    // SFC 解析报错不阻断；交由后续 vitest 真实运行时暴露
    // 但记录警告，便于排查
    console.warn(`[ast-skeleton] SFC 解析存在告警：${srcAbs}\n${errors.map((e: any) => e.message).join('\n')}`);
  }

  const props = extractDefineProps(descriptor as any);
  const componentName = basename(srcAbs, '.vue');
  const importPath = relativeImportFromSpec(specAbs, srcAbs);

  const propsObj = props.length
    ? `{ ${props.map((p: string) => `${p}: undefined`).join(', ')} }`
    : '{}';

  return {
    kind: 'vue',
    exports: [componentName],
    skeleton: `// 由 code-quality 自动生成，请勿手动修改 AI-FILL 标记之外的结构
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import ${componentName} from '${importPath}';

describe('${componentName}.vue', () => {
  it('renders without crash', () => {
    const wrapper = mount(${componentName}, { props: ${propsObj} });
    expect(wrapper.exists()).toBe(true);
  });

${FILL_BEGIN}
  it('行为补全（待 LLM 补全）', () => {
    const wrapper = mount(${componentName}, { props: ${propsObj} });
    // TODO: LLM 在此补全 props / events / slots / DOM 断言
    expect(wrapper).toBeTruthy();
  });
${FILL_END}
});
`
  };
}

/**
 * 从 SFC descriptor 抽取 defineProps 字段名（仅尽力提取标识符，不解析类型）。
 */
function extractDefineProps(descriptor: any): string[] {
  const script = descriptor?.scriptSetup ?? descriptor?.script;
  if (!script || !script.content) return [];
  const code = script.content;
  let ast: any;
  try {
    ast = babelParse(code, {
      sourceType: 'module',
      errorRecovery: true,
      plugins: ['jsx', 'typescript', 'importAssertions']
    });
  } catch {
    return [];
  }
  const props = new Set<string>();
  traverse(ast, {
    CallExpression(path: any) {
      const callee = path.node.callee;
      if (callee.type !== 'Identifier' || callee.name !== 'defineProps') return;
      const arg = path.node.arguments[0];
      if (!arg) return;
      if (arg.type === 'ObjectExpression') {
        for (const p of arg.properties) {
          if (p.type === 'ObjectProperty' && p.key) {
            if (p.key.type === 'Identifier') props.add(p.key.name);
            else if (p.key.type === 'StringLiteral') props.add(p.key.value);
          }
        }
      } else if (arg.type === 'ArrayExpression') {
        for (const el of arg.elements) {
          if (el && el.type === 'StringLiteral') props.add(el.value);
        }
      }
    }
  });
  return [...props];
}
