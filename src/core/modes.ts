import type { Mode, Report, ScoreOptions } from './types.ts';

export const DEFAULT_MODE: Mode = 'inject';
export const DEFAULT_THRESHOLD = 70;

export function normalizeMode(mode?: string): Mode {
  if (mode === 'silent' || mode === 'inject' || mode === 'advisory' || mode === 'strict') {
    return mode;
  }
  return DEFAULT_MODE;
}

export function decideVerdict(report: Report, options: ScoreOptions = {}) {
  const mode = normalizeMode(options.mode);
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;

  if (mode === 'strict' && report.clarity_score < threshold && report.risk_level === 'high') {
    return 'gate';
  }

  if (mode === 'inject' || mode === 'strict') {
    return report.clarity_score < threshold ? 'inject' : 'pass';
  }

  return 'pass';
}

export function renderAdditionalContext(report: Report, mode: Mode): string {
  const missing = report.missing.length > 0 ? report.missing.join(', ') : 'none';
  const base = [
    `Readback-gate: clarity_score=${report.clarity_score}, risk_level=${report.risk_level}, missing=${missing}.`
  ];

  if (mode === 'inject' || mode === 'strict') {
    base.push(
      'If the prompt is ambiguous, do not execute yet. First sync intent in this format:',
      '1. State the understood goal in one sentence.',
      '2. List 2-4 plausible interpretations as options.',
      '3. Recommend one with a short reason.',
      '4. Ask exactly one clarification question, then stop.',
      'Skip this for simple chat or a clearly-scoped single command.'
    );
    if (report.suggested_questions.length > 0) {
      base.push(`Suggested questions: ${report.suggested_questions.join(' | ')}`);
    }
  }

  return base.join('\n');
}

export function renderHumanSummary(report: Report): string {
  const missing = report.missing.length > 0 ? report.missing.join(', ') : 'none';
  const reasons = report.trigger_reasons.length > 0 ? report.trigger_reasons.join(' ') : 'No ambiguity triggers detected.';
  return [
    `readback-gate: score=${report.clarity_score}/100 risk=${report.risk_level} verdict=${report.verdict}`,
    `missing: ${missing}`,
    `reasons: ${reasons}`,
    report.suggested_questions.length > 0 ? `questions: ${report.suggested_questions.join(' | ')}` : undefined
  ]
    .filter(Boolean)
    .join('\n');
}
