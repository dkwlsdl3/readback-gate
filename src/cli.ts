#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { scorePrompt } from './core/scorer.ts';
import { normalizeMode, renderHumanSummary } from './core/modes.ts';
import { recordTelemetry } from './core/telemetry.ts';
import type { Mode } from './core/types.ts';
import { parseInstallArgs, runInstall } from './install.ts';

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
  const argv = process.argv.slice(2);
  if (argv[0] === 'install') {
    try {
      const options = parseInstallArgs(argv.slice(1), import.meta.url);
      const results = runInstall(options);
      console.log(JSON.stringify({ results }, null, 2));
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
    process.exit(0);
  }

  const args = parseArgs(argv);
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
