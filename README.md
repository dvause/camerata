# camerata

**Camerata** — a multi-agent orchestration engine and
playbooks for Claude Code and OpenAI Codex CLI orchestrators.

A strong planning model owns the goal, decomposition, and judgment; bounded
worker agents execute in isolated git worktrees; nothing merges on a worker's
self-report. Successor to a private harness proven in consulting use.

## Install

One repo, three paths — all on the same engine version.

```
# Claude Code
/plugin marketplace add dvause/camerata
/plugin install camerata@camerata

# Codex CLI — installs the skills, registers the MCP server
npx -y camerata setup-codex

# bare CLI
npm i -g camerata
```

`camerata doctor` reports what the current machine supports: git, each backend
CLI, and codex sandbox availability. On native Windows the codex backend
refuses and the claude backend carries the run.

## Playbooks

Four skills drive the engine. Each is portable `SKILL.md` — the same file works
in Claude Code and Codex.

| skill | stage | produces |
| --- | --- | --- |
| `camerata-spec` | fuzzy ask → testable spec (solo) | approved spec doc |
| `camerata-plan` | spec → dependency-ordered runs (solo) | orchestration plan |
| `camerata-build` | plan → parallel workers, review→fix loop | `integration/<project>` branch |
| `camerata-audit` | read-only auditors, findings bus | ranked report |

Every stage boundary is a human gate. Workers never run git, nothing merges on a
worker's self-report, and a run is not over until the close gate exits clean.

## Reference

### Data dir layout

```
~/.camerata/
  config.json
  calibration/build.md            # optional, carried from v1 format
  runs/<repo-slug>/<project>/
    run.json                      # repo, baseSha, createdAt, retryBudget, workerTimeoutS, resumedAt?
    progress.md                   # human-readable run log (same role as v1)
    manifest.jsonl                # one immutable row per dispatch
    recovery.jsonl                # dispatch ledger (task, attempt, name, policy, launchedAt)
    goals/<name>.goal.md
    logs/<name>.log
    status/<name>.json             # mutable worker state, atomic temp+rename writes
    allow/<name>.allow             # optional scope globs (* crosses /)
    commitignore/<name>            # optional staging excludes
    wt-<name>/                     # worktree
    findings/<name>.findings.md    # collected bus outputs (audit)
    escalation-<task>.md
    archive/                       # close gate: <name>.rejected.patch, <name>.worktree.diff
```

`<repo-slug>` = `<basename>-<first 8 hex of sha256(absolute repo path)>`.
Project and worker names keep v1 slug rules (letters, digits, `.`, `_`, `-`;
no leading `.`, no `..`).

### Worker status

```text
{ state: "running" | "done" | "failed",
  model, requestedModel, backend, pid?, startedAt, finishedAt?,
  exitCode?, reason?: "timeout" | "spawn-crash" | "git-add" | "git-commit",
  diff?: "empty" | "nonempty", tokens?: number, durationS?: number }
```

### Tools

MCP server `camerata`; CLI subcommands mirror the nine tools 1:1.

| tool | description |
| --- | --- |
| `init_run` | Set up or resume a run, record the base SHA, and snapshot retry budget and worker timeout; reuse requires `resume`, which verifies the same repo and base SHA. |
| `dispatch_worker` | Launch a bounded worker in an isolated worktree and return immediately; append the ledger first, enforce the retry budget, and refuse duplicate names/branches or Claude with `gitMode: ro`. |
| `worker_status` | Report worker state and reason, diffstat, untracked files, scope violations, stale PIDs, and ledger-only attempts whose dispatch died in preflight. |
| `wait_workers` | Block until any or all named workers reach a terminal state or `timeoutS` elapses; poll status files at 1s and return a timeout marker instead of hanging. |
| `integrate_branch` | Review a branch against the recorded base, or perform a real `--no-ff` merge into `integration/<project>`; refuse uncommitted tracked changes and leave conflicts for resolution. |
| `collect_findings` | Copy each worker's single output file, default `FINDINGS.md`, to the run-dir findings bus; refuse symlinks and error when nothing was collected. |
| `escalate_task` | Write an escalation report with every recorded attempt, outcome, diffstat, log tail, and archived diffs. |
| `close_run` | Close the run after requiring a non-empty `## Final summary`, archive rejected or dirty evidence, tear down manifest-scoped worktrees and branches, verify zero residuals, and append usage and closed lines. |
| `cleanup_run` | Recovery-only teardown of run worktrees and optional branches without touching the checked-out branch, `main`/`master`, `integration/*`, or paths outside the run dir; support `allBranches`, `force`, and `dryRun`. |

### Config

```json
{
  "dataDir": "~/.camerata",
  "retryBudget": 2,
  "workerTimeoutS": 1800,
  "backends": {
    "codex":  { "tiers": { "low": { "model": "gpt-5.6-luna", "reasoning": "high" },
                            "medium": { "model": "gpt-5.6-terra", "reasoning": "medium" },
                            "high": { "model": "gpt-5.6-sol", "reasoning": "high" },
                            "xhigh": { "model": "gpt-5.6-sol", "reasoning": "xhigh" } },
                "defaults": { "model": "gpt-5.6-terra", "reasoning": "high" },
                "fallbackModel": "gpt-5.6-terra" },
    "claude": { "tiers": { "low": { "model": "haiku", "reasoning": "high" },
                            "medium": { "model": "sonnet", "reasoning": "medium" },
                            "high": { "model": "opus", "reasoning": "high" },
                            "xhigh": { "model": "opus", "reasoning": "xhigh" } },
                "defaults": { "model": "sonnet", "reasoning": "high" },
                "fallbackModel": "sonnet" } }
}
```

Precedence is explicit tool args > config > shipped defaults. `run.json`
snapshots `retryBudget` and `workerTimeoutS` at init so a mid-run config edit
cannot change a live run.

### Errors

Errors are structured `{code, message}` via `EngineError`, never stack traces,
and every refusal names the rule it enforced.

License: Apache-2.0
