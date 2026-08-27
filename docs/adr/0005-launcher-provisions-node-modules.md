# ADR 0005: the launcher provisions node_modules into worker worktrees

**Status:** accepted (Dave, 2026-08-27)

## Context

Workers run sandboxed with no network. `git worktree add` never brings
`node_modules` (gitignored), and workers cannot install it themselves, so any
task verified by a test suite was dead on arrival unless the orchestrator
copied dependencies in by hand. Two calibration rules carried the workarounds:
BLD-007 (a symlink fails twice — the sandbox denies writes resolving outside
the worktree, and a trailing-slash ignore pattern matches a directory but not
a symlink, leaving the link stageable) and BLD-005 (a commitignore entry for
the provisioned directory causes the staging failure it was meant to prevent).
Every plan had to re-state both.

## Decision

`dispatch_worker` provisions `<repo>/node_modules` into each new worktree,
after `git worktree add` and before spawning the launcher. It copies with
`fs.cpSync` + `COPYFILE_FICLONE_FORCE` — an APFS clonefile: real files inside
the worktree, copy-on-write, near-zero disk until divergence (measured 60 MB /
4,420 files in 0.44 s). On failure (non-APFS, cross-volume, Windows) it falls
back to a plain recursive copy and notes that in `progress.md`. Absent
`node_modules` is skipped silently. No commitignore entry is written.

`fs.cpSync` rather than `cp -Rc` keeps the no-shell, Windows-first-class
invariant; the syscall is the same clonefile on APFS.

## Consequences

- Orchestrators and plans no longer carry a provisioning step; BLD-007's
  manual-copy rule is superseded (its symlink trigger history stays true).
- BLD-005 still stands on its own: never write a commitignore entry for an
  already-ignored directory.
- Root `node_modules` only. Nested workspace trees (`packages/*/node_modules`)
  are a known ceiling, marked in the code.
- Correctness depends on the target repo gitignoring `node_modules`, which any
  repo that has one does; a repo that doesn't would get it committed by the
  launcher's `add -A`, same as any other untracked file.
