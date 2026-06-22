import type { RuleHit, StaticRiskItem, RiskType } from '../types.js';

export function aggregateRiskItems(hits: RuleHit[], riskType: RiskType): StaticRiskItem[] {
  return hits
    .filter((h) => h.riskType === riskType)
    .map((h) => ({
      ruleId: h.ruleId,
      ruleName: h.ruleName,
      filePath: h.filePath,
      line: h.line,
      column: h.column,
      message: h.message,
      severity: h.severity,
      riskType,
      context: h.context,
    }));
}

export function extractMemoryLeakRisks(hits: RuleHit[]): StaticRiskItem[] {
  return aggregateRiskItems(hits, 'memory-leak');
}

export function extractResourceLoadRisks(hits: RuleHit[]): StaticRiskItem[] {
  return aggregateRiskItems(hits, 'resource-load');
}
