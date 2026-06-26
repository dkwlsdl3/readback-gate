import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runDualRun } from '../src/dualrun.ts';

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function run(command: string, cwd: string): string {
  return execFileSync(process.env.SHELL ?? '/bin/sh', ['-lc', command], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'readback-gate-test',
      GIT_AUTHOR_EMAIL: 'readback-gate@example.invalid',
      GIT_COMMITTER_NAME: 'readback-gate-test',
      GIT_COMMITTER_EMAIL: 'readback-gate@example.invalid'
    }
  });
}

function makeRepo(): string {
  const repo = tempDir('readback-gate-dualrun-repo-');
  run('git init -q', repo);
  writeFileSync(join(repo, 'README.md'), '# fixture\n', 'utf8');
  run('git add README.md && git commit -q -m init', repo);
  return repo;
}

function writeContextFile(artifactsRoot: string, name = 'full-transcript.txt'): string {
  const path = join(artifactsRoot, name);
  writeFileSync(path, 'Full transcript fixture.\nUser: previous request\nAssistant: previous response\n', 'utf8');
  return path;
}

test('dual-run executes baseline inside replica without touching source repo', () => {
  const repo = makeRepo();
  const artifactsRoot = tempDir('readback-gate-dualrun-artifacts-');

  const summary = runDualRun({
    prompt: '이거 알아서 다 처리해줘',
    repoPath: repo,
    artifactsRoot,
    pairId: 'pair-baseline-only',
    baselineCommand: 'node -e "require(\'fs\').writeFileSync(\'baseline.txt\', \'baseline\\n\')"'
  });

  assert.equal(summary.pairId, 'pair-baseline-only');
  assert.equal(summary.branches.baseline_replica.skipped, false);
  assert.equal(summary.branches.gated_visible.skipped, true);
  assert.equal(summary.verdict, 'inconclusive');
  assert.equal(summary.acceptance.primaryEligible, false);
  assert.match(summary.acceptance.failures.join('\n'), /primary evidence requires full_transcript/);
  assert.match(summary.acceptance.failures.join('\n'), /gated_visible skipped/);
  assert.equal(existsSync(join(repo, 'baseline.txt')), false);
  assert.equal(existsSync(join(summary.replicaPath, 'baseline.txt')), true);

  const baselineStatus = readFileSync(summary.branches.baseline_replica.statusPath!, 'utf8');
  assert.match(baselineStatus, /baseline\.txt/);

  const storedSummary = JSON.parse(readFileSync(join(artifactsRoot, 'pair-baseline-only', 'summary.json'), 'utf8'));
  assert.equal(storedSummary.promptStored, false);
  assert.equal(storedSummary.contextFidelity, 'none');
  assert.equal(storedSummary.excludedFromPrimary, true);
  assert.equal(existsSync(join(artifactsRoot, 'pair-baseline-only', 'prompt.txt')), false);
});

test('dual-run injects prompt while keeping treatment labels out of branch inputs', () => {
  const repo = makeRepo();
  const artifactsRoot = tempDir('readback-gate-dualrun-artifacts-');
  const contextFile = writeContextFile(artifactsRoot);

  const summary = runDualRun({
    prompt: 'README.md 이거 좀 알아서 고쳐줘',
    repoPath: repo,
    artifactsRoot,
    pairId: 'pair-branch-inputs',
    agent: 'claude',
    contextFile,
    contextFidelity: 'full_transcript',
    baselineCommand: 'node -e "require(\'fs\').writeFileSync(\'seen-baseline.txt\', require(\'fs\').readFileSync(0, \'utf8\'))"',
    gatedCommand: 'node -e "require(\'fs\').writeFileSync(\'seen-gated.txt\', require(\'fs\').readFileSync(0, \'utf8\'))"'
  });

  assert.equal(summary.branches.baseline_replica.skipped, false);
  assert.equal(summary.branches.gated_visible.skipped, false);
  assert.equal(summary.verdict, 'unreviewed');
  assert.equal(summary.contextFidelity, 'full_transcript');
  assert.equal(summary.contextSource, 'context_file');
  assert.equal(summary.contextPath, contextFile);
  assert.equal(summary.agent, 'claude');
  assert.equal(summary.commandGuard, 'remote_write');
  assert.equal(summary.excludedFromPrimary, false);
  assert.equal(summary.acceptance.primaryEligible, true);
  assert.deepEqual(summary.acceptance.failures, []);
  assert.equal(summary.branches.baseline_replica.treatment, 'baseline');
  assert.equal(summary.branches.gated_visible.treatment, 'gated');
  assert.equal(summary.branches.baseline_replica.treatmentApplied, false);
  assert.equal(summary.branches.gated_visible.treatmentApplied, true);

  const baselineInput = readFileSync(summary.branches.baseline_replica.inputPath!, 'utf8');
  const gatedInput = readFileSync(summary.branches.gated_visible.inputPath!, 'utf8');
  assert.doesNotMatch(baselineInput, /treatment: baseline/);
  assert.doesNotMatch(gatedInput, /treatment: gated/);
  assert.match(baselineInput, /agent: claude/);
  assert.match(gatedInput, /agent: claude/);
  assert.match(baselineInput, /README\.md 이거 좀 알아서 고쳐줘/);
  assert.match(gatedInput, /README\.md 이거 좀 알아서 고쳐줘/);
  assert.doesNotMatch(baselineInput, /Readback-gate:/);
  assert.match(gatedInput, /Readback-gate:/);

  const seenBaseline = readFileSync(join(summary.replicaPath, 'seen-baseline.txt'), 'utf8');
  const seenGated = readFileSync(join(summary.gatedReplicaPath, 'seen-gated.txt'), 'utf8');
  assert.equal(seenBaseline, baselineInput);
  assert.equal(seenGated, gatedInput);
  assert.equal(existsSync(join(repo, 'seen-baseline.txt')), false);
  assert.equal(existsSync(join(repo, 'seen-gated.txt')), false);
});

test('dual-run references large transcript files instead of inlining them into branch input', () => {
  const repo = makeRepo();
  const artifactsRoot = tempDir('readback-gate-dualrun-artifacts-');
  const contextFile = join(artifactsRoot, 'large-transcript.txt');
  writeFileSync(contextFile, `User: previous\n${'x'.repeat(1024 * 1024)}\n`, 'utf8');

  const summary = runDualRun({
    prompt: 'README.md 이거 좀 알아서 고쳐줘',
    repoPath: repo,
    artifactsRoot,
    pairId: 'pair-large-transcript',
    contextFile,
    contextFidelity: 'full_transcript',
    baselineCommand: 'node -e "require(\'fs\').writeFileSync(\'baseline.txt\', require(\'fs\').readFileSync(0, \'utf8\'))"',
    gatedCommand: 'node -e "require(\'fs\').writeFileSync(\'gated.txt\', require(\'fs\').readFileSync(0, \'utf8\'))"'
  });

  assert.equal(summary.acceptance.primaryEligible, true);
  const baselineInput = readFileSync(summary.branches.baseline_replica.inputPath!, 'utf8');
  const gatedInput = readFileSync(summary.branches.gated_visible.inputPath!, 'utf8');
  assert.match(baselineInput, /Conversation Context File/);
  assert.match(gatedInput, /Conversation Context File/);
  assert.match(baselineInput, /context\.txt/);
  assert.ok(Buffer.byteLength(baselineInput, 'utf8') < 20_000);
  assert.ok(Buffer.byteLength(gatedInput, 'utf8') < 30_000);
  assert.equal(existsSync(join(artifactsRoot, 'pair-large-transcript', 'context.txt')), true);
});

test('dual-run expands pair directory placeholder inside branch commands', () => {
  const repo = makeRepo();
  const artifactsRoot = tempDir('readback-gate-dualrun-artifacts-');

  const summary = runDualRun({
    prompt: 'README.md 이거 좀 알아서 고쳐줘',
    repoPath: repo,
    artifactsRoot,
    pairId: 'pair-dir-placeholder',
    baselineCommand: 'node -e "require(\'fs\').writeFileSync(\'pair-dir.txt\', process.argv[1])" {PAIR_DIR}'
  });

  assert.equal(readFileSync(join(summary.replicaPath, 'pair-dir.txt'), 'utf8'), join(artifactsRoot, 'pair-dir-placeholder'));
  assert.doesNotMatch(summary.branches.baseline_replica.command!, /\{PAIR_DIR\}/);
});

test('dual-run can bridge Codex auth into isolated branch homes with an explicit symlink option', () => {
  const repo = makeRepo();
  const artifactsRoot = tempDir('readback-gate-dualrun-artifacts-');
  const authPath = join(artifactsRoot, 'codex-auth.json');
  writeFileSync(authPath, '{"TEST_AUTH":"public-fixture"}\n', 'utf8');
  const previousAuthPath = process.env.READBACK_GATE_CODEX_AUTH_PATH;
  process.env.READBACK_GATE_CODEX_AUTH_PATH = authPath;

  try {
    const summary = runDualRun({
      prompt: 'README.md 이거 좀 알아서 고쳐줘',
      repoPath: repo,
      artifactsRoot,
      pairId: 'pair-codex-auth-bridge',
      authBridge: 'codex_symlink',
      baselineCommand: 'test -L "$HOME/.codex/auth.json" && cat "$HOME/.codex/auth.json" > auth-link.txt'
    });

    const linkPath = join(artifactsRoot, 'pair-codex-auth-bridge', 'baseline_replica_home', '.codex', 'auth.json');
    assert.equal(readlinkSync(linkPath), authPath);
    assert.match(readFileSync(join(summary.replicaPath, 'auth-link.txt'), 'utf8'), /public-fixture/);
    assert.equal(summary.authBridge, 'codex_symlink');
    assert.match(summary.acceptance.warnings.join('\n'), /auth-bridge=codex_symlink/);
  } finally {
    if (previousAuthPath === undefined) {
      delete process.env.READBACK_GATE_CODEX_AUTH_PATH;
    } else {
      process.env.READBACK_GATE_CODEX_AUTH_PATH = previousAuthPath;
    }
  }
});

test('dual-run snapshots dirty source state before measuring branch diffs', () => {
  const repo = makeRepo();
  const artifactsRoot = tempDir('readback-gate-dualrun-artifacts-');
  writeFileSync(join(repo, 'dirty-source.txt'), 'already here\n', 'utf8');

  const summary = runDualRun({
    prompt: 'README.md 이거 좀 알아서 고쳐줘',
    repoPath: repo,
    artifactsRoot,
    pairId: 'pair-dirty-source',
    baselineCommand: 'node -e "require(\'fs\').writeFileSync(\'baseline.txt\', \'baseline\\n\')"'
  });

  assert.equal(existsSync(join(summary.replicaPath, 'dirty-source.txt')), true);

  const baselineDiff = readFileSync(summary.branches.baseline_replica.diffPath!, 'utf8');
  const baselineStatus = readFileSync(summary.branches.baseline_replica.statusPath!, 'utf8');
  assert.match(baselineDiff, /baseline/);
  assert.doesNotMatch(baselineDiff, /dirty-source/);
  assert.doesNotMatch(baselineStatus, /dirty-source/);
});

test('dual-run normalizes gated diff against the pre-run source snapshot', () => {
  const repo = makeRepo();
  const artifactsRoot = tempDir('readback-gate-dualrun-artifacts-');
  writeFileSync(join(repo, 'dirty-source.txt'), 'already here\n', 'utf8');

  const summary = runDualRun({
    prompt: 'README.md 이거 좀 알아서 고쳐줘',
    repoPath: repo,
    artifactsRoot,
    pairId: 'pair-gated-dirty-source',
    gatedCommand: 'node -e "require(\'fs\').writeFileSync(\'gated.txt\', \'gated\\n\')"'
  });

  const gatedDiff = readFileSync(summary.branches.gated_visible.diffPath!, 'utf8');
  const gatedStatus = readFileSync(summary.branches.gated_visible.statusPath!, 'utf8');
  assert.match(gatedDiff, /gated/);
  assert.doesNotMatch(gatedDiff, /dirty-source/);
  assert.match(gatedStatus, /gated\.txt/);
  assert.doesNotMatch(gatedStatus, /dirty-source/);
  assert.equal(existsSync(join(repo, 'gated.txt')), false);
  assert.equal(existsSync(join(summary.gatedReplicaPath, 'gated.txt')), true);
});

test('dual-run captures committed changes relative to the snapshot commit', () => {
  const repo = makeRepo();
  const artifactsRoot = tempDir('readback-gate-dualrun-artifacts-');

  const summary = runDualRun({
    prompt: 'README.md 수정하고 커밋해줘',
    repoPath: repo,
    artifactsRoot,
    pairId: 'pair-committed-baseline',
    baselineCommand: 'node -e "require(\'fs\').appendFileSync(\'README.md\', \'committed baseline\\n\')" && git add README.md && git commit -q -m baseline'
  });

  const baselineDiff = readFileSync(summary.branches.baseline_replica.diffPath!, 'utf8');
  assert.match(baselineDiff, /committed baseline/);
});

test('dual-run minimal baseline env does not inherit arbitrary secrets by default', () => {
  const repo = makeRepo();
  const artifactsRoot = tempDir('readback-gate-dualrun-artifacts-');
  const previous = process.env.READBACK_GATE_TEST_SECRET;
  process.env.READBACK_GATE_TEST_SECRET = 'do-not-copy';
  try {
    const summary = runDualRun({
      prompt: '환경을 확인해줘',
      repoPath: repo,
      artifactsRoot,
      pairId: 'pair-minimal-env',
      baselineCommand: 'node -e "require(\'fs\').writeFileSync(\'env.txt\', process.env.READBACK_GATE_TEST_SECRET || \'\')"'
    });

    assert.equal(readFileSync(join(summary.replicaPath, 'env.txt'), 'utf8'), '');
  } finally {
    if (previous === undefined) {
      delete process.env.READBACK_GATE_TEST_SECRET;
    } else {
      process.env.READBACK_GATE_TEST_SECRET = previous;
    }
  }
});

test('dual-run stores branch stdout in an artifact file', () => {
  const repo = makeRepo();
  const artifactsRoot = tempDir('readback-gate-dualrun-artifacts-');

  const summary = runDualRun({
    prompt: 'stdout 저장 확인해줘',
    repoPath: repo,
    artifactsRoot,
    pairId: 'pair-stdout-artifact',
    baselineCommand: 'node -e "process.stdout.write(\'x\'.repeat(1024 * 1024))"'
  });

  assert.equal(readFileSync(summary.branches.baseline_replica.stdoutPath!, 'utf8').length, 1024 * 1024);
});

test('dual-run redacts common secret patterns from stored artifacts by default', () => {
  const repo = makeRepo();
  const artifactsRoot = tempDir('readback-gate-dualrun-artifacts-');
  const contextFile = join(artifactsRoot, 'secret-transcript.txt');
  writeFileSync(contextFile, 'Authorization: Bearer fixture\n', 'utf8');

  const summary = runDualRun({
    prompt: 'README.md 이거 좀 알아서 고쳐줘 token=public-redaction-fixture-123456',
    repoPath: repo,
    artifactsRoot,
    pairId: 'pair-redaction',
    contextFile,
    contextFidelity: 'full_transcript',
    storePrompt: true,
    baselineCommand: 'node -e "console.log(\'api_key=public-redaction-fixture-123456\')"',
    gatedCommand: 'node -e "process.stdin.resume()"'
  });

  assert.equal(summary.redaction, 'basic');
  assert.ok(summary.redactedPaths.length >= 3);
  const promptArtifact = readFileSync(join(artifactsRoot, 'pair-redaction', 'prompt.txt'), 'utf8');
  const contextArtifact = readFileSync(join(artifactsRoot, 'pair-redaction', 'context.txt'), 'utf8');
  const baselineInput = readFileSync(summary.branches.baseline_replica.inputPath!, 'utf8');
  const baselineStdout = readFileSync(summary.branches.baseline_replica.stdoutPath!, 'utf8');
  assert.doesNotMatch(promptArtifact, /public-redaction-fixture/);
  assert.doesNotMatch(contextArtifact, /Authorization: Bearer fixture/);
  assert.match(contextArtifact, /Authorization: Bearer \[REDACTED\]/);
  assert.doesNotMatch(baselineInput, /public-redaction-fixture/);
  assert.doesNotMatch(baselineStdout, /public-redaction-fixture/);
  assert.match(baselineStdout, /\[REDACTED\]/);
});

test('dual-run excludes no-treatment prompts from primary analysis', () => {
  const repo = makeRepo();
  const artifactsRoot = tempDir('readback-gate-dualrun-artifacts-');
  const contextFile = writeContextFile(artifactsRoot);

  const summary = runDualRun({
    prompt: 'README.md 내용 설명해줘',
    repoPath: repo,
    artifactsRoot,
    pairId: 'pair-no-treatment',
    contextFile,
    contextFidelity: 'full_transcript',
    baselineCommand: 'node -e "require(\'fs\').writeFileSync(\'baseline.txt\', require(\'fs\').readFileSync(0, \'utf8\'))"',
    gatedCommand: 'node -e "require(\'fs\').writeFileSync(\'gated.txt\', require(\'fs\').readFileSync(0, \'utf8\'))"'
  });

  assert.equal(summary.treatmentApplied, false);
  assert.equal(summary.acceptance.primaryEligible, false);
  assert.match(summary.acceptance.failures.join('\n'), /no treatment was applied/);
});

test('dual-run records inherited baseline env as a privacy warning', () => {
  const repo = makeRepo();
  const artifactsRoot = tempDir('readback-gate-dualrun-artifacts-');
  const contextFile = writeContextFile(artifactsRoot);

  const summary = runDualRun({
    prompt: 'README.md 이거 좀 알아서 고쳐줘',
    repoPath: repo,
    artifactsRoot,
    pairId: 'pair-inherit-env-warning',
    contextFile,
    contextFidelity: 'full_transcript',
    baselineEnvMode: 'inherit',
    baselineCommand: 'node -e "require(\'fs\').writeFileSync(\'baseline.txt\', require(\'fs\').readFileSync(0, \'utf8\'))"',
    gatedCommand: 'node -e "require(\'fs\').writeFileSync(\'gated.txt\', require(\'fs\').readFileSync(0, \'utf8\'))"'
  });

  assert.equal(summary.baselineEnvMode, 'inherit');
  assert.equal(summary.acceptance.primaryEligible, true);
  assert.match(summary.acceptance.warnings.join('\n'), /baseline-env=inherit/);
});

test('dual-run rejects inline full_transcript context from primary analysis', () => {
  const repo = makeRepo();
  const artifactsRoot = tempDir('readback-gate-dualrun-artifacts-');

  const summary = runDualRun({
    prompt: 'README.md 이거 좀 알아서 고쳐줘',
    repoPath: repo,
    artifactsRoot,
    pairId: 'pair-inline-full-transcript',
    context: 'Inline text claiming to be a full transcript.',
    contextFidelity: 'full_transcript',
    baselineCommand: 'node -e "require(\'fs\').writeFileSync(\'baseline.txt\', require(\'fs\').readFileSync(0, \'utf8\'))"',
    gatedCommand: 'node -e "require(\'fs\').writeFileSync(\'gated.txt\', require(\'fs\').readFileSync(0, \'utf8\'))"'
  });

  assert.equal(summary.contextSource, 'inline');
  assert.equal(summary.acceptance.primaryEligible, false);
  assert.match(summary.acceptance.failures.join('\n'), /must come from --context-file/);
});

test('dual-run command guard blocks common remote commands in branch commands', () => {
  const repo = makeRepo();
  const artifactsRoot = tempDir('readback-gate-dualrun-artifacts-');

  const summary = runDualRun({
    prompt: '원격 호출 테스트해줘',
    repoPath: repo,
    artifactsRoot,
    pairId: 'pair-command-guard',
    baselineCommand: 'curl https://example.invalid; git push origin HEAD'
  });

  assert.equal(summary.commandGuard, 'remote_write');
  assert.equal(summary.branches.baseline_replica.exitCode, 126);
  const stderr = readFileSync(summary.branches.baseline_replica.stderrPath!, 'utf8');
  assert.match(stderr, /blocked remote\/network command: curl/);
  assert.match(stderr, /blocked remote git subcommand: push/);
  assert.match(summary.acceptance.failures.join('\n'), /baseline_replica exited with code 126/);
});

test('dual-run command guard off is excluded from primary analysis', () => {
  const repo = makeRepo();
  const artifactsRoot = tempDir('readback-gate-dualrun-artifacts-');
  const contextFile = writeContextFile(artifactsRoot);

  const summary = runDualRun({
    prompt: 'README.md 이거 좀 알아서 고쳐줘',
    repoPath: repo,
    artifactsRoot,
    pairId: 'pair-command-guard-off',
    contextFile,
    contextFidelity: 'full_transcript',
    commandGuard: 'off',
    baselineCommand: 'node -e "require(\'fs\').writeFileSync(\'baseline.txt\', require(\'fs\').readFileSync(0, \'utf8\'))"',
    gatedCommand: 'node -e "require(\'fs\').writeFileSync(\'gated.txt\', require(\'fs\').readFileSync(0, \'utf8\'))"'
  });

  assert.equal(summary.commandGuard, 'off');
  assert.equal(summary.acceptance.primaryEligible, false);
  assert.match(summary.acceptance.failures.join('\n'), /command_guard=off/);
});

test('dual-run CLI --require-primary exits nonzero for non-primary pairs', () => {
  const repo = makeRepo();
  const artifactsRoot = tempDir('readback-gate-dualrun-artifacts-');
  const result = spawnSync(process.execPath, [
    'src/dualrun.ts',
    '--prompt',
    '이거 알아서 다 처리해줘',
    '--repo',
    repo,
    '--artifacts-root',
    artifactsRoot,
    '--pair-id',
    'pair-require-primary',
    '--baseline-cmd',
    'node -e "require(\'fs\').writeFileSync(\'baseline.txt\', require(\'fs\').readFileSync(0, \'utf8\'))"',
    '--require-primary',
    '--json'
  ], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });

  assert.equal(result.status, 2);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.acceptance.primaryEligible, false);
  assert.match(summary.acceptance.failures.join('\n'), /primary evidence requires full_transcript/);
});
