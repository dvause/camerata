---
name: camerata-spec
description: Use when a fuzzy ask — basic requirements, a brainstorm, a feature request, or a confirmed audit finding list — must become a written, testable spec that `camerata-plan` can slice into worker runs. A SOLO playbook: the orchestrator interviews and writes; workers appear only in an optional read-only research fan-out. Triggers: "write a spec", "spec this out", "turn this brainstorm into a spec", "requirements to spec", "camerata-spec".
---

# Spec authoring (solo orchestration stage)

## Overview

`camerata-spec` *defines*, `camerata-plan` *slices*, `camerata-build` *executes*.
The hard part is converting fuzzy intent into TESTABLE acceptance criteria and
EXPLICIT non-goals; every ambiguity that survives the spec resurfaces mid-build
as a worker stall or a high-LOE dispatch. Spec-writing is judgment work, so the
orchestrator does it directly — dispatching cheap workers to write specs inverts
the thesis (planning matters more than typing).

## When NOT to use

- A spec already exists → go straight to `camerata-plan`.
- The change is trivial → just do it (or a single build worker).
- The real ask is defect-finding → `camerata-audit`.
- Nobody can answer the open questions AND there is no codebase to answer them
  from → stop; a spec built on guesses is worse than no spec.

## Inputs

- A brainstorm or requirements text from the user.
- For remediation specs: the confirmed-findings `report.md` of a
  `camerata-audit` run.
- For brownfield work: whatever codebase documentation already exists.

## Procedure

1. **Intake & classify.** Greenfield feature | brownfield change | remediation
   (seeded from a confirmed audit report). Identify the decision surface: what is
   genuinely undecided vs. merely unstated. Agree the output path with the user
   once, up front (default: `<target-repo>/docs/specs/<slug>.md` for brownfield;
   any user-named path for greenfield). The spec is handed to the human — NEVER
   auto-committed into a client repo.

2. **Research before grilling (brownfield only).** Never ask the user a question
   the code can answer. Consume existing artifacts first. If codebase facts are
   still missing, run the optional research fan-out (below).

3. **Grill the user — bounded.** Interview budget: at most 3 rounds, at most 5
   questions per round, highest-information questions first. Question rubric
   (cover all axes, skip the already-answered):
   - success criteria (what observable behavior proves done)
   - non-goals
   - users/actors and key scenarios
   - data-model deltas
   - integration surface and the exact interface names to freeze
   - quality bar (perf, security, accessibility)
   - human-only work (secrets, fixtures, live deploys, real-data migrations)
   - constraints (stack, conventions)
   - risk tolerance

   When the budget is spent or the user is unavailable, every unanswered question
   becomes an explicit line in the spec's Assumptions section marked PENDING —
   never a silent decision.

4. **Draft the spec(s)** from `templates/spec.md`. One spec per independently
   shippable unit; the splitting rule: if two halves could ship in either order,
   they are two specs.

5. **Make every acceptance criterion machine-checkable where possible** — each
   criterion names the command or test that proves it. A criterion no machine can
   check is tagged `[human check]` with who checks it and how. This is what lets
   `camerata-build`'s verification stay mechanical instead of judgment-bound.

6. **Self-check gate** (all must pass before handoff):
   - every success criterion has a named check
   - non-goals section is non-empty
   - human-only work is carved into P0/P-Final
   - frozen interface names are stated where later workers must import them
   - every open question is either answered in the Decisions log or PENDING in
     Assumptions
   - the spec contains NO worker assignments or run slicing (that is plan's job)

7. **Human gate.** The user reads the spec and approves it; record
   `Status: approved (<who>, <date>)` in the header. `camerata-plan` MUST NOT
   consume a spec whose status is draft. PENDING assumptions convert to APPROVED
   (or get answered) at this gate.

## Spec document skeleton

The contract with `camerata-plan`:

```markdown
# <Feature> — Spec
**Status:** draft | approved (<who>, <date>) · **Target repo:** <path | greenfield> · **Sources:** <brainstorm/report paths>

## Summary                      <!-- 3 sentences: what, for whom, why now -->
## Goals & success criteria     <!-- testable; each names its check command/test, or [human check] -->
## Non-goals                    <!-- explicitly out of scope -->
## Users & scenarios            <!-- actors + key workflows -->
## Design constraints           <!-- stack, conventions, perf/security/a11y bar -->
## Data & interfaces            <!-- data-model deltas; exact interface names to freeze -->
## Human-only work              <!-- P0 discovery/fixtures/secrets · P-Final deploy/migrations -->
## Risks & open questions
## Assumptions                  <!-- each marked APPROVED or PENDING -->
## Decisions log                <!-- grill answers, dated -->
```

Mapping to `camerata-plan`'s document: Goals & success criteria → plan's
"Sharpened goal + success criteria (testable)"; Design constraints → plan's
"Global constraints (every worker inherits)"; Human-only work → plan's
P0/P-Final; Data & interfaces → the foundation workers' Output/Interfaces blocks.

## Optional research fan-out (brownfield only)

Compose first: prefer existing documentation over new workers.

Otherwise dispatch AT MOST 2 read-only surveyors on the document-bus contract:
`commit: false`, exactly one `REPORT.md` at the worktree root,
`<runDir>/allow/<name>.allow` containing the single line `REPORT.md`, no git, LOE
low or medium. For codex surveyors add `gitMode: "ro"` to narrow the sandbox to
read-only.

**Host.** Engine calls are `camerata` MCP tools (`init_run`, `dispatch_worker`,
`worker_status`, `wait_workers`, `collect_findings`, `close_run`). In Claude
Code, run `camerata wait --project <p> --timeout-s 300` through the Bash tool
with `run_in_background: true`; in Codex, call `wait_workers` with
`timeoutS: 300` and re-call while it returns the timeout marker. Collect with:

```
collect_findings { project, file: "REPORT.md" }
```

Verify evidence refs against the real code before relying on them.

The client-repo consent gate applies IN FULL: dispatching a worker sends source
to a third-party model API, so record explicit consent in `<runDir>/progress.md`
before any dispatch. Committed secrets are visible at the base SHA — sweep first,
warn the owner about any sensitive location before dispatch, and write every
research goal so workers reference credential LOCATIONS only, never values.

When a research run dir exists, drop a copy of the finished spec there for the
engagement record, and close the run with `close_run { project }` once
`## Final summary` is written.

## Common Mistakes

| Mistake | Fix |
|---|---|
| Grilling the user about facts the code answers | Research first, then grill |
| "Works well" acceptance criteria | Every criterion names its check or is tagged `[human check]` |
| Spec contains worker slicing / run assignments | Describe WHAT and constraints; slicing is `camerata-plan`'s job |
| Silent assumptions | Assumptions section, PENDING until the human gate |
| One mega-spec for separable units | One spec per shippable unit (either-order rule) |
| Skipping the human gate | `camerata-plan` consumes only `Status: approved` specs |
| Unbounded interview | 3-round budget, then PENDING assumptions |
| Auto-committing the spec into a client repo | Hand the file to the human |

## Cross-References

- **REQUIRED next stage:** `camerata-plan` (then `camerata-build`).
- **Remediation specs** seed from `camerata-audit`'s `report.md` (confirmed
  findings only).
