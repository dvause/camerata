# ADR 0002: v1 scope and decisions (extracted from the shipped spec)

**Status:** accepted (Dave, 2026-08-09) · extracted 2026-08-24 on ship, per the repo doc policy

## Context

Camerata is the open-source successor to a private harness. The v1 spec froze
the contract. It shipped at 0.1.0, and this ADR keeps its *why*.

## Out of scope for v1, deliberately

- Porting deliver (client-branded packaging stays private), secscan, onboard,
  and dissect; read-only dispatch and findings collection ship because audit
  needs them, and the engine must not block them.
- The orchestrator eval harness (`evals/`), deferred until the engine
  stabilizes.
- `maestro-stats.sh` rollups and `open-pr.sh`; orchestrators draft PRs with
  their own GitHub tooling under the prepare/confirm discipline, which moved
  into build playbook prose.
- mutation-check, deferred; its gate survives as optional build-playbook
  prose.
- The `/tmp/goal-<project>.md` compatibility symlink.
- Migration tooling for v1 `runs/` state; v1 stays runnable side by side.
- Claude-native orchestration primitives (Agent-tool worktrees, Workflow) as
  the core mechanism; Codex lacks them, so the deterministic engine is the
  portable core.
- Any new worker backend beyond codex and claude; the driver interface leaves
  the seam.

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

## Still open

- Claude worker token parsing was never solved in v1 (`-`); consider
  `--output-format json` for Claude workers to recover usage.
- Codex `.agents/skills` convention is young; directory or frontmatter details
  may shift. `setup-codex` owns the mapping, one place to patch.
- MCP long-poll `wait_workers` needs a documented recommended `timeoutS`
  (suggest 300s) to stay under host tool timeouts.

## Superseded details

The spec's “fast-forward-only” merge wording was superseded by the shipped real
`--no-ff` merge; the decision to “port v1 guard exactly” stands. The allow-glob
contract is `*` crosses `/`, full repo-relative path match, independent of any
matching library.
