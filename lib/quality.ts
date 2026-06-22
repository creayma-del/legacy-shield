import type { CodeQualityResult, CodeQualitySummary, RunCodeQualityOptions } from './types.js';
import { runAll, runDiff, runModule } from './code-quality/index.js';

let codeQualityRootDeprecationShown = false;

// v1.2 起 code-quality 已内置到 legacy-shield，保留该废弃提示以兼容 v1.1 用户习惯。
function warnDeprecatedCodeQualityRoot(): void {
  if (codeQualityRootDeprecationShown) return;
  if (process.env.CODE_QUALITY_ROOT) {
    // eslint-disable-next-line no-console
    console.warn('CODE_QUALITY_ROOT 已废弃，将使用 legacy-shield 内置 code-quality。');
    codeQualityRootDeprecationShown = true;
  }
}

export async function runCodeQuality(
  legacyRoot: string,
  options: RunCodeQualityOptions = {},
): Promise<CodeQualityResult> {
  warnDeprecatedCodeQualityRoot();

  const command = resolveCommand(options);

  try {
    const result = await runInternal(command, legacyRoot, options);
    const parsedSummary = parseSummary(result.stdout, result.stderr, options.skipList || []);

    return {
      ...result,
      command,
      summary: mergeSummary(result.summary, parsedSummary),
    };
  } catch (err) {
    return errorResult(
      legacyRoot,
      command,
      1,
      '',
      err instanceof Error ? err.message : String(err),
    );
  }
}

function resolveCommand(options: RunCodeQualityOptions): 'all' | 'module' | 'diff' {
  if (options.base) return 'diff';
  if (options.targets && options.targets.length > 0) return 'module';
  return 'all';
}

async function runInternal(
  command: 'all' | 'module' | 'diff',
  legacyRoot: string,
  options: RunCodeQualityOptions,
): Promise<CodeQualityResult> {
  if (command === 'all') {
    return runAll({
      projectPath: legacyRoot,
      // 内部 API 会对 skip 做运行时校验，因此此处先做类型断言
      skip: (options.skipList || []) as ('type-check' | 'lint' | 'test')[],
    });
  }

  if (command === 'module') {
    return runModule({
      projectPath: legacyRoot,
      targets: options.targets || [],
    });
  }

  return runDiff({
    projectPath: legacyRoot,
    base: options.base,
  });
}

function mergeSummary(internal: CodeQualitySummary, parsed: CodeQualitySummary): CodeQualitySummary {
  return {
    exitCode: internal.exitCode || parsed.exitCode,
    testStatus: internal.testStatus !== 'unknown' ? internal.testStatus : parsed.testStatus,
    eslintIssueCount: internal.eslintIssueCount || parsed.eslintIssueCount,
    typeCheckStatus:
      internal.typeCheckStatus !== 'unknown' ? internal.typeCheckStatus : parsed.typeCheckStatus,
  };
}

function parseSummary(stdout: string, stderr: string, skipList: string[]): CodeQualitySummary {
  const output = stdout + stderr;
  const summary: CodeQualitySummary = {
    exitCode: 0,
    testStatus: 'unknown',
    eslintIssueCount: 0,
    typeCheckStatus: 'unknown',
  };

  if (/Tests\s+\d+\s+passed|test passed|Tests passed/i.test(output)) {
    summary.testStatus = 'passed';
  } else if (/Tests\s+\d+\s+failed|test failed|Tests failed/i.test(output)) {
    summary.testStatus = 'failed';
  }

  const problemMatch = output.match(/(\d+) problem/i);
  if (problemMatch) summary.eslintIssueCount = parseInt(problemMatch[1], 10);

  if (/Type check passed|type-check passed/i.test(output)) {
    summary.typeCheckStatus = 'passed';
  } else if (/Type check failed|type-check failed/i.test(output)) {
    summary.typeCheckStatus = 'failed';
  } else if (/type-check skipped|--skip type-check/i.test(output) || skipList.includes('type-check')) {
    summary.typeCheckStatus = 'skipped';
  }

  return summary;
}

function errorResult(
  legacyRoot: string,
  command: string,
  code: number,
  stdout: string,
  stderr: string,
): CodeQualityResult {
  return {
    command,
    code,
    stdout,
    stderr,
    legacyRoot,
    executedAt: new Date().toISOString(),
    summary: {
      exitCode: code,
      testStatus: 'unknown',
      eslintIssueCount: 0,
      typeCheckStatus: 'unknown',
    },
  };
}
