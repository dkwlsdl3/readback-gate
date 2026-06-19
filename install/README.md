# Hook Installation

`readback-gate` registers a `UserPromptSubmit` hook for Codex and Claude Code.

## One-line Install

```sh
npx readback-gate install
```

When no target flag is provided, the installer detects existing config files:

- Codex: `~/.codex/hooks.json`
- Claude Code: `~/.claude/settings.json`

If neither file exists, it defaults to Codex. To force a target:

```sh
npx readback-gate install --codex
npx readback-gate install --claude
npx readback-gate install --codex --claude
```

## Options

```sh
npx readback-gate install [--codex] [--claude] [--mode inject|silent|advisory|strict] [--threshold N] [--dry-run] [--uninstall]
```

- `--dry-run` prints the planned result without writing files.
- `--uninstall` removes existing readback-gate hooks.
- `--mode` and `--threshold` encode hook-time `READBACK_GATE_MODE` and
  `READBACK_GATE_THRESHOLD` only when they differ from defaults.

The registered command uses absolute paths and does not depend on `PATH`:

```sh
"/absolute/path/to/node" "/absolute/path/to/readback-gate/dist/adapters/codex.js"
```

## Test Fixtures

Tests can override config paths without touching real global settings:

```sh
READBACK_GATE_CODEX_HOOKS_PATH=/tmp/hooks.json npx readback-gate install --codex
READBACK_GATE_CLAUDE_SETTINGS_PATH=/tmp/settings.json npx readback-gate install --claude
```

The legacy source installer remains available for local checkouts:

```sh
node install/codex-install.mjs --dry-run
```

## Verification

Ambiguous prompt should inject context:

```sh
echo '{"prompt":"이거 알아서 다 처리해줘"}' | node dist/adapters/codex.js
```

Clear prompt should pass silently:

```sh
echo '{"prompt":"src/core/scorer.ts에서 테스트를 추가하고 npm test로 검증해줘"}' | node dist/adapters/codex.js
```

Strict high-risk prompt should exit `2`:

```sh
echo '{"prompt":"이거 전부 삭제하고 초기화해줘"}' | READBACK_GATE_MODE=strict node dist/adapters/codex.js
```
