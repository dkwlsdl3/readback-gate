#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { PromptAdapter, ScoreOptions } from '../core/types.ts';
import { scorePrompt } from '../core/scorer.ts';
import { normalizeMode, renderAdditionalContext, renderHumanSummary } from '../core/modes.ts';
import { recordTelemetry } from '../core/telemetry.ts';

function extractPrompt(rawInput: string): string {
  if (!rawInput.trim()) return '';
  try {
    const payload = JSON.parse(rawInput);
    return String(
      payload.prompt ??
        payload.user_prompt ??
        payload.userPrompt ??
        payload.message ??
        payload.input ??
        payload.text ??
        ''
    );
  } catch {
    return rawInput;
  }
}

function renderHookSpecificOutput(additionalContext: string): string {
  return `${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext
    }
  })}\n`;
}

export const codexAdapter: PromptAdapter = {
  name: 'codex',
  run(input: string, options: ScoreOptions = {}) {
    const mode = normalizeMode(options.mode ?? process.env.READBACK_GATE_MODE);
    const threshold = options.threshold ?? Number(process.env.READBACK_GATE_THRESHOLD ?? 70);
    const prompt = extractPrompt(input);
    const report = scorePrompt(prompt, { mode, threshold });

    recordTelemetry('prompt_scored', prompt, report, options.telemetryPath);

    if (report.verdict === 'gate') {
      recordTelemetry('strict_blocked', prompt, report, options.telemetryPath);
      return {
        exitCode: 2,
        stderr: `${renderHumanSummary(report)}\n`
      };
    }

    if (mode === 'advisory') {
      return {
        exitCode: 0,
        stderr: `${renderHumanSummary(report)}\n`
      };
    }

    if (mode === 'silent') {
      return {
        exitCode: 0,
        stdout: renderHookSpecificOutput(renderAdditionalContext(report, 'silent'))
      };
    }

    if (report.verdict === 'inject') {
      recordTelemetry('clarification_injected', prompt, report, options.telemetryPath);
      return {
        exitCode: 0,
        stdout: renderHookSpecificOutput(renderAdditionalContext(report, mode))
      };
    }

    return { exitCode: 0, stdout: '{}\n' };
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const input = readFileSync(0, 'utf8');
  const result = await codexAdapter.run(input);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.exitCode);
}
