#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { scorePrompt } from './core/scorer.ts';
import { renderAdditionalContext } from './core/modes.ts';
import type { Report } from './core/types.ts';

export type DualRunBranchName = 'gated_visible' | 'baseline_replica';
export type ContextFidelity = 'none' | 'full_transcript' | 'truncated_transcript' | 'summary_pack';
export type ContextSource = 'none' | 'inline' | 'context_file';
export type AgentKind = 'claude' | 'codex' | 'custom';
export type BranchTreatment = 'gated' | 'baseline';
export type BaselineEnvMode = 'minimal' | 'inherit';
export type CommandGuardMode = 'remote_write' | 'off';
export type RedactionMode = 'basic' | 'off';
export type AuthBridgeMode = 'none' | 'codex_symlink';
export type SideEffectIsolation =
  | 'workspace_snapshot_minimal_env_command_guard'
  | 'workspace_snapshot_minimal_env'
  | 'workspace_snapshot_inherited_env_command_guard'
  | 'workspace_snapshot_inherited_env';
export type PairVerdict =
  | 'gated_better'
  | 'baseline_better'
  | 'same'
  | 'both_bad'
  | 'inconclusive'
  | 'not_eligible'
  | 'unreviewed';

export interface DualRunOptions {
  prompt: string;
  repoPath?: string;
  artifactsRoot?: string;
  pairId?: string;
  agent?: AgentKind;
  baselineCommand?: string;
  gatedCommand?: string;
  context?: string;
  contextFile?: string;
  contextFidelity?: ContextFidelity;
  baselineEnvMode?: BaselineEnvMode;
  commandGuard?: CommandGuardMode;
  redaction?: RedactionMode;
  authBridge?: AuthBridgeMode;
  storePrompt?: boolean;
}

export interface CommandArtifact {
  branch: DualRunBranchName;
  cwd: string;
  command?: string;
  treatment: BranchTreatment;
  treatmentApplied: boolean;
  inputPath?: string;
  inputHash?: string;
  promptHash: string;
  contextFidelity: ContextFidelity;
  commandGuard: CommandGuardMode;
  redaction: RedactionMode;
  authBridge: AuthBridgeMode;
  redactedPaths: string[];
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
  spawnError?: string;
  durationMs?: number;
  stdoutPath?: string;
  stderrPath?: string;
  diffPath?: string;
  statusPath?: string;
  skipped: boolean;
  skipReason?: string;
}

export interface DualRunAcceptance {
  checkedAt: string;
  primaryEligible: boolean;
  failures: string[];
  warnings: string[];
}

export interface DualRunSummary {
  version: 1;
  pairId: string;
  createdAt: string;
  agent: AgentKind;
  repoPath: string;
  replicaPath: string;
  gatedReplicaPath: string;
  replicaSnapshotCommit: string;
  gatedSnapshotCommit: string;
  sourceSnapshotPath: string;
  sourceSnapshotCommit: string;
  promptHash: string;
  promptLength: number;
  promptStored: boolean;
  contextFidelity: ContextFidelity;
  contextSource: ContextSource;
  contextPath?: string;
  contextHash?: string;
  contextStored: boolean;
  baselineEnvMode: BaselineEnvMode;
  commandGuard: CommandGuardMode;
  redaction: RedactionMode;
  authBridge: AuthBridgeMode;
  redactedPaths: string[];
  sideEffectIsolation: SideEffectIsolation;
  excludedFromPrimary: boolean;
  exclusionReason?: string;
  treatmentApplied: boolean;
  score: Report;
  injectedContext?: string;
  branches: {
    gated_visible: CommandArtifact;
    baseline_replica: CommandArtifact;
  };
  verdict: PairVerdict;
  acceptance: DualRunAcceptance;
  notes: string[];
}

interface CliArgs extends DualRunOptions {
  jsonOnly: boolean;
  requirePrimary: boolean;
}

const DEFAULT_ARTIFACTS_ROOT = join(tmpdir(), 'readback-gate-dualrun');
const INLINE_CONTEXT_LIMIT_BYTES = 512 * 1024;

function nowSafe(): string {
  return new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
}

function sha256Short(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function runGit(args: string[], cwd: string, input?: string): string {
  const result = spawnSync('git', args, {
    cwd,
    input,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  });
  if (result.status !== 0) {
    const message = result.stderr?.trim() || result.stdout?.trim() || `git ${args.join(' ')} failed`;
    throw new Error(message);
  }
  return result.stdout;
}

function tryGit(args: string[], cwd: string): string {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  });
  return result.status === 0 ? result.stdout : '';
}

function gitDiffNoIndex(cwd: string, relativePath: string): string {
  const result = spawnSync('git', ['diff', '--no-index', '--binary', '--', '/dev/null', relativePath], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  });
  if (result.status === 0 || result.status === 1) {
    return result.stdout ?? '';
  }
  return '';
}

function shellCommand(command: string, cwd: string, env: NodeJS.ProcessEnv, stdoutPath: string, stderrPath: string, input?: string): {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  spawnError?: string;
  durationMs: number;
} {
  const startedAt = Date.now();
  const stdoutFd = openSync(stdoutPath, 'w');
  const stderrFd = openSync(stderrPath, 'w');
  let result: ReturnType<typeof spawnSync>;
  try {
    result = spawnSync(process.env.SHELL ?? '/bin/sh', ['-lc', command], {
      cwd,
      input,
      encoding: 'utf8',
      env,
      stdio: ['pipe', stdoutFd, stderrFd]
    });
  } finally {
    closeSync(stdoutFd);
    closeSync(stderrFd);
  }
  if (result.error) {
    appendFileSync(stderrPath, `\n[readback-gate-dual-run spawn error: ${result.error.message}]\n`, 'utf8');
  }
  return {
    exitCode: result.status,
    signal: result.signal,
    spawnError: result.error?.message,
    durationMs: Date.now() - startedAt
  };
}

function findExecutable(name: string): string | undefined {
  for (const dir of (process.env.PATH ?? '').split(':').filter(Boolean)) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function createCommandGuardBin(pairDir: string, mode: CommandGuardMode): string | undefined {
  if (mode === 'off') return undefined;
  const binDir = join(pairDir, 'command_guard_bin');
  mkdirSync(binDir, { recursive: true });

  const writeExecutable = (name: string, body: string): void => {
    const path = join(binDir, name);
    writeFileSync(path, body, { encoding: 'utf8', mode: 0o755 });
  };

  const gitPath = findExecutable('git');
  writeExecutable('git', `#!/bin/sh
set -eu
subcommand="\${1:-}"
case "$subcommand" in
  push|fetch|pull|clone|remote)
    echo "readback-gate dual-run blocked remote git subcommand: $subcommand" >&2
    exit 126
    ;;
esac
if [ -z ${shellQuote(gitPath ?? '')} ]; then
  echo "readback-gate dual-run could not find original git binary" >&2
  exit 127
fi
exec ${shellQuote(gitPath ?? '')} "$@"
`);

  for (const name of ['curl', 'wget', 'ssh', 'scp', 'rsync', 'gh']) {
    writeExecutable(name, `#!/bin/sh
echo "readback-gate dual-run blocked remote/network command: ${name}" >&2
exit 126
`);
  }

  return binDir;
}

function minimalBranchEnv(pairDir: string, pairId: string, branch: DualRunBranchName): NodeJS.ProcessEnv {
  const home = join(pairDir, `${branch}_home`);
  mkdirSync(home, { recursive: true });
  return {
    PATH: process.env.PATH ?? '',
    SHELL: process.env.SHELL ?? '/bin/sh',
    LANG: process.env.LANG ?? 'C.UTF-8',
    LC_ALL: process.env.LC_ALL ?? 'C.UTF-8',
    TERM: process.env.TERM ?? 'xterm-256color',
    HOME: home,
    GIT_CONFIG_NOSYSTEM: '1',
    READBACK_GATE_DUALRUN_PAIR_DIR: pairDir,
    READBACK_GATE_DUALRUN_PAIR_ID: pairId,
    READBACK_GATE_DUALRUN_BRANCH: branch
  };
}

function codexAuthPath(): string {
  return process.env.READBACK_GATE_CODEX_AUTH_PATH ?? join(homedir(), '.codex', 'auth.json');
}

function prepareAuthBridge(pairDir: string, branch: DualRunBranchName, authBridge: AuthBridgeMode): void {
  if (authBridge !== 'codex_symlink') return;
  const source = codexAuthPath();
  if (!existsSync(source)) {
    throw new Error(`--auth-bridge codex_symlink requires Codex auth at ${source}`);
  }
  const codexDir = join(pairDir, `${branch}_home`, '.codex');
  mkdirSync(codexDir, { recursive: true });
  const target = join(codexDir, 'auth.json');
  if (!existsSync(target)) {
    symlinkSync(source, target);
  }
}

function branchEnv(
  pairDir: string,
  pairId: string,
  branch: DualRunBranchName,
  mode: BaselineEnvMode,
  authBridge: AuthBridgeMode,
  extra: NodeJS.ProcessEnv,
  commandGuardBin?: string
): NodeJS.ProcessEnv {
  const base = mode === 'minimal'
    ? minimalBranchEnv(pairDir, pairId, branch)
    : { ...process.env };
  if (mode === 'minimal') {
    prepareAuthBridge(pairDir, branch, authBridge);
  }
  const path = commandGuardBin
    ? `${commandGuardBin}:${base.PATH ?? ''}`
    : base.PATH;
  return {
    ...base,
    ...extra,
    PATH: path,
    READBACK_GATE_DUALRUN_PAIR_ID: pairId,
    READBACK_GATE_DUALRUN_BRANCH: branch
  };
}

function ensureGitRepo(repoPath: string): string {
  const root = runGit(['rev-parse', '--show-toplevel'], repoPath).trim();
  if (!root) throw new Error(`${repoPath} is not inside a git repository`);
  return root;
}

function copyUntrackedFiles(sourceRoot: string, replicaPath: string): void {
  const raw = tryGit(['ls-files', '--others', '--exclude-standard', '-z'], sourceRoot);
  for (const relativePath of raw.split('\0').filter(Boolean)) {
    const sourcePath = join(sourceRoot, relativePath);
    const targetPath = join(replicaPath, relativePath);
    mkdirSync(dirname(targetPath), { recursive: true });
    cpSync(sourcePath, targetPath, { recursive: true });
  }
}

function createReplica(sourceRoot: string, replicaPath: string): string {
  rmSync(replicaPath, { recursive: true, force: true });
  mkdirSync(dirname(replicaPath), { recursive: true });
  runGit(['clone', '--no-hardlinks', sourceRoot, replicaPath], sourceRoot);
  const head = runGit(['rev-parse', 'HEAD'], sourceRoot).trim();
  runGit(['checkout', '--detach', head], replicaPath);

  const dirtyPatch = tryGit(['diff', '--binary', 'HEAD'], sourceRoot);
  if (dirtyPatch.trim()) {
    runGit(['apply', '--whitespace=nowarn'], replicaPath, dirtyPatch);
  }
  copyUntrackedFiles(sourceRoot, replicaPath);
  runGit(['add', '-A'], replicaPath);
  runGit([
    '-c',
    'user.name=readback-gate-dual-run',
    '-c',
    'user.email=readback-gate-dual-run@example.invalid',
    'commit',
    '--allow-empty',
    '--no-gpg-sign',
    '-q',
    '-m',
    'readback-gate dual-run source snapshot'
  ], replicaPath);
  return runGit(['rev-parse', 'HEAD'], replicaPath).trim();
}

function createReplicaFromSnapshot(snapshotPath: string, replicaPath: string): string {
  rmSync(replicaPath, { recursive: true, force: true });
  mkdirSync(dirname(replicaPath), { recursive: true });
  runGit(['clone', '--no-hardlinks', snapshotPath, replicaPath], snapshotPath);
  const head = runGit(['rev-parse', 'HEAD'], snapshotPath).trim();
  runGit(['checkout', '--detach', head], replicaPath);
  return runGit(['rev-parse', 'HEAD'], replicaPath).trim();
}

function writeText(path: string, value: string): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value, 'utf8');
  return path;
}

function redactText(value: string): string {
  return value
    .replaceAll(/(Authorization:\s*Bearer\s+)[^\s]+/gi, '$1[REDACTED]')
    .replaceAll(/((?:api[_-]?key|token|secret|password)\s*[:=]\s*)(["']?)[^\s"']{8,}\2/gi, '$1$2[REDACTED]$2')
    .replaceAll(/\bsk-[A-Za-z0-9_-]{20,}\b/g, 'sk-[REDACTED]')
    .replaceAll(/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, 'gh_[REDACTED]')
    .replaceAll(/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, 'xox-[REDACTED]');
}

function redactFile(path: string | undefined, mode: RedactionMode): boolean {
  if (!path || mode === 'off' || !existsSync(path)) return false;
  const original = readFileSync(path, 'utf8');
  const redacted = redactText(original);
  if (redacted === original) return false;
  writeFileSync(path, redacted, 'utf8');
  return true;
}

function redactFiles(paths: Array<string | undefined>, mode: RedactionMode): string[] {
  return paths.filter((path): path is string => redactFile(path, mode));
}

function collectGitArtifacts(
  branchDir: string,
  artifactDir: string,
  baseRef = 'HEAD'
): Pick<CommandArtifact, 'diffPath' | 'statusPath'> {
  const diffParts = [tryGit(['diff', '--binary', baseRef], branchDir)];
  const untracked = tryGit(['ls-files', '--others', '--exclude-standard', '-z'], branchDir)
    .split('\0')
    .filter(Boolean);
  for (const relativePath of untracked) {
    diffParts.push(gitDiffNoIndex(branchDir, relativePath));
  }
  const diff = diffParts.filter(Boolean).join('\n');
  const status = tryGit(['status', '--short'], branchDir);
  return {
    diffPath: writeText(join(artifactDir, 'diff.patch'), diff),
    statusPath: writeText(join(artifactDir, 'status.txt'), status)
  };
}

function artifactExists(path: string | undefined): boolean {
  return Boolean(path && existsSync(path));
}

export function assessDualRunAcceptance(summary: Omit<DualRunSummary, 'acceptance'>): DualRunAcceptance {
  const failures: string[] = [];
  const warnings: string[] = [];
  const baseline = summary.branches.baseline_replica;
  const gated = summary.branches.gated_visible;

  if (summary.contextFidelity !== 'full_transcript') {
    failures.push(`context_fidelity=${summary.contextFidelity}; primary evidence requires full_transcript`);
  } else if (summary.excludedFromPrimary) {
    failures.push(summary.exclusionReason ?? 'pair is excluded from primary analysis');
  }
  if (summary.contextFidelity === 'full_transcript' && summary.contextSource !== 'context_file') {
    failures.push('full_transcript context must come from --context-file so the transcript artifact path and hash are auditable');
  }
  if (summary.commandGuard !== 'remote_write') {
    failures.push('command_guard=off; primary evidence requires remote_write command guard');
  }
  if (!summary.treatmentApplied) {
    failures.push('readback-gate did not inject/gate for this prompt; no treatment was applied');
  }
  if (summary.verdict === 'inconclusive' || summary.verdict === 'not_eligible') {
    failures.push(`verdict=${summary.verdict}; both branches must produce comparable artifacts`);
  }

  for (const branch of [baseline, gated]) {
    if (branch.skipped) {
      failures.push(`${branch.branch} skipped: ${branch.skipReason ?? 'unknown reason'}`);
      continue;
    }
    if (branch.exitCode !== undefined && branch.exitCode !== 0) {
      failures.push(`${branch.branch} exited with code ${branch.exitCode}`);
    }
    if (branch.signal) {
      failures.push(`${branch.branch} terminated by signal ${branch.signal}`);
    }
    if (branch.spawnError) {
      failures.push(`${branch.branch} spawn failed: ${branch.spawnError}`);
    }
    if (branch.promptHash !== summary.promptHash) {
      failures.push(`${branch.branch} prompt hash does not match summary prompt hash`);
    }
    if (branch.contextFidelity !== summary.contextFidelity) {
      failures.push(`${branch.branch} context fidelity does not match summary context fidelity`);
    }
    if (branch.commandGuard !== summary.commandGuard) {
      failures.push(`${branch.branch} command guard does not match summary command guard`);
    }
    if (!artifactExists(branch.inputPath)) {
      failures.push(`${branch.branch} input artifact is missing`);
    }
    if (!artifactExists(branch.diffPath)) {
      failures.push(`${branch.branch} diff artifact is missing`);
    }
    if (!artifactExists(branch.statusPath)) {
      failures.push(`${branch.branch} status artifact is missing`);
    }
  }

  if (baseline.treatment !== 'baseline') {
    failures.push('baseline branch treatment label is not baseline');
  }
  if (baseline.treatmentApplied) {
    failures.push('baseline branch reports treatmentApplied=true');
  }
  if (gated.treatment !== 'gated') {
    failures.push('gated branch treatment label is not gated');
  }
  if (!gated.treatmentApplied) {
    failures.push('gated branch reports treatmentApplied=false');
  }
  if (summary.baselineEnvMode !== 'minimal') {
    warnings.push('baseline-env=inherit can leak local credentials into the replica branch');
  }
  if (summary.authBridge === 'codex_symlink') {
    warnings.push('auth-bridge=codex_symlink grants branch agents access to the local Codex auth token via symlink; keep artifacts local and delete pair directories after review');
  }
  if (summary.redaction === 'off') {
    warnings.push('redaction=off can leave prompts, context, diffs, stdout, stderr, or secrets in artifacts');
  }
  warnings.push('dual-run uses command shims for common remote commands, not an OS-level network sandbox; use only local, low-risk prompts unless wrapped by an external sandbox');
  if (summary.promptStored || summary.contextStored) {
    warnings.push('prompt/context artifacts may contain private data; keep artifact roots local and delete them after review');
  }

  return {
    checkedAt: new Date().toISOString(),
    primaryEligible: failures.length === 0,
    failures,
    warnings
  };
}

function runBranch(
  branch: DualRunBranchName,
  cwd: string,
  artifactDir: string,
  command: string | undefined,
  pairDir: string,
  pairId: string,
  input: string,
  promptHash: string,
  contextFidelity: ContextFidelity,
  treatment: BranchTreatment,
  treatmentApplied: boolean,
  baselineEnvMode: BaselineEnvMode,
  authBridge: AuthBridgeMode,
  commandGuard: CommandGuardMode,
  commandGuardBin: string | undefined,
  redaction: RedactionMode,
  baseRef = 'HEAD'
): CommandArtifact {
  mkdirSync(artifactDir, { recursive: true });
  const inputPath = writeText(join(artifactDir, 'input.txt'), input);
  const inputHash = sha256Short(input);
  if (!command) {
    return {
      branch,
      cwd,
      treatment,
      treatmentApplied,
      inputPath,
      inputHash,
      promptHash,
      contextFidelity,
      commandGuard,
      authBridge,
      redaction,
      redactedPaths: redactFiles([inputPath], redaction),
      skipped: true,
      skipReason: branch === 'gated_visible'
        ? 'No gated command was provided; run with --gated-cmd or attach equivalent gated agent artifacts for full pair comparison.'
        : 'No baseline command was provided.'
    };
  }

  const stdoutPath = join(artifactDir, 'stdout.txt');
  const stderrPath = join(artifactDir, 'stderr.txt');
  const resolvedCommand = command.replaceAll('{PAIR_DIR}', pairDir);
  const result = shellCommand(resolvedCommand, cwd, branchEnv(pairDir, pairId, branch, baselineEnvMode, authBridge, {
    READBACK_GATE_DUALRUN_TREATMENT: treatment,
    READBACK_GATE_DUALRUN_TREATMENT_APPLIED: treatmentApplied ? '1' : '0',
    READBACK_GATE_DUALRUN_INPUT_FILE: inputPath,
    READBACK_GATE_DUALRUN_INPUT_HASH: inputHash,
    READBACK_GATE_DUALRUN_PROMPT_HASH: promptHash,
    READBACK_GATE_DUALRUN_CONTEXT_FIDELITY: contextFidelity,
    READBACK_GATE_DUALRUN_COMMAND_GUARD: commandGuard,
    READBACK_GATE_DUALRUN_PAIR_DIR: pairDir,
    READBACK_GATE_DISABLE: '1'
  }, commandGuardBin), stdoutPath, stderrPath, input);
  const gitArtifacts = collectGitArtifacts(cwd, artifactDir, baseRef);
  const redactedPaths = redactFiles([
    inputPath,
    stdoutPath,
    stderrPath,
    gitArtifacts.diffPath,
    gitArtifacts.statusPath
  ], redaction);

  return {
    branch,
    cwd,
    command: resolvedCommand,
    treatment,
    treatmentApplied,
    inputPath,
    inputHash,
    promptHash,
    contextFidelity,
    commandGuard,
    authBridge,
    redaction,
    redactedPaths,
    exitCode: result.exitCode,
    signal: result.signal,
    spawnError: result.spawnError,
    durationMs: result.durationMs,
    stdoutPath,
    stderrPath,
    ...gitArtifacts,
    skipped: false
  };
}

export function defaultArtifactsRoot(): string {
  return process.env.READBACK_GATE_DUALRUN_ROOT ?? DEFAULT_ARTIFACTS_ROOT;
}

export function makePairId(prompt: string, repoPath: string): string {
  return `${nowSafe()}-${sha256Short(`${repoPath}\n${prompt}`)}`;
}

function readContext(options: DualRunOptions): string {
  if (options.contextFile) {
    return readFileSync(options.contextFile, 'utf8');
  }
  return options.context ?? '';
}

function contextSource(options: DualRunOptions, context: string): ContextSource {
  if (options.contextFile) return 'context_file';
  if (context.trim()) return 'inline';
  return 'none';
}

function normalizeContextFidelity(options: DualRunOptions, context: string): ContextFidelity {
  if (options.contextFidelity) return options.contextFidelity;
  return context.trim() ? 'summary_pack' : 'none';
}

function buildBranchInput(args: {
  agent: AgentKind;
  treatment: BranchTreatment;
  prompt: string;
  context: string;
  contextArtifactPath?: string;
  contextFidelity: ContextFidelity;
  injectedContext?: string;
}): string {
  const parts = [
    '# readback-gate dual-run branch input',
    '',
    `agent: ${args.agent}`,
    `context_fidelity: ${args.contextFidelity}`,
    ''
  ];

  if (args.contextArtifactPath && Buffer.byteLength(args.context, 'utf8') > INLINE_CONTEXT_LIMIT_BYTES) {
    parts.push(
      '## Conversation Context File',
      `Full transcript context is stored at: ${args.contextArtifactPath}`,
      'Read that file before acting; both branches receive the same context file.',
      ''
    );
  } else if (args.context.trim()) {
    parts.push('## Conversation Context', args.context.trim(), '');
  }

  if (args.treatment === 'gated' && args.injectedContext) {
    parts.push('## Readback-gate Injected Context', args.injectedContext, '');
  }

  parts.push('## User Prompt', args.prompt.trim(), '');
  return parts.join('\n');
}

export function runDualRun(options: DualRunOptions): DualRunSummary {
  if (!options.prompt.trim()) {
    throw new Error('dual-run requires a non-empty prompt');
  }
  const sourceRoot = ensureGitRepo(resolve(options.repoPath ?? process.cwd()));
  const pairId = options.pairId ?? makePairId(options.prompt, sourceRoot);
  const agent = options.agent ?? 'custom';
  const pairDir = join(resolve(options.artifactsRoot ?? defaultArtifactsRoot()), pairId);
  const replicaPath = join(pairDir, `${basename(sourceRoot)}_replica`);
  const gatedReplicaPath = join(pairDir, `${basename(sourceRoot)}_gated_replica`);
  const sourceSnapshotPath = join(pairDir, `${basename(sourceRoot)}_source_snapshot`);
  const gatedDir = join(pairDir, 'gated_visible');
  const baselineDir = join(pairDir, 'baseline_replica');
  const score = scorePrompt(options.prompt, { mode: 'inject' });
  const promptHash = sha256Short(options.prompt);
  const context = readContext(options);
  const contextFidelity = normalizeContextFidelity(options, context);
  const source = contextSource(options, context);
  const contextPath = options.contextFile ? resolve(options.contextFile) : undefined;
  const contextHash = context.trim() ? sha256Short(context) : undefined;
  const treatmentApplied = score.verdict === 'inject' || score.verdict === 'gate';
  const excludedFromPrimary = contextFidelity !== 'full_transcript' || source !== 'context_file';
  const exclusionReason = excludedFromPrimary
    ? source === 'context_file'
      ? `context_fidelity=${contextFidelity}; primary evidence requires full_transcript`
      : `context_source=${source}; primary evidence requires --context-file with context_fidelity=full_transcript`
    : undefined;
  const baselineEnvMode = options.baselineEnvMode ?? 'minimal';
  const commandGuard = options.commandGuard ?? 'remote_write';
  const redaction = options.redaction ?? 'basic';
  const authBridge = options.authBridge ?? 'none';

  mkdirSync(pairDir, { recursive: true });
  const commandGuardBin = createCommandGuardBin(pairDir, commandGuard);
  const sourceSnapshotCommit = createReplica(sourceRoot, sourceSnapshotPath);
  const replicaSnapshotCommit = createReplicaFromSnapshot(sourceSnapshotPath, replicaPath);
  const gatedSnapshotCommit = createReplicaFromSnapshot(sourceSnapshotPath, gatedReplicaPath);

  const injectedContext = treatmentApplied
    ? renderAdditionalContext(score, 'inject')
    : undefined;
  const metadataPath = writeText(join(pairDir, 'prompt.meta.json'), `${JSON.stringify({
    prompt_hash: promptHash,
    agent,
    prompt_length: options.prompt.length,
    prompt_stored: Boolean(options.storePrompt),
    context_hash: contextHash,
    context_fidelity: contextFidelity,
    context_source: source,
    context_path: contextPath,
    context_stored: Boolean(context.trim())
  }, null, 2)}\n`);
  const rootRedactedPaths: string[] = [];
  if (options.storePrompt) {
    rootRedactedPaths.push(...redactFiles([writeText(join(pairDir, 'prompt.txt'), options.prompt)], redaction));
  }
  if (context.trim()) {
    rootRedactedPaths.push(...redactFiles([writeText(join(pairDir, 'context.txt'), context)], redaction));
  }
  if (injectedContext) {
    rootRedactedPaths.push(...redactFiles([writeText(join(pairDir, 'injected-context.txt'), injectedContext)], redaction));
  }
  rootRedactedPaths.push(...redactFiles([metadataPath], redaction));
  const contextArtifactPath = context.trim() ? join(pairDir, 'context.txt') : undefined;

  const baselineInput = buildBranchInput({
    agent,
    treatment: 'baseline',
    prompt: options.prompt,
    context,
    contextArtifactPath,
    contextFidelity
  });
  const gatedInput = buildBranchInput({
    agent,
    treatment: 'gated',
    prompt: options.prompt,
    context,
    contextArtifactPath,
    contextFidelity,
    injectedContext
  });

  const baseline = runBranch(
    'baseline_replica',
    replicaPath,
    baselineDir,
    options.baselineCommand,
    pairDir,
    pairId,
    baselineInput,
    promptHash,
    contextFidelity,
    'baseline',
    false,
    baselineEnvMode,
    authBridge,
    commandGuard,
    commandGuardBin,
    redaction,
    replicaSnapshotCommit
  );
  const gated = runBranch(
    'gated_visible',
    gatedReplicaPath,
    gatedDir,
    options.gatedCommand,
    pairDir,
    pairId,
    gatedInput,
    promptHash,
    contextFidelity,
    'gated',
    treatmentApplied,
    baselineEnvMode,
    authBridge,
    commandGuard,
    commandGuardBin,
    redaction,
    gatedSnapshotCommit
  );

  const notes: string[] = [];
  if (!options.gatedCommand) {
    notes.push('gated_visible was not executed by this runner; run with --gated-cmd or attach equivalent gated agent artifacts for full pair comparison.');
  }
  if (!options.baselineCommand) {
    notes.push('baseline_replica was not executed because --baseline-cmd was omitted.');
  }
  notes.push('replica retained with artifacts; remove the pair directory manually when no longer needed.');

  const summary: DualRunSummary = {
    version: 1,
    pairId,
    createdAt: new Date().toISOString(),
    agent,
    repoPath: sourceRoot,
    replicaPath,
    gatedReplicaPath,
    replicaSnapshotCommit,
    gatedSnapshotCommit,
    sourceSnapshotPath,
    sourceSnapshotCommit,
    promptHash,
    promptLength: options.prompt.length,
    promptStored: Boolean(options.storePrompt),
    contextFidelity,
    contextSource: source,
    contextPath,
    contextHash,
    contextStored: Boolean(context.trim()),
    baselineEnvMode,
    commandGuard,
    redaction,
    authBridge,
    redactedPaths: [],
    sideEffectIsolation: baselineEnvMode === 'minimal'
      ? commandGuard === 'remote_write'
        ? 'workspace_snapshot_minimal_env_command_guard'
        : 'workspace_snapshot_minimal_env'
      : commandGuard === 'remote_write'
        ? 'workspace_snapshot_inherited_env_command_guard'
        : 'workspace_snapshot_inherited_env',
    excludedFromPrimary,
    exclusionReason,
    treatmentApplied,
    score,
    injectedContext,
    branches: {
      gated_visible: gated,
      baseline_replica: baseline
    },
    verdict: gated.skipped || baseline.skipped ? 'inconclusive' : 'unreviewed',
    acceptance: {
      checkedAt: '',
      primaryEligible: false,
      failures: [],
      warnings: []
    },
    notes
  };
  summary.redactedPaths = [
    ...rootRedactedPaths,
    ...baseline.redactedPaths,
    ...gated.redactedPaths
  ];
  summary.acceptance = assessDualRunAcceptance(summary);

  writeText(join(pairDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    prompt: '',
    jsonOnly: false,
    requirePrimary: false
  };
  const promptParts: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--prompt') {
      args.prompt = argv[++index] ?? '';
    } else if (arg.startsWith('--prompt=')) {
      args.prompt = arg.slice('--prompt='.length);
    } else if (arg === '--repo') {
      args.repoPath = argv[++index];
    } else if (arg.startsWith('--repo=')) {
      args.repoPath = arg.slice('--repo='.length);
    } else if (arg === '--artifacts-root') {
      args.artifactsRoot = argv[++index];
    } else if (arg.startsWith('--artifacts-root=')) {
      args.artifactsRoot = arg.slice('--artifacts-root='.length);
    } else if (arg === '--pair-id') {
      args.pairId = argv[++index];
    } else if (arg.startsWith('--pair-id=')) {
      args.pairId = arg.slice('--pair-id='.length);
    } else if (arg === '--agent') {
      args.agent = normalizeAgentKind(argv[++index]);
    } else if (arg.startsWith('--agent=')) {
      args.agent = normalizeAgentKind(arg.slice('--agent='.length));
    } else if (arg === '--baseline-cmd') {
      args.baselineCommand = argv[++index];
    } else if (arg.startsWith('--baseline-cmd=')) {
      args.baselineCommand = arg.slice('--baseline-cmd='.length);
    } else if (arg === '--gated-cmd') {
      args.gatedCommand = argv[++index];
    } else if (arg.startsWith('--gated-cmd=')) {
      args.gatedCommand = arg.slice('--gated-cmd='.length);
    } else if (arg === '--context-file') {
      args.contextFile = argv[++index];
    } else if (arg.startsWith('--context-file=')) {
      args.contextFile = arg.slice('--context-file='.length);
    } else if (arg === '--context-fidelity') {
      args.contextFidelity = normalizeContextFidelityValue(argv[++index]);
    } else if (arg.startsWith('--context-fidelity=')) {
      args.contextFidelity = normalizeContextFidelityValue(arg.slice('--context-fidelity='.length));
    } else if (arg === '--baseline-env') {
      args.baselineEnvMode = normalizeBaselineEnvMode(argv[++index]);
    } else if (arg.startsWith('--baseline-env=')) {
      args.baselineEnvMode = normalizeBaselineEnvMode(arg.slice('--baseline-env='.length));
    } else if (arg === '--command-guard') {
      args.commandGuard = normalizeCommandGuardMode(argv[++index]);
    } else if (arg.startsWith('--command-guard=')) {
      args.commandGuard = normalizeCommandGuardMode(arg.slice('--command-guard='.length));
    } else if (arg === '--redaction') {
      args.redaction = normalizeRedactionMode(argv[++index]);
    } else if (arg.startsWith('--redaction=')) {
      args.redaction = normalizeRedactionMode(arg.slice('--redaction='.length));
    } else if (arg === '--auth-bridge') {
      args.authBridge = normalizeAuthBridgeMode(argv[++index]);
    } else if (arg.startsWith('--auth-bridge=')) {
      args.authBridge = normalizeAuthBridgeMode(arg.slice('--auth-bridge='.length));
    } else if (arg === '--store-prompt') {
      args.storePrompt = true;
    } else if (arg === '--json') {
      args.jsonOnly = true;
    } else if (arg === '--require-primary') {
      args.requirePrimary = true;
    } else {
      promptParts.push(arg);
    }
  }

  if (!args.prompt && promptParts.length > 0) {
    args.prompt = promptParts.join(' ').trim();
  }
  if (!args.prompt && !process.stdin.isTTY) {
    args.prompt = readFileSync(0, 'utf8').trim();
  }
  if (!args.prompt) {
    throw new Error('Usage: readback-gate-dual-run --prompt "<prompt>" --baseline-cmd "<cmd>" [--gated-cmd "<cmd>"] [--agent claude|codex|custom] [--context-file <path>] [--command-guard remote_write|off] [--redaction basic|off] [--auth-bridge none|codex_symlink] [--require-primary]');
  }
  return args;
}

function normalizeAgentKind(value?: string): AgentKind {
  if (value === 'claude' || value === 'codex' || value === 'custom') return value;
  throw new Error('--agent must be claude|codex|custom');
}

function normalizeContextFidelityValue(value?: string): ContextFidelity {
  if (
    value === 'none' ||
    value === 'full_transcript' ||
    value === 'truncated_transcript' ||
    value === 'summary_pack'
  ) {
    return value;
  }
  throw new Error('--context-fidelity must be none|full_transcript|truncated_transcript|summary_pack');
}

function normalizeBaselineEnvMode(value?: string): BaselineEnvMode {
  if (value === 'minimal' || value === 'inherit') return value;
  throw new Error('--baseline-env must be minimal|inherit');
}

function normalizeCommandGuardMode(value?: string): CommandGuardMode {
  if (value === 'remote_write' || value === 'off') return value;
  throw new Error('--command-guard must be remote_write|off');
}

function normalizeRedactionMode(value?: string): RedactionMode {
  if (value === 'basic' || value === 'off') return value;
  throw new Error('--redaction must be basic|off');
}

function normalizeAuthBridgeMode(value?: string): AuthBridgeMode {
  if (value === 'none' || value === 'codex_symlink') return value;
  throw new Error('--auth-bridge must be none|codex_symlink');
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href ||
    fileURLToPath(import.meta.url) === resolve(entry);
}

if (isMainModule()) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const summary = runDualRun(args);
    if (args.jsonOnly) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      console.log(`readback-gate dual-run pair: ${summary.pairId}`);
      console.log(`artifacts: ${join(resolve(args.artifactsRoot ?? defaultArtifactsRoot()), summary.pairId)}`);
      console.log(`verdict: ${summary.verdict}`);
      console.log(`primary eligible: ${summary.acceptance.primaryEligible ? 'yes' : 'no'}`);
      if (summary.acceptance.failures.length > 0) {
        console.log(`acceptance failures: ${summary.acceptance.failures.length}`);
      }
    }
    if (args.requirePrimary && !summary.acceptance.primaryEligible) {
      process.exit(2);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
