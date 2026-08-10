# Acceptance checklist — camerata 0.1.0

The spec's `[human check]` criteria: real CLIs, real API spend, real hosts. CI
already covers the hermetic smoke on all three OSes; everything here is what
shims cannot model.

Keep every goal trivial and every worker at `loe: "low"`. The point is
exercising the machinery, not the model.

Record the date and outcome next to each box. A failure is a finding — note what
broke rather than retrying blind.

## Prep — demo repo

```sh
mkdir -p ~/tmp/camerata-demo && cd ~/tmp/camerata-demo
git init -b main && echo "# demo" > README.md
printf 'def add(a, b):\n    return a + b\n' > calc.py
printf 'from calc import add\n\ndef test_add():\n    assert add(2, 2) == 4\n' > test_calc.py
git add -A && git commit -qm "initial"
```

A repo with a runnable test command matters — the playbook's verification is
mechanical and needs something to run. Note the absolute path; it is the `repo`
argument.

- [ ] demo repo created, `pytest` (or equivalent) green at base

## Shared pass criteria

Every host run ends the same way. Check all four:

- [ ] `git -C <repo> status --porcelain` is empty — the engine writes refs, never files
- [ ] `git -C <repo> worktree list` shows only the main worktree
- [ ] `git -C <repo> branch --list 'agent/*'` is empty
- [ ] `<runDir>/progress.md` ends with a `- closed:` line

## E1 — Claude Code host, full pipeline

```
/plugin marketplace add dvause/camerata
/plugin install camerata@camerata
```

Restart the session, then confirm the plumbing before spending anything.

- [ ] `/mcp` lists `camerata` as connected, 9 tools
- [ ] the four `camerata-*` skills appear in the skills list
- [ ] `npx -y camerata@0.1.0 mcp < /dev/null` sits on stdio instead of erroring
      (only needed if the server shows as failed)

Drive a real run: ask the session to use `camerata-build` on the demo repo for
something small and splittable — "add a `subtract` function with a test, and a
`multiply` function with a test, two workers." That shape gives two disjoint
scopes without inventing work.

- [ ] `init_run` returns a `runDir` under `~/.camerata/runs/<repo-slug>/<project>/`
- [ ] `dispatch_worker` returns immediately — it must not block
- [ ] one worker on `backend: "codex"`, one on `"claude"` (both-backends criterion)
- [ ] the wait path re-invokes the session on completion
- [ ] `worker_status` shows `done`, non-empty diff, no scope violations
- [ ] `integrate_branch` review then merge, one branch at a time
- [ ] `close_run` exits clean
- [ ] shared pass criteria above

## E2 — Codex host, and the one pending assumption

```sh
npx -y camerata@0.1.0 setup-codex
```

The spec's only PENDING assumption is that Codex reads skills from
`~/.agents/skills`. Verify by hand before running anything:

- [ ] `ls ~/.agents/skills/` shows the four `camerata-*` directories
- [ ] `~/.codex/config.toml` contains `[mcp_servers.camerata]`
- [ ] Codex itself lists the skills — not just the files on disk
- [ ] Codex connects to the `camerata` MCP server

If Codex does not see them, the convention has shifted. `src/setup-codex.ts`
owns that mapping and is the only file to patch.

Then run the same build as E1. The difference: the orchestrator calls
`wait_workers` and re-calls on the timeout marker rather than backgrounding the
CLI.

- [ ] same build completes through close
- [ ] shared pass criteria above

## E3 — Native Windows

Needs real hardware or a VM. On Apple Silicon, Windows 11 **ARM64** — an x64
image will not boot.

```powershell
npx -y camerata@0.1.0 doctor
```

- [ ] `backends.codex.available` is `false`, with the sandbox reason
- [ ] `backends.claude.available` is `true`
- [ ] `ok` is `true`
- [ ] a one-worker claude-backend build completes through close
- [ ] shared pass criteria above

CI already proves the hermetic smoke and the `taskkill /T` tree kill on
`windows-latest`. What this adds is a genuine `claude` CLI spawned through the
`.cmd` shim, which the shims cannot fully model.

## E4 — Linux

Portability sanity check; path handling and process-group kill are already in
CI, so keep it short.

- [ ] one-worker codex-backend build completes through close
- [ ] shared pass criteria above

## E5 — Failure paths (optional but worth it)

The failure-recovery table only proves itself when something actually fails.
Give one worker a goal it cannot satisfy.

- [ ] a failed worker lands with a `reason` the table keys off
- [ ] retries are visible in `recovery.jsonl`, one row per attempt
- [ ] the fourth dispatch for a task is refused (budget = initial + 2)
- [ ] `escalate_task` writes `escalation-<task>.md` with every attempt archived

## E6 — Cutover and listing

Judgment, not a test.

- [ ] one piece of real work run through `camerata-build` instead of v1
- [ ] note anything reached for that is not there
- [ ] marketplace listing and announcement — only after E1–E4 pass

v1 stays runnable side by side, so aborting a cutover run costs one `close_run`.
