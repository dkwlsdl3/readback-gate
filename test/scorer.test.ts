import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fixtures } from './fixtures/prompts.ts';
import { scorePrompt } from '../src/core/scorer.ts';
import { recordTelemetry } from '../src/core/telemetry.ts';

test('scorer is deterministic and matches fixture expectations', () => {
  assert.ok(fixtures.length >= 50);

  const snapshot = fixtures.map((fixture) => {
    const first = scorePrompt(fixture.prompt, { mode: 'strict' });
    const second = scorePrompt(fixture.prompt, { mode: 'strict' });

    assert.deepEqual(second, first, fixture.name);
    assert.equal(first.risk_level, fixture.risk, fixture.name);
    assert.equal(first.verdict, fixture.verdict, fixture.name);
    assert.ok(
      first.clarity_score >= fixture.min && first.clarity_score <= fixture.max,
      `${fixture.name}: score ${first.clarity_score} expected ${fixture.min}-${fixture.max}`
    );

    return {
      name: fixture.name,
      score: first.clarity_score,
      risk: first.risk_level,
      verdict: first.verdict,
      missing: first.missing
    };
  });

  assert.equal(snapshot.length, fixtures.length);
  assert.deepEqual(snapshot.slice(0, 3), [
    { name: 'ko clear test target', score: 100, risk: 'none', verdict: 'pass', missing: [] },
    { name: 'en clear file test', score: 100, risk: 'none', verdict: 'pass', missing: [] },
    { name: 'ko clear read only', score: 100, risk: 'low', verdict: 'pass', missing: [] }
  ]);
});

test('strict mode gates only low-clarity high-risk prompts', () => {
  const report = scorePrompt('이거 전부 삭제하고 초기화해줘', { mode: 'strict' });
  assert.equal(report.risk_level, 'high');
  assert.equal(report.verdict, 'gate');

  const safeReport = scorePrompt('삭제가 필요하면 먼저 물어보고, 지금은 src/core만 읽어서 삭제 후보를 목록화해줘', {
    mode: 'strict'
  });
  assert.equal(safeReport.risk_level, 'high');
  assert.equal(safeReport.verdict, 'pass');
});

test('telemetry stores validity signals without raw prompt text', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readback-gate-'));
  const path = join(dir, 'events.jsonl');
  const prompt = '이거 전부 삭제하고 초기화해줘';
  const report = scorePrompt(prompt, { mode: 'strict' });

  recordTelemetry('prompt_scored', prompt, report, path);
  recordTelemetry('clarification_injected', prompt, report, path);
  recordTelemetry('clarification_asked', prompt, report, path);
  recordTelemetry('followup_prompt_seen', prompt, report, path);
  recordTelemetry('undo_or_revert_seen', prompt, report, path);
  recordTelemetry('strict_blocked', prompt, report, path);

  const lines = readFileSync(path, 'utf8').trim().split('\n');
  assert.equal(lines.length, 6);
  const events = lines.map((line) => JSON.parse(line));
  assert.deepEqual(events.map((event) => event.event), [
    'prompt_scored',
    'clarification_injected',
    'clarification_asked',
    'followup_prompt_seen',
    'undo_or_revert_seen',
    'strict_blocked'
  ]);
  assert.ok(events.every((event) => event.prompt_hash && event.prompt_length === prompt.length));
  assert.ok(!readFileSync(path, 'utf8').includes(prompt));
});
