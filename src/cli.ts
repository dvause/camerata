#!/usr/bin/env node
// Thin CLI over the engine library; subcommands mirror the MCP tools 1:1.
import { parseArgs } from "node:util";
import { closeRun, cleanupRun } from "./close.js";
import { loadConfig } from "./config.js";
import { EngineError } from "./errors.js";
import { dispatchWorker } from "./dispatch.js";
import { doctor } from "./doctor.js";
import { escalateTask } from "./escalate.js";
import { collectFindings } from "./findings.js";
import { integrateBranch } from "./integrate.js";
import { initRun } from "./run.js";
import { workerStatus } from "./status.js";
import { waitWorkers } from "./wait.js";
import { workerMain } from "./_worker.js";

const USAGE = `usage: camerata <command> [options]

commands:
  init       --project P --repo DIR [--resume]
  dispatch   --project P --name N --goal-file F [--backend codex|claude]
             [--loe low|medium|high|xhigh] [--model M] [--reasoning R]
             [--commit] [--task T] [--attempt N] [--policy S]
             [--timeout-s N] [--git-mode ro|none] [--base REF]
  status     --project P
  wait       --project P --timeout-s N [--workers a,b] [--mode any|all]
  integrate  --project P --branch B --mode review|merge
  collect    --project P [--file FINDINGS.md]
  escalate   --project P --task T
  close      --project P [--check] [--dry-run]
  cleanup    --project P [--branches] [--all-branches] [--force] [--dry-run]
  doctor     probe git, both backend CLIs, and codex sandbox support
  mcp        run the MCP server on stdio
`;

function opt<T extends Record<string, { type: "string" | "boolean" }>>(args: string[], options: T) {
  return parseArgs({ args, options, allowPositionals: false }).values;
}

function intOr(v: string | undefined, label: string): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n)) throw new EngineError("E_ARG", `${label} must be an integer`);
  return n;
}

function req(v: string | undefined, label: string): string {
  if (v === undefined) throw new EngineError("E_ARG", `--${label} is required`);
  return v;
}

async function main(): Promise<number> {
  const [cmd, ...rest] = process.argv.slice(2);
  const cfg = loadConfig();
  let out: unknown;

  switch (cmd) {
    case "init": {
      const v = opt(rest, {
        project: { type: "string" },
        repo: { type: "string" },
        resume: { type: "boolean" },
      });
      out = initRun(cfg, {
        project: req(v.project, "project"),
        repo: req(v.repo, "repo"),
        resume: Boolean(v.resume),
      });
      break;
    }
    case "dispatch": {
      const v = opt(rest, {
        project: { type: "string" },
        name: { type: "string" },
        "goal-file": { type: "string" },
        backend: { type: "string" },
        loe: { type: "string" },
        model: { type: "string" },
        reasoning: { type: "string" },
        commit: { type: "boolean" },
        task: { type: "string" },
        attempt: { type: "string" },
        policy: { type: "string" },
        "timeout-s": { type: "string" },
        "git-mode": { type: "string" },
        base: { type: "string" },
      });
      out = await dispatchWorker(cfg, {
        project: req(v.project, "project"),
        name: req(v.name, "name"),
        goalFile: req(v["goal-file"], "goal-file"),
        backend: v.backend,
        loe: v.loe,
        model: v.model,
        reasoning: v.reasoning,
        commit: Boolean(v.commit),
        task: v.task,
        attempt: intOr(v.attempt, "attempt"),
        policy: v.policy,
        timeoutS: intOr(v["timeout-s"], "timeout-s"),
        gitMode: v["git-mode"],
        base: v.base,
      });
      break;
    }
    case "status": {
      const v = opt(rest, { project: { type: "string" } });
      out = workerStatus(cfg, req(v.project, "project"));
      break;
    }
    case "wait": {
      const v = opt(rest, {
        project: { type: "string" },
        "timeout-s": { type: "string" },
        workers: { type: "string" },
        mode: { type: "string" },
      });
      out = await waitWorkers(cfg, {
        project: req(v.project, "project"),
        timeoutS: intOr(v["timeout-s"], "timeout-s") ?? 0,
        workers: v.workers?.split(",").filter((w) => w !== ""),
        mode: v.mode as "any" | "all" | undefined,
      });
      break;
    }
    case "integrate": {
      const v = opt(rest, {
        project: { type: "string" },
        branch: { type: "string" },
        mode: { type: "string" },
      });
      out = integrateBranch(cfg, {
        project: req(v.project, "project"),
        branch: req(v.branch, "branch"),
        mode: req(v.mode, "mode") as "review" | "merge",
      });
      break;
    }
    case "collect": {
      const v = opt(rest, { project: { type: "string" }, file: { type: "string" } });
      out = collectFindings(cfg, {
        project: req(v.project, "project"),
        file: v.file,
      });
      break;
    }
    case "escalate": {
      const v = opt(rest, { project: { type: "string" }, task: { type: "string" } });
      out = escalateTask(cfg, {
        project: req(v.project, "project"),
        task: req(v.task, "task"),
      });
      break;
    }
    case "close": {
      const v = opt(rest, {
        project: { type: "string" },
        check: { type: "boolean" },
        "dry-run": { type: "boolean" },
      });
      const res = closeRun(cfg, {
        project: req(v.project, "project"),
        check: Boolean(v.check),
        dryRun: Boolean(v["dry-run"]),
      });
      console.log(JSON.stringify(res, null, 2));
      return "clean" in res && res.clean === false ? 1 : 0;
    }
    case "cleanup": {
      const v = opt(rest, {
        project: { type: "string" },
        branches: { type: "boolean" },
        "all-branches": { type: "boolean" },
        force: { type: "boolean" },
        "dry-run": { type: "boolean" },
      });
      const res = cleanupRun(cfg, {
        project: req(v.project, "project"),
        branches: Boolean(v.branches),
        allBranches: Boolean(v["all-branches"]),
        force: Boolean(v.force),
        dryRun: Boolean(v["dry-run"]),
      });
      console.log(JSON.stringify(res, null, 2));
      return res.worktreesSkipped > 0 ? 1 : 0;
    }
    case "doctor": {
      const report = await doctor(cfg);
      console.log(JSON.stringify(report, null, 2));
      return report.ok ? 0 : 1;
    }
    case "mcp": {
      const { runMcp } = await import("./mcp.js");
      await runMcp();
      return new Promise<number>(() => {
        /* serve until the transport closes the process */
      });
    }
    case "_worker": {
      const v = opt(rest, { "run-dir": { type: "string" }, name: { type: "string" } });
      return await workerMain(
        req(v["run-dir"], "run-dir"),
        req(v.name, "name"),
      );
    }
    case undefined:
    case "help":
    case "--help":
    case "-h":
      process.stdout.write(USAGE);
      return cmd === undefined ? 1 : 0;
    default:
      throw new EngineError("E_COMMAND", `unknown command: ${cmd}\n${USAGE}`);
  }

  console.log(JSON.stringify(out, null, 2));
  return 0;
}

main().then(
  (rc) => process.exit(rc),
  (e) => {
    const code = e instanceof EngineError ? e.code : "E_INTERNAL";
    console.error(JSON.stringify({ code, message: e instanceof Error ? e.message : String(e) }));
    process.exit(1);
  },
);
