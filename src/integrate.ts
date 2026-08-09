// Review then merge one worker branch into integration/<project>.
// Integration is deliberately ONE branch at a time; the orchestrator runs
// tests between merges. Merge semantics port v1 exactly (spec open question,
// default "port exactly"): real --no-ff merge, blocked only by uncommitted
// changes to TRACKED files — untracked files don't block, git itself refuses
// to overwrite one that would conflict.
import type { Config } from "./config.js";
import { fail } from "./errors.js";
import { findRunDir, git, readRun } from "./run.js";

export interface IntegrateOpts {
  project: string;
  branch: string;
  mode: "review" | "merge";
}

export function integrateBranch(cfg: Config, opts: IntegrateOpts) {
  const runDir = findRunDir(cfg, opts.project);
  const run = readRun(runDir);
  const repo = run.repo;
  if (opts.mode !== "review" && opts.mode !== "merge") {
    fail("E_ARG", "mode must be review or merge");
  }
  const ref = git(["-C", repo, "show-ref", "--verify", "--quiet", `refs/heads/${opts.branch}`], {
    allowFail: true,
  });
  if (ref.status !== 0) fail("E_BRANCH_NOT_FOUND", `branch not found: ${opts.branch}`);

  const base = run.baseSha;
  const integration = `integration/${opts.project}`;
  const diffstat = git(["-C", repo, "diff", "--stat", `${base}..${opts.branch}`]).stdout.trimEnd();
  const commits = git(["-C", repo, "log", "--format=%h %s", `${base}..${opts.branch}`])
    .stdout.split("\n")
    .filter((l) => l !== "");

  if (opts.mode === "review") {
    return { mode: "review", branch: opts.branch, base, integration, diffstat, commits };
  }

  const dirt = git(["-C", repo, "status", "--porcelain", "--untracked-files=no"]).stdout.trim();
  if (dirt !== "") {
    fail("E_DIRTY", `refusing to merge: ${repo} has uncommitted tracked changes:\n${dirt}`);
  }

  const integExists =
    git(["-C", repo, "show-ref", "--verify", "--quiet", `refs/heads/${integration}`], {
      allowFail: true,
    }).status === 0;
  if (integExists) {
    git(["-C", repo, "checkout", integration]);
  } else {
    git(["-C", repo, "checkout", "-b", integration, base]);
  }

  // Own identity: the merge must not depend on ambient git config
  const merge = git(
    [
      "-C",
      repo,
      "-c",
      "user.email=camerata@local",
      "-c",
      "user.name=camerata-integrate",
      "merge",
      "--no-ff",
      "-m",
      `merge(${opts.branch}): integrate worker branch`,
      opts.branch,
    ],
    { allowFail: true },
  );
  if (merge.status !== 0) {
    fail(
      "E_MERGE_CONFLICT",
      `merge conflict integrating ${opts.branch} into ${integration}; resolve in ${repo}, or run \`git -C ${repo} merge --abort\` to back out`,
    );
  }
  return {
    mode: "merge",
    branch: opts.branch,
    integration,
    head: git(["-C", repo, "rev-parse", "HEAD"]).stdout.trim(),
  };
}
