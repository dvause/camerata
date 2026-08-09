# camerata

**Camerata** — a multi-agent orchestration engine and
playbooks for Claude Code and OpenAI Codex CLI orchestrators.

A strong planning model owns the goal, decomposition, and judgment; bounded
worker agents execute in isolated git worktrees; nothing merges on a worker's
self-report. Successor to a private harness proven in consulting use.

Full release in development.

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

License: Apache-2.0
