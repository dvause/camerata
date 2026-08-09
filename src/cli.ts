#!/usr/bin/env node
// Thin CLI over the engine library; subcommands mirror the MCP tools 1:1.
import { parseArgs } from "node:util";
import { loadConfig } from "./config.js";
import { EngineError } from "./errors.js";
import { dispatchWorker } from "./dispatch.js";
import { initRun } from "./run.js";
import { workerStatus } from "./status.js";
import { waitWorkers } from "./wait.js";
import { workerMain } from "./_worker.js";

const USAGE = `usage: camerata <command> [options]

commands:
  init      --project P --repo DIR [--resume]
  dispatch  --project P --name N --goal-file F [--backend codex|claude]
            [--loe low|medium|high|xhigh] [--model M] [--reasoning R]
            [--commit] [--task T] [--attempt N] [--policy S]
            [--timeout-s N] [--git-mode ro|none] [--base REF]
  status    --project P
  wait      --project P --timeout-s N [--workers a,b] [--mode any|all]
`;

function opt(args: string[], options: Record<string, { type: "string" | "boolean" }>) {
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
        project: req(v.project as string | undefined, "project"),
        repo: req(v.repo as string | undefined, "repo"),
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
        project: req(v.project as string | undefined, "project"),
        name: req(v.name as string | undefined, "name"),
        goalFile: req(v["goal-file"] as string | undefined, "goal-file"),
        backend: v.backend as string | undefined,
        loe: v.loe as string | undefined,
        model: v.model as string | undefined,
        reasoning: v.reasoning as string | undefined,
        commit: Boolean(v.commit),
        task: v.task as string | undefined,
        attempt: intOr(v.attempt as string | undefined, "attempt"),
        policy: v.policy as string | undefined,
        timeoutS: intOr(v["timeout-s"] as string | undefined, "timeout-s"),
        gitMode: v["git-mode"] as string | undefined,
        base: v.base as string | undefined,
      });
      break;
    }
    case "status": {
      const v = opt(rest, { project: { type: "string" } });
      out = workerStatus(cfg, req(v.project as string | undefined, "project"));
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
        project: req(v.project as string | undefined, "project"),
        timeoutS: intOr(v["timeout-s"] as string | undefined, "timeout-s") ?? 0,
        workers: (v.workers as string | undefined)?.split(",").filter((w) => w !== ""),
        mode: v.mode as "any" | "all" | undefined,
      });
      break;
    }
    case "_worker": {
      const v = opt(rest, { "run-dir": { type: "string" }, name: { type: "string" } });
      return await workerMain(
        req(v["run-dir"] as string | undefined, "run-dir"),
        req(v.name as string | undefined, "name"),
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
