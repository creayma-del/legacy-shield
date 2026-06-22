// legacy-shield / lib/code-quality / configs / eslint.config.ts
// ------------------------------------------------------------
// 设计目标：扩展（extends）老项目现有的 ESLint 配置，对老项目源码进行校验。
// 关键约束（由项目红线规则衍生）：
//   1. 不修改老项目任何文件，不在老项目中安装依赖。
//   2. 老项目的 ESLint 配置可能是 legacy（.eslintrc.*）也可能是 flat（eslint.config.*）。
//   3. legacy 配置中常出现的插件（vue / import / prettier 等）由 legacy-shield 自身的
//      node_modules 提供；FlatCompat 需要把 plugin 显式注册并把 resolvePluginsRelativeTo
//      指向本配置文件所在目录，以兼容 ESLint 9 + flat config 体系。
//   4. 老项目 .eslintrc 里的 parserOptions.parser 若是 babel-eslint（已废弃），
//      在本模块侧透明替换为 @babel/eslint-parser，且不修改老项目任何文件。
//
// 本文件被 runner/cli 通过 --config 显式指定，读取的环境变量：
//   - LEGACY_PROJECT_PATH: 老项目根目录绝对路径（由调用方注入）
//
// 若未提供 LEGACY_PROJECT_PATH，将抛错退出（严禁静默兜底）。
// ------------------------------------------------------------

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';
import vuePlugin from 'eslint-plugin-vue';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
// @eslint/js 是 ESLint 9 的传递依赖，使用 CJS require 直接加载，避免 ESM 顶层导入受 hoist 影响
const js = require('@eslint/js') as any;

const legacyProjectPath = process.env.LEGACY_PROJECT_PATH;
if (!legacyProjectPath) {
  throw new Error(
    '[code-quality] 缺少环境变量 LEGACY_PROJECT_PATH，请通过 cli --project <path> 调用。'
  );
}

const LEGACY_ROOT = resolve(legacyProjectPath);

/**
 * 在老项目根目录探测 ESLint 配置文件。
 * 命中顺序与 ESLint 官方文档一致：先 flat 后 legacy。
 * 找不到则返回 null（cli 会决定是否报错退出）。
 */
function detectLegacyEslintConfig(root: string): { path: string; kind: 'flat' | 'legacy' } | null {
  const flatCandidates = [
    'eslint.config.js',
    'eslint.config.mjs',
    'eslint.config.cjs',
    'eslint.config.ts'
  ];
  const legacyCandidates = [
    '.eslintrc.js',
    '.eslintrc.cjs',
    '.eslintrc.mjs',
    '.eslintrc.json',
    '.eslintrc.yaml',
    '.eslintrc.yml',
    // 兼容 ESLint 历史上支持的无后缀文件（内容可为 JSON 或 YAML），优先级最低
    '.eslintrc'
  ];

  let entries: Set<string>;
  try {
    entries = new Set(readdirSync(root));
  } catch (err: any) {
    throw new Error(
      `[code-quality] 无法读取老项目目录 ${root}：${err.message}`
    );
  }

  for (const name of flatCandidates) {
    if (entries.has(name)) {
      return { path: resolve(root, name), kind: 'flat' };
    }
  }
  for (const name of legacyCandidates) {
    if (entries.has(name)) {
      return { path: resolve(root, name), kind: 'legacy' };
    }
  }
  return null;
}

const detected = detectLegacyEslintConfig(LEGACY_ROOT);
if (!detected) {
  throw new Error(
    `[code-quality] 未在 ${LEGACY_ROOT} 下发现任何 ESLint 配置文件（` +
      `eslint.config.* 或 .eslintrc.*），按用户选择的"运行时自动探测"策略，拒绝静默兜底，请在老项目添加 ESLint 配置后再运行。`
  );
}

// 校验探测到的路径确实存在
try {
  statSync(detected.path);
} catch (err: any) {
  throw new Error(
    `[code-quality] 探测到的 ESLint 配置不可读：${detected.path} -> ${err.message}`
  );
}

// FlatCompat 必须注入 recommendedConfig / allConfig，否则 ESLint 9 在解析过程中
// 一旦命中 'eslint:recommended' / 'eslint:all' 路径会崩溃。
const compat = new FlatCompat({
  baseDirectory: LEGACY_ROOT,
  resolvePluginsRelativeTo: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all
});

/**
 * 构造最终 flat config 数组。
 *
 * 处理两种情况：
 *  1. legacy：通过 compat.config({ extends: ['<绝对路径>'] }) 转成 flat。
 *  2. flat：动态 import，并把数组结果直接拼接。
 */
const configs: any[] = [];

// 提供 .vue 文件的解析能力（老项目 .eslintrc 中的 'plugin:vue/...' 通过 FlatCompat 可识别；
// 若老项目本身就是 flat 配置，下面这行也只是补充确保 vue 文件能进入 lint 流程）
configs.push({
  files: ['**/*.vue'],
  plugins: { vue: vuePlugin },
  languageOptions: vuePlugin.configs?.['flat/base']?.[0]?.languageOptions ?? {}
});

if (detected.kind === 'legacy') {
  // 直接读取老项目 .eslintrc 内容（仅支持 JSON / 无后缀 JSON 文本，与本项目当前用法一致）。
  const legacyConfigText = readFileSync(detected.path, 'utf8');
  let legacyConfigObj: any;
  try {
    legacyConfigObj = JSON.parse(legacyConfigText);
  } catch (err: any) {
    throw new Error(
      `[code-quality] 解析 ${detected.path} 失败（当前实现仅支持 JSON 内容的 .eslintrc*）：${err.message}`
    );
  }

  const rawExtends = Array.isArray(legacyConfigObj.extends)
    ? legacyConfigObj.extends
    : legacyConfigObj.extends
    ? [legacyConfigObj.extends]
    : [];

  // 预处理 extends：把已知的 "plugin:xxx/yyy" / "@vue/prettier" 等映射为 legacy-shield 自身装好的
  // flat config 数组，并从交给 compat 的 extends 中剥离，避免 FlatCompat 解析 legacy plugin
  // 共享配置失败（这是 ESLint 9 + flat config 的固有限制）。
  const prettierFlatPluginConfig = require('eslint-plugin-prettier/recommended') as any;
  const vueFlatPrettierConfig = require('@vue/eslint-config-prettier') as any;

  const remainingExtends: any[] = [];
  const flatExtraConfigs: any[] = [];
  for (const e of rawExtends) {
    if (typeof e !== 'string') {
      remainingExtends.push(e);
      continue;
    }
    if (e.startsWith('plugin:vue/')) {
      const name = e.slice('plugin:vue/'.length);
      // eslint-plugin-vue@10+ 的 flat 配置不再使用 vue3- 前缀，做名称映射以兼容老项目写法
      const aliasMap: Record<string, string> = {
        'vue3-essential': 'flat/essential',
        'vue3-strongly-recommended': 'flat/strongly-recommended',
        'vue3-recommended': 'flat/recommended'
      };
      const flatKey = aliasMap[name] || `flat/${name}`;
      const flatCfg = (vuePlugin.configs as Record<string, any> | undefined)?.[flatKey];
      if (!flatCfg) {
        throw new Error(
          `[code-quality] eslint-plugin-vue 未提供 flat 配置 "${flatKey}"，无法兼容 ${e}`
        );
      }
      flatExtraConfigs.push(...flatCfg);
    } else if (e === 'plugin:prettier/recommended') {
      flatExtraConfigs.push(prettierFlatPluginConfig);
    } else if (e === '@vue/prettier') {
      flatExtraConfigs.push(vueFlatPrettierConfig);
    } else if (e.startsWith('./') || e.startsWith('../')) {
      // 相对路径：转绝对路径，交给 compat 加载
      remainingExtends.push(resolve(LEGACY_ROOT, e));
    } else {
      remainingExtends.push(e);
    }
  }

  // 剩下的部分（含 rules / globals / parserOptions / 剥离后的 extends）交给 compat 转换。
  const legacyAsFlat = compat.config({
    ...legacyConfigObj,
    extends: remainingExtends,
    plugins: Array.from(
      new Set([...(legacyConfigObj.plugins || []), 'vue', 'import', 'prettier'])
    )
  });
  configs.push(...legacyAsFlat);
  configs.push(...flatExtraConfigs);
} else {
  // flat 配置：直接 import（路径运行时确定，返回值按 any 处理）
  const mod: any = await import(detected.path);
  const exported = mod.default ?? mod;
  if (Array.isArray(exported)) {
    configs.push(...exported);
  } else if (exported && typeof exported === 'object') {
    configs.push(exported);
  } else {
    throw new Error(
      `[code-quality] 老项目 flat 配置 ${detected.path} 的导出不是 config 对象/数组。`
    );
  }
}

// 透明替换 babel-eslint（已废弃，与 ESLint 9 不兼容）为 @babel/eslint-parser。
// 仅作用于运行时，不修改老项目 .eslintrc。
// requireConfigFile: false 让 parser 在没有独立 babel config 路径时也能解析现代 JS / JSX；
// 不引入 @babel/preset-env，避免给 legacy-shield 增加无用依赖。
const babelParser = require('@babel/eslint-parser') as any;
configs.push({
  files: ['**/*.js', '**/*.jsx', '**/*.cjs', '**/*.mjs'],
  languageOptions: {
    parser: babelParser,
    parserOptions: {
      requireConfigFile: false,
      ecmaVersion: 'latest',
      sourceType: 'module',
      ecmaFeatures: { jsx: true },
      babelOptions: {
        babelrc: false,
        configFile: false
      }
    }
  }
});

// 仅锁定老项目源码范围，避免误检 legacy-shield 项目自身与老项目的非源码目录
configs.push({
  ignores: [
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/.cache/**',
    '**/coverage/**',
    '**/mock/**',
    '**/script/**',
    '**/public/**'
  ]
});

export default configs;
