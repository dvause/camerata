import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "./config.js";
import { readLedger } from "./ledger.js";
import { isAlive } from "./platform.js";
import { findRunDir, git, readManifest, type ManifestRow } from "./run.js";

export interface WorkerView {
  name: string;
  task: string;
  attempt: number;
  branch: string;
  worktree: string;
  backend: string;
  state: string;
  // stale: status says running but the launcher pid is dead — crashed launcher,
  // status is unreliable; treated as terminal by wait_workers
  stale?: boolean;
  [k: string]: unknown;
}

function readStatusFile(runDir: string, name: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(join(runDir, "status", `${name}.json`), "utf8"));
  } catch {
    return null;
  }
}

export function readWorkerViews(runDir: string, workers?: string[]): WorkerView[] {
  let rows = readManifest(runDir);
  if (workers) rows = rows.filter((r) => workers.includes(r.name));
  return rows.map((row) => {
    const st = readStatusFile(runDir, row.name) ?? { state: "unknown" };
    const view: WorkerView = {
      name: row.name,
      task: row.task,
      attempt: row.attempt,
      branch: row.branch,
      worktree: row.worktree,
      backend: row.backend,
      ...st,
      state: (st.state as string) ?? "unknown",
    };
    const pid = st.pid as number | undefined;
    if (view.state === "running" && pid && !isAlive(pid)) view.stale = true;
    return view;
  });
}

export function isTerminal(v: WorkerView): boolean {
  return v.state === "done" || v.state === "failed" || v.stale === true;
}

// Allow globs, v1 contract: patterns match the full repo-relative path;
// `*` is the only wildcard (it crosses `/`), everything else is literal.
export function allowRegExp(pat: string): RegExp {
  return new RegExp(`^${pat.replace(/[.*+?^${}()|[\]\\]/g, (c) => (c === "*" ? ".*" : `\\${c}`))}$`);
}

export function scopeViolations(runDir: string, name: string, files: string[]): string[] | null {
  const allowFile = join(runDir, "allow", `${name}.allow`);
  if (!existsSync(allowFile)) return null;
  const matchers = readFileSync(allowFile, "utf8")
    .split("\n")
    .map((l) => l.replace(/\r$/, "").trim())
    .filter((l) => l !== "" && !l.startsWith("#"))
    .map(allowRegExp);
  return files.filter((f) => !matchers.some((m) => m.test(f)));
}

function diffInfo(runDir: string, row: ManifestRow) {
  if (!existsSync(row.worktree)) {
    return { diffstat: null, untracked: [], violations: null, worktreeMissing: true };
  }
  const diffstat = git(["-C", row.worktree, "diff", "--stat", row.base], { allowFail: true })
    .stdout.trimEnd();
  const untracked = git(["-C", row.worktree, "ls-files", "--others", "--exclude-standard"], {
    allowFail: true,
  })
    .stdout.split("\n")
    .filter((l) => l !== "");
  const changed = git(["-C", row.worktree, "diff", "--name-only", row.base], { allowFail: true })
    .stdout.split("\n")
    .filter((l) => l !== "");
  const files = [...new Set([...changed, ...untracked])].sort();
  return { diffstat, untracked, violations: scopeViolations(runDir, row.name, files) };
}

export function workerStatus(cfg: Config, project: string) {
  const runDir = findRunDir(cfg, project);
  const rows = readManifest(runDir);
  const views = readWorkerViews(runDir).map((view, i) => ({ ...view, ...diffInfo(runDir, rows[i]) }));
  // Ledger rows with no manifest row: dispatch died in preflight, budget consumed.
  const named = new Set(rows.map((r) => r.name));
  const ledgerOnly = readLedger(runDir)
    .filter((r) => !named.has(r.name))
    .map((r) => ({ name: r.name, task: r.task, attempt: r.attempt, ledgerOnly: true }));
  return { workers: views, ledgerOnly };
}
