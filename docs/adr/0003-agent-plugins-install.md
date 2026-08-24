# ADR 0003: install on Codex via Agent Plugins, delete setup-codex

**Status:** accepted (Dave, 2026-08-24)

## Context

v1 shipped `camerata setup-codex`: it copied `skills/` into `~/.agents/skills`
and patched an `[mcp_servers.camerata]` block into `~/.codex/config.toml` with
a line-scanning TOML rewriter. ADR 0002 listed the `.agents/skills` convention
as an open assumption and named that file as the one place to patch when it
shifted.

It shifted. Agent Plugins 1.0.0 (2026-08-06, OpenAI/Microsoft/AWS/Cursor/Vercel)
standardized packaging skills plus MCP servers as a portable plugin directory,
and Codex CLI 0.147.0 (2026-08-07) implements installation from a local path or
git marketplace.

Verified against 0.147.0 with a throwaway `CODEX_HOME`: `codex plugin
marketplace add <repo>` then `codex plugin add camerata@camerata` reads the
`.claude-plugin/marketplace.json` and `.mcp.json` we already ship, and
`codex mcp list` then shows the camerata server registered and enabled. No repo
change was needed.

## Decision

Delete `src/setup-codex.ts`, the `setup-codex` subcommand, and its tests.
Codex installs via `codex plugin`, the same two-step shape as the Claude Code
plugin install.

## Consequences

- The hand-rolled TOML rewriter is gone; nobody owns a mapping to Codex's
  private config layout any more. Host install is the host's problem.
- One less install path to keep working on three OSes.
- We conform to the spec only through Codex's tolerance of Claude's dotted
  filenames. Agent Plugins wants `plugin.json` and `mcp.json` at the plugin
  root, each `$schema`-pinned, with `type` on the server entry. Adding those
  would open camerata to Cursor, Copilot, VS Code, and Kiro, at the cost of a
  fourth manifest in the version-sync set that `packaging.test.ts` guards.
  Deferred until someone wants one of those hosts.
