import type { Axes, Report, ScoreOptions } from './types.ts';
import {
  clampScore,
  doneConditionPatterns,
  hasActionVerb,
  hasConcreteTarget,
  hasMutatingAction,
  isNonExecutionIntent,
  isReadOnlyStatusIntent,
  isSimpleReadOnly,
  matchesAny,
  unboundedScopePatterns,
  unresolvedReferencePatterns,
  vagueGoalPatterns
} from './rules.ts';
import { acknowledgesRisk, classifyRisk } from './risk.ts';
import { decideVerdict } from './modes.ts';

const VERSION = '0.1.0';

interface Penalties {
  missing_goal: number;
  missing_target: number;
  unbounded_scope: number;
  missing_done: number;
  risk_unacknowledged: number;
  context_dependency: number;
}

export function scorePrompt(prompt: string, options: ScoreOptions = {}): Report {
  const text = prompt.trim();
  const mutatingAction = hasMutatingAction(text);
  const simpleReadOnly = isSimpleReadOnly(text) && !mutatingAction;
  const riskLevel = classifyRisk(text);
  const mediumReadOnlyStatus = riskLevel === 'medium' && isReadOnlyStatusIntent(text) && !mutatingAction;
  const nonExecution =
    isNonExecutionIntent(text) && !mutatingAction && (riskLevel === 'none' || riskLevel === 'low' || mediumReadOnlyStatus);
  const riskAcknowledged = acknowledgesRisk(text);
  const vagueGoal = matchesAny(text, vagueGoalPatterns);
  const unresolved = matchesAny(text, unresolvedReferencePatterns);
  const unbounded = matchesAny(text, unboundedScopePatterns);
  const done = matchesAny(text, doneConditionPatterns);

  const penalties: Penalties = {
    missing_goal: 0,
    missing_target: 0,
    unbounded_scope: 0,
    missing_done: 0,
    risk_unacknowledged: 0,
    context_dependency: 0
  };
  const missing: string[] = [];
  const triggerReasons: string[] = [];

  if (!simpleReadOnly && !nonExecution && !hasActionVerb(text)) {
    penalties.missing_goal = 22;
    missing.push('goal_clarity');
    triggerReasons.push('No clear action verb was detected.');
  } else if (vagueGoal.matched) {
    penalties.missing_goal = 16;
    missing.push('goal_clarity');
    triggerReasons.push('The requested action is vague or delegation-heavy.');
  }

  if (!simpleReadOnly && !nonExecution && !hasConcreteTarget(text)) {
    penalties.missing_target += 32;
    missing.push('target_context');
    triggerReasons.push('No concrete file, path, symbol, module, or object was detected.');
  }

  if (unresolved.matched) {
    penalties.missing_target += 8;
    penalties.context_dependency += 12;
    if (!missing.includes('target_context')) missing.push('target_context');
    missing.push('context_dependency');
    triggerReasons.push('The prompt depends on unresolved references or previous context.');
  }

  if (unbounded.matched) {
    penalties.unbounded_scope = 12;
    missing.push('scope_boundedness');
    triggerReasons.push('The requested scope is broad or unbounded.');
  }

  if (!simpleReadOnly && !nonExecution && !done.matched && riskLevel !== 'low') {
    penalties.missing_done = riskLevel === 'none' ? 10 : 12;
    missing.push('done_condition');
    triggerReasons.push('No verifiable done condition or validation signal was detected.');
  }

  if ((riskLevel === 'high' || riskLevel === 'medium') && !riskAcknowledged) {
    penalties.risk_unacknowledged = riskLevel === 'high' ? 14 : 8;
    missing.push('risk_side_effect');
    triggerReasons.push('The prompt has side effects but does not acknowledge risk or confirmation boundaries.');
  }

  const totalPenalty = Object.values(penalties).reduce((sum, value) => sum + value, 0);
  const clarityScore = clampScore(100 - totalPenalty);
  const axes: Axes = {
    goal_clarity: clampScore(100 - penalties.missing_goal),
    target_context: clampScore(100 - penalties.missing_target),
    scope_boundedness: clampScore(100 - penalties.unbounded_scope),
    done_condition: clampScore(100 - penalties.missing_done),
    risk_side_effect: clampScore(100 - penalties.risk_unacknowledged),
    context_dependency: clampScore(100 - penalties.context_dependency)
  };

  const report: Report = {
    version: VERSION,
    clarity_score: clarityScore,
    risk_level: riskLevel,
    verdict: 'pass',
    axes,
    missing: Array.from(new Set(missing)),
    trigger_reasons: Array.from(new Set(triggerReasons)),
    suggested_questions: suggestQuestions(Array.from(new Set(missing)), riskLevel)
  };
  report.verdict = decideVerdict(report, options);
  return report;
}

function suggestQuestions(missing: string[], riskLevel: string): string[] {
  const questions: string[] = [];
  if (missing.includes('goal_clarity')) {
    questions.push('What exact outcome should the agent produce?');
  }
  if (missing.includes('target_context')) {
    questions.push('Which file, path, symbol, module, or object should the agent work on?');
  }
  if (missing.includes('scope_boundedness')) {
    questions.push('What is explicitly in scope and out of scope?');
  }
  if (missing.includes('done_condition')) {
    questions.push('What command, test, output, or observable condition proves the task is done?');
  }
  if (missing.includes('risk_side_effect') || riskLevel === 'high') {
    questions.push('Should the agent ask before destructive, remote, or production-impacting actions?');
  }
  if (missing.includes('context_dependency')) {
    questions.push('What prior context should be restated so the task is self-contained?');
  }
  return questions.slice(0, 4);
}
