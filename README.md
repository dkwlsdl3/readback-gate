# readback-gate

> Your coding agent reads back what it understood — **before** it acts on it.

**English** · [한국어](README.ko.md)

A runtime prompt gate for AI coding agents. It deterministically flags
low-clarity prompts the moment you hit enter — inside the loop — and injects a
structured readback so you confirm intent before the agent runs.

![status: pre-release](https://img.shields.io/badge/status-v0%20pre--release-orange)
![license: MIT](https://img.shields.io/badge/license-MIT-blue)
![node](https://img.shields.io/badge/node-%3E%3D24-green)
![dependencies: none](https://img.shields.io/badge/deps-0-brightgreen)
![telemetry: local-only](https://img.shields.io/badge/telemetry-local--only-brightgreen)

Demo GIF source: [`assets/demo.tape`](assets/demo.tape). Render it with
`npm run demo` to produce `assets/demo.gif` when `vhs` and `ffmpeg` are
available.

---

## The problem

You type *"just clean this up and handle it."* The agent confidently does the
wrong thing — and you find out three file edits later.

Other tools check your prompt in a browser, or lint your config files. None of
them catch **the command you just typed, in the loop, before it runs.**

## What it does

**Before** — an ambiguous prompt:

```text
just clean everything up and handle it
```

readback-gate scores it as low-clarity and injects a short instruction into the
agent's context:

```text
Readback-gate: clarity_score=16, risk_level=none, missing=goal_clarity, target_context, context_dependency, done_condition.
If the prompt is ambiguous, do not execute yet. First sync intent in this format:
1. State the understood goal in one sentence.
2. List 2-4 plausible interpretations as options.
3. Recommend one with a short reason.
4. Ask exactly one clarification question, then stop.
```

**After** — a clear prompt passes untouched:

```text
Add a risk_level test to src/core/scorer.ts and verify with npm test
```

It has a target, bounded scope, and a verification command — so it passes.

## Why it's different

|  | What it checks | When | Blocks? |
|---|---|---|---|
| Browser paste tools | prompt text | outside the loop | report only |
| Config linters | static config files | commit / CI | file fix |
| **readback-gate** | **the prompt you just typed** | **in the loop, pre-execution** | **inject (default) / opt-in block** |

- **Deterministic & local.** The scoring path never calls an LLM or the network — same prompt, same score, every time.
- **Inject, don't block.** Blocking your own command is paternalistic; injecting "read back first" is not. Hard blocking is opt-in (`strict`).
- **Non-execution aware.** Questions, acknowledgements, and read-only queries pass through untouched.

## Install

Requires **Node ≥ 24**.

```sh
npx readback-gate install
```

The installer auto-detects existing Codex and Claude Code config files. Use
`--codex` or `--claude` to force a target, `--dry-run` to preview, and
`--uninstall` to remove the hook.

## Usage

### CLI

```sh
readback-gate "just clean everything up and handle it"
```

Prints a human summary plus a report JSON:

```json
{
  "version": "0.1.0",
  "clarity_score": 16,
  "risk_level": "none",
  "verdict": "inject",
  "axes": {
    "goal_clarity": 84,
    "target_context": 68,
    "scope_boundedness": 88,
    "done_condition": 90,
    "risk_side_effect": 100,
    "context_dependency": 88
  },
  "missing": ["goal_clarity", "target_context", "context_dependency", "done_condition"],
  "trigger_reasons": ["The requested action is vague or delegation-heavy."],
  "suggested_questions": ["What exact outcome should the agent produce?"]
}
```

### As a hook (Codex / Claude Code)

Both agents speak the same `UserPromptSubmit` protocol, so the same adapter
works for both. Register it with one command:

```sh
npx readback-gate install
```

See [install/README.md](install/README.md) for target-specific options. The
adapter:

- emits `{"hookSpecificOutput":{...,"additionalContext":"..."}}` to inject, or
- emits `{}` to pass through, or
- in `strict` mode, prints a reason to stderr and exits `2` to block.

### Measuring effect with dual-run (experimental)

`readback-gate-dual-run` records paired artifacts for the same prompt:

- `gated_visible`: the prompt plus readback-gate's injected context
- `baseline_replica`: the same prompt/context in a cloned replica with
  `READBACK_GATE_DISABLE=1`

The agent under test can be Claude Code, Codex, or another coding agent. Record
that with `--agent claude|codex|custom`; it is analysis metadata only. The
treatment variable remains readback-gate on/off: baseline runs with
`READBACK_GATE_DISABLE=1`, while gated runs receive the readback-gate injection.

```sh
readback-gate-dual-run \
  --prompt "README.md 이거 좀 알아서 고쳐줘" \
  --context-file /tmp/full-transcript.txt \
  --context-fidelity full_transcript \
  --agent claude \
  --baseline-cmd "claude" \
  --gated-cmd "claude" \
  --require-primary
```

Replace `claude` with the command that runs the target agent for one prompt, for
example `codex exec` for Codex or a custom wrapper script. The runner feeds both
branches the same generated input file on stdin.

The runner writes `summary.json`, branch inputs, stdout/stderr, git diffs, and
status files under `/tmp/readback-gate-dualrun` by default. A pair is
`acceptance.primaryEligible=true` only when both branches ran, the prompt got an
actual readback-gate treatment, and the supplied context is marked
`full_transcript` from `--context-file`. Inline, summary, truncated, or
no-context pairs are retained for debugging but excluded from primary effect
claims.

Artifacts are redacted with `--redaction basic` by default for common token/key
patterns. Use `--redaction off` only when you need byte-for-byte review
artifacts and can protect the artifact root.

Aggregate accepted pairs with labels:

```sh
readback-gate-dual-run-report \
  --artifacts-root /tmp/readback-gate-dualrun \
  --labels labels.jsonl \
  --min-labeled 30 \
  --require-ready
```

`labels.jsonl` uses one JSON object per line:

```json
{"pairId":"...","verdict":"gated_better","reviewer":"alice","confidence":"high"}
```

Allowed verdicts are `gated_better`, `baseline_better`, `same`, `both_bad`, and
`exclude`. Use `--prepare-review <dir>` to create blinded `arm_a` / `arm_b`
review packs for primary-eligible unlabeled pairs.

You can run an AI first-pass labeler over that blind review pack. The labeler
only sees `arm_a` and `arm_b`; `readback-gate-dual-run-label` reads
`manifest.private.json` afterward and writes mapped `gated_better` /
`baseline_better` labels. Labeler subprocesses run with `READBACK_GATE_DISABLE=1`
to avoid recursively queuing the labeling prompt:

```sh
readback-gate-dual-run-report \
  --artifacts-root /tmp/readback-gate-dualrun \
  --prepare-review /tmp/readback-gate-review

readback-gate-dual-run-label \
  --review-dir /tmp/readback-gate-review \
  --labels labels.jsonl \
  --audit audit.jsonl \
  --labeler-cmd "codex exec --sandbox read-only" \
  --reviewer ai-codex
```

Treat AI labels as triage, not final proof. Human-review at least a 10-20%
sample, plus every `confidence=low`, `exclude`, `both_bad`, or AI-disagreement
case, before making public claims.

For a multi-day live experiment, enable capture in the hook and run the worker:

```sh
readback-gate install --codex --claude --dual-run-capture

readback-gate-dual-run-worker \
  --watch \
  --interval-sec 60 \
  --auth-bridge codex_symlink \
  --claude-cmd "claude" \
  --codex-cmd "codex exec"
```

The hook only queues prompt candidates; it does not run a second agent inside
the live session. The worker creates `/tmp/readback-gate-dualrun/<pair-id>/`
artifacts and runs both baseline and gated branches inside separate replica
directories.

`--auth-bridge codex_symlink` is optional and only applies to Codex queue
entries. It creates `.codex/auth.json` symlinks inside the isolated branch
homes so `codex exec` can authenticate without inheriting the whole user
environment. This deliberately exposes the local Codex auth token to branch
agents and leaves symlinks under the pair artifact directory; keep those
artifacts local and delete them after review.

Cleanup is required after a measurement window. Pair directories can contain
full transcripts, stdout/stderr, diffs, and auth symlinks. After exporting the
labels or report you need, delete reviewed artifacts:

```sh
rm -rf /tmp/readback-gate-dualrun/<pair-id>
# or, after the whole experiment:
rm -rf /tmp/readback-gate-dualrun
```

Important limits: the replica is a workspace snapshot, not an OS network
sandbox. The runner uses a minimal baseline environment and `--command-guard
remote_write` by default, which blocks common remote commands such as `curl`,
`wget`, `ssh`, `rsync`, `gh`, and remote git subcommands like `git push`.
That is a command shim, not a kernel/network sandbox; production APIs can still
be reached through unrecognized binaries or code-level network libraries unless
you wrap the run in an external sandbox. Artifacts may contain prompts, context,
diffs, stdout, stderr, or secrets even after best-effort redaction, so keep the
artifact root local and delete it after review.

## Modes

| Mode | Behavior |
|---|---|
| `silent` | Injects one score/missing-signal line. No instruction. |
| `inject` **(default)** | Injects score/signals + the 4-step readback instruction. |
| `advisory` | Prints a report to stderr and continues. |
| `strict` | Blocks (`exit 2`) only when `clarity_score < threshold` **and** `risk_level == high`; otherwise behaves like `inject`. |

Configure via env: `READBACK_GATE_MODE`, `READBACK_GATE_THRESHOLD` (default 70),
`READBACK_GATE_TELEMETRY`.

## How scoring works

`clarity_score` (0–100) is `100` minus deterministic penalties across six axes.
A separate `risk_level` (`none`/`low`/`medium`/`high`) drives `strict` gating.

| Axis | Penalized when… |
|---|---|
| goal clarity | vague verb (handle / sort out), or no action verb |
| target/context | no concrete file, path, symbol, or module |
| scope boundedness | unbounded scope (all / everything / entire) |
| done condition | no verifiable completion signal |
| risk / side-effect | destructive/remote/prod action with no acknowledgement |
| context dependency | relies on unresolved references or prior turns |

Both English and Korean are detected. See [docs/spec-v0.md](docs/spec-v0.md) for
the full model and [§13](docs/spec-v0.md) for known limitations.

## Privacy

readback-gate adds **no data egress of its own**:

- **No network calls, no phone-home, no device fingerprint.** Scoring is
  deterministic and offline; readback-gate never sends anything to a readback-gate
  or third-party server.
- **Raw prompts are never stored.** Telemetry records only a `prompt_hash`,
  length, score, risk, verdict, and missing axes — to a **local JSONL file**.
- Optional LLM helpers (explanations / rewrites) are strictly opt-in.

> Note: readback-gate runs *inside* your coding agent. Your agent still sends your
> prompt — plus readback-gate's short injected line — to its own model provider,
> exactly as it already does. readback-gate just adds **no new destination**.

## Status & honesty

readback-gate reliably does what it says: deterministic scoring plus a
structured readback on low-clarity prompts. What it does **not** yet have is
evidence that this reduces real mistakes — a backtest over ~3,700 real prompts
found **no correlation** between clarity score and later rework. So treat it
today as a *pause-and-confirm* aid, not a proven error preventer. Whether
intervening actually helps is an open question, to be tested with an on/off A/B.

## Roadmap

- [ ] A/B / accepted dual-run dataset to measure whether injecting actually reduces rework
- [ ] Dedicated Claude Code adapter (the boundary is already clean)
- [ ] Re-derive the score from what actually predicts rework (if the A/B is positive)
- [ ] Tighten the mutating-verb denylist ([§13](docs/spec-v0.md))

## Development

No runtime dependencies.

```sh
npm test
npm run demo
readback-gate "Add a test to src/core/scorer.ts and run npm test"
READBACK_GATE_MODE=strict node src/adapters/codex.ts < test/fixtures/codex-ambiguous.json
```

## License

MIT
