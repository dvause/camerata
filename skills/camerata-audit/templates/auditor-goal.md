# Auditor goal template

Copy the block below into a goal file, fill the brackets, and pass its path to
`dispatch_worker` as `goalFile` with `commit: false`. Also write
`<runDir>/allow/<name>.allow` with exactly one line, `FINDINGS.md`, so
`worker_status` can flag any scope violation. Auditors are always
`commit: false`; names are single-use per run, so repeat audits need a suffix
like `security-r2`.

---

## Auditor worker

```text
Mission: Audit [SCOPE] of [PROJECT] against the rubric: [RUBRIC AXES].

Scope:
- Allowed: read everything in the worktree; write EXACTLY ONE file: FINDINGS.md at the worktree root.
- Forbidden: modifying/creating any other file; "fixing" anything; running git.

Inputs/context:
- [WHAT THE PROJECT IS — 2-5 lines]
- [INTENTIONAL INVARIANTS — check they hold instead of reporting them as bugs]
- [FOCUS AREAS / KNOWN RISKS]
- [READ-ONLY CHECK COMMANDS THE AUDITOR MAY RUN, e.g. a syntax check, a linter, a test suite in read-only mode]
- You are confined to this worktree; the orchestrator collects FINDINGS.md from it — do not try to write the run directory.

Expected output:
- FINDINGS.md in this exact bus format:
  - H1 with the worker name and its rubric.
  - One `## F<n> — <short title>` section per finding.
  - Exactly these bold fields on their own lines under each finding:
    **Severity:** P1|P2|P3
    **Where:** file:line (or file range)
    **What:** the defect
    **Why it matters:** consequence
    **Fix:** concrete recommendation
    **Confidence:** high|medium|low
  - `## Coverage` section: which assigned focus areas/subsystems you examined, which you did not and why. If you skipped a focus area, say so here.
  - Final `## Verdict` section with overall assessment + top items.
  - P1 = incorrect behavior/data loss/security; P2 = real defect with workaround or latent trap; P3 = robustness/clarity.

Expected tests/checks:
- Re-read every file you cite.
- Verify each finding's file:line against the actual code.
- Run only the read-only commands listed.

Definition of done:
- Every rubric axis examined.
- Every finding concrete: file:line + fix + confidence.
- Intentional invariants checked, not flagged.
- Verdict present.
- No vague or speculative findings.

What to avoid:
- Editing code.
- Writing any file other than FINDINGS.md.
- Findings without file:line.
- Restating the rubric as findings.
- Flagging documented intentional invariants as bugs.
- Quoting credential VALUES; reference their locations only.

Commit: no
Final message: counts by severity + the verdict (the log is the backup channel if FINDINGS.md is missing).
```
