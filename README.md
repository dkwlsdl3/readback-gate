# readback-gate

Coding agents read back what they understood, before they act on it. A runtime prompt gate that catches ambiguous tasks before your agent misunderstands them.

## Before / After

Before:

```text
이거 알아서 다 처리해줘
```

`readback-gate` scores the prompt as low clarity and injects a concise instruction into the agent context:

```text
Readback-gate: clarity_score=16, risk_level=none, missing=goal_clarity, target_context, context_dependency, done_condition.
Before executing, ask the user exactly one concise clarification question if the prompt is ambiguous.
```

After:

```text
src/core/scorer.ts에서 risk_level 분류 테스트를 추가하고 npm test로 검증해줘
```

That prompt passes because it has a target, bounded work, and a verification command.

## What v0 Does

- Deterministic local scoring only. The scoring path never calls an LLM or the network.
- Codex-first `UserPromptSubmit` hook adapter.
- Default mode: `inject`.
- Optional modes: `silent`, `advisory`, `strict`.
- Local JSONL telemetry for validity signals. Raw prompts are not stored.
- Core and adapter boundaries are separate from day one. Claude Code support is a v1 adapter.

## CLI

```sh
npx --no-install readback-gate "이거 알아서 다 처리해줘"
```

Output includes a short human summary and a report JSON:

```json
{
  "version": "0.1.0",
  "clarity_score": 34,
  "risk_level": "none",
  "verdict": "inject",
  "axes": {
    "goal_clarity": 78,
    "target_context": 60,
    "scope_boundedness": 100,
    "done_condition": 90,
    "risk_side_effect": 100,
    "context_dependency": 88
  },
  "missing": ["goal_clarity", "target_context", "context_dependency", "done_condition"],
  "trigger_reasons": ["The requested action is vague or delegation-heavy."],
  "suggested_questions": ["What exact outcome should the agent produce?"]
}
```

Use strict mode for opt-in blocking:

```sh
npx --no-install readback-gate --mode strict "이거 전부 삭제하고 초기화해줘"
```

If clarity is below the threshold and `risk_level` is `high`, the process exits with code `2`.

## Modes

- `silent`: injects only one score/missing-signal line into context. No behavior instruction.
- `inject`: injects score/missing signals plus a "ask before executing" instruction. This is the default.
- `advisory`: prints a short report to stderr and continues.
- `strict`: blocks only when `clarity_score < threshold` and `risk_level == high`; otherwise falls back to inject behavior.

## Codex Hook

The Codex adapter reads `UserPromptSubmit` JSON from stdin and writes either:

- `{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"..."}}` on stdout for context injection
- `{}` on stdout for pass-through prompts
- a human report on stderr and exit code `2` for strict blocking

Local clone command:

```sh
node /absolute/path/to/readback-gate/src/adapters/codex.ts
```

See [install/README.md](install/README.md) for hook registration options.

## Telemetry

v0 records validity signals only. It does not analyze them yet.

Events:

- `prompt_scored`
- `clarification_injected`
- `clarification_asked`
- `followup_prompt_seen`
- `undo_or_revert_seen`
- `strict_blocked`

Privacy:

- Raw prompts are never stored.
- `prompt_hash`, `prompt_length`, score, risk, verdict, and missing axes are stored.
- No remote telemetry exists.

Override the telemetry path:

```sh
READBACK_GATE_TELEMETRY=.tmp/events.jsonl npx --no-install readback-gate "..."
```

## Development

This project intentionally uses no npm dependencies in v0.

```sh
npm test
node src/cli.ts "src/core/scorer.ts에서 테스트를 추가하고 npm test로 검증해줘"
READBACK_GATE_MODE=strict node src/adapters/codex.ts < test/fixtures/codex-ambiguous.json
```
