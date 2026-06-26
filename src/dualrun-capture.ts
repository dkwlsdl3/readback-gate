import { createHash } from 'node:crypto';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { Report } from './core/types.ts';
import type { AgentKind, ContextFidelity } from './dualrun.ts';

type JsonObject = Record<string, unknown>;

export interface DualRunQueueEntry {
  version: 1;
  id: string;
  ts: string;
  agent: AgentKind;
  repoPath: string;
  promptHash: string;
  promptPath: string;
  hookInputPath: string;
  contextPath?: string;
  contextFidelity: ContextFidelity;
  score: {
    clarity_score: number;
    risk_level: string;
    verdict: string;
    missing: string[];
  };
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sha256Short(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function safeTs(): string {
  return new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
}

function truthyEnv(value: string | undefined): boolean {
  return value === '1' || value === 'true' || value === 'yes';
}

function normalizeAgent(value: string | undefined, fallback: AgentKind): AgentKind {
  if (value === 'claude' || value === 'codex' || value === 'custom') return value;
  return fallback;
}

function defaultStateRoot(): string {
  return join(homedir(), '.local', 'state', 'readback-gate');
}

export function defaultDualRunQueuePath(): string {
  return process.env.READBACK_GATE_DUALRUN_QUEUE ?? join(defaultStateRoot(), 'dualrun-queue.jsonl');
}

export function defaultDualRunCaptureRoot(): string {
  return process.env.READBACK_GATE_DUALRUN_CAPTURE_ROOT ?? join(defaultStateRoot(), 'dualrun-captures');
}

export function parseHookPayload(rawInput: string): JsonObject | undefined {
  try {
    const parsed: unknown = JSON.parse(rawInput);
    return isObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function extractPrompt(rawInput: string): string {
  const payload = parseHookPayload(rawInput);
  if (!payload) return rawInput;
  return String(
    payload.prompt ??
      payload.user_prompt ??
      payload.userPrompt ??
      payload.message ??
      payload.input ??
      payload.text ??
      ''
  );
}

function stringField(payload: JsonObject | undefined, names: string[]): string | undefined {
  if (!payload) return undefined;
  for (const name of names) {
    const value = payload[name];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function resolveMaybeRelative(path: string, cwd: string): string {
  return isAbsolute(path) ? path : resolve(cwd, path);
}

function findTranscriptPath(payload: JsonObject | undefined, cwd: string): string | undefined {
  const raw = stringField(payload, [
    'transcript_path',
    'transcriptPath',
    'conversation_transcript_path',
    'conversationTranscriptPath'
  ]);
  if (!raw) return undefined;
  const path = resolveMaybeRelative(raw, cwd);
  return existsSync(path) ? path : undefined;
}

export function recordDualRunCapture(
  rawInput: string,
  prompt: string,
  report: Report,
  fallbackAgent: AgentKind
): void {
  if (!truthyEnv(process.env.READBACK_GATE_DUALRUN_CAPTURE)) return;
  if (report.verdict === 'pass' && !truthyEnv(process.env.READBACK_GATE_DUALRUN_CAPTURE_PASS)) return;
  if (!prompt.trim()) return;

  try {
    const payload = parseHookPayload(rawInput);
    const agent = normalizeAgent(process.env.READBACK_GATE_DUALRUN_AGENT, fallbackAgent);
    const repoPath = resolve(
      process.env.READBACK_GATE_DUALRUN_REPO ??
        stringField(payload, ['cwd', 'workspace', 'workspace_path', 'workspacePath']) ??
        process.cwd()
    );
    const id = `${safeTs()}-${agent}-${sha256Short(`${repoPath}\n${prompt}`)}`;
    const captureDir = join(defaultDualRunCaptureRoot(), id);
    mkdirSync(captureDir, { recursive: true });

    const promptPath = join(captureDir, 'prompt.txt');
    const hookInputPath = join(captureDir, 'hook-input.json');
    writeFileSync(promptPath, prompt, 'utf8');
    writeFileSync(hookInputPath, rawInput.trim() ? rawInput : '{}\n', 'utf8');

    const transcriptPath = findTranscriptPath(payload, repoPath);
    const contextPath = transcriptPath ? join(captureDir, 'context-transcript.txt') : undefined;
    if (transcriptPath && contextPath) {
      copyFileSync(transcriptPath, contextPath);
    }

    const entry: DualRunQueueEntry = {
      version: 1,
      id,
      ts: new Date().toISOString(),
      agent,
      repoPath,
      promptHash: sha256Short(prompt),
      promptPath,
      hookInputPath,
      contextPath,
      contextFidelity: contextPath ? 'full_transcript' : 'none',
      score: {
        clarity_score: report.clarity_score,
        risk_level: report.risk_level,
        verdict: report.verdict,
        missing: report.missing
      }
    };

    const queuePath = defaultDualRunQueuePath();
    mkdirSync(dirname(queuePath), { recursive: true });
    appendFileSync(queuePath, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch {
    // Capture is experimental measurement plumbing; it must never block hooks.
  }
}
