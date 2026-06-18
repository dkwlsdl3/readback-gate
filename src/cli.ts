#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { scorePrompt } from './core/scorer.ts';
import { normalizeMode, renderHumanSummary } from './core/modes.ts';
import { recordTelemetry } from './core/telemetry.ts';
import type { Mode } from './core/types.ts';

interface CliArgs {
  mode: Mode;
  threshold: number;
  jsonOnly: boolean;
  telemetryPath?: string;
  prompt: string;
}

export function resolvePrompt(promptParts: string[], readStdin: () => string, isTty: boolean): string {
  const argvPrompt = promptParts.join(' ').trim();
  if (argvPrompt) return argvPrompt;
  if (isTty) return '';

  try {
    return readStdin().trim();
  } catch {
    return '';
  }
}

function parseArgs(argv: string[]): CliArgs {
  let mode: Mode = 'inject';
  let threshold = 70;
  let jsonOnly = false;
  let telemetryPath: string | undefined;
  const promptParts: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--mode') {
      mode = normalizeMode(argv[++index]);
    } else if (arg.startsWith('--mode=')) {
      mode = normalizeMode(arg.slice('--mode='.length));
    } else if (arg === '--threshold') {
      threshold = Number(argv[++index]);
    } else if (arg.startsWith('--threshold=')) {
      threshold = Number(arg.slice('--threshold='.length));
    } else if (arg === '--json') {
      jsonOnly = true;
    } else if (arg === '--telemetry') {
      telemetryPath = argv[++index];
    } else if (arg.startsWith('--telemetry=')) {
      telemetryPath = arg.slice('--telemetry='.length);
    } else {
      promptParts.push(arg);
    }
  }

  const prompt = resolvePrompt(promptParts, () => readFileSync(0, 'utf8'), Boolean(process.stdin.isTTY));
  if (!prompt) {
    console.error('Usage: readback-gate [--mode inject|silent|advisory|strict] [--threshold N] "<prompt>"');
    process.exit(1);
  }
  return { mode, threshold, jsonOnly, telemetryPath, prompt };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  const report = scorePrompt(args.prompt, { mode: args.mode, threshold: args.threshold });
  recordTelemetry('prompt_scored', args.prompt, report, args.telemetryPath);
  if (report.verdict === 'inject') {
    recordTelemetry('clarification_injected', args.prompt, report, args.telemetryPath);
  }
  if (report.verdict === 'gate') {
    recordTelemetry('strict_blocked', args.prompt, report, args.telemetryPath);
  }

  if (!args.jsonOnly) {
    console.log(renderHumanSummary(report));
  }
  console.log(JSON.stringify(report, null, 2));

  if (report.verdict === 'gate') {
    process.exit(2);
  }
}
