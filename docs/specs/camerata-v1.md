# Camerata v1 — Spec
**Status:** approved (Dave, 2026-08-09) · **Target repo:** greenfield (`maestro-v2`, becomes `camerata`) · **Sources:** grilling session 2026-08-09; maestro v1 at `../maestro` (README, CLAUDE.md, ADRs 0001–0008, engine scripts, playbook SKILL.mds)

## Summary

Camerata is the open-source successor to maestro: a multi-agent orchestration
engine plus playbook skills, where a strong planning model (running as Claude
Code or Codex CLI) dispatches bounded worker agents into isolated git worktrees
and never trusts their self-reports. v1 is a bash harness coupled to a live
repo checkout, macOS/Linux only, installed by symlink; camerata replaces it
with a TypeScript engine exposed as an MCP server plus thin CLI, portable
SKILL.md playbooks, and one repo that installs three ways (npm, Claude Code
plugin, Codex skills). Why now: maestro is proven but unshareable, and the
conductor-metaphor namespace on npm is being claimed by competitors monthly.

## Goals & success criteria

- Hermetic end-to-end smoke (fake `codex`/`claude` shims, no network, no API
  spend) passes on ubuntu, macos, windows — check: `npm test` in 3-OS GitHub
  Actions matrix.
- Claude Code host: install plugin from marketplace repo, run `camerata-build`
  on a demo repo through init → dispatch (both backends) → wait → integrate →
  close — [human check: Dave, real run].
- Codex host: `camerata setup-codex` registers the MCP server and installs
  skills; same build run completes — [human check: Dave, real run].
- Target repo stays pristine: engine writes only git refs/objects (branches,
  worktree metadata) into the target repo, never files — check: smoke asserts
  clean `git status` in the target after a full run.
- Native Windows: engine + claude backend smoke green; codex dispatch refuses
  with a clear message when its sandbox is unavailable — check: windows CI job
  asserts both.
- A worker crash, timeout, or over-budget retry is visible in the ledger and
  never silently retried — check: unit tests on the recovery ledger.
- No install step reads from a live camerata checkout at runtime (the v1
  symlink coupling) — check: smoke runs against the packed npm artifact
  (`npm pack`), not the source tree.

## Non-goals

- Porting deliver (client-branded packaging stays private), secscan, onboard,
  dissect. The engine must not block them: read-only dispatch + findings
  collection ship in v1 because audit needs them.
- Orchestrator eval harness (v1 `evals/`) — port later, after the engine
  stabilizes.
- `maestro-stats.sh` rollups, `open-pr.sh` (orchestrators draft PRs with their
  own GitHub tooling under the prepare/confirm discipline, which moves into
  build playbook prose), mutation-check (deferred; the gate survives as
  optional prose in the build playbook).
- `/tmp/goal-<project>.md` compatibility symlink — dead.
- Migration tooling for v1 `runs/` state. v1 stays runnable side by side.
- Claude-native orchestration primitives (Agent-tool worktrees, Workflow) as
  the core mechanism — Codex lacks them; the deterministic engine is the
  portable core.
- Any new worker backend beyond codex and claude (the driver interface leaves
  the seam).

## Users & scenarios

- **Orchestrator session (Claude Code or Codex CLI):** loads a camerata
  playbook skill, drives the engine through MCP tools, adjudicates diffs and
  findings, closes the run through the gate.
- **OSS engineer:** installs the Claude plugin or Codex skills, points
  `camerata-build` at their repo, gets an integration branch they review.
- **Consultant (Dave):** same engine underneath private playbooks; audit
  playbook against client repos with recorded consent, nothing auto-committed.
- **Contributor:** clones one repo, `npm test` gives the hermetic smoke, no
  API keys needed.

## Design constraints

- TypeScript, Node >= 18. Runtime deps capped at `@modelcontextprotocol/sdk`
  + `picomatch`; arg parsing via `node:util` `parseArgs`; git via the `git`
  CLI (required anyway for worktrees).
- No bash anywhere in the engine path. Platform differences (process-group
  kill vs `taskkill /T`, path handling) isolated in one platform module.
- License Apache-2.0. Package/repo/server name `camerata`.
- All v1 deterministic invariants survive: workers never run git; launcher
  commits; recovery ledger enforces retry budget (initial + 2); worker names
  single-use per run; scope check covers untracked files; close gate archives
  evidence before teardown; a run is not over until close exits clean; never
  trust worker self-report (prose + verify gate in playbooks).
- State lives in an engine-owned data dir, default `~/.camerata`, override via
  config or `CAMERATA_HOME`. Worktrees live under the run dir — outside the
  target repo, invariant kept.
- MCP tool calls that can block are bounded: `dispatch` returns immediately
  after launch; only `wait_workers` blocks, with a required timeout.
- Skills are portable SKILL.md (Agent Skills standard) with a short
  host-conditional section; engine interactions referenced by MCP tool name,
  never by script path.

## Architecture

```
orchestrator session (Claude Code | Codex CLI)
  │  playbook SKILL.md (camerata-spec / -plan / -build / -audit)
  ▼
camerata MCP server (stdio, `npx -y camerata mcp`)  ──┐
camerata CLI (same core; humans, CI, background wait) ─┤→ engine library (TS)
                                                       │    run lifecycle · dispatch
                                                       │    ledger · scope · integrate
                                                       │    close gate · drivers
                                                       ▼
                        detached worker process (`camerata _worker`)
                          driver: codex exec --sandbox workspace-write -C <wt>
                                  | claude -p (cwd=wt, acceptEdits, git denied)
                          writes log + status.json; launcher commits after exit
```

- **One package.** `camerata` on npm ships library, CLI (`bin`), and MCP
  server. The Claude plugin's `.mcp.json` launches `npx -y camerata mcp`
  version-pinned to the plugin version; the repo doubles as plugin root and
  marketplace (`.claude-plugin/plugin.json`, `marketplace.json`, `skills/`).
- **Dispatch is a detached child.** The MCP `dispatch_worker` tool (and CLI
  `dispatch`) validates, appends the ledger row, creates branch + worktree,
  then spawns `camerata _worker <args>` detached with stdio to the log file
  and returns. `_worker` owns the driver run, timeout, model fallback,
  post-run commit, and status writes — v1's `codex-worker.sh` reborn as a
  hidden subcommand.
- **Waiting.** `wait_workers` MCP tool polls status files (1s interval) until
  any/all named workers change state or `timeoutS` elapses, then returns the
  changed statuses; re-callable. `camerata wait` CLI does the same and exits —
  a Claude Code orchestrator backgrounds it with `run_in_background: true` to
  get the native completion wakeup; a Codex orchestrator calls the tool.
- **Feature detection.** `camerata doctor` (and preflight inside dispatch)
  probes git, each backend CLI, and codex sandbox support on the current OS.
  On native Windows without a working codex sandbox, codex dispatch refuses
  with a one-line reason; claude backend is fully supported.

## Data & interfaces

Frozen for playbook prose and later workers to reference by name.

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
    status/<name>.json            # mutable worker state, atomic temp+rename writes
    allow/<name>.allow            # optional scope globs (picomatch, * crosses /)
    commitignore/<name>           # optional staging excludes
    wt-<name>/                    # worktree
    findings/<name>.findings.md   # collected bus outputs (audit)
    escalation-<task>.md
    archive/                      # close gate: <name>.rejected.patch, <name>.worktree.diff
```

`<repo-slug>` = `<basename>-<first 8 hex of sha256(absolute repo path)>`.
Project and worker names keep v1 slug rules (letters, digits, `.`, `_`, `-`;
no leading `.`, no `..`).

Splitting v1's mutable `manifest.tsv` into immutable `manifest.jsonl` rows plus
per-worker `status/<name>.json` kills the awk-under-lock rewrite dance; the
only lock that remains is the v1-style mkdir lock around `recovery.jsonl`
appends (budget check + append must be atomic).

### Worker status (`status/<name>.json`)

```
{ state: "running" | "done" | "failed",
  model, requestedModel, backend, pid?, startedAt, finishedAt?,
  exitCode?, reason?: "timeout" | "spawn-crash" | "git-add" | "git-commit",
  diff?: "empty" | "nonempty", tokens?: number, durationS?: number }
```

State machine and reasons match v1 exactly; the failure-recovery table in the
build playbook keys off them unchanged.

### MCP tools (server `camerata`; CLI subcommands mirror 1:1)

| tool | input (required first) | returns |
| --- | --- | --- |
| `init_run` | `project, repo, resume?` | `{runDir, baseSha}`; refuses reuse without `resume`; resume verifies same repo + base SHA |
| `dispatch_worker` | `project, name, goalFile, backend?, loe?, model?, reasoning?, commit?, task?, attempt?, policy?, timeoutS?, gitMode?, base?` | `{name, branch, worktree, log}` immediately; ledger row appended pre-launch; refuses over-budget, duplicate name/branch, claude+gitMode:ro |
| `worker_status` | `project` | per-worker status + diffstat + scope-check violations (untracked included, gitignored excluded); stale-pid detection |
| `wait_workers` | `project, timeoutS, workers?, mode?: "any"\|"all"` | statuses that changed, or timeout marker |
| `integrate_branch` | `project, branch, mode: "review"\|"merge"` | review: diffstat + commit list vs recorded base; merge: fast-forward-only result into `integration/<project>`, refuses on dirty tracked files |
| `collect_findings` | `project, file?` (default `FINDINGS.md`) | copies each read-only worker's single output to `findings/`, returns list |
| `escalate_task` | `project, task` | writes `escalation-<task>.md` with attempt diffs archived, returns path |
| `close_run` | `project, check?, dryRun?` | close gate: requires `## Final summary` in progress.md, archives rejected/dirty evidence, tears down run worktrees + `agent/*` branches, verifies zero residuals (run-scoped, manifest-named branches only), appends usage + closed lines |
| `cleanup_run` | `project, branches?, allBranches?, force?, dryRun?` | recovery-only teardown, v1 semantics: never touches checked-out branch, `main`/`master`, `integration/*`, or paths outside the run dir |

Errors are structured (`{code, message}`), never stack traces; every refusal
names the rule it enforced.

### Driver interface (TS, `src/drivers/`)

```ts
interface WorkerDriver {
  name: "codex" | "claude";
  check(): Promise<{ available: boolean; reason?: string }>;   // incl. Windows sandbox probe
  tiers: Record<"low"|"medium"|"high"|"xhigh", { model: string; reasoning: string }>;
  defaults: { model: string; reasoning: string };
  fallbackModel: string;
  spawnSpec(opts: { model; reasoning; worktree; gitMode }): { cmd: string; args: string[]; env?; cwd? };
  parseTokens(log: string): number | null;
  modelUnavailable(logTail: string): boolean;
}
```

Invocations are v1's, verbatim: codex `codex exec --sandbox workspace-write -m
<model> -c model_reasoning_effort="<r>" -C <wt>`; claude `claude -p --model
<model> --effort <r> --permission-mode acceptEdits --allowedTools Bash
--disallowedTools "Bash(git *)" --output-format text` with cwd = worktree,
parent-session env markers stripped, `MAESTRO_WORKER` marker replaced by
`CAMERATA_WORKER=1`. The engine composes the prompt preamble (worker charter +
git prohibition, git-ro variant codex-only) ahead of the goal file, v1 text
carried over.

### Config (`~/.camerata/config.json`, all keys optional)

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

Shipped defaults = the values above (v1's ladders). Precedence: explicit tool
args > config > shipped defaults. `run.json` snapshots `retryBudget` and
`workerTimeoutS` at init so a mid-run config edit cannot change a live run's
budget.

### Repo layout

```
camerata/
  package.json                 # name camerata; bin: camerata; files: dist, skills
  src/                         # engine lib, cli.ts, mcp.ts, _worker.ts, drivers/, platform.ts
  skills/
    camerata-spec/SKILL.md     # solo playbooks port near-verbatim
    camerata-plan/SKILL.md
    camerata-build/SKILL.md    # engine calls → tool names; judgment prose intact
    camerata-audit/SKILL.md
    */templates/               # goal + output templates from v1
  .claude-plugin/plugin.json   # Claude plugin manifest
  .mcp.json                    # camerata: npx -y camerata@<version> mcp
  marketplace.json             # this repo is its own marketplace
  test/                        # vitest unit + smoke/ (Node shim codex/claude executables)
  docs/specs/camerata-v1.md    # this file
  LICENSE  README.md
```

Install paths: Claude — `/plugin marketplace add dvause/camerata` +
`/plugin install camerata@camerata`; Codex — `camerata setup-codex` (copies
`skills/` into `~/.agents/skills/`, registers the MCP server in Codex config);
npm — `npm i -g camerata` for the bare CLI.

### Playbook porting rules

- Kill every `$ORCH` path derivation; engine interactions are tool names.
- Host-conditional block (~5 lines per skill): Claude backgrounds
  `camerata wait` via Bash; Codex calls `wait_workers`.
- Judgment content ports intact: build's failure-recovery table, LOE ladder
  discipline (luna-first), adjudication calibration (CONFIRM/REJECT/DEFER +
  P1/P2/P3), review→fix loop with 2-pass cap, competition protocol, abort
  conditions; audit's evidence-verification rule (every file:line checked
  before the report). Calibration memory keeps v1 format at
  `~/.camerata/calibration/build.md`.
- Prepare/confirm PR discipline (ADR 0004) becomes build prose: push
  integration branch, draft PR text into the run dir, open only on explicit
  human approval using the host's own GitHub tooling.
- Client-repo consent stays a prose gate in audit: recorded in progress.md
  before any dispatch.

## Human-only work

- P0: create the GitHub repo (final org/name), publish the npm placeholder
  (`npm publish` needs Dave's auth), decide repo URL for package.json.
- P0: real `codex`/`claude` CLI accounts for acceptance runs.
- P-Final: marketplace listing/announcement, v1 → camerata cutover for Dave's
  own workflow, real-API acceptance runs on all three OSes (Windows hardware
  or VM needed).

## Risks & open questions

- Codex `.agents/skills` convention is young; directory or frontmatter details
  may shift. Mitigation: `setup-codex` owns the mapping, one place to patch.
- MCP long-poll `wait_workers` vs host tool timeouts: bounded `timeoutS` +
  re-call keeps under any host cap; needs a documented recommended value
  (suggest 300s).
- Windows process-tree kill (`taskkill /T`) reliability for timeout
  enforcement — needs explicit smoke coverage with a stalling shim.
- Claude worker token parsing was never solved in v1 (`-`); consider
  `--output-format json` for claude workers to recover usage. Open.
- `integrate_branch` merge semantics: v1 allowed real merges with clean-tree
  guard ignoring untracked files; port that guard exactly or tighten? Open —
  default: port exactly.
- Name collision risk until placeholder published (active squatting observed:
  divisi, concertino, attacca, maestoso, orchestrion — all 2026).

## Assumptions

- Node >= 18 present wherever an orchestrator host runs (npx ships with it) —
  APPROVED (2026-08-09).
- `git` CLI present, worktree-capable, on all three OSes — APPROVED
  (2026-08-09).
- Codex CLI sandbox unavailable on native Windows until proven otherwise;
  feature-detect, degrade — APPROVED (2026-08-09).
- Codex skills read from `~/.agents/skills` / `$REPO/.agents/skills` per
  current OpenAI docs — PENDING (verify against installed Codex version at M5).
- Claude plugin `.mcp.json` may launch `npx` — APPROVED per plugin docs
  (2026-08-09).

## Decisions log

- 2026-08-09: orchestrator hosts → both Claude Code and Codex CLI first-class.
- 2026-08-09: Windows → native first-class for engine; no bash in engine path.
- 2026-08-09: playbook scope → core pipeline only (spec, plan, build, audit).
- 2026-08-09: v1 relationship → clean-room v2, port docs selectively, v1 stays
  runnable.
- 2026-08-09: engine form → MCP server + thin CLI over one TS library.
- 2026-08-09: runtime → TypeScript/Node (>= 18).
- 2026-08-09: state home → `~/.camerata` engine-owned data dir; target repo
  pristine.
- 2026-08-09: packaging → one repo, three install paths, single version.
- 2026-08-09: wait model → blocking MCP `wait_workers` + CLI `camerata wait`
  (Claude backgrounds the CLI for native wakeup).
- 2026-08-09: name → **camerata** (npm free; conductor namespace under active
  squatting). License → Apache-2.0.
- 2026-08-09: Windows + codex backend → feature-detect and degrade with clear
  refusal.
- 2026-08-09: engine surface → trimmed core (drop open-pr, stats, symlink
  compat; defer mutation-check); all deterministic ledgers/gates keep.
- 2026-08-09: model tiers → shipped defaults + user config override.
- 2026-08-09: tests → vitest unit + hermetic Node-shim smoke, 3-OS CI from
  first commit.
