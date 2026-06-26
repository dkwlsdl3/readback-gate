#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { AgentKind, AuthBridgeMode } from './dualrun.ts';
import type { DualRunQueueEntry } from './dualrun-capture.ts';
import { defaultDualRunQueuePath } from './dualrun-capture.ts';

interface WorkerOptions {
  queuePath: string;
  statePath: string;
  artifactsRoot: string;
  limit: number;
  watch: boolean;
  intervalMs: number;
  agent?: AgentKind;
  agentCommand?: string;
  claudeCommand?: string;
  codexCommand?: string;
  customCommand?: string;
  authBridge?: AuthBridgeMode;
  dualRunBin: string;
}

interface ProcessedRecord {
  id: string;
  ts: string;
  status: 'processed' | 'failed' | 'skipped';
  exitCode: number | null;
  artifactsRoot: string;
  error?: string;
}

function defaultStatePath(): string {
  return join(homedir(), '.local', 'state', 'readback-gate', 'dualrun-worker-processed.jsonl');
}

function defaultArtifactsRoot(): string {
  return process.env.READBACK_GATE_DUALRUN_ROOT ?? join('/tmp', 'readback-gate-dualrun');
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href ||
    fileURLToPath(import.meta.url) === resolve(entry);
}

function resolveDualRunBin(): string {
  if (process.env.READBACK_GATE_DUALRUN_BIN) return process.env.READBACK_GATE_DUALRUN_BIN;
  const current = fileURLToPath(import.meta.url);
  if (current.endsWith('/dist/dualrun-worker.js')) return current.replace(/dualrun-worker\.js$/, 'dualrun.js');
  if (current.endsWith('/src/dualrun-worker.ts')) return current.replace(/dualrun-worker\.ts$/, 'dualrun.ts');
  return join(dirname(current), 'dualrun.js');
}

function normalizeAgent(value?: string): AgentKind | undefined {
  if (value === undefined) return undefined;
  if (value === 'claude' || value === 'codex' || value === 'custom') return value;
  throw new Error('--agent must be claude|codex|custom');
}

function normalizeAuthBridge(value?: string): AuthBridgeMode {
  if (value === 'none' || value === 'codex_symlink') return value;
  throw new Error('--auth-bridge must be none|codex_symlink');
}

function parseArgs(argv: string[]): WorkerOptions {
  const options: WorkerOptions = {
    queuePath: defaultDualRunQueuePath(),
    statePath: defaultStatePath(),
    artifactsRoot: defaultArtifactsRoot(),
    limit: 10,
    watch: false,
    intervalMs: 60_000,
    dualRunBin: resolveDualRunBin()
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--queue') {
      options.queuePath = argv[++index];
    } else if (arg.startsWith('--queue=')) {
      options.queuePath = arg.slice('--queue='.length);
    } else if (arg === '--state') {
      options.statePath = argv[++index];
    } else if (arg.startsWith('--state=')) {
      options.statePath = arg.slice('--state='.length);
    } else if (arg === '--artifacts-root') {
      options.artifactsRoot = argv[++index];
    } else if (arg.startsWith('--artifacts-root=')) {
      options.artifactsRoot = arg.slice('--artifacts-root='.length);
    } else if (arg === '--limit') {
      options.limit = Number(argv[++index]);
    } else if (arg.startsWith('--limit=')) {
      options.limit = Number(arg.slice('--limit='.length));
    } else if (arg === '--watch') {
      options.watch = true;
    } else if (arg === '--interval-sec') {
      options.intervalMs = Number(argv[++index]) * 1000;
    } else if (arg.startsWith('--interval-sec=')) {
      options.intervalMs = Number(arg.slice('--interval-sec='.length)) * 1000;
    } else if (arg === '--agent') {
      options.agent = normalizeAgent(argv[++index]);
    } else if (arg.startsWith('--agent=')) {
      options.agent = normalizeAgent(arg.slice('--agent='.length));
    } else if (arg === '--agent-cmd') {
      options.agentCommand = argv[++index];
    } else if (arg.startsWith('--agent-cmd=')) {
      options.agentCommand = arg.slice('--agent-cmd='.length);
    } else if (arg === '--claude-cmd') {
      options.claudeCommand = argv[++index];
    } else if (arg.startsWith('--claude-cmd=')) {
      options.claudeCommand = arg.slice('--claude-cmd='.length);
    } else if (arg === '--codex-cmd') {
      options.codexCommand = argv[++index];
    } else if (arg.startsWith('--codex-cmd=')) {
      options.codexCommand = arg.slice('--codex-cmd='.length);
    } else if (arg === '--custom-cmd') {
      options.customCommand = argv[++index];
    } else if (arg.startsWith('--custom-cmd=')) {
      options.customCommand = arg.slice('--custom-cmd='.length);
    } else if (arg === '--auth-bridge') {
      options.authBridge = normalizeAuthBridge(argv[++index]);
    } else if (arg.startsWith('--auth-bridge=')) {
      options.authBridge = normalizeAuthBridge(arg.slice('--auth-bridge='.length));
    } else if (arg === '--dual-run-bin') {
      options.dualRunBin = argv[++index];
    } else if (arg.startsWith('--dual-run-bin=')) {
      options.dualRunBin = arg.slice('--dual-run-bin='.length);
    } else {
      throw new Error(`Unknown worker option: ${arg}`);
    }
  }

  if (!Number.isFinite(options.limit) || options.limit < 1) throw new Error('--limit must be a positive number');
  if (!Number.isFinite(options.intervalMs) || options.intervalMs < 1000) throw new Error('--interval-sec must be at least 1');
  return options;
}

function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

function processedIds(path: string): Set<string> {
  return new Set(readJsonl<ProcessedRecord>(path).map((record) => record.id));
}

function commandForAgent(entry: DualRunQueueEntry, options: WorkerOptions): string | undefined {
  if (entry.agent === 'claude') return options.claudeCommand ?? options.agentCommand;
  if (entry.agent === 'codex') return options.codexCommand ?? options.agentCommand;
  return options.customCommand ?? options.agentCommand;
}

function appendProcessed(options: WorkerOptions, record: ProcessedRecord): void {
  mkdirSync(dirname(options.statePath), { recursive: true });
  appendFileSync(options.statePath, `${JSON.stringify(record)}\n`, 'utf8');
}

function processOnce(options: WorkerOptions): number {
  const queue = readJsonl<DualRunQueueEntry>(options.queuePath);
  const done = processedIds(options.statePath);
  let processed = 0;

  for (const entry of queue) {
    if (processed >= options.limit) break;
    if (done.has(entry.id)) continue;
    if (options.agent && entry.agent !== options.agent) continue;
    const command = commandForAgent(entry, options);
    if (!command) {
      appendProcessed(options, {
        id: entry.id,
        ts: new Date().toISOString(),
        status: 'skipped',
        exitCode: null,
        artifactsRoot: options.artifactsRoot,
        error: `no command configured for agent=${entry.agent}`
      });
      processed += 1;
      continue;
    }

    const prompt = readFileSync(entry.promptPath, 'utf8');
    const args = [
      options.dualRunBin,
      '--prompt',
      prompt,
      '--repo',
      entry.repoPath,
      '--artifacts-root',
      options.artifactsRoot,
      '--pair-id',
      entry.id,
      '--agent',
      entry.agent,
      '--baseline-cmd',
      command,
      '--gated-cmd',
      command
    ];
    if (entry.contextPath) {
      args.push('--context-file', entry.contextPath, '--context-fidelity', entry.contextFidelity);
    }
    if (entry.agent === 'codex' && options.authBridge) {
      args.push('--auth-bridge', options.authBridge);
    }

    const result = spawnSync(process.execPath, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'inherit', 'inherit']
    });
    appendProcessed(options, {
      id: entry.id,
      ts: new Date().toISOString(),
      status: result.status === 0 ? 'processed' : 'failed',
      exitCode: result.status,
      artifactsRoot: options.artifactsRoot,
      error: result.error?.message
    });
    processed += 1;
  }

  return processed;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.watch) {
    for (;;) {
      const count = processOnce(options);
      if (count > 0) {
        console.error(`readback-gate dual-run worker processed ${count} queue entr${count === 1 ? 'y' : 'ies'}`);
      }
      await sleep(options.intervalMs);
    }
  }
  const count = processOnce(options);
  console.log(`processed=${count}`);
}

if (isMainModule()) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
