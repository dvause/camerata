// Close gate and recovery teardown (v1 orchestrate-close.sh + cleanup.sh).
// A run is not over until close exits clean: final summary required, rejected
// and dirty evidence archived before teardown, zero residuals verified after.
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve, sep } from "node:path";
import type { Config } from "./config.js";
import { fail } from "./errors.js";
import { branchExists, findRunDir, git, readManifest, readRun, type RunMeta } from "./run.js";

function isAncestor(repo: string, branch: string, of: string): boolean {
  return (
    git(["-C", repo, "merge-base", "--is-ancestor", branch, of], { allowFail: true }).status === 0
  );
}

function inRunDir(path: string, runDir: string): boolean {
  return resolve(path).startsWith(resolve(runDir) + sep);
}

// Worktrees this run owns: manifest rows (guarded to paths inside the run
// dir) plus any stray wt-* directory, deduped.
function discoverWorktrees(runDir: string): { name: string; worktree: string }[] {
  const seen = new Map<string, string>();
  for (const row of readManifest(runDir)) {
    if (inRunDir(row.worktree, runDir)) seen.set(row.worktree, row.name);
  }
  let entries: string[] = [];
  try {
    entries = readdirSync(runDir);
  } catch {
    /* run dir gone */
  }
  for (const e of entries) {
    if (e.startsWith("wt-")) {
      const p = join(runDir, e);
      if (!seen.has(p)) seen.set(p, e.slice(3));
    }
  }
  return [...seen.entries()].map(([worktree, name]) => ({ name, worktree }));
}

// Only THIS run's agent/* branches — repo-wide refs intersected with the
// manifest — so a concurrent run on the same repo can never block this close.
function runAgentBranches(runDir: string, repo: string): string[] {
  const mine = new Set(readManifest(runDir).map((r) => r.branch));
  return git(["-C", repo, "for-each-ref", "--format=%(refname:short)", "refs/heads/agent"], {
    allowFail: true,
  })
    .stdout.split("\n")
    .filter((b) => b !== "" && mine.has(b));
}

function finalSummaryPresent(runDir: string): boolean {
  let text: string;
  try {
    text = readFileSync(join(runDir, "progress.md"), "utf8");
  } catch {
    return false;
  }
  let inFinal = false;
  for (const line of text.split("\n")) {
    if (/^## Final summary\s*$/.test(line)) {
      inFinal = true;
      continue;
    }
    if (inFinal && /^## /.test(line)) return false;
    if (inFinal && line.trim() !== "" && !line.startsWith("#")) return true;
  }
  return false;
}

function worktreeDirty(worktree: string): boolean {
  const tracked = git(["-C", worktree, "diff", "--quiet", "HEAD", "--"], { allowFail: true });
  if (tracked.status !== 0) return true;
  const untracked = git(["-C", worktree, "ls-files", "--others", "--exclude-standard"], {
    allowFail: true,
  }).stdout.trim();
  return untracked !== "";
}

export interface CleanupOpts {
  project: string;
  branches?: boolean;
  allBranches?: boolean;
  force?: boolean;
  dryRun?: boolean;
}

export function cleanupRun(cfg: Config, opts: CleanupOpts) {
  const runDir = findRunDir(cfg, opts.project);
  const run = readRun(runDir);
  const repo = run.repo;
  const manifest = readManifest(runDir);
  const stateFile = join(runDir, "cleanup.branches");
  const actions: string[] = [];
  const candidates = new Set<string>();
  let removed = 0;
  let skipped = 0;

  for (const { worktree } of discoverWorktrees(runDir)) {
    if (!existsSync(worktree)) continue;
    let branch = git(["-C", worktree, "rev-parse", "--abbrev-ref", "HEAD"], {
      allowFail: true,
    }).stdout.trim();
    if (branch === "" || branch === "HEAD") {
      branch = manifest.find((r) => r.worktree === worktree)?.branch ?? "";
    }
    if (opts.dryRun) {
      actions.push(`would remove worktree ${worktree}`);
      if (branch && branch !== "HEAD") candidates.add(branch);
      removed++;
      continue;
    }
    const args = ["-C", repo, "worktree", "remove", ...(opts.force ? ["--force"] : []), worktree];
    const r = git(args, { allowFail: true });
    if (r.status === 0) {
      actions.push(`removed worktree ${worktree}`);
      if (branch && branch !== "HEAD") {
        appendFileSync(stateFile, JSON.stringify({ branch, worktree }) + "\n");
        candidates.add(branch);
      }
      removed++;
    } else if (/permission denied/i.test(r.stderr)) {
      actions.push(`PERMISSION-DENIED worktree ${worktree} (hand deletion to the user)`);
      skipped++;
    } else {
      actions.push(`SKIP worktree ${worktree} (dirty? retry with force)`);
      skipped++;
    }
  }
  if (!opts.dryRun) git(["-C", repo, "worktree", "prune"], { allowFail: true });

  for (const row of manifest) {
    if (!existsSync(row.worktree)) candidates.add(row.branch);
  }
  if (existsSync(stateFile)) {
    for (const line of readFileSync(stateFile, "utf8").split("\n")) {
      if (line.trim() === "") continue;
      const { branch, worktree } = JSON.parse(line);
      if (worktree && !inRunDir(worktree, runDir)) continue;
      if (!worktree || !existsSync(worktree)) candidates.add(branch);
    }
  }

  let deleted = 0;
  let kept = 0;
  if (opts.branches) {
    const current = git(["-C", repo, "rev-parse", "--abbrev-ref", "HEAD"], {
      allowFail: true,
    }).stdout.trim();
    const integration = `integration/${opts.project}`;
    for (const branch of candidates) {
      if (!branch || branch === "HEAD") continue;
      if (branch === current) {
        actions.push(`KEEP branch ${branch} (currently checked out)`);
        kept++;
        continue;
      }
      if (branch === "main" || branch === "master" || branch.startsWith("integration/")) {
        actions.push(`KEEP branch ${branch} (protected)`);
        kept++;
        continue;
      }
      if (!branchExists(repo, branch)) continue;
      const deletable =
        (opts.allBranches && branch.startsWith("agent/")) ||
        isAncestor(repo, branch, run.baseSha) ||
        (branchExists(repo, integration) && isAncestor(repo, branch, integration));
      if (!deletable) {
        actions.push(`KEEP branch ${branch} (not merged into ${integration})`);
        kept++;
        continue;
      }
      if (opts.dryRun) {
        actions.push(`would delete branch ${branch}`);
        deleted++;
      } else if (git(["-C", repo, "branch", "-D", branch], { allowFail: true }).status === 0) {
        actions.push(`deleted branch ${branch}`);
        deleted++;
      } else {
        actions.push(`KEEP branch ${branch} (delete failed)`);
        kept++;
      }
    }
  }
  return {
    worktreesRemoved: removed,
    worktreesSkipped: skipped,
    branchesDeleted: deleted,
    branchesKept: kept,
    actions,
  };
}

function archiveEvidence(runDir: string, run: RunMeta, project: string, dryRun: boolean) {
  const repo = run.repo;
  const archiveDir = join(runDir, "archive");
  mkdirSync(archiveDir, { recursive: true });
  const integration = `integration/${project}`;
  const archived: string[] = [];
  const warnings: string[] = [];

  // Branches with commits that never made integration: archive/<name>.rejected.patch
  for (const row of readManifest(runDir)) {
    if (!row.branch || row.branch === "HEAD" || !branchExists(repo, row.branch)) continue;
    const ahead = Number(
      git(["-C", repo, "rev-list", "--count", `${run.baseSha}..${row.branch}`], {
        allowFail: true,
      }).stdout.trim() || "0",
    );
    if (ahead === 0) continue;
    if (branchExists(repo, integration) && isAncestor(repo, row.branch, integration)) continue;
    const path = join(archiveDir, `${row.name}.rejected.patch`);
    if (existsSync(path)) {
      warnings.push(`archive exists, keeping existing: ${path}`);
      continue;
    }
    if (dryRun) {
      archived.push(`would archive rejected branch ${row.branch} to ${path}`);
    } else {
      writeFileSync(
        path,
        git(["-C", repo, "log", "--patch", "--reverse", `${run.baseSha}..${row.branch}`]).stdout,
      );
      archived.push(path);
    }
  }

  // Dirty worktrees: archive/<name>.worktree.diff
  for (const { name, worktree } of discoverWorktrees(runDir)) {
    if (!existsSync(worktree) || !worktreeDirty(worktree)) continue;
    const path = join(archiveDir, `${name}.worktree.diff`);
    if (existsSync(path)) {
      warnings.push(`archive exists, keeping existing: ${path}`);
      continue;
    }
    if (dryRun) {
      archived.push(`would archive dirty worktree ${worktree} to ${path}`);
    } else {
      const diff = git(["-C", worktree, "diff", "HEAD"], { allowFail: true }).stdout;
      const untracked = git(["-C", worktree, "ls-files", "--others", "--exclude-standard"], {
        allowFail: true,
      }).stdout;
      writeFileSync(path, `${diff}\n--- untracked files ---\n${untracked}`);
      archived.push(path);
    }
  }
  return { archived, warnings };
}

function usageSummary(runDir: string) {
  const rows = readManifest(runDir);
  let done = 0;
  let failed = 0;
  let tokens = 0;
  let tokensSeen = false;
  let wallS = 0;
  for (const row of rows) {
    try {
      const st = JSON.parse(readFileSync(join(runDir, "status", `${row.name}.json`), "utf8"));
      if (st.state === "done") done++;
      if (st.state === "failed") failed++;
      if (typeof st.tokens === "number") {
        tokens += st.tokens;
        tokensSeen = true;
      }
      if (typeof st.durationS === "number") wallS += st.durationS;
    } catch {
      /* no status */
    }
  }
  return { workers: rows.length, done, failed, tokens: tokensSeen ? tokens : null, wallS };
}

export function closeRun(cfg: Config, opts: { project: string; check?: boolean; dryRun?: boolean }) {
  const runDir = findRunDir(cfg, opts.project);
  const run = readRun(runDir);

  const collectResiduals = () => {
    const residuals: string[] = [];
    for (const { worktree } of discoverWorktrees(runDir)) {
      if (existsSync(worktree)) residuals.push(`worktree: ${worktree}`);
    }
    for (const branch of runAgentBranches(runDir, run.repo)) {
      residuals.push(`agent branch: ${branch}`);
    }
    return residuals;
  };

  if (opts.check) {
    const residuals = collectResiduals();
    if (!finalSummaryPresent(runDir)) {
      residuals.unshift(`missing or empty final summary: ${join(runDir, "progress.md")}`);
    }
    return { clean: residuals.length === 0, residuals };
  }

  if (!finalSummaryPresent(runDir)) {
    fail(
      "E_NO_SUMMARY",
      `missing or empty final summary in ${join(runDir, "progress.md")}; write "## Final summary" before closing`,
    );
  }

  const { archived, warnings } = archiveEvidence(runDir, run, opts.project, Boolean(opts.dryRun));
  const cleanup = cleanupRun(cfg, {
    project: opts.project,
    force: true,
    branches: true,
    allBranches: true,
    dryRun: opts.dryRun,
  });

  if (opts.dryRun) {
    return { dryRun: true, archived, warnings, cleanup };
  }

  const residuals = collectResiduals();
  if (residuals.length > 0) {
    fail("E_RESIDUALS", `residuals remain after cleanup:\n${residuals.join("\n")}`);
  }

  const u = usageSummary(runDir);
  appendFileSync(
    join(runDir, "progress.md"),
    `- usage: workers=${u.workers} done=${u.done} failed=${u.failed} tokens=${u.tokens ?? "-"} wall_s=${u.wallS}\n` +
      `- closed: ${new Date().toISOString()} worktrees=0 agent_branches=0\n`,
  );
  return { closed: true, archived, warnings, cleanup, usage: u };
}
