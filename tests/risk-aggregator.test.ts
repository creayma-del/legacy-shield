import { describe, it, expect } from 'vitest';
import { extractMemoryLeakRisks, extractResourceLoadRisks } from '../lib/custom-rules/risk-aggregator.js';
import type { RuleHit } from '../lib/types.js';

function makeHit(ruleName: string, riskType: 'memory-leak' | 'resource-load' | undefined): RuleHit {
  return {
    ruleId: 'SHIELD-000',
    ruleName,
    filePath: '/src/app.js',
    line: 1,
    column: 1,
    message: 'test',
    severity: 'warning',
    riskType,
  };
}

describe('risk-aggregator', () => {
  it('extracts memory leak risks only', () => {
    const hits: RuleHit[] = [
      makeHit('no-leaked-listener', 'memory-leak'),
      makeHit('no-uncleared-timer', 'memory-leak'),
      makeHit('no-large-resource', 'resource-load'),
    ];
    const risks = extractMemoryLeakRisks(hits);
    expect(risks.length).toBe(2);
    expect(risks.every((r) => r.riskType === 'memory-leak')).toBe(true);
  });

  it('extracts resource load risks only', () => {
    const hits: RuleHit[] = [
      makeHit('no-leaked-listener', 'memory-leak'),
      makeHit('no-large-resource', 'resource-load'),
      makeHit('no-sync-script', 'resource-load'),
    ];
    const risks = extractResourceLoadRisks(hits);
    expect(risks.length).toBe(2);
    expect(risks.every((r) => r.riskType === 'resource-load')).toBe(true);
  });

  it('returns empty array when no risk type matches', () => {
    const hits: RuleHit[] = [makeHit('no-dangerous-apis', undefined)];
    expect(extractMemoryLeakRisks(hits)).toEqual([]);
    expect(extractResourceLoadRisks(hits)).toEqual([]);
  });
});
