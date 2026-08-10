// Real-CLI acceptance run: a genuine worker backend, real API spend, no shims.
// Drives the globally installed camerata exactly as an orchestrator would, then
// asserts the invariants CI's hermetic smoke cannot reach.
//
// env: CAMERATA_CLI (path to the installed dist/cli.js), ACC_BACKEND, ACC_HOME
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const cli = process.env.CAMERATA_CLI;
const backend = process.env.ACC_BACKEND ?? "claude";
const home = process.env.ACC_HOME ?? join(process.cwd(), "acc-home");
const repo = join(process.cwd(), "acc-demo");
const project = "acceptance";

if (!cli || !existsSync(cli)) throw new Error(`CAMERATA_CLI not found: ${cli}`);

let failures = 0;
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

function git(args, cwd = repo) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

function camerata(args) {
  const r = spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    env: { ...process.env, CAMERATA_HOME: home },
  });
  process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  let json;
  try {
    json = JSON.parse(r.stdout);
  } catch {
    /* refusals print structured errors to stderr */
  }
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, json };
}

// ---- demo repo -------------------------------------------------------------
mkdirSync(repo, { recursive: true });
git(["init", "-b", "main"]);
writeFileSync(join(repo, "calc.py"), "def add(a, b):\n    return a + b\n");
git(["add", "-A"]);
git(["-c", "user.email=acc@local", "-c", "user.name=acceptance", "commit", "-qm", "initial"]);

// ---- doctor ----------------------------------------------------------------
const doctor = camerata(["doctor"]);
check("doctor reports git available", doctor.json?.git?.available === true);
check(`doctor reports the ${backend} backend available`, doctor.json?.backends?.[backend]?.available === true,
  doctor.json?.backends?.[backend]?.reason ?? "");
if (process.platform === "win32") {
  check("codex refuses on native Windows", doctor.json?.backends?.codex?.available === false,
    doctor.json?.backends?.codex?.reason ?? "");
}

// ---- init ------------------------------------------------------------------
const init = camerata(["init", "--project", project, "--repo", repo]);
check("init returns a run dir and base SHA", init.status === 0 && Boolean(init.json?.runDir));
const runDir = init.json.runDir;
check("base SHA matches the repo HEAD", init.json.baseSha === git(["rev-parse", "HEAD"]));

// ---- dispatch --------------------------------------------------------------
const goalFile = join(process.cwd(), "acc.goal.md");
writeFileSync(
  goalFile,
  `Mission: In calc.py, add a \`subtract(a, b)\` function that returns a - b.

Scope:
- Allowed: calc.py
- Forbidden: every other file.

Definition of done:
- calc.py defines both add and subtract.
- No other file is changed.

Commit: yes
Final message: what you changed.
`,
);
writeFileSync(join(runDir, "allow", "w1.allow"), "calc.py\n");

const d = camerata([
  "dispatch", "--project", project, "--name", "w1", "--goal-file", goalFile,
  "--backend", backend, "--loe", "low", "--commit", "--timeout-s", "600",
]);
check("dispatch launches and returns immediately", d.status === 0 && d.json?.branch === "agent/w1");

// ---- wait / status ---------------------------------------------------------
const w = camerata(["wait", "--project", project, "--timeout-s", "900", "--workers", "w1", "--mode", "all"]);
check("wait returns before its timeout", w.status === 0 && w.json?.timedOut === false);

const st = camerata(["status", "--project", project]).json?.workers?.find((x) => x.name === "w1");
check("worker finished done", st?.state === "done", `state=${st?.state} reason=${st?.reason ?? "-"}`);
check("worker produced a non-empty diff", st?.diff === "nonempty");
check("worker stayed in scope", (st?.violations ?? []).length === 0, JSON.stringify(st?.violations ?? []));

// ---- integrate -------------------------------------------------------------
const review = camerata(["integrate", "--project", project, "--branch", "agent/w1", "--mode", "review"]);
check("integrate review lists the worker's commit", (review.json?.commits ?? []).length > 0);
const merge = camerata(["integrate", "--project", project, "--branch", "agent/w1", "--mode", "merge"]);
check("integrate merge lands on the integration branch", merge.status === 0 && Boolean(merge.json?.head));

// The engine is not a test runner: verify the merged result ourselves.
// Runners disagree on which name Python answers to.
const probe = "import calc; assert calc.subtract(5, 3) == 2; print('subtract ok')";
let py = { status: -1, stdout: "", stderr: "no python interpreter found" };
for (const exe of ["python3", "python"]) {
  const r = spawnSync(exe, ["-c", probe], { cwd: repo, encoding: "utf8" });
  if (!r.error) {
    py = r;
    break;
  }
}
check("merged code actually works", py.status === 0, (py.stderr || py.stdout).trim().split("\n").at(-1) ?? "");

// ---- close gate ------------------------------------------------------------
const noSummary = camerata(["close", "--project", project]);
check("close refuses without a final summary", noSummary.status !== 0);

appendFileSync(join(runDir, "progress.md"), "\n## Final summary\n\nAcceptance run: one worker, merged, verified.\n");
const close = camerata(["close", "--project", project]);
check("close exits clean", close.status === 0);

// ---- the invariants that matter --------------------------------------------
git(["checkout", "-q", "main"]);
check("target repo has no uncommitted files", git(["status", "--porcelain"]) === "");
check("no run worktrees survive", !git(["worktree", "list"]).includes("wt-w1"));
check("no agent branches survive", git(["branch", "--list", "agent/*"]) === "");

console.log(`\n${failures === 0 ? "acceptance PASSED" : `acceptance FAILED (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
