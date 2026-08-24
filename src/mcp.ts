// MCP server (stdio): tools map 1:1 onto the engine library, same names the
// playbook skills reference. Only wait_workers blocks, bounded by timeoutS.
import { createRequire } from "node:module";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { closeRun, cleanupRun } from "./close.js";
import { loadConfig, type Config } from "./config.js";
import { dispatchWorker } from "./dispatch.js";
import { EngineError } from "./errors.js";
import { escalateTask } from "./escalate.js";
import { collectFindings } from "./findings.js";
import { integrateBranch } from "./integrate.js";
import { initRun } from "./run.js";
import { workerStatus } from "./status.js";
import { waitWorkers } from "./wait.js";

const str = { type: "string" } as const;
const int = { type: "integer" } as const;
const bool = { type: "boolean" } as const;

const TOOLS = [
  {
    name: "init_run",
    description:
      "Set up (or resume) an orchestration run for a target git repo. Records the base SHA and snapshots retry budget and worker timeout. Refuses to reuse an existing run without resume; resume verifies same repo and base SHA.",
    inputSchema: {
      type: "object",
      properties: { project: str, repo: str, resume: bool },
      required: ["project", "repo"],
    },
  },
  {
    name: "dispatch_worker",
    description:
      "Launch one bounded worker in an isolated git worktree; returns immediately after launch. Appends the recovery-ledger row before anything else exists, so refusals stay visible and budget is enforced (initial + retryBudget attempts per task). Refuses duplicate names/branches and claude with gitMode ro.",
    inputSchema: {
      type: "object",
      properties: {
        project: str,
        name: str,
        goalFile: str,
        backend: { type: "string", enum: ["codex", "claude"] },
        loe: { type: "string", enum: ["low", "medium", "high", "xhigh"] },
        model: str,
        reasoning: str,
        commit: bool,
        task: str,
        attempt: int,
        policy: str,
        timeoutS: int,
        gitMode: { type: "string", enum: ["ro", "none"] },
        base: str,
      },
      required: ["project", "name", "goalFile"],
    },
  },
  {
    name: "worker_status",
    description:
      "Per-worker state (running/done/failed with reason), diffstat vs the recorded base, untracked files, scope-check violations against allow/<name>.allow, stale-pid detection, and ledger-only attempts whose dispatch died in preflight.",
    inputSchema: { type: "object", properties: { project: str }, required: ["project"] },
  },
  {
    name: "wait_workers",
    description:
      "Block until any/all named workers reach a terminal state (done, failed, or crashed launcher) or timeoutS elapses; polls status files at 1s. Re-callable; returns a timeout marker instead of hanging past timeoutS.",
    inputSchema: {
      type: "object",
      properties: {
        project: str,
        timeoutS: int,
        workers: { type: "array", items: str },
        mode: { type: "string", enum: ["any", "all"] },
      },
      required: ["project", "timeoutS"],
    },
  },
  {
    name: "integrate_branch",
    description:
      "Review mode: diffstat + commit list of the branch vs the recorded base. Merge mode: real --no-ff merge into integration/<project> (created off base if missing); refuses on uncommitted tracked changes; a conflict is left in the repo for resolution.",
    inputSchema: {
      type: "object",
      properties: { project: str, branch: str, mode: { type: "string", enum: ["review", "merge"] } },
      required: ["project", "branch", "mode"],
    },
  },
  {
    name: "collect_findings",
    description:
      "Copy each worker's single output file (default FINDINGS.md) from its worktree to findings/<name>.<suffix>.md on the run-dir bus. Refuses symlinks; errors if nothing was collected.",
    inputSchema: {
      type: "object",
      properties: { project: str, file: str },
      required: ["project"],
    },
  },
  {
    name: "escalate_task",
    description:
      "Write escalation-<task>.md for a task whose recovery stops here: every recorded attempt with outcome, diffstat, log tail, and archived diffs under archive/. Returns the report path.",
    inputSchema: { type: "object", properties: { project: str, task: str }, required: ["project", "task"] },
  },
  {
    name: "close_run",
    description:
      "Close gate: requires a non-empty '## Final summary' in progress.md, archives rejected branches and dirty worktrees as evidence, tears down this run's worktrees and agent/* branches (manifest-scoped only), verifies zero residuals, then appends usage and closed lines. check=true only reports residuals; dryRun previews.",
    inputSchema: {
      type: "object",
      properties: { project: str, check: bool, dryRun: bool },
      required: ["project"],
    },
  },
  {
    name: "cleanup_run",
    description:
      "Recovery-only teardown of this run's worktrees (and optionally branches). Never touches the checked-out branch, main/master, integration/*, or paths outside the run dir. allBranches also deletes unmerged agent/* branches; force removes dirty worktrees; dryRun previews.",
    inputSchema: {
      type: "object",
      properties: { project: str, branches: bool, allBranches: bool, force: bool, dryRun: bool },
      required: ["project"],
    },
  },
];

const HANDLERS: Record<string, (cfg: Config, a: never) => unknown> = {
  init_run: initRun,
  dispatch_worker: dispatchWorker,
  worker_status: (cfg, a) => workerStatus(cfg, (a as { project: string }).project),
  wait_workers: waitWorkers,
  integrate_branch: integrateBranch,
  collect_findings: collectFindings,
  escalate_task: escalateTask,
  close_run: closeRun,
  cleanup_run: cleanupRun,
};

async function callTool(name: string, a: Record<string, unknown>): Promise<unknown> {
  const fn = HANDLERS[name];
  if (!fn) throw new EngineError("E_TOOL", `unknown tool: ${name}`);
  return fn(loadConfig(), a as never);
}

export async function runMcp(): Promise<void> {
  const version: string = createRequire(import.meta.url)("../package.json").version;
  const server = new Server({ name: "camerata", version }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    try {
      const result = await callTool(req.params.name, req.params.arguments ?? {});
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      const code = e instanceof EngineError ? e.code : "E_INTERNAL";
      const message = e instanceof Error ? e.message : String(e);
      return {
        content: [{ type: "text", text: JSON.stringify({ code, message }) }],
        isError: true,
      };
    }
  });
  await server.connect(new StdioServerTransport());
}
