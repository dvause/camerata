---
name: camerata-audit
description: Use when a strong planning model should orchestrate READ-ONLY auditor workers over a repo to produce findings files for a ranked report. No code changes, no fixes, no merges. Triggers on "audit this repo", "run camerata audit", "camerata-audit", "orchestrate a code audit", or multi-agent audits where charter, decomposition, and adjudication matter.
---

# Audit orchestration

You are the **orchestrator**. You own the charter, decomposition, adjudication,
and final ranked report. Auditors are cheaper and bounded. They read, reason,
and produce findings for you to judge.

This differs from `camerata-build`. Audit workers never modify the codebase and
nothing is ever merged. Worker READ scopes may overlap because that is harmless,
but every worker must have a **distinct rubric** so spend is not duplicated.

## Host

Engine calls are tools of the `camerata` MCP server: `init_run`,
`dispatch_worker`, `worker_status`, `wait_workers`, `collect_findings`,
`close_run`. Every tool takes `project`; the run directory comes back from
`init_run`.

- **Claude Code:** run `camerata wait --project <p> --timeout-s 300` through the
  Bash tool with `run_in_background: true`, so worker completion re-invokes you.
- **Codex:** call `wait_workers` with `timeoutS: 300` and re-call while it
  returns the timeout marker.

## When NOT to use

- A small diff: review it yourself.
- A single question about code.
- A repo you cannot check out.
- The real ask is to FIX things. That is a `camerata-build` run, possibly seeded
  by an audit report.

## Client-repo consent (prose gate, before any dispatch)

Dispatching a worker sends source to a third-party model API. For any repo you do
not own, record explicit consent in `<runDir>/progress.md` before the first
dispatch: who authorized it, when, and what scope. Committed secrets are visible
at the base SHA, so sweep for them first and warn the owner about any sensitive
location before dispatch. Write every auditor goal so workers reference
credential LOCATIONS only, never values. No consent line, no dispatch.

## The findings bus contract

- Every auditor is dispatched `commit: false` and must write EXACTLY ONE file:
  `FINDINGS.md` at its worktree root. Everything else is read-only.
- You write `<runDir>/allow/<name>.allow` containing the single line
  `FINDINGS.md` so the `worker_status` scope check can flag anything else.
- FINDINGS.md format: an H1 with the worker name and its rubric; then one
  `## F<n> — <short title>` section per finding with exactly these bold fields on
  their own lines: **Severity:** P1|P2|P3, **Where:** file:line (or file range),
  **What:** the defect, **Why it matters:** consequence, **Fix:** concrete
  recommendation, **Confidence:** high|medium|low; then a `## Coverage` section
  naming which assigned focus areas and subsystems were examined and which were
  not, with the reason, so a worker that skipped a focus area has to say so; then
  a final `## Verdict` section (overall assessment + top items). P1 = incorrect
  behavior/data loss/security; P2 = real defect with workaround or latent trap;
  P3 = robustness/clarity.
- `collect_findings { project }` copies each worker's `FINDINGS.md` from its
  worktree to the bus as `<runDir>/findings/<name>.findings.md` and returns the
  list. It warns per worker that produced none and fails only if NO worker did.
  Pass `file` to collect a differently-named output.
- Findings are PROPOSALS. You adjudicate every one against the real code before
  it can enter the report.

## Procedure

1. **Sharpen the audit charter.** Define scope (which code), rubric axes
   (correctness, concurrency, robustness, security/secrets, docs-vs-code drift),
   severity scale, and the INTENTIONAL INVARIANTS the target project has.
   Front-load those invariants in every auditor goal so they are checked rather
   than reported as bugs.

2. **Repo safety preflight.** Confirm the target is a git repo and run
   `git -C <repo> status --short`. Auditors read the COMMITTED state at the
   recorded base SHA via their worktrees. Uncommitted dirt in the target is
   invisible to them; record any dirt in `<runDir>/progress.md`.

3. **Decide the split.** Default 3 auditors; up to 8 when the scopes are
   genuinely disjoint. Record the justification in the progress log. Split by
   rubric axis or by subsystem. Read-scope overlap is fine; rubric overlap is
   waste. One auditor is often enough for a small repo.

4. **Init the run.** `init_run { project, repo }` returns `{runDir, baseSha}`.
   Fill the seeded `<runDir>/progress.md`: consent line, charter, criteria,
   severity scale, intentional invariants, and worker table. Project and worker
   names must be slugs using only letters, digits, `.`, `_`, and `-`; they must
   not start with `.` or contain `..`. Pass `resume: true` only when continuing
   the same repo at the same recorded base SHA.

5. **Write auditor goals.** One goal file per worker from
   `templates/auditor-goal.md` (keep ALL fields), passed as `goalFile`. For each
   auditor, write `<runDir>/allow/<name>.allow` with the single line:
   ```text
   FINDINGS.md
   ```
   No commitignore is needed: auditors never commit.

6. **Pick LOE per auditor, luna-first but honest.** `medium` is the sensible
   default because reading unfamiliar code and judging it needs real reasoning.
   Use `high` for security-critical or invariant-heavy targets; use `low` only
   for mechanical checklist sweeps. `backend: "claude"` gives the claude tiers if
   you want family diversity across auditors. Dispatch each with
   `commit: false`:
   ```
   dispatch_worker { project, name: "<auditor>", goalFile: "<path>", loe: "medium", commit: false }
   ```
   For codex auditors, `gitMode: "ro"` narrows the sandbox to read-only, the
   strongest containment available. It is refused with the claude backend, whose
   deny-wins tool precedence cannot express read-only git; there `commit: false`
   plus the goal's prohibition is the boundary.

7. **Monitor.** `worker_status { project }`. Scope must show only `FINDINGS.md`;
   anything else is an abort condition.

8. **Collect.** `collect_findings { project }`. If a worker wrote no
   `FINDINGS.md`, fall back to its final message in `<runDir>/logs/<name>.log`,
   the backup channel, and record that in the progress log.

9. **Synthesize by adjudicating, never by concatenating.** Verify each finding
   against the real code (confirm / reject / defer) using the adjudication
   calibration below, dedupe across auditors, rank by severity, and write the
   ranked report to `<runDir>/report.md` from `templates/report.md`. You are the
   gate: reject the speculative and the wrong. A finding that flags an
   intentional invariant is a rejection and a hint your charter under-specified
   the invariants.
   Two synthesis duties beyond the verdicts. (a) **Strength claims are findings
   in reverse.** A defense or quality claim from a worker's Verdict enters the
   report (or any downstream deliverable) as verified only when you re-traced it
   against the code and recorded the trace in `progress.md`; otherwise it stays
   attributed to the worker. (b) **Cluster confirmed findings into themes** in
   the report Verdict. A shared failure pattern is the most useful thing an audit
   can hand the client, and it only emerges at synthesis.

10. **Final report to the human.** Provide the ranked report location, counts by
    severity, top-3 actions, workers/models/branches used, and checks you ran
    yourself. Keep `<runDir>/progress.md` current throughout. If fixes are
    wanted, hand the confirmed findings to a `camerata-build` run; never fix
    from inside the audit. The report is handed to the human; never
    auto-committed into a client repo.

11. **Close the run.** Make sure `<runDir>/progress.md` has a `## Final summary`,
    then:
    ```
    close_run { project }
    ```
    The gate tears down the run's worktrees and its `agent/*` branches, archives
    any evidence as `archive/<name>.rejected.patch` and
    `archive/<name>.worktree.diff`, verifies zero residuals, and appends the
    `closed:` line to `progress.md`. `close_run { project, check: true }` is the
    stale-run detection entry point for a later session. The `findings/` copies
    and `report.md` live in the run dir and SURVIVE the close.

## Adjudication calibration

Per finding, against the real code:

- **CONFIRM** only when you can reproduce the reasoning yourself: open the
  file:line, state the failure scenario in one sentence, and check the claimed
  severity against the scale. Re-grade severity as part of confirming; auditors
  inflate. A P1 means incorrect behavior, data loss, or a security hole NOW;
  "could be bad someday" is P2 (latent trap) or P3.
- **REJECT** findings that flag a recorded intentional invariant (and record the
  charter gap), findings with no file:line, and findings whose claimed behavior
  you cannot reproduce by reading the code. A 30–50% rejection rate on cheap
  auditors is expected, not a crisis. Concatenating unverified findings is the
  actual failure.
- **DEFER** what is plausible but would take real investigation to prove and is
  not release-blocking. Deferred items ship in the report under their own
  heading, never silently dropped.
- **When unsure, DEFER; never CONFIRM.** The report's credibility is the
  deliverable; one confirmed-but-wrong finding costs more than five deferred true
  positives.

Every file:line in the report is checked by you before it ships. A citation you
did not open is not evidence.

How the verdicts should read:

| finding (abridged) | verdict | why |
| --- | --- | --- |
| P1 "path traversal via worker `name`" | REJECT | Read the guard first: the slug is validated (rejects `/`, `..`, leading `.`) before any path is derived from it. The attractive story dies at the actual validation order, so open the file before confirming. |
| P1 "dependencies not pinned" | REJECT | Charter invariant: "single-user dev tool, deps reviewed on update." Recorded as a charter note. |
| P2 "TOCTOU between status write and read" | DEFER | Single writer today; proving it needs a concurrency harness. Ships as deferred. |
| P3 "duplicated helper across two files" | CONFIRM | Both file:line refs check out; trivial to state the drift risk. |

## Abort conditions (hard stops → stop, report, ask)

- An auditor writes anything beyond `FINDINGS.md` (scope violation).
- An auditor edits or "fixes" code.
- A worker failure you cannot explain.
- Suspicious network, dependency, credential, auth, production, or destructive
  filesystem behavior in a log.

## Cross-references

- **Fixing confirmed findings:** `camerata-build`, seeded by this report.
- **Turning a report into a spec first:** `camerata-spec` (remediation class,
  confirmed findings only).
