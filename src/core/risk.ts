import type { RiskLevel } from './types.ts';
import {
  highRiskPatterns,
  lowRiskPatterns,
  matchesAny,
  mediumRiskPatterns,
  riskAcknowledgementPatterns
} from './rules.ts';

export function classifyRisk(prompt: string): RiskLevel {
  if (matchesAny(prompt, highRiskPatterns).matched) return 'high';
  if (matchesAny(prompt, mediumRiskPatterns).matched) return 'medium';
  if (matchesAny(prompt, lowRiskPatterns).matched) return 'low';
  return 'none';
}

export function acknowledgesRisk(prompt: string): boolean {
  return matchesAny(prompt, riskAcknowledgementPatterns).matched;
}
