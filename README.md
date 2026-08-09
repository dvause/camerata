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

License: Apache-2.0
