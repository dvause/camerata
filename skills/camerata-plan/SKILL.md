---
name: camerata-plan
description: Use when you have a spec or design doc for a non-trivial build and need to turn it into a camerata orchestration plan before dispatching workers. It slices the work into dependency-ordered runs of non-overlapping parallel workers. Triggers on "decompose this for workers", "slice the spec into worker tasks", "prep for camerata", or any build too big for one worker where worker scopes must not collide.
---

# Plan

## Overview

`camerata-build` *executes*; this skill *plans the slice it executes*. The hard
part of a plan is not listing tasks. It is **cutting the work so every run holds
to the size rule: default 3 workers, up to 8 when the scopes are genuinely
disjoint, with the justification recorded in the progress log.** The work must
still have strictly non-overlapping file ownership, be ordered by real
dependencies, and carve secret/deploy/token work out to humans. Get the slice
right and cheap `low`-LOE workers can build it in parallel without colliding; get
it wrong and workers stall, overwrite each other, or need frontier reasoning to
recover.

This is a solo stage: you write the plan, dispatch nothing.

## When to use

- You have a written spec/design doc and are about to run `camerata-build` on a
  build too big for one worker.
- You need worker scopes that *provably* won't edit the same files.
- Triggers: "decompose this for workers," "slice the spec into worker tasks,"
  "prep for camerata," "how do I parallelize this build."

**When NOT:** tiny tasks (just do it). With no spec yet, write one first with
`camerata-spec` (this skill MUST NOT consume a spec whose status is draft). Work
you can't split into non-overlapping scopes stays solo; do it yourself and run
one review pass.

## Procedure

1. **Topo-order by dependency.** Sketch what depends on what: shared
   types/schema → pure engines → API/server → collectors/consumers → UI →
   deploy. This ordering *becomes your runs*.
2. **Find what a layer's workers share.** Anything multiple workers import
   (types, DB schema, DB client, auth helper, theme, api-client barrel) is built
   FIRST by ONE foundational worker, then **frozen**. This is the recurring
   **foundation-then-fan-out** pattern; it usually appears once per layer.
3. **Fan out only along non-overlapping file boundaries.** Within a layer, split
   into default 3 parallel workers; up to 8 when the scopes are genuinely
   disjoint. Record the justification in the progress log. Each worker owns
   disjoint directories. Non-overlap is judged per file, dependency, migration,
   generated code, and global config, *not* per "feature."
4. **Carve out human-only phases.** Reading the user's real machine (capturing
   fixtures), secrets, real tokens, live deploy, and migrations against real data
   are NOT worker scope. Bookend the plan with **P0** (discovery / fixtures) and
   **P-Final** (deploy / secrets).
5. **Assign LOE luna-first.** Per worker, from the ambiguity that *remains after
   your decomposition*, not feature size. The start rung is `low` by default and
   needs no justification. Any task starting at `medium` or above, and any task
   flagged for competition, carries a one-line recorded reason in its worker card
   in the plan doc. Well-specified slice → `low`. Only genuine architecture →
   `high`. If everything trends high, decompose harder.
6. **Write each worker as a goal contract** (below) and lay out the runs with
   explicit gates + a dependency graph. Do not run them all at once. Read the
   `plan-slice` entries in `~/.camerata/calibration/build.md` before writing the
   contracts and paste their `rule:` lines into the affected slices; a missing or
   empty memory file is normal.

## The non-overlap rule (the crux)

Two workers **collide** if they both edit: the same file • the same
`package.json`/lockfile • the same migration • the same generated code • the same
barrel/`index`/route-registry • the same global config.

Resolve by: assign the shared file to exactly ONE worker • make barrels/exports
**append-only** • or pull the shared piece up into a **foundation worker**. If you
cannot carve disjoint slices that still fit within the default 3 / up to 8 rule,
the layer is sequential, so make it a single worker.

### Collision walkthrough (calibration)

Candidate split: worker A "add `/export` API route", worker B "add CSV download
button". Looks disjoint (server vs UI). Now run the checks:

1. **Files:** A owns `api/export/`, B owns `components/Export*`. Disjoint so far.
2. **Deps:** both need `csv-stringify` → both would edit `package.json` + the
   lockfile. **Collision.**
3. **Barrel/registry:** B imports the new route's types from `api/index.ts`,
   which A also edits. **Collision.**
4. **Resolve:** hoist `package.json` and the shared types into a foundation
   worker (run N), freeze the type names in its Output/Interfaces block; A and B
   fan out in run N+1 importing them read-only.

Rule of thumb: when two goal files name the same file, dependency, migration, or
registry, either one worker owns it or it moves up into a foundation run. If you
cannot prove disjointness in this walkthrough form, the layer is sequential, so
use one worker.

## Worker goal contract

Each worker block carries, verbatim from `camerata-build`'s template:

**Mission** (one sentence) · **LOE (start rung; reason required only when not low
or when competing)** · **Scope: Allowed** (globs) / **Forbidden** (globs) ·
**Inputs** (spec sections, fixtures) · **Output / Interfaces** (the *exact* names
later workers import, frozen) · **Tests** (fixture-driven, runnable) ·
**Definition of Done** · **Avoid** · **Commit** (yes/no).

The Output/Interfaces block is how non-adjacent workers learn each other's
signatures without ever seeing each other's code. Freeze it; later workers
import, never edit.

Allowed globs double as the worker's `<runDir>/allow/<name>.allow` file in build:
one glob per line, matched against the full repo-relative path with `*` crossing
`/`. Write them in that form so build can paste them straight in.

## Run sizing

- Default 3 workers; up to 8 when the scopes are genuinely disjoint. Record the
  justification in the progress log.
- A run is **either** one foundation worker **or** default 3 / up to 8 disjoint
  parallel workers, never both. Express a foundation as its own run.
- **Fan out only when a layer is large enough to need it.** A small layer is ONE
  worker, even if you *could* split it; don't manufacture a foundation +
  parallel pages for a handful of files. Parallelism is a cost (more branches,
  more integration, more ways to collide), not a goal. *Agent confetti is still
  confetti.*
- **Gate between runs:** merge one branch at a time, re-run the tests *yourself*,
  then proceed.
- If a loop needs repeated dispatches, namespace the worker names with the
  iteration (`reviewer-r<r>`, `fix-r<r>`, ...); the engine never reuses a worker
  name within a run.

## Plan document skeleton

```markdown
# <Feature> — Camerata Orchestration Plan
**Reference spec:** <path>  ·  **Project slug:** <slug>  ·  **Repo:** <path>  ·  **Build target:** <env>

## Sharpened goal + success criteria (testable)
## Global constraints (every worker inherits)
## P0 — Discovery (HUMAN): fixtures/secrets workers can't touch
## Run 1..N — each = ONE foundation worker OR default 3 / up to 8 disjoint parallel workers (goal contracts)
## P-Final — Deploy (HUMAN)
## Run dependency graph + gates
```

## Worked example (a monorepo dashboard build)

```
P0  Discovery (human): capture real log/API fixtures + token locations
R1  Foundation .............. monorepo + shared types + DB schema     [1 worker, frozen output]
R2  Core engines ............ pricing+value | quota-normalize          [2 disjoint subdirs]
R3  Web foundation .......... app scaffold + db client + auth + api-client [1 worker]
R4  API routes .............. ingest | quota | stats                   [3 disjoint route dirs]
R5  Collectors .............. parsers | oauth | poller+transport       [3 disjoint subdirs]
R6  UI foundation ........... shared components + theme                [1 worker]
R7  UI pages ................ home | drill-down | settings             [3 disjoint page dirs]
P-Final  Deploy (human): launchd, secrets, end-to-end smoke
```

Note the **foundation-then-fan-out** pattern recurs three times (R1→R2, R3→R4,
R6→R7). Each fan-out follows a single worker that builds and freezes the shared
code the parallel workers import.

## Common mistakes

| Mistake | Fix |
|---|---|
| One monolithic plan, or >3 workers without a recorded disjointness justification (hard max 8) | Topo-order into runs; foundation-then-fan-out |
| Two workers edit the same barrel / `package.json` / migration | Assign to one worker, or make it append-only |
| Splitting by *feature* instead of by *file ownership* | Slice into disjoint dirs; shared piece → foundation worker |
| Fanning out a *small* layer into foundation + parallel workers just because you can | One worker per small layer; only fan out when it's big enough to warrant it |
| Workers reading real tokens / secrets / doing the deploy | Carve out P0 + P-Final human phases |
| Everything dispatched at `high` LOE | Sharpen the slice; default luna-first |
| Shared types edited mid-run by a parallel worker | Freeze them in the foundation run; import read-only |

## Cross-references

- **REQUIRED for execution:** `camerata-build`. This skill only produces the
  plan; build dispatches, monitors, synthesizes, and runs the review→fix loop.
- **Produce the spec first:** `camerata-spec`. Grill, draft, and get the
  `Status: approved` human gate before slicing.
