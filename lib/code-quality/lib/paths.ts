// legacy-shield / lib/code-quality / lib / paths.ts
// ------------------------------------------------------------
// 路径计算（纯函数，不做任何 IO）
// 镜像规则：
//   <legacy>/src/utils/foo.js  -> <legacy-shield>/tests/code-quality-generated/utils/foo.spec.js
//   <legacy>/src/components/Hello.vue -> <legacy-shield>/tests/code-quality-generated/components/Hello.vue.spec.js
// ------------------------------------------------------------

import { existsSync } from 'node:fs';
import { dirname, relative, resolve, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * 向上遍历目录，直到找到包含 package.json 的目录，作为 legacy-shield 项目根目录。
 * 该实现同时兼容源码开发与编译到 dist 后的运行场景。
 */
function findProjectRoot(startDir: string): string {
  let dir = startDir;
  while (true) {
    if (existsSync(resolve(dir, 'package.json'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`[paths] 无法定位 legacy-shield 根目录：${startDir}`);
    }
    dir = parent;
  }
}

/** code-quality 内部模块目录（源码位置） */
export const CODE_QUALITY_DIR = resolve(findProjectRoot(__dirname), 'lib', 'code-quality');

/** legacy-shield 项目根目录 */
export const LEGACY_SHIELD_ROOT = findProjectRoot(__dirname);

/** 自动生成单测的稳定落盘目录 */
export const CODE_QUALITY_TESTS_DIR = resolve(LEGACY_SHIELD_ROOT, 'tests', 'code-quality-generated');

// 集中维护：本模块处理的源文件后缀白名单
// 注意 .vue 单独成镜像规则；其它后缀按"去后缀 + .spec.js"方式镜像
export const SUPPORTED_SCRIPT_EXTS: string[] = ['.js', '.jsx', '.ts', '.tsx'];
export const SUPPORTED_EXTS: string[] = [...SUPPORTED_SCRIPT_EXTS, '.vue'];

export function isSupportedExt(absPath: string): boolean {
  return SUPPORTED_EXTS.some((e: string) => absPath.endsWith(e));
}

export function legacySrcOf(legacyRoot: string): string {
  return resolve(legacyRoot, 'src');
}

/**
 * 给定老项目 src 内的源文件绝对路径，计算 tests/code-quality-generated 下镜像的 spec 文件绝对路径。
 * 不做存在性校验。
 *
 * 抛错条件：srcAbs 不在老项目 src 范围内 / 后缀不被支持。
 */
export function mirrorTestPathOf(legacyRoot: string, srcAbs: string): string {
  if (!isAbsolute(srcAbs)) {
    throw new Error(`[paths] srcAbs 必须是绝对路径：${srcAbs}`);
  }
  const srcRoot = legacySrcOf(legacyRoot);
  const rel = relative(srcRoot, srcAbs);
  if (rel.startsWith('..') || rel.startsWith(sep)) {
    throw new Error(
      `[paths] 文件不在老项目 src 范围内，无法生成测试：${srcAbs}（src=${srcRoot}）`
    );
  }
  let specRel: string;
  if (srcAbs.endsWith('.vue')) {
    // .vue 保留后缀以避免与同名脚本镜像冲突，例如 Hello.vue.spec.js
    specRel = `${rel}.spec.js`;
  } else {
    // .js / .jsx / .ts / .tsx 统一去掉源后缀，写为 .spec.js（vitest 默认可识别）
    const matched = SUPPORTED_SCRIPT_EXTS.find((e: string) => srcAbs.endsWith(e));
    if (!matched) {
      throw new Error(
        `[paths] 仅支持 ${SUPPORTED_EXTS.join(' / ')}：${srcAbs}`
      );
    }
    specRel = rel.replace(new RegExp(matched.replace('.', '\\.') + '$'), '.spec.js');
  }
  return resolve(CODE_QUALITY_TESTS_DIR, specRel);
}

/**
 * 计算从 spec 文件到老项目 src 内源文件的相对 import 路径（POSIX 形式，不带后缀）。
 * 用于在生成的 spec 中以相对路径 import，避免老项目 alias 不一致。
 *
 * 规则：
 *   - .vue 保留后缀（Vite/Vitest 解析 SFC 需要）
 *   - .js / .jsx / .ts / .tsx 统一去掉后缀，由 Vitest/TS 自行解析
 */
export function relativeImportFromSpec(specAbs: string, srcAbs: string): string {
  const dir = dirname(specAbs);
  let rel = relative(dir, srcAbs);
  for (const e of SUPPORTED_SCRIPT_EXTS) {
    if (rel.endsWith(e)) {
      rel = rel.slice(0, -e.length);
      break;
    }
  }
  // 转为 POSIX 风格
  rel = rel.split(sep).join('/');
  if (!rel.startsWith('.')) rel = './' + rel;
  return rel;
}
