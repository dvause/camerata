# ADR 0001: Trio orchestration is a playbook profile, not an engine feature

**Status:** accepted (Dave, 2026-08-24)

## Context

We wanted a run shape that splits author from judge across model families: a
codex frontier orchestrator (`gpt-5.6-sol`), luna-first builders
(`gpt-5.6-luna`), and Claude's strongest model as independent advisor and
evaluator. The engine already had everything mechanical: skills run unchanged on
Codex, `dispatch_worker` accepts `backend`/`model`/`reasoning`/`base` per call
with explicit args beating the tier config, and `escalate_task` already
materializes diffs into files a later worker can consume.

A draft spec explored a **per-branch pre-merge gate**: an evaluator verdict
(MERGE/FIX/REJECT) required before each `integrate_branch`. We abandoned that
shape. The build playbook's post-integration review topology is a deliberate
decision — one frontier pass over the merged result also catches cross-worker
integration bugs, and per-branch review doubles frontier spend for less
coverage. A second verdict vocabulary beside CONFIRM/REJECT/DEFER would also
have been a drift surface.

## Decision

Trio orchestration is an **opt-in profile of `camerata-build`** — prose and a
template, zero engine changes:

- The Review→fix loop's reviewer is pinned off-ladder to
  `backend: "claude", model: "claude-fable-5", reasoning: "high"`. Topology
  stays post-integration.
- A **plan gate** (new): an advisor worker reviews the worker table before the
  first dispatch; skipped for runs of ≤2 workers.
- An **escalation advisor** (new): consumes `escalation-<task>.md` at
  `reasoning: "xhigh"` and proposes the rewritten goal or a family switch; the
  orchestrator endorses before it lands.
- The claude tier table is unchanged. The strongest-model pin is an explicit
  `model` arg, because tiers are shared vocabulary for cross-run stats and the
  pin is a role choice, not a new rung.

Verified 2026-08-24 on this machine: `claude -p --model claude-fable-5
--effort xhigh` completes headless (the driver's exact spawn shape).

## Consequences

- The model id `claude-fable-5` lives in playbook prose and will age with the
  model family; the orchestrator can substitute the current strongest claude
  model without any repo change, since it is an explicit arg.
- Advisor/evaluator spend rides the Claude subscription; builder spend stays on
  cheap codex tiers.
- The advisor is confined exactly like any claude worker (cwd + goal preamble +
  launcher-owned commits + orchestrator review, per the v1 confinement
  decision); `commit: false` keeps stray writes out of history.
- The draft spec (`docs/specs/trio-orchestration.md`) is deleted with this ADR
  per the repo doc policy: shipped work keeps its *why* here, not in a spec.
