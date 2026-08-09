// Hidden subcommand behind `dispatch` — v1's codex-worker.sh reborn. Runs
// detached: owns the driver run, timeout, model fallback, post-run commit, and
// status writes. Its stdout/stderr are the worker log.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "./config.js";
import { getDriver, type GitMode, type WorkerDriver } from "./drivers/index.js";
import { commandLine, isWindows, killTree } from "./platform.js";
import { atomicWriteJson, appendProgress, git, readManifest } from "./run.js";

// Worker charter (v1 text carried over). Workers never run git themselves:
// the launcher commits after the worker finishes.
function buildPrompt(name: string, worktree: string, gitMode: GitMode, goal: string): string {
  const head = `You are a bounded worker agent named "${name}" dispatched by an orchestrator.
You are running inside an isolated git worktree at: ${worktree}
That worktree is your ENTIRE world. Only create or modify files inside it.
Do not touch other worktrees, dependency lockfiles, migrations, generated code,
or global config unless your goal below explicitly says to.
`;
  const gitRules =
    gitMode === "ro"
      ? `You MAY run READ-ONLY git commands (log, show, diff, blame, shortlog, for-each-ref, ls-files). Do NOT run git commands that write anything (add/commit/checkout/switch/restore/reset/merge/rebase/push/pull/fetch/stash/clean/branch/tag/worktree/remote/config). Leave your changes in the working tree; the orchestrator reviews and commits them.
`
      : `Do NOT run git yourself (no add/commit). Just leave your changes in the working
tree; the orchestrator reviews and commits them.
`;
  return `${head}${gitRules}If your goal requires forbidden scope, STOP and explain why instead of proceeding.

Below is your /goal.
====================================================================
${goal}`;
}

function parseCommitIgnore(file: string): string[] {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const excludes: string[] = [];
  for (let line of text.split("\n")) {
    line = line.replace(/\r$/, "").trim();
    if (line === "" || line.startsWith("#")) continue;
    if (line.startsWith(":")) {
      throw new Error(`${file}: raw pathspec magic is not allowed; the launcher adds the magic`);
    }
    line = line.replace(/\/+$/, "");
    if (line === "") throw new Error(`${file}: line reduces to an empty pattern`);
    excludes.push(`:(exclude)${line}`);
  }
  return excludes;
}

function runDriver(
  driver: WorkerDriver,
  opts: { model: string; reasoning: string; worktree: string; gitMode: GitMode },
  prompt: string,
  timeoutS: number,
): Promise<{ rc: number; timedOut: boolean }> {
  return new Promise((resolvePromise) => {
    const spec = driver.spawnSpec(opts);
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const [k, v] of Object.entries(spec.env ?? {})) {
      if (v === undefined) delete env[k];
      else env[k] = v;
    }
    // detached: own process group, so a timeout can kill the whole tree
    const c = commandLine(spec.cmd, spec.args);
    const child = spawn(c.cmd, c.args, {
      cwd: spec.cwd ?? opts.worktree,
      env,
      detached: !isWindows,
      stdio: ["pipe", "inherit", "inherit"],
      windowsVerbatimArguments: c.windowsVerbatimArguments,
    });
    let timedOut = false;
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    if (timeoutS > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        killTree(child.pid!);
        const hard = setTimeout(() => {
          if (!settled) killTree(child.pid!, "SIGKILL");
        }, 5000);
        hard.unref();
      }, timeoutS * 1000);
    }
    child.on("error", (e) => {
      settled = true;
      if (timer) clearTimeout(timer);
      console.error(`camerata-worker: driver spawn failed: ${e.message}`);
      resolvePromise({ rc: 127, timedOut: false });
    });
    child.on("exit", (code, signal) => {
      settled = true;
      if (timer) clearTimeout(timer);
      resolvePromise({ rc: code ?? (signal ? 1 : 0), timedOut });
    });
    child.stdin.on("error", () => {
      /* driver exited before reading the prompt */
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

export async function workerMain(runDir: string, name: string): Promise<number> {
  const cfg = loadConfig();
  const row = readManifest(runDir).find((r) => r.name === name);
  if (!row) {
    console.error(`camerata-worker[${name}]: no manifest row`);
    return 1;
  }
  const driver = getDriver(row.backend, cfg);
  const gitMode = row.gitMode as GitMode;
  const statusFile = join(runDir, "status", `${name}.json`);
  let initial: Record<string, unknown> = {};
  try {
    initial = JSON.parse(readFileSync(statusFile, "utf8"));
  } catch {
    /* dispatch died before writing it */
  }
  const base = {
    requestedModel: row.requestedModel,
    backend: row.backend,
    pid: (initial.pid as number) ?? process.pid,
    startedAt: (initial.startedAt as string) ?? new Date().toISOString(),
  };

  const prompt = buildPrompt(name, row.worktree, gitMode, readFileSync(row.goal, "utf8"));
  let model = row.requestedModel;
  const started = Date.now();
  let { rc, timedOut } = await runDriver(
    driver,
    { model, reasoning: row.reasoning, worktree: row.worktree, gitMode },
    prompt,
    row.timeoutS,
  );

  // Model-not-found fallback: match confined to the log tail so ordinary
  // worker output earlier in the log cannot fake it.
  const readLog = () => {
    try {
      return readFileSync(row.log, "utf8");
    } catch {
      return "";
    }
  };
  if (rc !== 0 && !timedOut && model !== driver.fallbackModel && driver.modelUnavailable(readLog())) {
    console.error(`camerata-worker[${name}]: model ${model} unavailable, retrying with ${driver.fallbackModel}`);
    model = driver.fallbackModel;
    atomicWriteJson(statusFile, { state: "running", model, ...base });
    ({ rc, timedOut } = await runDriver(
      driver,
      { model, reasoning: row.reasoning, worktree: row.worktree, gitMode },
      prompt,
      row.timeoutS,
    ));
  }
  const durationS = Math.round((Date.now() - started) / 1000);
  const tokens = driver.parseTokens(readLog());
  const finish = (extra: Record<string, unknown>) => {
    atomicWriteJson(statusFile, {
      ...extra,
      model,
      ...base,
      finishedAt: new Date().toISOString(),
      tokens,
      durationS,
    });
  };

  if (rc !== 0 || timedOut) {
    const reason = timedOut ? "timeout" : "spawn-crash";
    finish({ state: "failed", exitCode: rc, reason });
    appendProgress(runDir, `worker ${name} failed (reason=${reason} exit=${rc})`);
    console.error(`camerata-worker[${name}]: FAILED exit=${rc} reason=${reason}`);
    return rc || 1;
  }

  // Launcher commits the worker's changes (reliable: runs outside the worker
  // backend). Single squashed commit; the orchestrator reviews the diff.
  if (row.commit) {
    const excludes = parseCommitIgnore(join(runDir, "commitignore", name));
    const addArgs =
      excludes.length > 0
        ? ["-C", row.worktree, "add", "-A", "--", ".", ...excludes]
        : ["-C", row.worktree, "add", "-A"];
    const add = git(addArgs, { allowFail: true });
    if (add.status !== 0) {
      finish({ state: "failed", exitCode: 1, reason: "git-add" });
      appendProgress(runDir, `worker ${name} failed (reason=git-add)`);
      console.error(`camerata-worker[${name}]: FAILED git add: ${add.stderr.trim()}`);
      return 1;
    }
    const staged = git(["-C", row.worktree, "diff", "--cached", "--quiet"], { allowFail: true });
    if (staged.status !== 0) {
      const commit = git(
        [
          "-C",
          row.worktree,
          "-c",
          "user.email=camerata@local",
          "-c",
          `user.name=camerata-worker[${name}]`,
          "commit",
          "-qm",
          `feat(${name}): worker changes`,
        ],
        { allowFail: true },
      );
      if (commit.status !== 0) {
        finish({ state: "failed", exitCode: commit.status, reason: "git-commit" });
        appendProgress(runDir, `worker ${name} failed (reason=git-commit)`);
        console.error(`camerata-worker[${name}]: FAILED git commit: ${commit.stderr.trim()}`);
        return commit.status;
      }
      console.error(`camerata-worker[${name}]: committed on ${row.branch}`);
    }
  }

  const ahead = git(["-C", row.worktree, "rev-list", "--count", `${row.base}..HEAD`], {
    allowFail: true,
  }).stdout.trim();
  const dirty = git(["-C", row.worktree, "status", "--porcelain"], { allowFail: true }).stdout.trim();
  const diff = Number(ahead) > 0 || dirty !== "" ? "nonempty" : "empty";
  finish({ state: "done", exitCode: 0, diff });
  appendProgress(runDir, `worker ${name} done (model=${model} diff=${diff})`);
  console.error(`camerata-worker[${name}]: done (model=${model})`);
  return 0;
}
