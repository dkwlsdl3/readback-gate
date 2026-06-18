import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import type { Report, TelemetryEvent } from './types.ts';

export interface TelemetryRecord {
  ts: string;
  event: TelemetryEvent;
  prompt_hash?: string;
  prompt_length?: number;
  clarity_score?: number;
  risk_level?: string;
  verdict?: string;
  missing?: string[];
}

export function defaultTelemetryPath(): string {
  return process.env.READBACK_GATE_TELEMETRY ??
    join(homedir(), '.local', 'state', 'readback-gate', 'events.jsonl');
}

export function hashPrompt(prompt: string): string {
  return createHash('sha256').update(prompt).digest('hex').slice(0, 16);
}

export function recordTelemetry(
  event: TelemetryEvent,
  prompt: string,
  report?: Report,
  telemetryPath = defaultTelemetryPath()
): void {
  const record: TelemetryRecord = {
    ts: new Date().toISOString(),
    event,
    prompt_hash: hashPrompt(prompt),
    prompt_length: prompt.length
  };

  if (report) {
    record.clarity_score = report.clarity_score;
    record.risk_level = report.risk_level;
    record.verdict = report.verdict;
    record.missing = report.missing;
  }

  try {
    mkdirSync(dirname(telemetryPath), { recursive: true });
    appendFileSync(telemetryPath, `${JSON.stringify(record)}\n`, 'utf8');
  } catch {
    // Telemetry is validity data for later analysis; it must never block a hook.
  }
}
