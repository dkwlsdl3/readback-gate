# Dual-run agent notes

Date: 2026-06-26

This note is for future agents continuing the readback-gate measurement work.
It records the current dual-run direction and a real failure case from this
session.

## Current Measurement Goal

The goal is not to test a specific handoff skill such as Claude Code
`/delegate`. The goal is broader:

Measure whether readback-gate improves the behavior of an AI coding agent when
the human gives that agent an ambiguous, underspecified, or context-dependent
prompt.

The agent under test may be Codex, Claude Code, or another coding agent. The
measurement unit is:

1. Same user prompt.
2. Same relevant conversation/project context.
3. Same repository snapshot.
4. One run with readback-gate treatment.
5. One run without readback-gate treatment.
6. Comparable artifacts, diffs, logs, and human labels.

Do not redefine the test target just because the user mentions their current
workflow. If the user says they use Claude Code and then delegate to Codex, that
does not automatically mean the project should start testing the delegate skill
or delegate artifact format. Ask what layer is under test before changing the
design.

## Current Implementation Status

The current implementation work is dual-run oriented:

- `src/dualrun.ts`: creates paired gated/baseline runs and artifacts.
- `readback-gate-dual-run --agent claude|codex|custom`: records which agent the
  pair targeted. This is metadata for later analysis, not the treatment.
- `src/dualrun-report.ts`: aggregates accepted pair summaries plus labels.
- `test/dualrun.test.ts`: regression tests for prompt/context parity, treatment
  application, dirty-tree diff isolation, command guard, and redaction.
- `test/dualrun-report.test.ts`: regression tests for report aggregation and
  blind review pack generation.
- `src/adapters/codex.ts`: honors `READBACK_GATE_DISABLE=1|true`.

Primary evidence is intentionally strict. A pair should only enter primary
analysis when:

- both branches executed,
- the prompt actually received a readback-gate treatment,
- baseline has readback-gate disabled,
- context fidelity is `full_transcript`,
- full transcript context came from `--context-file`,
- command guard is enabled,
- branch artifacts exist,
- the pair is labeled later as `gated_better`, `baseline_better`, `same`,
  `both_bad`, or `exclude`.

Current known limits:

- Command guard is a PATH shim for common remote commands, not a kernel/network
  sandbox.
- Current Codex/Claude live TUI full-context extraction is not solved.
- Redaction is best-effort and does not prove artifacts are secret-free.
- The tool can collect and aggregate data, but claims still depend on enough
  labeled accepted pairs.

## Real Failure Case From This Session

The user explained their actual workflow:

1. The user usually talks directly to Claude Code.
2. Claude Code interprets the request.
3. Claude may generate a prompt for Codex through a `/delegate` workflow.
4. Codex then performs implementation work.

The assistant incorrectly jumped to the conclusion that the next implementation
should test the `/delegate` artifact or Claude-to-Codex handoff bundle. That was
not the user's intent.

The correct interpretation was:

The user wants to test whether readback-gate helps when the human gives a
possibly bad prompt to an AI coding agent, whether that agent is Claude Code,
Codex, or another agent.

The correct behavior from readback-gate, and from future agents, would have
been to stop and ask:

> I understand that you use Claude Code and sometimes delegate work to Codex.
> Are we testing the `/delegate` handoff itself, or are we still testing
> readback-gate's effect on the agent that directly receives your prompt?

This is exactly the type of failure readback-gate exists to reduce: an agent
hears an ambiguous workflow detail, silently changes the target, and starts
implementing the wrong thing.

## Regression Seed

Use this as a seed case for future evaluation:

- User prompt shape: "I usually talk to Claude Code, then Claude delegates to
  Codex. Does that mean Claude Code context extraction matters?"
- Bad baseline behavior: assume `/delegate` is now the thing to test and start
  implementing delegate-specific artifacts without asking.
- Desired gated behavior: ask whether the target is `/delegate` itself or
  readback-gate behavior on the agent receiving the user's prompt.
- Expected label: `gated_better`.

## Operating Rule For Future Agents

When the user introduces a new tool, workflow, or agent name while discussing
measurement design, treat it as context, not as permission to pivot.

Before changing the implementation target, ask one clarification question unless
the user explicitly says to implement that new target.

For this project, "continue dual-run" means continue the measurement harness for
readback-gate's effect on AI-agent behavior, not invent a new product surface.
