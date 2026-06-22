import { scanFiles } from './scanner.js';
import { RULE_IMPLEMENTATIONS } from './rules/index.js';
import { scanHtmlForSyncScripts } from './rules/no-sync-script.js';
import type { CustomRulesResult, ScanOptions } from '../types.js';

export async function runCustomRules(
  legacyRoot: string,
  options: { disabled?: string[]; scanOptions?: ScanOptions } = {},
): Promise<CustomRulesResult> {
  const disabled = new Set(options.disabled || []);
  const allHits = [];

  for (const [ruleName, rule] of Object.entries(RULE_IMPLEMENTATIONS)) {
    if (disabled.has(rule.id) || disabled.has(ruleName)) continue;
    if (ruleName === 'no-sync-script') {
      const hits = scanHtmlForSyncScripts(legacyRoot);
      allHits.push(...hits);
      continue;
    }
    const hits = await scanFiles(legacyRoot, ruleName, options.scanOptions);
    allHits.push(...hits);
  }

  return {
    hits: allHits,
    summary: {
      total: allHits.length,
      errors: allHits.filter((h) => h.severity === 'error').length,
      warnings: allHits.filter((h) => h.severity === 'warning').length,
      files: new Set(allHits.map((h) => h.filePath)).size,
    },
  };
}

export { scanFiles, scanFile } from './scanner.js';
export { RULE_IMPLEMENTATIONS } from './rules/index.js';
