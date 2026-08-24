import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import type { Config } from "./config.js";
import { fail } from "./errors.js";

export interface RunMeta {
  project: string;
  repo: string;
  baseSha: string;
  createdAt: string;
  retryBudget: number;
  workerTimeoutS: number;
  resumedAt?: string;
}

export interface ManifestRow {
  name: string;
  task: string;
  attempt: number;
  branch: string;
  worktree: string;
  goal: string;
  log: string;
  commit: boolean;
  base: string;
  backend: string;
  requestedModel: string;
  reasoning: string;
  gitMode: string;
  policy: string;
  timeoutS: number;
  launchedAt: string;
}

export function git(
  args: string[],
  opts: { cwd?: string; allowFail?: boolean; env?: NodeJS.ProcessEnv } = {},
) {
  const r = spawnSync("git", args, {
    cwd: opts.cwd,
    encoding: "utf8",
    env: opts.env ? { ...process.env, ...opts.env } : undefined,
  });
  if (r.error) fail("E_GIT", `git not runnable: ${r.error.message}`);
  if (r.status !== 0 && !opts.allowFail) {
    fail("E_GIT", `git ${args.join(" ")} failed: ${(r.stderr ?? "").trim()}`);
  }
  return { status: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

export function branchExists(repo: string, branch: string): boolean {
  return (
    git(["-C", repo, "show-ref", "--verify", "--quiet", `refs/heads/${branch}`], {
      allowFail: true,
    }).status === 0
  );
}

const SLUG = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

export function validateSlug(label: string, value: string): void {
  if (!SLUG.test(value) || value.includes("..")) {
    fail(
      "E_SLUG",
      `${label} must use only A-Za-z0-9._- and must not start with . or contain ..: ${value}`,
    );
  }
}

export function repoSlug(repoPath: string): string {
  const h = createHash("sha256").update(repoPath).digest("hex").slice(0, 8);
  return `${basename(repoPath)}-${h}`;
}

export function atomicWriteJson(file: string, obj: unknown): void {
  const tmp = `${file}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(obj, null, 2) + "\n");
  renameSync(tmp, file);
}

export function appendProgress(runDir: string, line: string): void {
  appendFileSync(join(runDir, "progress.md"), `- ${new Date().toISOString()} ${line}\n`);
}

export function readRun(runDir: string): RunMeta {
  try {
    return JSON.parse(readFileSync(join(runDir, "run.json"), "utf8"));
  } catch {
    fail("E_NO_RUN", `no run.json at ${runDir}; run init_run first`);
  }
}

export function readManifest(runDir: string): ManifestRow[] {
  let text: string;
  try {
    text = readFileSync(join(runDir, "manifest.jsonl"), "utf8");
  } catch {
    return [];
  }
  return text
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l));
}

export function appendManifest(runDir: string, row: ManifestRow): void {
  appendFileSync(join(runDir, "manifest.jsonl"), JSON.stringify(row) + "\n");
}

// Runs are addressed by project name alone (spec tool inputs), so locate the
// run dir by scanning runs/<repo-slug>/<project>.
export function findRunDir(cfg: Config, project: string): string {
  validateSlug("project", project);
  const root = join(cfg.dataDir, "runs");
  const hits: string[] = [];
  let slugs: string[] = [];
  try {
    slugs = readdirSync(root);
  } catch {
    /* no runs yet */
  }
  for (const slug of slugs) {
    const dir = join(root, slug, project);
    if (existsSync(join(dir, "run.json"))) hits.push(dir);
  }
  if (hits.length === 0) fail("E_NO_RUN", `no run found for project ${project}; run init_run first`);
  if (hits.length > 1) {
    fail("E_AMBIGUOUS", `project ${project} exists under multiple repos: ${hits.join(", ")}`);
  }
  return hits[0];
}

export function initRun(
  cfg: Config,
  opts: { project: string; repo: string; resume?: boolean },
): { runDir: string; baseSha: string } {
  validateSlug("project", opts.project);
  const repo = resolve(opts.repo);
  const inside = git(["-C", repo, "rev-parse", "--is-inside-work-tree"], { allowFail: true });
  if (inside.status !== 0) fail("E_REPO", `not a git repository: ${repo}`);
  const baseSha = git(["-C", repo, "rev-parse", "HEAD"]).stdout.trim();

  const runDir = join(cfg.dataDir, "runs", repoSlug(repo), opts.project);
  const existing = existsSync(join(runDir, "run.json"));
  if (existing && !opts.resume) {
    fail("E_RUN_EXISTS", `run already exists at ${runDir}; pass resume to reuse it`);
  }

  let old: RunMeta | undefined;
  if (existing) {
    old = readRun(runDir);
    if (old.repo !== repo) {
      fail("E_RESUME_REPO", `resume repo mismatch: existing run uses ${old.repo}, requested ${repo}`);
    }
    if (old.baseSha !== baseSha) {
      fail(
        "E_RESUME_BASE",
        `resume base mismatch: existing run uses ${old.baseSha}, repo HEAD is ${baseSha}`,
      );
    }
  }

  // allow/ and commitignore/ are orchestrator-written and often empty; seeding
  // them keeps every playbook from having to create the directory first.
  for (const d of ["goals", "logs", "status", "allow", "commitignore"]) {
    mkdirSync(join(runDir, d), { recursive: true });
  }

  const now = new Date().toISOString();
  // Snapshot budget/timeout at init: a mid-run config edit cannot change a live run.
  const meta: RunMeta = {
    project: opts.project,
    repo,
    baseSha,
    createdAt: old?.createdAt ?? now,
    retryBudget: old?.retryBudget ?? cfg.retryBudget,
    workerTimeoutS: old?.workerTimeoutS ?? cfg.workerTimeoutS,
    ...(existing ? { resumedAt: now } : {}),
  };
  atomicWriteJson(join(runDir, "run.json"), meta);

  if (!existsSync(join(runDir, "progress.md"))) {
    writeFileSync(
      join(runDir, "progress.md"),
      `# ${opts.project} progress\n\nrepo: ${repo}\nbase: ${baseSha}\ncreated: ${now}\n\n`,
    );
  }
  appendProgress(runDir, existing ? "run resumed" : "run initialized");
  return { runDir, baseSha };
}
