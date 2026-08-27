import { spawn } from "node:child_process";
import {
  closeSync,
  constants,
  copyFileSync,
  cpSync,
  existsSync,
  openSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Config, Loe } from "./config.js";
import { getDriver, type GitMode } from "./drivers/index.js";
import { fail } from "./errors.js";
import { appendDispatch } from "./ledger.js";
import {
  appendManifest,
  appendProgress,
  atomicWriteJson,
  branchExists,
  findRunDir,
  git,
  readManifest,
  readRun,
  validateSlug,
} from "./run.js";

export interface DispatchOpts {
  project: string;
  name: string;
  goalFile: string;
  backend?: string;
  loe?: string;
  model?: string;
  reasoning?: string;
  commit?: boolean;
  task?: string;
  attempt?: number;
  policy?: string;
  timeoutS?: number;
  gitMode?: string;
  base?: string;
}

// Workers run sandboxed with no network, so dependencies can never arrive via
// install; a symlinked node_modules is both sandbox-unwritable (test runners
// write temp files inside it, and writes resolving outside the worktree are
// denied) and stageable (a trailing-slash ignore pattern matches a directory,
// not a symlink). A real copy avoids both. COPYFILE_FICLONE_FORCE is an APFS
// clonefile — copy-on-write, near-free — with a plain copy as the cross-volume
// fallback. No commitignore entry is written: the repo's own gitignore covers
// the directory, and an explicit entry makes the launcher's dot-pathspec
// staging error on the already-ignored path.
// ponytail: root node_modules only; nested workspace trees
// (packages/*/node_modules) are a known ceiling.
function provisionNodeModules(repo: string, worktree: string, runDir: string): void {
  const src = join(repo, "node_modules");
  if (!existsSync(src)) return;
  const dest = join(worktree, "node_modules");
  try {
    cpSync(src, dest, { recursive: true, mode: constants.COPYFILE_FICLONE_FORCE });
  } catch {
    cpSync(src, dest, { recursive: true, force: true });
    appendProgress(runDir, `node_modules clone unsupported (non-APFS?); plain copy for ${dest}`);
  }
}

export async function dispatchWorker(
  cfg: Config,
  opts: DispatchOpts,
): Promise<{ name: string; branch: string; worktree: string; log: string }> {
  const runDir = findRunDir(cfg, opts.project);
  const run = readRun(runDir);

  // ---- shape validation (caller errors; no budget consumed) ----
  validateSlug("name", opts.name);
  const task = opts.task ?? opts.name;
  validateSlug("task", task);
  const attempt = opts.attempt ?? 1;
  if (!Number.isInteger(attempt) || attempt < 1) fail("E_ARG", "attempt must be a positive integer");
  const policy = opts.policy ?? "-";
  if (/[\t\n\r]/.test(policy)) fail("E_ARG", "policy must be a single line without tabs");
  const backend = opts.backend ?? "codex";
  const gitMode = (opts.gitMode ?? "none") as GitMode;
  if (gitMode !== "ro" && gitMode !== "none") fail("E_ARG", "gitMode must be ro or none");
  if (backend === "claude" && gitMode === "ro") {
    fail(
      "E_GIT_MODE",
      "gitMode ro is not supported with the claude backend (deny-wins tool precedence makes read-only git unexpressible; use codex, whose sandbox is the real boundary)",
    );
  }
  if (opts.loe && !["low", "medium", "high", "xhigh"].includes(opts.loe)) {
    fail("E_ARG", "loe must be low, medium, high, or xhigh");
  }
  const timeoutS = opts.timeoutS ?? run.workerTimeoutS;
  if (!Number.isInteger(timeoutS) || timeoutS < 0) {
    fail("E_ARG", "timeoutS must be a non-negative integer");
  }
  if (!existsSync(opts.goalFile) || statSync(opts.goalFile).size === 0) {
    fail("E_GOAL", `goal file missing or empty: ${opts.goalFile}`);
  }

  const driver = getDriver(backend, cfg);
  const loe = opts.loe as Loe | undefined;
  const model = opts.model ?? (loe ? driver.tiers[loe].model : driver.defaults.model);
  const reasoning = opts.reasoning ?? (loe ? driver.tiers[loe].reasoning : driver.defaults.reasoning);

  // ---- ledger row first: refusals past this point stay visible ----
  await appendDispatch(runDir, run.retryBudget, { task, attempt, name: opts.name, policy });

  if (readManifest(runDir).some((r) => r.name === opts.name)) {
    fail("E_NAME_REUSED", `worker name already used in this run: ${opts.name}`);
  }
  const branch = `agent/${opts.name}`;
  const worktree = join(runDir, `wt-${opts.name}`);
  if (existsSync(worktree)) fail("E_WORKTREE_EXISTS", `worktree already exists: ${worktree}`);
  if (branchExists(run.repo, branch)) fail("E_BRANCH_EXISTS", `branch already exists: ${branch}`);

  const check = await driver.check();
  if (!check.available) fail("E_BACKEND_UNAVAILABLE", check.reason ?? `${backend} unavailable`);

  const base = opts.base
    ? git(["-C", run.repo, "rev-parse", opts.base]).stdout.trim()
    : run.baseSha;

  const goal = join(runDir, "goals", `${opts.name}.goal.md`);
  copyFileSync(opts.goalFile, goal);
  git(["-C", run.repo, "worktree", "add", "-b", branch, worktree, base]);
  provisionNodeModules(run.repo, worktree, runDir);

  const log = join(runDir, "logs", `${opts.name}.log`);
  appendManifest(runDir, {
    name: opts.name,
    task,
    attempt,
    branch,
    worktree,
    goal,
    log,
    commit: opts.commit ?? false,
    base,
    backend,
    requestedModel: model,
    reasoning,
    gitMode,
    policy,
    timeoutS,
    launchedAt: new Date().toISOString(),
  });

  // Detached child owns the driver run, timeout, fallback, commit, status.
  const cliJs = fileURLToPath(new URL("./cli.js", import.meta.url));
  const fd = openSync(log, "a");
  const child = spawn(
    process.execPath,
    [cliJs, "_worker", "--run-dir", runDir, "--name", opts.name],
    { detached: true, stdio: ["ignore", fd, fd] },
  );
  closeSync(fd);
  child.unref();

  atomicWriteJson(join(runDir, "status", `${opts.name}.json`), {
    state: "running",
    model,
    requestedModel: model,
    backend,
    pid: child.pid,
    startedAt: new Date().toISOString(),
  });
  appendProgress(
    runDir,
    `dispatched ${opts.name} (backend=${backend} model=${model} task=${task} attempt=${attempt})`,
  );
  return { name: opts.name, branch, worktree, log };
}
