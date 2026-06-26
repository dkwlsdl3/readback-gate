import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
  const repo = tempDir('readback-gate-report-repo-');
  run('git init -q', repo);
  writeFileSync(join(repo, 'README.md'), '# fixture\n', 'utf8');
  run('git add README.md && git commit -q -m init', repo);
  return repo;
}

function writeContextFile(root: string): string {
  const path = join(root, 'full-transcript.txt');
  writeFileSync(path, 'Full transcript fixture.\nUser: previous request\nAssistant: previous response\n', 'utf8');
  return path;
}

test('dual-run report aggregates accepted labels from primary-eligible pairs', () => {
  const repo = makeRepo();
  const artifactsRoot = tempDir('readback-gate-report-artifacts-');
  const contextFile = writeContextFile(artifactsRoot);
  const primary = runDualRun({
    prompt: 'README.md 이거 좀 알아서 고쳐줘',
    repoPath: repo,
    artifactsRoot,
    pairId: 'pair-primary',
    agent: 'claude',
    contextFile,
    contextFidelity: 'full_transcript',
    baselineCommand: 'node -e "process.stdin.resume()"',
    gatedCommand: 'node -e "process.stdin.resume()"'
  });
  runDualRun({
    prompt: '이거 알아서 다 처리해줘',
    repoPath: repo,
    artifactsRoot,
    pairId: 'pair-ineligible',
    baselineCommand: 'node -e "process.stdin.resume()"'
  });
  const labelsPath = join(artifactsRoot, 'labels.jsonl');
  writeFileSync(labelsPath, `${JSON.stringify({
    pairId: primary.pairId,
    verdict: 'gated_better',
    reviewer: 'test',
    confidence: 'high'
  })}\n`, 'utf8');

  const result = spawnSync(process.execPath, [
    'src/dualrun-report.ts',
    '--artifacts-root',
    artifactsRoot,
    '--labels',
    labelsPath,
    '--min-labeled',
    '1',
    '--require-ready',
    '--json'
  ], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.totals.pairs, 2);
  assert.equal(report.totals.primaryEligible, 1);
  assert.equal(report.totals.primaryIneligible, 1);
  assert.equal(report.totals.labeledPrimary, 1);
  assert.equal(report.agents.claude.pairs, 1);
  assert.equal(report.agents.claude.primaryEligible, 1);
  assert.equal(report.agents.claude.labeledPrimary, 1);
  assert.equal(report.agents.custom.pairs, 1);
  assert.equal(report.agents.custom.primaryEligible, 0);
  assert.equal(report.outcomes.gated_better, 1);
  assert.equal(report.effect.gatedMinusBaseline, 1);
  assert.equal(report.readyForClaim, true);
});

test('dual-run report can prepare a blind review queue', () => {
  const repo = makeRepo();
  const artifactsRoot = tempDir('readback-gate-report-artifacts-');
  const reviewRoot = tempDir('readback-gate-review-');
  const contextFile = writeContextFile(artifactsRoot);
  runDualRun({
    prompt: 'README.md 이거 좀 알아서 고쳐줘',
    repoPath: repo,
    artifactsRoot,
    pairId: 'pair-review',
    contextFile,
    contextFidelity: 'full_transcript',
    baselineCommand: 'node -e "process.stdin.resume()"',
    gatedCommand: 'node -e "process.stdin.resume()"'
  });

  const result = spawnSync(process.execPath, [
    'src/dualrun-report.ts',
    '--artifacts-root',
    artifactsRoot,
    '--prepare-review',
    reviewRoot,
    '--json'
  ], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(existsSync(join(reviewRoot, 'pair-review', 'arm_a_input.txt')), true);
  assert.equal(existsSync(join(reviewRoot, 'pair-review', 'arm_b_input.txt')), true);
  assert.equal(existsSync(join(reviewRoot, 'pair-review', 'summary.public.json')), true);
  assert.equal(existsSync(join(reviewRoot, 'pair-review', 'label.json')), true);
  assert.equal(existsSync(join(reviewRoot, 'manifest.private.json')), true);
  assert.doesNotMatch(readFileSync(join(reviewRoot, 'pair-review', 'arm_a_input.txt'), 'utf8'), /treatment: gated|treatment: baseline/);
  assert.doesNotMatch(readFileSync(join(reviewRoot, 'pair-review', 'arm_b_input.txt'), 'utf8'), /treatment: gated|treatment: baseline/);
  assert.match(readFileSync(join(reviewRoot, 'README.md'), 'utf8'), /arm_a_better/);
  const report = JSON.parse(result.stdout);
  assert.equal(report.reviewQueue.length, 1);
});

test('dual-run labeler maps blind arm labels back to gated and baseline verdicts', () => {
  const repo = makeRepo();
  const artifactsRoot = tempDir('readback-gate-report-artifacts-');
  const reviewRoot = tempDir('readback-gate-review-');
  const labelsPath = join(artifactsRoot, 'labels.jsonl');
  const auditPath = join(artifactsRoot, 'audit.jsonl');
  const contextFile = writeContextFile(artifactsRoot);
  runDualRun({
    prompt: 'README.md 이거 좀 알아서 고쳐줘',
    repoPath: repo,
    artifactsRoot,
    pairId: 'pair-review-2',
    contextFile,
    contextFidelity: 'full_transcript',
    baselineCommand: 'node -e "process.stdin.resume()"',
    gatedCommand: 'node -e "process.stdin.resume()"'
  });
  spawnSync(process.execPath, [
    'src/dualrun-report.ts',
    '--artifacts-root',
    artifactsRoot,
    '--prepare-review',
    reviewRoot
  ], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });

  const result = spawnSync(process.execPath, [
    'src/dualrun-label.ts',
    '--review-dir',
    reviewRoot,
    '--labels',
    labelsPath,
    '--audit',
    auditPath,
    '--labeler-cmd',
    'node -e "console.log(JSON.stringify({verdict:\'arm_a_better\',confidence:\'high\',notes:\'fixture\'}))"',
    '--json'
  ], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.labeled, 1);
  const label = JSON.parse(readFileSync(labelsPath, 'utf8'));
  assert.equal(label.pairId, 'pair-review-2');
  assert.equal(label.verdict, 'gated_better');
  assert.equal(label.blindVerdict, 'arm_a_better');
  assert.equal(existsSync(auditPath), false);
});

test('dual-run report --require-ready exits nonzero when labeled sample is too small', () => {
  const artifactsRoot = tempDir('readback-gate-report-empty-');
  const result = spawnSync(process.execPath, [
    'src/dualrun-report.ts',
    '--artifacts-root',
    artifactsRoot,
    '--min-labeled',
    '1',
    '--require-ready',
    '--json'
  ], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });

  assert.equal(result.status, 2);
  const report = JSON.parse(result.stdout);
  assert.equal(report.readyForClaim, false);
  assert.match(report.blockers.join('\n'), /need at least 1/);
});
