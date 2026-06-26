#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { PromptAdapter, ScoreOptions } from '../core/types.ts';
import { scorePrompt } from '../core/scorer.ts';
import { normalizeMode, renderAdditionalContext, renderHumanSummary } from '../core/modes.ts';
import { recordTelemetry } from '../core/telemetry.ts';
import { extractPrompt, recordDualRunCapture } from '../dualrun-capture.ts';

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
    if (process.env.READBACK_GATE_DISABLE === '1' || process.env.READBACK_GATE_DISABLE === 'true') {
      return { exitCode: 0, stdout: '{}\n' };
    }

    const mode = normalizeMode(options.mode ?? process.env.READBACK_GATE_MODE);
    const threshold = options.threshold ?? Number(process.env.READBACK_GATE_THRESHOLD ?? 70);
    const prompt = extractPrompt(input);
    const report = scorePrompt(prompt, { mode, threshold });

    recordTelemetry('prompt_scored', prompt, report, options.telemetryPath);
    recordDualRunCapture(input, prompt, report, 'codex');

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

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  if (import.meta.url === pathToFileURL(entry).href) return true;
  // npm installs bins as symlinks, so argv[1] (the bin) differs from the real
  // module path. Compare resolved real paths to detect direct execution.
  try {
    return fileURLToPath(import.meta.url) === realpathSync(entry);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  const input = readFileSync(0, 'utf8');
  const result = await codexAdapter.run(input);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.exitCode);
}
