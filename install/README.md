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
- `--dual-run-capture` makes the hook append injected/gated prompt candidates to
  the dual-run queue for later worker processing.
- `--mode` and `--threshold` encode hook-time `READBACK_GATE_MODE` and
  `READBACK_GATE_THRESHOLD` only when they differ from defaults.

The registered command uses absolute paths and does not depend on `PATH`:

```sh
"/absolute/path/to/node" "/absolute/path/to/readback-gate/dist/adapters/codex.js"
```

With `--dual-run-capture`, the command also includes target-specific env:

```sh
READBACK_GATE_DUALRUN_CAPTURE=1 READBACK_GATE_DUALRUN_AGENT=claude "/absolute/path/to/node" "/absolute/path/to/readback-gate/dist/adapters/codex.js"
```

Capture does not run another agent inside the hook. It only writes queue entries
under `~/.local/state/readback-gate/dualrun-queue.jsonl` and prompt/transcript
snapshots under `~/.local/state/readback-gate/dualrun-captures/`. Process them
with a separate worker:

```sh
readback-gate-dual-run-worker \
  --watch \
  --interval-sec 60 \
  --claude-cmd "claude" \
  --codex-cmd "codex exec"
```

Dual-run artifacts default to `/tmp/readback-gate-dualrun/<pair-id>/`. Each pair
contains separate baseline and gated replicas, so the source project directory is
not used as either branch cwd.

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
