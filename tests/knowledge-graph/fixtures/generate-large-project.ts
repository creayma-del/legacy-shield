/**
 * 生成 5000 文件合成项目用于性能基线测试。
 *
 * 对应 T12 任务 Spec §3.5：合成项目夹具由本脚本一次性生成，
 * 夹具不纳入 git（.gitignore 排除 large-project/），CI 中首次运行时自动生成。
 *
 * 生成结构：
 * - package.json
 * - tsconfig.json（含 paths: { "@/*": ["src/*"] }）
 * - src/ 下 5000 个 .ts 文件，每个含 5-10 个 import 语句
 *   - 文件按 src/mod0/ ~ src/mod49/ 分 50 个子目录，每目录 100 个文件
 *   - import 语句混合相对路径与 @/ alias，形成真实依赖图
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** 合成项目根目录（位于 fixtures/large-project/，已 .gitignore 排除） */
export const LARGE_PROJECT_DIR = join(__dirname, 'large-project');

/** 文件总数 */
const TOTAL_FILES = 5000;

/** 子目录数 */
const MODULE_COUNT = 50;

/** 每个子目录文件数 */
const FILES_PER_MODULE = TOTAL_FILES / MODULE_COUNT; // 100

/**
 * 生成合成项目。若已存在则跳过（幂等）。
 * @returns 合成项目根路径
 */
export function generateLargeProject(): string {
  // 幂等：已存在则直接返回
  if (existsSync(LARGE_PROJECT_DIR) && existsSync(join(LARGE_PROJECT_DIR, 'package.json'))) {
    return LARGE_PROJECT_DIR;
  }

  // 1. 创建项目根目录
  mkdirSync(LARGE_PROJECT_DIR, { recursive: true });

  // 2. package.json
  writeFileSync(
    join(LARGE_PROJECT_DIR, 'package.json'),
    JSON.stringify({
      name: 'large-synthetic-project',
      version: '0.0.0',
      private: true,
    }),
  );

  // 3. tsconfig.json（含 alias 配置）
  writeFileSync(
    join(LARGE_PROJECT_DIR, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        baseUrl: '.',
        paths: { '@/*': ['src/*'] },
      },
    }),
  );

  // 4. 生成 5000 个 .ts 文件
  for (let mod = 0; mod < MODULE_COUNT; mod++) {
    const modDir = join(LARGE_PROJECT_DIR, 'src', `mod${mod}`);
    mkdirSync(modDir, { recursive: true });

    for (let i = 0; i < FILES_PER_MODULE; i++) {
      const fileName = `file${i}.ts`;
      const filePath = join(modDir, fileName);
      const content = generateFileContent(mod, i);
      writeFileSync(filePath, content);
    }
  }

  return LARGE_PROJECT_DIR;
}

/**
 * 生成单个文件内容：5-10 个 import 语句 + 1 个 export。
 *
 * import 策略（确保形成真实依赖图）：
 * - 2-3 个同模块相对路径 import（./fileN）
 * - 2-3 个跨模块 alias import（@/modM/fileN）
 * - 1-2 个 re-export（export { x } from './fileN'）
 * - 1 个 export const 声明
 */
function generateFileContent(mod: number, i: number): string {
  const lines: string[] = [];

  // 同模块相对路径 import（2-3 个）
  const sameModuleCount = 2 + (i % 2); // 2 或 3
  for (let j = 0; j < sameModuleCount; j++) {
    const target = (i + j + 1) % FILES_PER_MODULE;
    lines.push(`import { value_${mod}_${target} } from './file${target}';`);
  }

  // 跨模块 alias import（2-3 个）
  const crossModuleCount = 2 + (i % 2); // 2 或 3
  for (let j = 0; j < crossModuleCount; j++) {
    const targetMod = (mod + j + 1) % MODULE_COUNT;
    const targetFile = (i + j) % FILES_PER_MODULE;
    lines.push(`import { value_${targetMod}_${targetFile} } from '@/mod${targetMod}/file${targetFile}';`);
  }

  // re-export（1-2 个）
  const reExportCount = 1 + (i % 2); // 1 或 2
  for (let j = 0; j < reExportCount; j++) {
    const target = (i + j + 5) % FILES_PER_MODULE;
    lines.push(`export { value_${mod}_${target} } from './file${target}';`);
  }

  // 本地导出
  lines.push(`export const value_${mod}_${i} = ${i};`);

  return lines.join('\n') + '\n';
}
