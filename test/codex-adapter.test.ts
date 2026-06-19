import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
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
