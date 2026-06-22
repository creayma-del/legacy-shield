import { describe, it, expect } from 'vitest';
import { generateMarkdownReport, generateJsonReport } from '../lib/reporter.js';
import type { AnalysisResult } from '../lib/types.js';

describe('reporter markdown', () => {
  it('generates markdown with summary table', () => {
    const analysis: AnalysisResult = {
      summary: {
        runtimeErrorCount: 5,
        networkCount: 10,
        behaviorCount: 3,
        runtimeWarningCount: 0,
        networkIssueCount: 0,
        eslintIssueCount: 0,
        testStatus: 'unknown',
        customRuleHitCount: 0,
      },
      topErrors: [],
      networkIssues: [],
      behaviorTimeline: [],
      qualitySummary: { customRuleHitCount: 0, customRuleErrors: 0, customRuleWarnings: 0 },
    };
    const md = generateMarkdownReport(analysis, { project: '/x', date: '2026-06-17' });
    expect(md).toContain('# legacy-shield 运行报告');
    expect(md).toContain('5');
    expect(md).toContain('2026-06-17');
    expect(md).toContain('关键指标摘要表');
    expect(md).toContain('当前日志未发现明显问题，建议持续监控。');
  });

  it('renders top errors and suggestions', () => {
    const analysis: AnalysisResult = {
      summary: {
        runtimeErrorCount: 1,
        networkCount: 0,
        behaviorCount: 0,
        runtimeWarningCount: 0,
        networkIssueCount: 0,
        eslintIssueCount: 0,
        testStatus: 'unknown',
        customRuleHitCount: 0,
      },
      topErrors: [
        {
          errorId: 'e1',
          subType: 'js-error',
          message: 'oops',
          url: '/home',
          count: 3,
          firstAt: '2026-06-17T10:00:00.000Z',
          lastAt: '2026-06-17T10:00:02.000Z',
          samples: [
            {
              type: 'runtime',
              subType: 'js-error',
              errorId: 'e1',
              sessionId: 's1',
              timestamp: '2026-06-17T10:00:02.000Z',
              level: 'error',
              message: 'oops',
              url: '/home',
              userAgent: 'test',
            },
          ],
        },
      ],
      networkIssues: [],
      behaviorTimeline: [],
      qualitySummary: { customRuleHitCount: 0, customRuleErrors: 0, customRuleWarnings: 0 },
    };
    const md = generateMarkdownReport(analysis, { project: '/x', date: '2026-06-17' });
    expect(md).toContain('TOP 10 高频错误');
    expect(md).toContain('e1');
    expect(md).toContain('oops');
    expect(md).toContain('/home');
    expect(md).toContain('发现高频运行时错误');
  });

  it('renders network issues and suggestions', () => {
    const analysis: AnalysisResult = {
      summary: {
        runtimeErrorCount: 0,
        networkCount: 2,
        behaviorCount: 0,
        runtimeWarningCount: 0,
        networkIssueCount: 1,
        eslintIssueCount: 0,
        testStatus: 'unknown',
        customRuleHitCount: 0,
      },
      topErrors: [],
      networkIssues: [
        {
          requestId: 'r1',
          method: 'GET',
          url: '/api',
          status: 500,
          durationMs: 120,
          level: 'error',
          timestamp: '2026-06-17T10:00:00.000Z',
        },
      ],
      behaviorTimeline: [],
      qualitySummary: { customRuleHitCount: 0, customRuleErrors: 0, customRuleWarnings: 0 },
    };
    const md = generateMarkdownReport(analysis, { project: '/x', date: '2026-06-17' });
    expect(md).toContain('网络异常分析');
    expect(md).toContain('/api');
    expect(md).toContain('status=500');
    expect(md).toContain('存在网络异常或慢请求');
  });

  it('renders behavior timeline', () => {
    const analysis: AnalysisResult = {
      summary: {
        runtimeErrorCount: 0,
        networkCount: 0,
        behaviorCount: 1,
        runtimeWarningCount: 0,
        networkIssueCount: 0,
        eslintIssueCount: 0,
        testStatus: 'unknown',
        customRuleHitCount: 0,
      },
      topErrors: [],
      networkIssues: [],
      behaviorTimeline: [
        {
          sequence: 1,
          subType: 'click',
          timestamp: '2026-06-17T10:00:00.000Z',
          pageUrl: '/home',
          target: { tagName: 'BUTTON', selector: '#btn' },
          payload: {},
        },
      ],
      qualitySummary: { customRuleHitCount: 0, customRuleErrors: 0, customRuleWarnings: 0 },
    };
    const md = generateMarkdownReport(analysis, { project: '/x', date: '2026-06-17' });
    expect(md).toContain('用户行为时间线');
    expect(md).toContain('[1] click');
  });

  it('renders quality summary with custom rule suggestions', () => {
    const analysis: AnalysisResult = {
      summary: {
        runtimeErrorCount: 0,
        networkCount: 0,
        behaviorCount: 0,
        runtimeWarningCount: 0,
        networkIssueCount: 0,
        eslintIssueCount: 0,
        testStatus: 'unknown',
        customRuleHitCount: 0,
      },
      topErrors: [],
      networkIssues: [],
      behaviorTimeline: [],
      qualitySummary: {
        codeQualityCommand: 'all',
        codeQualityExitCode: 1,
        customRuleHitCount: 2,
        customRuleErrors: 1,
        customRuleWarnings: 1,
      },
    };
    const md = generateMarkdownReport(analysis, { project: '/x', date: '2026-06-17' });
    expect(md).toContain('代码质量摘要');
    expect(md).toContain('自定义规则命中数');
    expect(md).toContain('自定义规则扫描发现错误级别命中项');
  });

  it('renders v1.4 new subtypes (pinia/vuex) in markdown top errors section', () => {
    const subTypes = ['pinia-error', 'pinia-plugin-error', 'vuex-error', 'vuex-strict-violation'] as const;
    const analysis: AnalysisResult = {
      summary: {
        runtimeErrorCount: subTypes.length,
        networkCount: 0,
        behaviorCount: 0,
        runtimeWarningCount: 0,
        networkIssueCount: 0,
        eslintIssueCount: 0,
        testStatus: 'unknown',
        customRuleHitCount: 0,
      },
      topErrors: subTypes.map((subType, idx) => ({
        errorId: `${subType}-eid`,
        subType,
        message: `${subType} sample message`,
        url: '/x',
        count: 1,
        firstAt: `2026-06-17T10:00:0${idx}.000Z`,
        lastAt: `2026-06-17T10:00:0${idx}.000Z`,
        samples: [
          {
            type: 'runtime',
            subType,
            errorId: `${subType}-eid`,
            sessionId: 's1',
            timestamp: `2026-06-17T10:00:0${idx}.000Z`,
            level: 'error',
            message: `${subType} sample message`,
            url: '/x',
            userAgent: 'test',
          },
        ],
      })),
      networkIssues: [],
      behaviorTimeline: [],
      qualitySummary: { customRuleHitCount: 0, customRuleErrors: 0, customRuleWarnings: 0 },
    };
    const md = generateMarkdownReport(analysis, { project: '/x', date: '2026-06-17' });
    // reporter escapeMdCell 会对 '-' 转义为 '\-'，subType 字符串在表格中以 escape 形态呈现。
    // 这里同时容忍未转义（如未来 reporter 调整 escape 策略）与已转义两种形态。
    for (const subType of subTypes) {
      const escaped = subType.replace(/-/g, '\\-');
      expect(md.includes(subType) || md.includes(escaped)).toBe(true);
    }
  });
});

describe('reporter json', () => {
  it('generates valid json report', () => {
    const analysis: AnalysisResult = {
      summary: {
        runtimeErrorCount: 1,
        runtimeWarningCount: 0,
        networkCount: 0,
        networkIssueCount: 0,
        behaviorCount: 0,
        eslintIssueCount: 0,
        testStatus: 'unknown',
        customRuleHitCount: 0,
      },
      topErrors: [],
      networkIssues: [],
      behaviorTimeline: [],
      qualitySummary: { customRuleHitCount: 0, customRuleErrors: 0, customRuleWarnings: 0 },
    };
    const report = generateJsonReport(analysis, { project: '/x', date: '2026-06-17' });
    expect(report.meta.date).toBe('2026-06-17');
    expect(report.meta.project).toBe('/x');
    expect(report.summary.runtimeErrorCount).toBe(1);
  });
});
