# Worker goal templates

Copy one block into a goal file and pass its path to `dispatch_worker` as
`goalFile`; the engine copies it to `<runDir>/goals/<name>.goal.md`. Every worker
goal MUST keep all fields — they are what keep the worker bounded. Optionally
also write `<runDir>/allow/<name>.allow` (one glob per line) so `worker_status`
can flag out-of-scope edits.

Worker names are single-use per run; when re-dispatching a role across
iterations, suffix the name (`reviewer-r2`, `fix-r2`, ...).

> The `Commit:` field signals the **launcher's** behavior (`commit: true|false`).
> Workers never run git themselves; with `commit: true` the launcher commits the
> worker's changes on its branch after the driver finishes. The launcher also
> applies an optional `<runDir>/commitignore/<name>` at staging time to keep
> stray artifacts out of that commit.

---

## Implementation worker

```text
Mission: Implement [BOUNDED FEATURE] for [PROJECT].

Scope:
- Allowed: [FILES/DIRS]
- Forbidden: [FILES/DIRS, plus deps/lockfiles/migrations/generated/global config]

Inputs/context:
- [RELEVANT EXISTING CODE, APIS, CONVENTIONS]

Expected output:
- [SPECIFIC FILES/BEHAVIOR]

Expected tests/checks:
- Run: [TARGETED TEST COMMAND(S)]

Definition of done:
- [CONCRETE, TESTABLE CONDITIONS]
- No placeholders, fake implementations, or unfinished stubs.

What to avoid:
- Changing dependencies, migrations, generated files, or global config.
- Touching files outside Allowed scope.
- Broadening the design without reporting back.

Commit: [yes|no — matches the dispatch commit flag]
Write a short results summary as the final message: what you did, files changed,
commands run with their actual output, and anything you could not finish.
```

---

## Design / polish worker

```text
Mission: Review and improve the visual/interaction direction for [THING] in [PROJECT].

Scope:
- Allowed: [STYLE/COMPONENT FILES]
- Forbidden: [LOGIC/DATA FILES, deps, global config]

Focus on:
- Mood: [MOOD]
- Visual details: [VISUAL DETAILS]
- Motion/interaction: [BEHAVIOR DETAILS]
- Accessibility and responsive behavior

Expected output:
- Concrete recommendations, ranked.
- Safe code/CSS changes within Allowed files only.

Expected tests/checks:
- [BUILD/LINT COMMAND]; screenshots or verification notes if possible.

Definition of done:
- Recommendations are specific and actionable; any applied changes build cleanly.

What to avoid:
- Refactoring logic, changing data flow, or editing outside Allowed scope.

Commit: [yes|no]
Final message: recommendations + what you changed + checks run with output.
```

---

## Verifier worker

```text
Mission: Verify [THING] in [PROJECT] against its success criteria.

Scope:
- Allowed: read everything; write ONLY test files in [TEST DIR].
- Forbidden: changing production/source code (report bugs instead).

Check:
- Build/test command: [COMMAND]
- Runtime command: [COMMAND]
- Edge cases: [LIST]
- Accessibility/performance basics: [LIST]

Expected output:
- Commands run and their ACTUAL results.
- Bugs found, with file:line and a recommended fix.
- A clear verdict: safe to integrate or not.

Definition of done:
- Every success criterion is checked with real output, not assumptions.

What to avoid:
- "Fixing" source code; that is the implementation worker's job.
- Reporting success without showing the command output that proves it.

Commit: [usually no]
Final message: commands, actual results, bugs, verdict.
```

---

## Reviewer worker

```text
Mission: Review the integrated diff of [PROJECT] (the merged integration/[PROJECT] branch vs the recorded base SHA) and report findings.
The reviewer is advisory only: the orchestrator adjudicates every finding against the real code, and the reviewer is never authoritative or able to merge or force a change.

Scope:
- Allowed: read everything. You are READ-ONLY — do not modify any file. (You are
  confined to your worktree and cannot write the run dir; the orchestrator
  records your findings to the bus.)
- Forbidden: changing ANY source/code/tests; "fixing" anything; running git.

Review rubric:
- Correctness: [CHECK THE ACTUAL BEHAVIOR CHANGE]
- Scope adherence: [CHECK WHETHER WORKERS STAYED IN BOUNDS]
- Security/secrets: [CHECK FOR LEAKED CREDENTIALS, INJECTION, UNEXPECTED DEPENDENCY OR NETWORK ADDITIONS]
- Tests: [CHECK THE TEST COVERAGE AND ANY MISSED OR BROKEN CHECKS]
- Spec conformance: [CLAUSE-BY-CLAUSE VS THE SHARPENED GOAL/SPEC — UNIMPLEMENTED REQUIREMENTS AND UNREQUESTED SCOPE CREEP]
- Red team: [GAPS BETWEEN WHAT TESTS ASSERT AND WHAT THE GOAL PROMISES — ERROR PATHS, DEGRADATION PATHS, MISSING-DEPENDENCY FALLBACKS]

Inputs/context:
- [INTEGRATED DIFF AGAINST THE BASE SHA]
- [RELEVANT FILES, CALLERS, TESTS, AND THE RECORDED INVARIANTS IN FORCE]

Expected output:
- Report ALL findings in your FINAL MESSAGE. (The orchestrator records them to the
  bus at <runDir>/review-r<r>.md — you cannot write outside your worktree.)
- Each finding includes file:line, severity, why it matters, and a recommended fix.
- A clear verdict.
- No authority claim; findings are proposals only.

Expected tests/checks:
- [RE-READ THE DIFF, RELATED CODE, AND ANY RELEVANT TESTS]
- [VERIFY EACH RUBRIC AXIS AGAINST THE ACTUAL CHANGE]

Definition of done:
- Every rubric axis is considered against the actual diff.
- Each finding is concrete: file:line plus recommended fix.
- No vague or speculative findings.

What to avoid:
- Editing any code or "fixing" the diff.
- Asserting findings are authoritative.
- Reporting a clean bill without examining the diff.

Commit: no
Write a short results summary as the final message: findings by severity + the verdict.
```

---

## Fix worker

```text
Mission: Apply the fixes for the CONFIRMED findings in [CONFIRMED FINDINGS / review-r<r>.md items the orchestrator approved] for [PROJECT].
Only the confirmed findings count; do not act on the reviewer's raw list.

Scope:
- Allowed: [SPECIFIC FILES THE CONFIRMED FINDINGS TOUCH]
- Forbidden: anything outside those files; broadening beyond the confirmed findings; deps/migrations/generated/global config; running git.

Inputs/context:
- Fresh worktree off integration/[PROJECT].
- The confirmed findings list with their file:line targets.
- [RELEVANT CODE AND TESTS FOR THE CONFIRMED FINDINGS]

Expected output:
- Minimal, targeted edits that resolve ONLY the confirmed findings.

Expected tests/checks:
- [TARGETED TEST COMMAND(S)]

Definition of done:
- Each confirmed finding is resolved.
- No scope creep.
- No placeholders or stubs remain.

What to avoid:
- Fixing un-confirmed or speculative findings.
- Refactoring beyond the findings.
- Touching files outside Allowed scope.

Commit: yes
Write a short results summary as the final message: which confirmed findings were resolved, files changed, commands run with actual output, and anything not finished.
```
