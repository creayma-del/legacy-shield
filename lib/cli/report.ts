import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { analyzeLogs } from '../analyzer.js';
import { generateJsonReport, generateMarkdownReport } from '../reporter.js';
import { assertLegacyProject } from '../utils.js';
import type { ReportCommandOptions } from '../types.js';

export async function runReport(options: ReportCommandOptions): Promise<void> {
  const { project, date, format, out } = options;
  assertLegacyProject(project);

  const logDir = join(project, '.runtime-log-ignore');
  const analysis = await analyzeLogs(logDir, { date });

  const outputPath = out ?? join(logDir, 'reports', `summary-${date}.${format}`);
  mkdirSync(dirname(outputPath), { recursive: true });

  const reportOptions = { project, date };
  const content =
    format === 'json'
      ? JSON.stringify(generateJsonReport(analysis, reportOptions), null, 2)
      : generateMarkdownReport(analysis, reportOptions);

  writeFileSync(outputPath, content, 'utf8');
  // eslint-disable-next-line no-console
  console.log(`[legacy-shield] 报告已生成：${outputPath}`);
}
