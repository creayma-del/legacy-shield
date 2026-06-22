import type { AnalysisResult, JsonReport, TopError } from './types.js';

function escapeMdCell(value: unknown): string {
  const str = String(value ?? '');
  return str
    .replace(/[\\`*_{}[\]()#+\-.!|]/g, '\\$&')
    .replace(/\n/g, ' ');
}

function renderTopErrors(topErrors: TopError[]): string {
  if (topErrors.length === 0) {
    return '暂无高频错误';
  }
  const header = '| errorId | subType | message | count | firstAt | lastAt |';
  const separator = '|---|---|---|---|---|---|';
  const rows = topErrors.map(
    (e) =>
      `| ${escapeMdCell(e.errorId)} | ${escapeMdCell(e.subType)} | ${escapeMdCell(e.message)} | ${e.count} | ${escapeMdCell(e.firstAt)} | ${escapeMdCell(e.lastAt)} |`,
  );
  const samples = topErrors
    .filter((e) => e.samples.length > 0)
    .map((e) => {
      const sample = e.samples[e.samples.length - 1];
      return `- **${escapeMdCell(e.errorId)}** 最近样本：url=${escapeMdCell(sample.url)}, message=${escapeMdCell(sample.message)}`;
    })
    .join('\n');
  return [header, separator, ...rows, '', samples].join('\n');
}

function renderNetworkIssues(networkIssues: AnalysisResult['networkIssues']): string {
  if (networkIssues.length === 0) {
    return '暂无网络异常';
  }
  return networkIssues
    .map(
      (n) =>
        `- **[${n.level}]** ${n.method} ${n.url} | status=${n.status} | duration=${n.durationMs}ms | ${n.timestamp}`,
    )
    .join('\n');
}

function renderBehaviorTimeline(timeline: AnalysisResult['behaviorTimeline']): string {
  if (timeline.length === 0) {
    return '暂无行为事件';
  }
  return timeline
    .map(
      (item) =>
        `- [${item.sequence}] ${item.subType} @ ${item.timestamp} | page=${item.pageUrl}`,
    )
    .join('\n');
}

function renderQualitySummary(qualitySummary: AnalysisResult['qualitySummary']): string {
  if (!qualitySummary.codeQualityCommand && qualitySummary.customRuleHitCount === 0) {
    return '未检测到质量日志';
  }
  const lines: string[] = [];
  if (qualitySummary.codeQualityCommand !== undefined) {
    lines.push(`- 质量命令：${qualitySummary.codeQualityCommand}`);
  }
  if (qualitySummary.codeQualityExitCode !== undefined) {
    lines.push(`- 退出码：${qualitySummary.codeQualityExitCode}`);
  }
  lines.push(`- 自定义规则命中数：${qualitySummary.customRuleHitCount}`);
  lines.push(`- 自定义规则错误数：${qualitySummary.customRuleErrors}`);
  lines.push(`- 自定义规则警告数：${qualitySummary.customRuleWarnings}`);
  return lines.join('\n');
}

function renderSuggestions(analysis: AnalysisResult): string {
  const suggestions: string[] = [];
  if (analysis.topErrors.length > 0) {
    suggestions.push('- 发现高频运行时错误，建议优先排查 TOP 10 错误列表中的问题。');
  }
  if (analysis.summary.networkIssueCount > 0) {
    suggestions.push('- 存在网络异常或慢请求，建议检查接口稳定性与响应耗时。');
  }
  if (analysis.qualitySummary.customRuleErrors > 0) {
    suggestions.push('- 自定义规则扫描发现错误级别命中项，建议修复相关代码。');
  }
  if (suggestions.length === 0) {
    return '当前日志未发现明显问题，建议持续监控。';
  }
  return suggestions.join('\n');
}

export function generateMarkdownReport(
  analysis: AnalysisResult,
  options: { project: string; date: string },
): string {
  const summaryRows = [
    ['运行时错误数', analysis.summary.runtimeErrorCount],
    ['运行时警告数', analysis.summary.runtimeWarningCount],
    ['网络请求总数', analysis.summary.networkCount],
    ['网络异常数', analysis.summary.networkIssueCount],
    ['用户行为事件数', analysis.summary.behaviorCount],
    ['ESLint 问题数', analysis.summary.eslintIssueCount],
    ['测试状态', analysis.summary.testStatus],
    ['自定义规则命中数', analysis.summary.customRuleHitCount],
  ]
    .map(([label, value]) => `| ${label} | ${value} |`)
    .join('\n');

  return `# legacy-shield 运行报告

- 项目路径：${options.project}
- 分析日期：${options.date}
- 生成时间：${new Date().toISOString()}

## 关键指标摘要表

| 指标 | 数值 |
|---|---|
${summaryRows}

## TOP 10 高频错误

${renderTopErrors(analysis.topErrors)}

## 网络异常分析

${renderNetworkIssues(analysis.networkIssues)}

## 用户行为时间线

${renderBehaviorTimeline(analysis.behaviorTimeline)}

## 代码质量摘要

${renderQualitySummary(analysis.qualitySummary)}

## 建议与下一步

${renderSuggestions(analysis)}
`;
}

export function generateJsonReport(
  analysis: AnalysisResult,
  options: { project: string; date: string },
): JsonReport {
  return {
    meta: {
      project: options.project,
      date: options.date,
      generatedAt: new Date().toISOString(),
    },
    summary: analysis.summary,
    topErrors: analysis.topErrors,
    networkIssues: analysis.networkIssues,
    behaviorTimeline: analysis.behaviorTimeline,
    qualitySummary: analysis.qualitySummary,
  };
}
