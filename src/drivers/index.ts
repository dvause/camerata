import { spawnSync } from "node:child_process";
import type { BackendConfig, Config, Loe, Tier } from "../config.js";
import { fail } from "../errors.js";
import { commandLine, isWindows } from "../platform.js";

export type Backend = "codex" | "claude";
export type GitMode = "ro" | "none";

export interface SpawnSpec {
  cmd: string;
  args: string[];
  // undefined value = strip that variable from the child env
  env?: Record<string, string | undefined>;
  cwd?: string;
}

export interface WorkerDriver {
  name: Backend;
  check(): Promise<{ available: boolean; reason?: string }>;
  tiers: Record<Loe, Tier>;
  defaults: Tier;
  fallbackModel: string;
  spawnSpec(opts: { model: string; reasoning: string; worktree: string; gitMode: GitMode }): SpawnSpec;
  parseTokens(log: string): number | null;
  modelUnavailable(logTail: string): boolean;
}

function cliOnPath(cmd: string): { available: boolean; reason?: string } {
  const c = commandLine(cmd, ["--version"]);
  const r = spawnSync(c.cmd, c.args, {
    stdio: "ignore",
    windowsVerbatimArguments: c.windowsVerbatimArguments,
  });
  if (r.error || r.status !== 0) {
    return { available: false, reason: `${cmd} CLI not found on PATH` };
  }
  return { available: true };
}

function tail20(log: string): string {
  return log.split("\n").slice(-20).join("\n");
}

function makeCodex(bc: BackendConfig): WorkerDriver {
  return {
    name: "codex",
    async check() {
      if (isWindows) {
        return {
          available: false,
          reason: "codex sandbox is unavailable on native Windows; use the claude backend",
        };
      }
      return cliOnPath("codex");
    },
    tiers: bc.tiers,
    defaults: bc.defaults,
    fallbackModel: bc.fallbackModel,
    spawnSpec({ model, reasoning, worktree, gitMode }) {
      return {
        cmd: "codex",
        args: [
          "exec",
          "--sandbox",
          gitMode === "ro" ? "read-only" : "workspace-write",
          "-m",
          model,
          "-c",
          `model_reasoning_effort="${reasoning}"`,
          "-C",
          worktree,
        ],
        env: { CAMERATA_WORKER: "1" },
      };
    },
    parseTokens(log) {
      // v1 format: a line reading exactly "tokens used", value on the next line.
      const lines = log.split("\n");
      let sum = 0;
      let found = false;
      for (let i = 0; i < lines.length - 1; i++) {
        if (lines[i].trim() === "tokens used") {
          const v = lines[i + 1].trim();
          if (/^[0-9][0-9,]*$/.test(v)) {
            sum += Number(v.replaceAll(",", ""));
            found = true;
          }
        }
      }
      return found ? sum : null;
    },
    modelUnavailable(log) {
      return /model_not_found|invalid_model|invalid model|model[\s_-].*(not found|unknown|not available|does not exist)/i.test(
        tail20(log),
      );
    },
  };
}

function makeClaude(bc: BackendConfig): WorkerDriver {
  return {
    name: "claude",
    async check() {
      return cliOnPath("claude");
    },
    tiers: bc.tiers,
    defaults: bc.defaults,
    fallbackModel: bc.fallbackModel,
    spawnSpec({ model, reasoning, worktree }) {
      // No filesystem sandbox: confinement is cwd + prompt preamble +
      // launcher-owned commits + orchestrator diff review (v1 ADR 0005).
      // The git deny below is friction, not a boundary.
      return {
        cmd: "claude",
        args: [
          "-p",
          "--model",
          model,
          "--effort",
          reasoning,
          "--permission-mode",
          "acceptEdits",
          "--allowedTools",
          "Bash",
          "--disallowedTools",
          "Bash(git *)",
          "--output-format",
          "text",
        ],
        cwd: worktree,
        env: {
          // strip the parent Claude Code session's markers so the nested
          // headless run behaves like a fresh CLI invocation
          CLAUDECODE: undefined,
          CLAUDE_CODE_ENTRYPOINT: undefined,
          CLAUDE_CODE_SSE_PORT: undefined,
          CAMERATA_WORKER: "1",
        },
      };
    },
    parseTokens() {
      // Never solved in v1; open question in the spec.
      return null;
    },
    modelUnavailable(log) {
      return /not_found_error|invalid_model|invalid model|unknown model|model[\s_:-].*(not found|unknown|not available|does not exist)/i.test(
        tail20(log),
      );
    },
  };
}

export function getDriver(backend: string, cfg: Config): WorkerDriver {
  if (backend === "codex") return makeCodex(cfg.backends.codex);
  if (backend === "claude") return makeClaude(cfg.backends.claude);
  fail("E_BACKEND", `backend must be codex or claude (got ${backend})`);
}
