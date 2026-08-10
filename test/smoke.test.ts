// Hermetic end-to-end smoke: fake codex/claude shims on PATH, no network, no
// API spend. Drives the packed npm artifact — not the source tree — exactly as
// an orchestrator would.
import { spawn, spawnSync } from "node:child_process";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isAlive } from "../src/platform.js";
import { packCli } from "./pack.js";

const isWindows = process.platform === "win32";
// codex refuses on native Windows by design; the claude backend carries the run
const backend = isWindows ? "claude" : "codex";
const fallbackModel = isWindows ? "sonnet" : "gpt-5.6-terra";

let root: string;
let cliJs: string;
let home: string;
let shims: string;
let repo: string;
let goalDir: string;
let runDir: string;
let baseSha: string;

const SHIM_JS = `
const fs = require("fs");
const path = require("path");
const args = process.argv.slice(2);
if (args.includes("--version")) { console.log("shim 0.0.0"); process.exit(0); }
let dir = process.cwd();
const ci = args.indexOf("-C");
if (ci >= 0) dir = args[ci + 1];
const mi = args.indexOf("-m");
let model = mi >= 0 ? args[mi + 1] : "";
const mo = args.indexOf("--model");
if (mo >= 0) model = args[mo + 1];
let prompt = "";
process.stdin.on("data", (d) => (prompt += d));
process.stdin.on("end", () => {
  if (model === "bogus") { console.error("model_not_found: model bogus does not exist"); process.exit(1); }
  if (prompt.includes("SHIM:FAIL")) { console.error("shim: crashing as instructed"); process.exit(1); }
  if (prompt.includes("SHIM:STALL")) {
    if (prompt.includes("SHIM:CHILD")) {
      // A grandchild of the launcher: only a process-TREE kill reaches it.
      const kid = require("child_process").spawn(
        process.execPath, ["-e", "setTimeout(() => {}, 600000)"], { stdio: "ignore" });
      fs.writeFileSync(path.join(dir, "child.pid"), String(kid.pid));
    }
    setTimeout(() => process.exit(0), 120000);
    return;
  }
  if (prompt.includes("SHIM:FINDINGS")) {
    fs.writeFileSync(path.join(dir, "FINDINGS.md"), "## F1 shim finding\\n\\nEvidence here.\\n");
    console.log("findings written");
    process.exit(0);
  }
  fs.writeFileSync(path.join(dir, "shim-output.txt"), "shim did work\\n");
  console.log("worker done");
  console.log("tokens used");
  console.log("1,234");
  process.exit(0);
});
`;

function installShim(name: string): void {
  const js = join(shims, `${name}-impl.cjs`);
  writeFileSync(js, SHIM_JS);
  writeFileSync(join(shims, `${name}.cmd`), `@"${process.execPath}" "${js}" %*\r\n`);
  const sh = join(shims, name);
  writeFileSync(sh, `#!/bin/sh\nexec "${process.execPath}" "${js}" "$@"\n`);
  chmodSync(sh, 0o755);
}

function env(): NodeJS.ProcessEnv {
  const e: NodeJS.ProcessEnv = {
    ...process.env,
    CAMERATA_HOME: home,
    // hermetic: ambient git identity/config must not leak into the run
    GIT_CONFIG_GLOBAL: join(root, "gitconfig-empty"),
    GIT_CONFIG_SYSTEM: join(root, "gitconfig-empty"),
  };
  const pathKey = Object.keys(e).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  e[pathKey] = shims + delimiter + (e[pathKey] ?? "");
  return e;
}

function cli(args: string[]) {
  const r = spawnSync(process.execPath, [cliJs, ...args], { encoding: "utf8", env: env() });
  let json: any;
  try {
    json = JSON.parse(r.stdout);
  } catch {
    /* refusals print to stderr */
  }
  let error: any;
  try {
    error = JSON.parse(r.stderr.trim().split("\n").at(-1) ?? "");
  } catch {
    /* no structured error */
  }
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, json, error };
}

function gitOut(args: string[]): string {
  const r = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  expect(r.status).toBe(0);
  return r.stdout.trim();
}

function goal(name: string, content: string): string {
  const f = join(goalDir, `${name}.md`);
  writeFileSync(f, content);
  return f;
}

function dispatch(name: string, goalContent: string, extra: string[] = []) {
  return cli([
    "dispatch",
    "--project",
    "smoke",
    "--name",
    name,
    "--goal-file",
    goal(name, goalContent),
    "--backend",
    backend,
    ...extra,
  ]);
}

function waitFor(workers: string, timeoutS = 60) {
  return cli([
    "wait",
    "--project",
    "smoke",
    "--timeout-s",
    String(timeoutS),
    "--workers",
    workers,
    "--mode",
    "all",
  ]);
}

function statusOf(name: string) {
  const r = cli(["status", "--project", "smoke"]);
  expect(r.status).toBe(0);
  return r.json.workers.find((w: any) => w.name === name);
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "camerata-smoke-"));
  cliJs = packCli(join(root, "pack"));
  home = join(root, "home");
  shims = join(root, "shims");
  repo = join(root, "target-repo");
  goalDir = join(root, "goals");
  for (const d of [home, shims, repo, goalDir, join(root, "no-tools")]) {
    mkdirSync(d, { recursive: true });
  }
  writeFileSync(join(root, "gitconfig-empty"), "");
  installShim("codex");
  installShim("claude");
  const g = (args: string[]) => {
    const r = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  };
  g(["init", "-b", "main"]);
  writeFileSync(join(repo, "README.md"), "target\n");
  g(["add", "README.md"]);
  g(["-c", "user.email=smoke@local", "-c", "user.name=smoke", "commit", "-qm", "initial"]);
});

afterAll(() => {
  // Give the stall worker's detached launcher a moment to die with the run.
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    /* Windows can hold handles briefly; temp dir is ephemeral anyway */
  }
});

describe("engine smoke (hermetic)", () => {
  it("init creates the run and records the base SHA", () => {
    const r = cli(["init", "--project", "smoke", "--repo", repo]);
    expect(r.status).toBe(0);
    runDir = r.json.runDir;
    baseSha = r.json.baseSha;
    expect(existsSync(join(runDir, "run.json"))).toBe(true);
    expect(baseSha).toBe(gitOut(["rev-parse", "HEAD"]));
  });

  it("init refuses reuse without resume; resume verifies repo + base", () => {
    const again = cli(["init", "--project", "smoke", "--repo", repo]);
    expect(again.status).toBe(1);
    expect(again.error.code).toBe("E_RUN_EXISTS");
    const resume = cli(["init", "--project", "smoke", "--repo", repo, "--resume"]);
    expect(resume.status).toBe(0);
    expect(JSON.parse(readFileSync(join(runDir, "run.json"), "utf8")).resumedAt).toBeTruthy();
  });

  it("dispatch → wait → status: worker done, launcher committed on its branch", () => {
    const d = dispatch("w1", "Create a file. Any file.", ["--commit"]);
    expect(d.status).toBe(0);
    expect(d.json.branch).toBe("agent/w1");

    const w = waitFor("w1");
    expect(w.status).toBe(0);
    expect(w.json.timedOut).toBe(false);
    expect(w.json.workers[0].state).toBe("done");

    const st = statusOf("w1");
    expect(st.state).toBe("done");
    expect(st.diff).toBe("nonempty");
    if (backend === "codex") expect(st.tokens).toBe(1234);
    expect(st.model).toBe(fallbackModel); // default model == fallback tier
    expect(gitOut(["show", "--name-only", "--format=%s", "agent/w1"])).toContain("shim-output.txt");
  }, 90_000);

  it.skipIf(isWindows)("claude backend completes the same flow", () => {
    const d = cli([
      "dispatch",
      "--project",
      "smoke",
      "--name",
      "w2",
      "--goal-file",
      goal("w2", "Create a file."),
      "--backend",
      "claude",
      "--commit",
    ]);
    expect(d.status).toBe(0);
    const w = waitFor("w2");
    expect(w.json.workers[0].state).toBe("done");
    expect(statusOf("w2").tokens).toBeNull(); // claude token parsing: open question
  }, 90_000);

  it.skipIf(!isWindows)("codex dispatch refuses on native Windows with a clear reason", () => {
    const d = cli([
      "dispatch",
      "--project",
      "smoke",
      "--name",
      "wcodex",
      "--goal-file",
      goal("wcodex", "anything"),
      "--backend",
      "codex",
    ]);
    expect(d.status).toBe(1);
    expect(d.error.code).toBe("E_BACKEND_UNAVAILABLE");
    expect(d.error.message).toContain("Windows");
  });

  it("a timed-out worker is killed with its whole process tree", async () => {
    const d = dispatch("w3", "SHIM:STALL SHIM:CHILD — never finish.", ["--timeout-s", "2"]);
    expect(d.status).toBe(0);
    const w = waitFor("w3", 30);
    expect(w.json.timedOut).toBe(false);
    const st = statusOf("w3");
    expect(st.state).toBe("failed");
    expect(st.reason).toBe("timeout");

    // The stalling shim spawned a grandchild; process-group kill (POSIX) and
    // `taskkill /T` (Windows) must both reach it.
    const kid = Number(readFileSync(join(d.json.worktree, "child.pid"), "utf8").trim());
    expect(Number.isInteger(kid)).toBe(true);
    for (let i = 0; i < 50 && isAlive(kid); i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(isAlive(kid)).toBe(false);
  }, 90_000);

  it("model fallback: unavailable model retries once on the fallback, both visible", () => {
    const d = dispatch("w4", "Create a file.", ["--model", "bogus", "--commit"]);
    expect(d.status).toBe(0);
    const w = waitFor("w4");
    expect(w.json.workers[0].state).toBe("done");
    const st = statusOf("w4");
    expect(st.requestedModel).toBe("bogus");
    expect(st.model).toBe(fallbackModel);
  }, 90_000);

  it("duplicate worker names are refused", () => {
    const d = dispatch("w1", "anything", ["--task", "dup-check"]);
    expect(d.status).toBe(1);
    expect(d.error.code).toBe("E_NAME_REUSED");
  });

  it("claude + gitMode ro is refused", () => {
    const d = cli([
      "dispatch",
      "--project",
      "smoke",
      "--name",
      "wro",
      "--goal-file",
      goal("wro", "anything"),
      "--backend",
      "claude",
      "--git-mode",
      "ro",
    ]);
    expect(d.status).toBe(1);
    expect(d.error.code).toBe("E_GIT_MODE");
  });

  it("over-budget retries are refused and every attempt stays visible", () => {
    for (let i = 1; i <= 3; i++) {
      const d = dispatch(`w9-${i}`, "SHIM:FAIL", ["--task", "t9", "--attempt", String(i)]);
      expect(d.status).toBe(0);
    }
    const d4 = dispatch("w9-4", "SHIM:FAIL", ["--task", "t9", "--attempt", "4"]);
    expect(d4.status).toBe(1);
    expect(d4.error.code).toBe("E_BUDGET");
    const ledger = readFileSync(join(runDir, "recovery.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l))
      .filter((r) => r.task === "t9");
    expect(ledger).toHaveLength(3);
    const mismatch = dispatch("w10", "anything", ["--task", "t10", "--attempt", "2"]);
    expect(mismatch.status).toBe(1);
    expect(mismatch.error.code).toBe("E_ATTEMPT");
  }, 90_000);

  it("scope check: * crosses /, violations reported against the allowlist", () => {
    mkdirSync(join(runDir, "allow"), { recursive: true });
    writeFileSync(join(runDir, "allow", "w1.allow"), "docs/*\n");
    let st = statusOf("w1");
    expect(st.violations).toContain("shim-output.txt");
    writeFileSync(join(runDir, "allow", "w1.allow"), "shim-*\n");
    st = statusOf("w1");
    expect(st.violations).toEqual([]);
  });

  it("wait returns a timeout marker while workers still run", () => {
    const d = dispatch("w5", "SHIM:STALL", ["--timeout-s", "8"]);
    expect(d.status).toBe(0);
    const w = waitFor("w5", 2);
    expect(w.status).toBe(0);
    expect(w.json.timedOut).toBe(true);
    // let it settle so afterAll can remove the temp dir
    const settled = waitFor("w5", 30);
    expect(settled.json.timedOut).toBe(false);
  }, 90_000);

  it("target repo stays pristine: no files written, only refs", () => {
    expect(gitOut(["status", "--porcelain"])).toBe("");
    expect(gitOut(["rev-parse", "--verify", "agent/w1"])).toBeTruthy();
  });

  it("doctor probes git and both backends; codex refuses on native Windows", () => {
    const r = cli(["doctor"]);
    expect(r.status).toBe(0);
    expect(r.json.ok).toBe(true);
    expect(r.json.git.available).toBe(true);
    expect(r.json.dataDir).toBe(home);
    expect(r.json.backends.claude.available).toBe(true);
    expect(r.json.backends.codex.available).toBe(!isWindows);
    if (isWindows) expect(r.json.backends.codex.reason).toMatch(/sandbox is unavailable/);
  });

  it("doctor reports a missing backend CLI without a stack trace", () => {
    const bare = env();
    for (const k of Object.keys(bare)) {
      if (k.toUpperCase() === "PATH") bare[k] = join(root, "no-tools");
    }
    const r = spawnSync(process.execPath, [cliJs, "doctor"], { encoding: "utf8", env: bare });
    expect(r.status).toBe(1);
    const report = JSON.parse(r.stdout);
    expect(report.ok).toBe(false);
    expect(report.backends.claude.available).toBe(false);
    expect(report.backends.claude.reason).toBe("claude CLI not found on PATH");
  });
});

// Speak newline-delimited JSON-RPC to `camerata mcp`, return responses by id.
function mcpCall(requests: Record<string, unknown>[]): Promise<Record<number, any>> {
  return new Promise((res, rej) => {
    const child = spawn(process.execPath, [cliJs, "mcp"], { env: env() });
    const wanted = new Set(requests.map((r) => r.id).filter((id) => id !== undefined));
    const got: Record<number, any> = {};
    let buf = "";
    const finish = (err?: Error) => {
      child.kill();
      err ? rej(err) : res(got);
    };
    child.stdout.on("data", (d) => {
      buf += d;
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line === "") continue;
        const msg = JSON.parse(line);
        if (msg.id !== undefined && wanted.has(msg.id)) {
          got[msg.id] = msg;
          if (Object.keys(got).length === wanted.size) finish();
        }
      }
    });
    child.on("error", (e) => finish(e));
    setTimeout(() => finish(new Error("mcp timeout")), 20_000).unref();
    for (const r of requests) child.stdin.write(JSON.stringify(r) + "\n");
  });
}

describe("integrate / collect / escalate / close (M2)", () => {
  it("integrate review: diffstat + commit list vs recorded base", () => {
    const r = cli(["integrate", "--project", "smoke", "--branch", "agent/w1", "--mode", "review"]);
    expect(r.status).toBe(0);
    expect(r.json.diffstat).toContain("shim-output.txt");
    expect(r.json.commits).toHaveLength(1);
    expect(r.json.base).toBe(baseSha);
  });

  it("integrate refuses an unknown branch", () => {
    const r = cli(["integrate", "--project", "smoke", "--branch", "agent/nope", "--mode", "review"]);
    expect(r.status).toBe(1);
    expect(r.error.code).toBe("E_BRANCH_NOT_FOUND");
  });

  it("integrate merge: one branch at a time into integration/<project>", () => {
    const r1 = cli(["integrate", "--project", "smoke", "--branch", "agent/w1", "--mode", "merge"]);
    expect(r1.status).toBe(0);
    expect(r1.json.integration).toBe("integration/smoke");
    const r2 = cli(["integrate", "--project", "smoke", "--branch", "agent/w4", "--mode", "merge"]);
    expect(r2.status).toBe(0);
    const anc = spawnSync(
      "git",
      ["-C", repo, "merge-base", "--is-ancestor", "agent/w1", "integration/smoke"],
    );
    expect(anc.status).toBe(0);
  }, 90_000);

  it("collect findings copies each worker's output to the findings bus", () => {
    const d = dispatch("w6", "SHIM:FINDINGS — report only.", []);
    expect(d.status).toBe(0);
    expect(waitFor("w6").json.workers[0].state).toBe("done");
    const r = cli(["collect", "--project", "smoke"]);
    expect(r.status).toBe(0);
    const w6 = r.json.collected.find((c: any) => c.name === "w6");
    expect(w6.sections).toBe(1);
    expect(existsSync(join(runDir, "findings", "w6.findings.md"))).toBe(true);
    expect(r.json.skipped.length).toBeGreaterThan(0);
  }, 90_000);

  it("escalate writes the report with every attempt and archived diffs", () => {
    const r = cli(["escalate", "--project", "smoke", "--task", "t9"]);
    expect(r.status).toBe(0);
    expect(r.json.attempts).toBe(3);
    const report = readFileSync(r.json.path, "utf8");
    expect(report).toContain("# Escalation: t9");
    expect(report).toContain("### attempt 1 — w9-1");
    expect(report).toContain("### attempt 3 — w9-3");
    expect(report).toContain("reason=spawn-crash");
    expect(existsSync(join(runDir, "archive", "w9-1.attempt.diff"))).toBe(true);
  });

  it("escalate refuses a task with no recorded attempts", () => {
    const r = cli(["escalate", "--project", "smoke", "--task", "never-ran"]);
    expect(r.status).toBe(1);
    expect(r.error.code).toBe("E_NO_ATTEMPTS");
  });

  it("mcp server lists the 9 tools and serves worker_status", async () => {
    const got = await mcpCall([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "smoke", version: "0" },
        },
      },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "worker_status", arguments: { project: "smoke" } },
      },
    ]);
    expect(got[1].result.serverInfo.name).toBe("camerata");
    expect(got[2].result.tools.map((t: any) => t.name).sort()).toEqual([
      "cleanup_run",
      "close_run",
      "collect_findings",
      "dispatch_worker",
      "escalate_task",
      "init_run",
      "integrate_branch",
      "wait_workers",
      "worker_status",
    ]);
    const status = JSON.parse(got[3].result.content[0].text);
    expect(status.workers.find((w: any) => w.name === "w1").state).toBe("done");
  }, 30_000);

  it("close refuses without a final summary; check reports residuals", () => {
    const chk = cli(["close", "--project", "smoke", "--check"]);
    expect(chk.status).toBe(1);
    expect(chk.json.clean).toBe(false);
    expect(chk.json.residuals.join("\n")).toContain("final summary");
    const cl = cli(["close", "--project", "smoke"]);
    expect(cl.status).toBe(1);
    expect(cl.error.code).toBe("E_NO_SUMMARY");
  });

  it("close: archives evidence, tears down, verifies zero residuals", () => {
    appendFileSync(
      join(runDir, "progress.md"),
      "\n## Final summary\n\nw1 and w4 integrated; t9 escalated; rest rejected.\n",
    );
    const dry = cli(["close", "--project", "smoke", "--dry-run"]);
    expect(dry.status).toBe(0);
    expect(dry.json.dryRun).toBe(true);

    const r = cli(["close", "--project", "smoke"]);
    expect(r.status).toBe(0);
    expect(r.json.closed).toBe(true);

    expect(readdirSync(runDir).filter((e) => e.startsWith("wt-"))).toEqual([]);
    const w1ref = spawnSync("git", ["-C", repo, "show-ref", "--verify", "refs/heads/agent/w1"]);
    expect(w1ref.status).not.toBe(0);
    expect(gitOut(["rev-parse", "--verify", "integration/smoke"])).toBeTruthy();

    // evidence archived before teardown
    expect(existsSync(join(runDir, "archive", "w6.worktree.diff"))).toBe(true);
    if (!isWindows) {
      // w2 committed but was never merged — archived as a rejected patch
      expect(existsSync(join(runDir, "archive", "w2.rejected.patch"))).toBe(true);
    }

    const progress = readFileSync(join(runDir, "progress.md"), "utf8");
    expect(progress).toContain("- usage: workers=");
    expect(progress).toContain("- closed:");
    expect(gitOut(["status", "--porcelain", "--untracked-files=no"])).toBe("");

    const chk = cli(["close", "--project", "smoke", "--check"]);
    expect(chk.status).toBe(0);
    expect(chk.json.clean).toBe(true);
  }, 90_000);
});
