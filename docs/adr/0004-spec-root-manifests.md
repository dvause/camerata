# ADR 0004: ship the Agent Plugins root manifests

**Status:** accepted (Dave, 2026-08-24) · supersedes the deferral in ADR 0003

## Context

ADR 0003 deferred the spec's root `plugin.json` and `mcp.json`, since Codex
accepted the dotted Claude filenames we already shipped and the fourth manifest
was cost without a host that wanted it. That trade was reversed on request:
reaching Cursor, GitHub Copilot, VS Code, and Kiro is worth the sync burden.

## Decision

Ship `plugin.json` and `mcp.json` at the repo root, each pinned to
`https://agent-plugins.org/schemas/1.0.0/`, with `type: "stdio"` on the server
entry. The `.claude-plugin/` pair stays for Claude Code.

## Consequences

- Five files now carry the version. `packaging.test.ts` asserts all of them
  against `package.json`, because a bump that misses the root pair ships a
  stale `camerata@<old>` pin to every spec host.
- Two manifests state the same MCP server. Duplication a client owns is
  cheaper than a build step that generates one from the other.
- Codex changed behavior once the roots existed: it now launches the server
  with `PLUGIN_ROOT`/`PLUGIN_DATA` set and cwd inside the plugin cache, where
  before it had neither. The engine ignores both and resolves state from
  `CAMERATA_HOME`, so nothing depends on cwd — worth knowing if that ever
  stops being true.
