# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```sh
npm test                      # pretest builds, then vitest run (whole suite)
npm run build                 # tsc -> dist/
npx vitest run test/ledger.test.ts          # one file (build first — see below)
npx vitest run -t "retry budget"            # one test by name
node dist/cli.js doctor       # probe git + both backend CLIs on this machine
node dist/cli.js help         # subcommand surface
```

`test/smoke.test.ts` and `test/packaging.test.ts` drive the **packed npm
tarball** (`test/pack.ts` runs `npm pack`), not `src/`. Run `npm run build`
before a bare `npx vitest`, or the packed CLI is stale. `vitest.config.ts` sets
`fileParallelism: false` and 120s timeouts because the suite spawns real
processes and git worktrees.

CI (`.github/workflows/ci.yml`) runs `npm test` on ubuntu/macos/windows.
`acceptance.yml` is manual-only — it installs a real backend CLI and spends API
budget; `docs/acceptance-checklist.md` is its human counterpart.

## Architecture

One TS library; three faces onto it. `src/mcp.ts` (stdio MCP server) and
`src/cli.ts` (bin) are both thin shells over the same engine modules, and their
surfaces mirror **1:1** — nine tools, nine subcommands, same names, same args.
Adding an engine call means touching both plus `USAGE` in `cli.ts`.

Flow of one worker:

```
dispatch_worker (src/dispatch.ts)
  validate shape -> appendDispatch (ledger, under mkdir lock) -> git worktree add
  -> spawn detached `camerata _worker` -> return immediately
camerata _worker (src/_worker.ts)  # hidden subcommand, never imported
  driver spawn -> timeout/kill-tree -> model fallback -> launcher-side git commit
  -> status/<name>.json
wait_workers (src/wait.ts)         # the only blocking call, polls status files 1s
integrate_branch -> collect_findings / escalate_task -> close_run
```

`src/drivers/index.ts` holds everything backend-specific (codex vs claude:
argv, env, token parsing, model-unavailable regex). `src/platform.ts` holds
everything OS-specific (`.cmd` shims via cmd.exe, process-tree kill, PATHEXT
resolution, home dir). Nothing else in the engine should branch on platform or
backend.

`skills/*/SKILL.md` are the orchestrator playbooks — portable files that run
unchanged on Claude Code and Codex. They are the product's user interface;
README's Reference section is the engine contract (data-dir layout, tool list,
config schema), and `docs/adr/` holds the decisions log.

## Invariants worth not breaking

- **The target repo stays pristine.** The engine writes refs and worktrees into
  it, never files. All state lives under `~/.camerata` (`CAMERATA_HOME`
  overrides). A smoke test asserts this.
- **Ledger before anything else exists.** `appendDispatch` runs before the
  worktree or branch, so a dispatch that dies in preflight still consumed its
  attempt and stays visible. Budget check + append must stay inside one
  `withLock`.
- **Workers never run git.** The launcher (`_worker`) commits after the worker
  exits, with its own `user.name`/`user.email` so ambient git config can't
  affect it. Same for `integrate_branch`.
- **Nothing merges on a worker's self-report**, and a run is not closed until
  `close_run` exits with zero residuals. `close_run` refuses without a non-empty
  `## Final summary` in `progress.md`, and its teardown is manifest-scoped so a
  concurrent run on the same repo is never touched.
- **Errors are `EngineError(code, message)`** via `fail()`. Both faces render
  `{code, message}` — never a stack trace. Every refusal names the rule it
  enforced.
- **Five manifests share one version**: `package.json`,
  `.claude-plugin/plugin.json`, the pin in `.mcp.json`, and their Agent Plugins
  twins at the repo root (`plugin.json`, `mcp.json`). The dotted pair is what
  Claude Code reads; the root pair is the portable spec that Cursor, Copilot,
  VS Code, and Kiro read. `packaging.test.ts` fails on drift; bump all together.
- **Anything read at runtime must be in `package.json` `files`** (`dist`,
  `skills`) — the packed-artifact tests are what catch a gap.
- **No v1 vocabulary in skills.** A test greps `SKILL.md` and templates for
  `$ORCH|maestro|orchestrate-init|codex-worker`; engine interactions are named
  by MCP tool only.
- **Windows is first-class**: no bash anywhere in the engine path. The codex
  backend deliberately refuses on native Windows (no sandbox); the claude
  backend carries those runs. `gitMode: "ro"` is likewise refused with the
  claude backend — deny-wins tool precedence can't express read-only git.
- `.gitattributes` forces LF; skills ship to two hosts and get packed on any OS.

## Conventions

Comments explain *why a rule exists*, not what the line does — that voice is
load-bearing here since the engine is mostly refusals. `ponytail:` marks a
deliberate simplification with its ceiling and upgrade path; keep the form when
adding one.
