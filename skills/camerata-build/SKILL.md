---
name: camerata-build
description: Use when a strong planning model should orchestrate bounded worker agents (codex by default, claude via backend) to build or refactor something. You own the goal, decomposition, dispatch, and synthesis while the workers do bounded implementation in isolated git worktrees. The build/refactor playbook of the camerata engine. Triggers on "orchestrate workers", "dispatch codex workers", "run camerata build", "camerata-build", or multi-agent builds where planning matters more than typing.
---

# Build orchestration

You are the **orchestrator**. Use your full planning judgment: architecture,
decomposition, tradeoffs, quality bar, integration. Workers are cheaper and
narrower; they execute bounded tasks in isolated worktrees. What you add is
slowing down at the top and judging the merge, not parallelism for its own sake.

## Host

Engine calls are tools of the `camerata` MCP server: `init_run`,
`dispatch_worker`, `worker_status`, `wait_workers`, `integrate_branch`,
`escalate_task`, `close_run`, `cleanup_run`. Every tool takes `project`; the run
directory comes back from `init_run`. `dispatch_worker` returns as soon as the
worker is launched; only `wait_workers` blocks.

- **Claude Code:** run `camerata wait --project <p> --timeout-s 300` through the
  Bash tool with `run_in_background: true`, so worker completion re-invokes you.
- **Codex:** call `wait_workers` with `timeoutS: 300` and re-call while it
  returns the timeout marker.

Calibration memory lives at `~/.camerata/calibration/build.md` (`$CAMERATA_HOME`
overrides the directory).

## When NOT to use

- Tiny tasks (orchestration overhead > the work). Just do it directly.
- Repo has no meaningful test/build path.
- You cannot define non-overlapping worker scopes.
- Anything touching secrets, production, deploys, or migrations without human review.

If parallelism does not clearly help, do the task yourself and run one review
pass. Agent confetti is still confetti.

## Procedure

Track a todo item per step.

1. **Sharpen the goal.** Rewrite the fuzzy ask into a specific, testable, scoped
   goal with concrete success criteria. Identify the real risks (architecture,
   integration, UI quality, data model, edge cases, perf, tests, ambiguity).

2. **Repo safety preflight.** Confirm the target is a git repo. Run
   `git -C <repo> status --short`; it must come back clean, or record the
   pre-existing dirt. Never run workers on `main`/`master` directly.

3. **Decide the split.** Default 3 workers; up to 8 when the scopes are
   genuinely disjoint. Record the justification in the progress log. Split by
   *independent* work, not arbitrary sections. Pick worker types from
   `templates/worker-goal.md`: implementation, design/polish, verifier,
   (reviewer only if the diff is non-trivial). Assign **non-overlapping**
   ownership; never let two workers edit the same files, deps, migrations,
   generated code, or global config.

4. **Init the run.** `init_run { project, repo }` returns `{runDir, baseSha}`.
   Fill in the sharpened goal, success criteria, and worker table in the seeded
   `<runDir>/progress.md`. Project and worker names must be slugs using only
   letters, digits, `.`, `_`, and `-`; they must not start with `.` or contain
   `..`. Re-running the same project slug refuses to mix stale workers into a
   new run. Pass `resume: true` only when continuing the same repo at the same
   recorded base SHA; resume verifies both.

5. **Write worker goals.** Before writing any goal file, read the matching
   calibration rules from `~/.camerata/calibration/build.md`, the entries whose
   heading ends in `worker-goal` and `plan-slice`, and paste their `rule:` lines
   verbatim into each goal's *what to avoid* / constraints block. A missing or
   empty memory file is normal; proceed.

   One goal file per worker from `templates/worker-goal.md` (keep ALL fields:
   mission, scope, allowed/forbidden, inputs, output, tests, definition of done,
   what to avoid, commit). Pass its path as `goalFile`; `dispatch_worker` copies
   it to `<runDir>/goals/<name>.goal.md`.

   Optionally write `<runDir>/allow/<name>.allow` (one glob per line) so scope
   checks work. Patterns are matched against the full repo-relative path with
   `*` crossing `/`; blank lines and `#` comments are skipped, and trailing
   whitespace and CR are trimmed. Write it before you read `worker_status`; with
   no allow file the scope check reports `null`, not "clean". For a
   `commit: true` worker whose build/tests spew artifacts, also write
   `<runDir>/commitignore/<name>` (no extension) so the launcher's staging skips
   them.

6. **Pick the model per worker via `loe` (luna-first).** You are the expensive
   planner; the workers should be as cheap as the task allows. Choose the level
   of effort for each worker from how much judgment its goal still requires
   *after* your decomposition, not the raw size of the feature:
   - **`loe: "low"` → `gpt-5.6-luna` at high reasoning.** The default you should
     reach for is a small model thinking hard. Use it whenever the goal is
     simple, mechanical, or you have already supplied a clear, well-specified
     plan a small model can just follow (boilerplate, tests from a spec, a
     localized edit, a rename, wiring described step by step). Reasoning tokens
     at nano pricing are nearly free, and the effort bump takes the risk out of
     the tier most workers should run at.
   - **`loe: "medium"` → `gpt-5.6-terra`.** Moderate ambiguity or breadth the
     worker must resolve itself.
   - **`loe: "high"` → `gpt-5.6-sol` at high reasoning.** Frontier capability for
     genuinely complex, architectural, or ambiguous work. Reserve it; prefer to
     instead *sharpen the plan* and drop to a lower LOE.
   - **`loe: "xhigh"` → `gpt-5.6-sol` at xhigh reasoning.** Rare frontier-effort
     slices only: ambiguous architecture, gnarly synthesis, or high-risk judgment
     that cannot be decomposed smaller.

   If you find yourself dispatching everything at high LOE, decompose harder. A
   well-planned slice should be runnable at `low`. `low` is the start rung by
   default and needs no justification. Record each worker's start rung in the
   progress log, with a one-line reason for any `medium`+ start or competition
   flag. The tiers are the default vocabulary, not a cage. When the planned work
   warrants it, combine `model`/`reasoning` off-ladder. Model buys capability,
   reasoning buys thinking depth, and the two axes are independent. Examples:
   `model: "gpt-5.6-luna", reasoning: "medium"` for quick mechanical slices where
   latency matters more than depth, `model: "gpt-5.6-terra", reasoning: "xhigh"`
   for deep-but-narrow work (one hard function, no breadth). Record why in the
   progress log when you go off-ladder; prefer a tier when either fits, since
   tiers keep the manifest and cross-run stats comparable. On a model-not-found
   error the launcher auto-falls back to the backend's fallback model, and
   `worker_status` displays the effective model alongside the requested one.

   **Backend.** Default to `codex`. Pick `backend: "claude"` when the task
   benefits from Claude-family strengths, when you want to diversify model
   families across a run (for example, a reviewer on a different family than the
   builder), or when codex quota or availability is the constraint. Codex tiers are the
   ladder above (fallback `gpt-5.6-terra`); claude tiers are `low` → `haiku`/high,
   `medium` → `sonnet`/medium, `high` → `opus`/high, `xhigh` → `opus`/xhigh,
   fallback `sonnet`. All eight are config-overridable in `~/.camerata/config.json`. Keep
   the same luna-first discipline: `haiku` and `gpt-5.6-luna` are the goal for
   well-specified slices. Model-not-found fallback and `worker_status` reporting
   behave the same way for both backends. Claude workers get shell but git stays
   denied by the backend's tool guard. On native Windows the codex backend
   refuses (no sandbox); `camerata doctor` reports what this machine supports.

   Dispatch each worker:
   ```
   dispatch_worker { project, name: "builder", goalFile: "<path>", loe: "low", commit: true }
   ```
   Workers never run git themselves. With `commit: true` the launcher commits the
   worker's changes on its branch after the driver finishes (reliable, since it
   runs outside the sandbox); with `commit: false` it leaves them in the worktree
   for you to review and commit. You review the diff before merging regardless.

7. **Monitor.** `worker_status { project }` returns per-worker state, model,
   diffstat, untracked files, and scope violations, plus stale-pid detection and
   any ledger-only rows (a dispatch that died in preflight still spent budget).
   Watch for the abort conditions below; status carries the `reason` and `diff`
   fields the failure table keys off.

8. **Synthesize; never concatenate worker outputs.**
   - Read every worker log (`<runDir>/logs/<name>.log`) and its worktree diff.
   - **Independently verify**: re-read changed source and run the tests yourself.
     Never trust a worker's self-reported success: workers lack project context
     and will overstate or invent. After verifying each worker branch,
     record `verdict: fixable | reject` plus a one-line reason per branch in
     `<runDir>/progress.md`'s integration log. Reject only when the branch fails
     a mechanical gate (battery red on the branch, vacuous differential check, or
     scope violation) or when repair would exceed a fix worker's bounded scope;
     everything else is fixable. `fixable` → integrate; findings flow to the
     post-integration review loop unchanged. `reject` → the branch is archived
     (`archive/<name>.rejected.patch` at close) and the task re-dispatched as
     `<task>-a<n+1>` per the rejected-diff row, and it consumes retry budget. The
     verdict applies pre-merge only; the post-integration review→fix loop keeps
     its own 2-pass cap and escalate-to-human rule.
   - Compare tradeoffs, resolve conflicts, reject weak/speculative changes, keep
     the best parts.
   - Integrate **one branch at a time** into `integration/<project>`:
     ```
     integrate_branch { project, branch: "agent/<name>", mode: "review" }   // diffstat + commits vs the recorded base
     integrate_branch { project, branch: "agent/<name>", mode: "merge" }    // --no-ff merge into integration/<project>
     ```
     The base SHA is the one recorded at init; you never pass it. Merge refuses
     while the target repo has uncommitted changes to *tracked* files; untracked
     files do not block, and git itself refuses to clobber one. On a conflict the
     merge stops and names the repo to resolve in. Run the relevant tests after
     **each** merge.
   - Autoreview the integrated result. For a **trivial** integrated diff, review
     it yourself and resolve or explicitly waive each finding. For a
     **non-trivial** diff, run the **Review→fix loop** below instead of reviewing
     solo. Risk flags force the non-trivial tier regardless of diff size:
     dependency or lockfile changes, new network calls, credential or auth code,
     CI or global config, or a diff touching more than 8 files or 400 changed
     lines.
   - Mutation testing is not part of the engine. When a diff touches
     security-relevant executable code and the repo has a mutation tool, run it
     yourself and adjudicate survivors: default severity P2, P1 on
     security-relevant paths, reject equivalent mutants. Record the skip in the
     progress log otherwise.
   - Polish against the original mood/quality bar.

9. **Final summary.** Every outcome ends the same way: merged, partially merged,
   fully rejected, or aborted. Write `## Final summary` in `<runDir>/progress.md`
   with what happened; output location; branches and worktrees used; commits
   created; checks run with **actual** results; review findings
   handled/waived/deferred; known limitations; and the outcome. Keep
   `progress.md` current throughout; the close gate requires that heading.

10. **Promote calibration (before teardown, while verdicts are in context).**
    For each REJECT where the reviewer goal under-specified an invariant, and
    each DEFER or CONFIRM that revealed a reusable rule, apply the admission test
    below. Write passing candidates to `~/.camerata/calibration/build.md`; bump
    the `confirmed:` count on any entry this run re-confirmed; delete any entry
    this run falsified and note the deletion in `progress.md`. Graduate anything
    reaching 3 confirmations into this SKILL.md and delete the entry. Most runs
    produce zero entries. That is the expected outcome, not a failure.

11. **Prepare the PR; never open it unasked.** After the review→fix loop
    converges and before close: push `integration/<project>` with the host's own
    git tooling, write the PR title and body to `<runDir>/pr.md`, and show the
    draft. Open the PR only on explicit human approval, using the host's GitHub
    tooling. With no remote configured, stop after the draft. Preparing is
    yours; publishing is the human's.

12. **Close the run through the gate.** **A run is not over until `close_run`
    succeeds.**
    ```
    close_run { project }
    ```
    The gate asserts the `## Final summary`, archives rejected-branch patches and
    dirty worktree diffs to `<runDir>/archive/` as `<name>.rejected.patch` and
    `<name>.worktree.diff`, tears down the run's worktrees and its manifest-named
    `agent/*` branches, verifies zero residuals, and appends the usage and
    `closed:` lines to `progress.md`. `close_run { project, dryRun: true }` shows
    what it would do. In a later session, start stale-run recovery with
    `close_run { project, check: true }`, which reports residuals without
    touching anything. `cleanup_run` is recovery-only after a failed close, not
    the normal runbook path: it never touches a checked-out branch, `main`,
    `master`, `integration/*`, or paths outside the run dir.

## Review→fix loop (post-integration, advisory)

Run this inside step 8 in place of solo autoreview **when the integrated diff is
non-trivial**; skip it (review yourself) when it is trivial. A dedicated frontier
**reviewer worker** is a strong first pass, never an authority. The rule does not
bend. A reviewer is a worker too, so **you adjudicate every finding against the
real code** before any fix is dispatched. The reviewer cannot
merge or force a change; only you can. Worker names are single-use within a run,
so `reviewer-r<r>` and `fix-r<r>` are required iteration suffixes, not a naming
convention you can reuse or skip.

- **Topology: post-integration.** Review the merged `integration/<project>` diff
  vs the recorded base, which is what actually ships, so one frontier pass also
  catches cross-worker integration bugs. Per-branch review is the exception,
  only for an individually large or risky branch.
- **Bounded: cap = 2 reviewer passes.** Frontier spend is the cost and an
  unbounded review↔fix cycle is the risk. Past the cap, STOP and escalate to a
  human rather than looping.
- **Re-verification is orchestrator-by-default.** After a fix you run the tests
  and review the fix diff yourself; re-dispatch the reviewer only for a
  *substantial* fix. Total reviewer passes stay capped at 2 regardless.

The loop (round `r`, starting at 1):

1. Dispatch ONE reviewer (`templates/worker-goal.md` → **Reviewer worker**),
   frontier / `loe: "high"`, `commit: false`, on a worktree off the integration
   branch (`base: "integration/<project>"`).
   Pick the reviewer's backend cross-model by default: the family that did NOT
   build the majority of the integrated changes (codex builders →
   `backend: "claude"`; claude builders → codex). Record an exception and its
   reason in the progress log.
   The reviewer is *instructed* to only read and report, but a codex worker's
   sandbox is `workspace-write` and a claude worker has no filesystem sandbox at
   all. `commit: false` is what contains it; any stray edits stay uncommitted
   and are discarded when the worktree is removed. It cannot run git, so embed
   the integrated diff in its goal file:
   ```sh
   git -C <repo> diff <baseSha>..integration/<project> > <runDir>/integrated-r<r>.diff
   ```
   ```
   dispatch_worker { project, name: "reviewer-r<r>", goalFile: "<path>", loe: "high",
                     backend: "claude", base: "integration/<project>", commit: false }
   ```
   Rubric: correctness | scope adherence | **security/secrets** (leaked
   credentials, injection, unexpected dependency or network additions, a
   client-work requirement) | tests | **spec conformance** (unimplemented
   requirements and unrequested scope creep vs the sharpened goal) | **red team**
   (gaps between what tests assert and what the goal promises: error paths,
   degradation paths, missing-dependency fallbacks).
   Before writing the reviewer goal, read the `reviewer-goal` entries in
   `~/.camerata/calibration/build.md`, paste each `rule:` line into the goal, and
   enumerate the recorded invariants in force for this run (from the repo's
   CLAUDE.md/AGENTS.md and the charter) as authorities the reviewer must not
   contradict. A missing or empty memory file is normal; proceed.
2. **Record** the reviewer's findings (from its final message in
   `<runDir>/logs/reviewer-r<r>.log`) to `<runDir>/review-r<r>.md`. The reviewer
   can't write the run dir, so you do.
3. **Adjudicate** each finding against the real code: **confirm / reject /
   defer**. Reject the speculative and the wrong; you are the gate.
4. **No confirmed findings → DONE.**
5. Else dispatch ONE **fix worker** (`templates/worker-goal.md` → **Fix worker**)
   on a fresh worktree off the integration branch, scoped to the **confirmed**
   findings only, `commit: true`. Then verify it yourself, running the tests and
   reviewing the fix diff, and merge it with `integrate_branch`. You handle any
   fix that needs **git itself**, such as untracking already-committed build
   artifacts (`git rm --cached`) or reverting a file. Workers never run git, so a
   worker can add a `.gitignore` but cannot un-commit what is already tracked.
6. `r++`. If `r > 2` → **STOP + escalate to a human**. Otherwise loop, but
   re-dispatch the reviewer only if the fix was substantial (per re-verification
   above).

### Adjudication calibration

Verdict rules, applied per finding after reading the real code:

- **CONFIRM** only when you can point at the defect in the diff and state the
  failure scenario in one sentence (these inputs/this state → this wrong
  outcome). If you cannot state that sentence, it is not confirmed.
- **Severity on CONFIRM.** Every confirmed finding carries P1|P2|P3. P1
  (must-fix correctness/security) blocks the merge until fixed and
  re-verified; a security-flavored P1 stays a hard abort. P2 dispatches a fix
  worker within the 2-pass cap. P3 ships as a deferred finding.
- **REJECT** when the finding contradicts a recorded intentional invariant
  (CLAUDE.md, the charter, the goal file), and note which invariant the reviewer
  goal under-specified; when it has no file:line; or when the claimed behavior
  does not reproduce when you read or run the code. Rejection is normal, not
  failure.
- **DEFER** when plausible but not provable within ~10 minutes of reading, or
  real but outside this run's scope. Deferred findings ship in the final report
  under their own heading, never silently dropped.
- **When unsure after checking the code, DEFER; never CONFIRM.** A wrongly
  dispatched fix costs a worker round plus re-verification; a deferred true
  positive costs one report line.

How five typical verdicts should read:

| finding (abridged) | verdict | why |
| --- | --- | --- |
| "the merge guard ignores untracked files, a bug" | REJECT | Recorded invariant: test artifacts must not block merges; git still refuses to clobber. Add the invariant to the next reviewer goal. |
| "worker commit swept `__pycache__/` in via `git add -A`" | CONFIRM | Reproduced with `git show --stat`. Fix: commitignore + orchestrator-run `git rm --cached`. |
| "error handling could be more robust" (no location) | REJECT | No file:line, no failure scenario, so it is not actionable as written. |
| "possible race between status write and read" | DEFER | Plausible; single writer today; not a merge blocker. Ships as deferred. |
| "new outbound `curl` to an unknown host in the diff" | CONFIRM → ABORT | Matches an abort condition. Stop the run and report; do not dispatch a fix. |

## Failure recovery

Classify a failed worker from status, scope, and verification evidence. Record
the classification in the next dispatch's `policy` value.

| class | detected by | attempt 2 (retry 1) | attempt 3 (retry 2, last) | then |
|---|---|---|---|---|
| empty-diff | `done` + `diff: "empty"` on a goal requiring edits | LOE+1, tightened contract, same family | LOE+1 + family switch, tightened | escalate |
| rejected-diff | pre-merge verification fails: battery red on the branch, vacuous differential check (new tests pass at base), or `verdict: reject` | LOE+1, same family; goal embeds the rejection evidence | family switch at `loe: "high"` | escalate |
| spawn-crash | `failed` with `reason: "spawn-crash"` (any nonzero driver exit that is not a timeout; `git-add`/`git-commit` treated the same) | re-dispatch same goal, same family, same LOE (transient) | family switch, same LOE | escalate |
| contract-violation | scope violations from `worker_status`, or a missing required output file | narrowed allow + violation evidence in the goal, same LOE, same family | family switch, same LOE | escalate |
| tests-fail-at-base | you run the battery at the recorded base SHA and it is red | — | — | **escalate immediately, no retry** |
| timeout | `failed` with `reason: "timeout"` | narrower goal, same or lower LOE, same family | family switch, still no LOE bump | escalate |

The axis rule behind the table: capability failures (empty-diff, rejected-diff)
climb LOE; behavioral and environmental failures (spawn-crash,
contract-violation, timeout) get contract fixes and family switches, never more
model. Timeout never LOE-bumps, since higher reasoning is slower. Vacuous
differential checks are rejected-diff, not contract-violation. Tests that assert
nothing are a capability failure.

Standing rules:

- The budget is 3 dispatches per task (initial + 2 retries), spendable serially
  as retries or in parallel as a competition; the engine enforces it through the
  recovery ledger and refuses the fourth. Fix workers (`fix-r<r>`) stay outside
  this budget, bounded by the review loop's 2-pass cap.
- The first retry stays in-family and the last retry switches family; LOE moves
  per the table, and an LOE bump accompanies a tightened goal; it never
  substitutes for one. A retry goal byte-identical to its predecessor is a review
  flag, except for a `spawn-crash` re-dispatch, which is intentionally identical.
- Policy strings use `loe-bump:<from>→<to> reason=<class>` for ladder retries and
  `compete:2 <fam>+<fam>` for competitors. Free text stays legal; the convention
  is what exemplars check for.
- `tests-fail-at-base` and security-flavored violations escalate immediately with
  no retry. Security remains a hard abort under the section below.
- A retry's diff gets identical independent verification to a first-pass diff:
  full battery, differential check, non-empty diff, and scope check. Never merge
  a retry on self-report.
- Use fresh-dir isolation and never forced deletion. List a stuck path for the
  human; do not delete it harder.
- Re-slicing a failed task is allowed only after writing its escalation report.

Retry names are `<task>-a<n>` for `n ≥ 2`, dispatched with
`task: "<task>", attempt: <n>, policy: "<short-reason>"`. Each worker carries a
`timeoutS` (default 1800, snapshotted per run at init); the engine kills a
timed-out worker with its process tree and lands it as `failed` with
`reason: "timeout"`. The
engine refuses over-budget dispatches; that refusal is the signal to escalate.

Escalate with `escalate_task { project, task }`, which writes
`<runDir>/escalation-<task>.md` with every attempt and its archived diff.
Replace the `TODO(orchestrator)` marker with a concrete recommendation, list the
escalation in the final summary, continue independent tasks, and halt dependents.

## Competition (opt-in, plan-flagged)

Competition is the retry budget spent in parallel. It is opt-in per task and
flagged in the plan doc with a recorded one-line reason. Never use it for
mechanical, fully-dictated slices.

Use exactly two competitors, named `<task>-c1` and `<task>-c2`, with the same
goal file. Dispatch both with `task: "<task>"` so each writes one ledger row,
using two of the three dispatches and leaving one escalation rung in reserve.
Launch `<task>-c1` with `attempt: 1`, confirm its ledger row exists, then launch
`<task>-c2` with `attempt: 2`. The engine's attempt guard is sequential, so the
launches stagger even though the workers run concurrently. Cross-family is the
default; same-family competition needs a recorded reason. Both start at the
task's start rung. Use the policy string `compete:2 <fam>+<fam>`.

Give both diffs identical independent verification: full battery, differential
check, non-empty diff, and scope check. One survivor proceeds as a normal single
branch. Zero survivors leaves the final dispatch: attempt 3, named `<task>-a3`.
Classify per the failure table using the more informative failure, taking the
attempt-3 cell with LOE computed from the start rung as if the skipped attempt-2
rung had been climbed.

When two competitors survive, select in this order: (1) scope adherence, (2)
mutation score when a test battery exists, (3) smaller diff, (4) orchestrator
judgment on approach. Use a comparative reviewer worker (`commit: false`, both
diffs embedded in its goal) only when the mechanical discriminators tie and the
approaches genuinely differ.

The winner merges via `integrate_branch`; the close gate archives the loser.
Salvaging a loser's better tests is a normal fix worker with the loser's patch
quoted in the goal.

## Calibration memory

`~/.camerata/calibration/build.md` holds **rules you paste into the next run's
goal files**, not notes, not a journal. Fixed four-line entries:

```
## BLD-007 · reviewer-goal
rule: Name recorded invariants explicitly in the reviewer goal; cite CLAUDE.md and the charter as authorities the reviewer must not contradict.
trigger: Reviewer flagged a deliberate clean-tree guard as a defect; REJECTED against a recorded invariant.
confirmed: 2 runs (last 2026-08-04)
```

The heading is `## <ID> · <applies-to>`, ID monotonic and never reused.
Applies-to is exactly one of `worker-goal`, `reviewer-goal`, `plan-slice`. An
entry needing two slugs is two entries. `rule:` must be paste-ready verbatim; if
you can't phrase it that way, you have an observation, not a calibration.

**Admission test. All three must pass, or don't write it:**

1. **Would it have changed an artifact?** If following the rule wouldn't have
   altered a goal file, a plan slice, or a charter, it isn't calibration.
2. **Is it repo-agnostic?** Needs a client name or a path → not calibration.
3. **Is it absent from this SKILL.md?** If the playbook already says it, the
   lesson is "you didn't follow your own playbook". Fix the adherence, don't
   record the rule.

**Sanitization (mechanical, because the file gets shared).** If the `rule:` or
`trigger:` line contains a `/`, or a proper noun that isn't a tool name, stop.
That's engagement record. No client names, no repo paths, no code snippets.

**Lifecycle.** 1 run = candidate, expires if not re-confirmed within 10 runs. 2
runs = confirmed, read on every run. 3+ runs = **graduate**: write the rule into
this SKILL.md and delete the entry. Graduation is the point. A rule confirmed
three times is playbook, and promoting it means every future run gets it whether
or not the memory read happens.

**Strike rule.** Every entry is a falsifiable prediction. A run where you
followed it and the failure recurred anyway **deletes** the entry; record the
deletion in that run's `progress.md`. Entries are never amended into hedged
mush; they are right, or they are gone.

**Cap: 20 entries, hard.** Hitting it is a discipline problem, not a capacity
problem. Evict lowest `confirmed`, then oldest `last`.

## Abort conditions (hard stops → stop → final summary → close → ask)

- Dirty unexpected files outside an assigned worktree.
- A worker edits forbidden paths (scope violation in `worker_status`).
- A worker cannot explain failing tests.
- Repeated merge conflicts between branches.
- Unbounded refactor beyond assigned scope.
- Suspicious dependency, credential, auth, network, production, or destructive
  filesystem changes.

On any hard stop, stop dispatching and integrating, write the `## Final summary`
with the abort reason, run `close_run { project }`, then ask the human. Do not
preserve evidence by leaving branches or worktrees behind; the close gate
archives rejected patches and dirty diffs to the run dir before teardown.

## Cross-references

- **Plan first for anything non-trivial:** `camerata-plan` slices the spec into
  dependency-ordered runs of non-overlapping workers.
- **Spec first when the ask is fuzzy:** `camerata-spec`.
- **Defect-finding, not fixing:** `camerata-audit`.
