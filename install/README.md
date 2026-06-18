# Codex Installation

`readback-gate` v0 targets Codex `UserPromptSubmit` first.

## Local Clone

From this repository:

```sh
node install/codex-install.mjs --dry-run
node install/codex-install.mjs
```

The installer adds this command to `~/.codex/hooks.json` under `UserPromptSubmit`,
using the absolute path of your local clone (resolved automatically):

```sh
node /absolute/path/to/readback-gate/src/adapters/codex.ts
```

## Manual Hook Entry

Add a `UserPromptSubmit` hook that runs (use the absolute path of your clone):

```sh
node /absolute/path/to/readback-gate/src/adapters/codex.ts
```

Recommended defaults:

```sh
READBACK_GATE_MODE=inject
READBACK_GATE_THRESHOLD=70
```

Strict mode is opt-in:

```sh
READBACK_GATE_MODE=strict
```

## Verification

Ambiguous prompt should inject context:

```sh
echo '{"prompt":"이거 알아서 다 처리해줘"}' | node src/adapters/codex.ts
```

Clear prompt should pass silently:

```sh
echo '{"prompt":"src/core/scorer.ts에서 테스트를 추가하고 npm test로 검증해줘"}' | node src/adapters/codex.ts
```

Strict high-risk prompt should exit `2`:

```sh
echo '{"prompt":"이거 전부 삭제하고 초기화해줘"}' | READBACK_GATE_MODE=strict node src/adapters/codex.ts
```
