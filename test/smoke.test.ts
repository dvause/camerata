// Hermetic end-to-end smoke: fake codex/claude shims on PATH, no network, no
// API spend. Drives the built CLI (dist/) exactly as an orchestrator would.
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const cliJs = join(here, "..", "dist", "cli.js");
const isWindows = process.platform === "win32";
// codex refuses on native Windows by design; the claude backend carries the run
const backend = isWindows ? "claude" : "codex";
const fallbackModel = isWindows ? "sonnet" : "gpt-5.6-terra";

let root: string;
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
  if (prompt.includes("SHIM:STALL")) { setTimeout(() => process.exit(0), 120000); return; }
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
  const e: NodeJS.ProcessEnv = { ...process.env, CAMERATA_HOME: home };
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
  home = join(root, "home");
  shims = join(root, "shims");
  repo = join(root, "target-repo");
  goalDir = join(root, "goals");
  for (const d of [home, shims, repo, goalDir]) mkdirSync(d, { recursive: true });
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

  it("a timed-out worker is killed and lands in status as failed/timeout", () => {
    const d = dispatch("w3", "SHIM:STALL — never finish.", ["--timeout-s", "2"]);
    expect(d.status).toBe(0);
    const w = waitFor("w3", 30);
    expect(w.json.timedOut).toBe(false);
    const st = statusOf("w3");
    expect(st.state).toBe("failed");
    expect(st.reason).toBe("timeout");
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
});
