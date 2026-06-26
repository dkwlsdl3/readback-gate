import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { codexAdapter } from '../src/adapters/codex.ts';

function telemetryPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'readback-gate-codex-')), 'events.jsonl');
}

test('ambiguous prompt injects Codex hookSpecificOutput context', async () => {
  const result = await codexAdapter.run(
    JSON.stringify({ prompt: '이거 알아서 다 처리해줘' }),
    { telemetryPath: telemetryPath() }
  );

  assert.equal(result.exitCode, 0);
  assert.ok(result.stdout);

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.match(payload.hookSpecificOutput.additionalContext, /First sync intent in this format/);
});

test('clear prompt passes with empty JSON output', async () => {
  const result = await codexAdapter.run(
    JSON.stringify({ prompt: 'src/core/scorer.ts에서 테스트를 추가하고 npm test로 검증해줘' }),
    { telemetryPath: telemetryPath() }
  );

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, '{}\n');
  assert.equal(result.stderr, undefined);
});

test('strict high-risk low-clarity prompt gates without additionalContext', async () => {
  const result = await codexAdapter.run(
    JSON.stringify({ prompt: '이거 전부 삭제하고 초기화해줘' }),
    { mode: 'strict', telemetryPath: telemetryPath() }
  );

  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, undefined);
  assert.ok(result.stderr);
  assert.doesNotMatch(result.stderr, /additionalContext/);
});

test('READBACK_GATE_DISABLE bypasses Codex hook injection', async () => {
  const previous = process.env.READBACK_GATE_DISABLE;
  process.env.READBACK_GATE_DISABLE = '1';
  try {
    const result = await codexAdapter.run(
      JSON.stringify({ prompt: '이거 알아서 다 처리해줘' }),
      { telemetryPath: telemetryPath() }
    );

    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, '{}\n');
    assert.equal(result.stderr, undefined);
  } finally {
    if (previous === undefined) {
      delete process.env.READBACK_GATE_DISABLE;
    } else {
      process.env.READBACK_GATE_DISABLE = previous;
    }
  }
});

test('dual-run capture stores injected prompt candidates in a queue', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'readback-gate-capture-'));
  const queuePath = join(dir, 'queue.jsonl');
  const captureRoot = join(dir, 'captures');
  const transcriptPath = join(dir, 'transcript.txt');
  writeFileSync(transcriptPath, 'User: previous\nAssistant: previous\n', 'utf8');

  const previous = {
    capture: process.env.READBACK_GATE_DUALRUN_CAPTURE,
    queue: process.env.READBACK_GATE_DUALRUN_QUEUE,
    root: process.env.READBACK_GATE_DUALRUN_CAPTURE_ROOT,
    agent: process.env.READBACK_GATE_DUALRUN_AGENT
  };
  process.env.READBACK_GATE_DUALRUN_CAPTURE = '1';
  process.env.READBACK_GATE_DUALRUN_QUEUE = queuePath;
  process.env.READBACK_GATE_DUALRUN_CAPTURE_ROOT = captureRoot;
  process.env.READBACK_GATE_DUALRUN_AGENT = 'claude';

  try {
    const result = await codexAdapter.run(
      JSON.stringify({
        prompt: 'README.md 이거 좀 알아서 고쳐줘',
        cwd: process.cwd(),
        transcript_path: transcriptPath
      }),
      { telemetryPath: telemetryPath() }
    );

    assert.equal(result.exitCode, 0);
    assert.equal(existsSync(queuePath), true);
    const [entry] = readFileSync(queuePath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(entry.agent, 'claude');
    assert.equal(entry.repoPath, process.cwd());
    assert.equal(entry.contextFidelity, 'full_transcript');
    assert.equal(readFileSync(entry.promptPath, 'utf8'), 'README.md 이거 좀 알아서 고쳐줘');
    assert.match(readFileSync(entry.contextPath, 'utf8'), /User: previous/);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      const envKey = {
        capture: 'READBACK_GATE_DUALRUN_CAPTURE',
        queue: 'READBACK_GATE_DUALRUN_QUEUE',
        root: 'READBACK_GATE_DUALRUN_CAPTURE_ROOT',
        agent: 'READBACK_GATE_DUALRUN_AGENT'
      }[key]!;
      if (value === undefined) {
        delete process.env[envKey];
      } else {
        process.env[envKey] = value;
      }
    }
  }
});
