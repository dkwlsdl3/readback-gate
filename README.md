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

- [ ] A/B (gate on vs off) to measure whether injecting actually reduces rework
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
