export type RiskLevel = 'none' | 'low' | 'medium' | 'high';
export type Verdict = 'pass' | 'inject' | 'gate';
export type Mode = 'silent' | 'inject' | 'advisory' | 'strict';
export type TelemetryEvent =
  | 'prompt_scored'
  | 'clarification_injected'
  | 'clarification_asked'
  | 'followup_prompt_seen'
  | 'undo_or_revert_seen'
  | 'strict_blocked';

export type AxisName =
  | 'goal_clarity'
  | 'target_context'
  | 'scope_boundedness'
  | 'done_condition'
  | 'risk_side_effect'
  | 'context_dependency';

export type Axes = Record<AxisName, number>;

export interface ScoreOptions {
  mode?: Mode;
  threshold?: number;
  telemetryPath?: string;
}

export interface Report {
  version: string;
  clarity_score: number;
  risk_level: RiskLevel;
  verdict: Verdict;
  axes: Axes;
  missing: string[];
  trigger_reasons: string[];
  suggested_questions: string[];
  better_prompt_example?: string;
}

export interface AdapterResult {
  exitCode: number;
  stdout?: string;
  stderr?: string;
}

export interface PromptAdapter {
  name: string;
  run(input: string, options?: ScoreOptions): Promise<AdapterResult> | AdapterResult;
}
