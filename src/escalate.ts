// Write an escalation report for a task whose recovery stops here: every
// recorded attempt with its outcome, diffstat, log tail, and an archived diff
// under archive/<name>.attempt.diff.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Config } from "./config.js";
import { fail } from "./errors.js";
import { readLedger } from "./ledger.js";
import { branchExists, findRunDir, git, readManifest, readRun, validateSlug } from "./run.js";

// Diff the worktree against base including untracked files, without touching
// the worktree's real index (v1's GIT_INDEX_FILE trick).
function attemptDiff(worktree: string, base: string): string | null {
  const scratch = mkdtempSync(join(tmpdir(), "camerata-idx-"));
  const idx = join(scratch, "index");
  try {
    const add = git(["-C", worktree, "add", "-A"], { allowFail: true, env: { GIT_INDEX_FILE: idx } });
    if (add.status !== 0) return null;
    const diff = git(["-C", worktree, "diff", "--cached", base], {
      allowFail: true,
      env: { GIT_INDEX_FILE: idx },
    });
    if (diff.status !== 0) return null;
    const untracked = git(["-C", worktree, "ls-files", "--others", "--exclude-standard"], {
      allowFail: true,
    }).stdout;
    return `${diff.stdout}\n--- untracked files ---\n${untracked}`;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

export function escalateTask(cfg: Config, opts: { project: string; task: string }) {
  const runDir = findRunDir(cfg, opts.project);
  const run = readRun(runDir);
  validateSlug("task", opts.task);
  const attempts = readLedger(runDir)
    .filter((r) => r.task === opts.task)
    .sort((a, b) => a.attempt - b.attempt);
  if (attempts.length === 0) fail("E_NO_ATTEMPTS", `no recovery rows for task: ${opts.task}`);

  const archiveDir = join(runDir, "archive");
  mkdirSync(archiveDir, { recursive: true });
  const manifest = readManifest(runDir);
  const warnings: string[] = [];
  const sections: string[] = [];

  for (const a of attempts) {
    const row = manifest.find((r) => r.name === a.name);
    const worktree = row?.worktree ?? join(runDir, `wt-${a.name}`);
    const log = row?.log ?? join(runDir, "logs", `${a.name}.log`);
    const branch = row?.branch ?? `agent/${a.name}`;

    let status: Record<string, unknown> | null = null;
    try {
      status = JSON.parse(readFileSync(join(runDir, "status", `${a.name}.json`), "utf8"));
    } catch {
      /* ledger-only attempt */
    }
    const outcome = status
      ? [
          status.state,
          status.exitCode !== undefined ? `exit=${status.exitCode}` : "",
          status.reason ? `reason=${status.reason}` : "",
        ]
          .filter(Boolean)
          .join(" ")
      : "no status file";
    const requested = (row?.requestedModel ?? (status?.requestedModel as string)) || "-";
    const effective = ((status?.model as string) ?? requested) || "-";
    const model = requested === effective ? requested : `${requested} -> ${effective}`;

    // archive the attempt's diff
    const archive = join(archiveDir, `${a.name}.attempt.diff`);
    let archivePath = "-";
    if (existsSync(archive)) {
      warnings.push(`archive exists, keeping existing: ${archive}`);
      archivePath = archive;
    } else if (existsSync(worktree)) {
      const diff = attemptDiff(worktree, run.baseSha);
      if (diff !== null) {
        writeFileSync(archive, diff);
        archivePath = archive;
      }
    } else if (branchExists(run.repo, branch)) {
      writeFileSync(
        archive,
        git(["-C", run.repo, "log", "--patch", "--reverse", `${run.baseSha}..${branch}`]).stdout,
      );
      archivePath = archive;
    }

    let diffstat = "(no diff available)";
    if (existsSync(worktree)) {
      const stat = git(["-C", worktree, "diff", "--stat", run.baseSha], { allowFail: true });
      const untracked = git(["-C", worktree, "ls-files", "--others", "--exclude-standard"], {
        allowFail: true,
      })
        .stdout.split("\n")
        .filter((l) => l !== "")
        .map((f) => `+ untracked: ${f}`)
        .join("\n");
      if (stat.status === 0) diffstat = [stat.stdout.trimEnd(), untracked].filter(Boolean).join("\n") || "(no diff available)";
    } else if (branchExists(run.repo, branch)) {
      const stat = git(["-C", run.repo, "diff", "--stat", `${run.baseSha}..${branch}`], {
        allowFail: true,
      });
      if (stat.status === 0 && stat.stdout.trim() !== "") diffstat = stat.stdout.trimEnd();
    }

    let logTail = "(no log)";
    if (existsSync(log)) {
      const lines = readFileSync(log, "utf8").split("\n");
      const tail = lines.slice(-20).join("\n").trim();
      if (tail !== "") logTail = tail;
    }

    sections.push(
      `### attempt ${a.attempt} — ${a.name}

- backend: ${row?.backend ?? "codex"}
- model: ${model}
- policy: ${a.policy}
- outcome: ${outcome}
- tokens: ${status?.tokens ?? "-"}
- duration_s: ${status?.durationS ?? "-"}

\`\`\`\`
${diffstat}
\`\`\`\`

\`\`\`\`
${logTail}
\`\`\`\`

archive: ${archivePath}
`,
    );
  }

  const report = `# Escalation: ${opts.task}

- run: ${opts.project}
- repo: ${run.repo}
- base: ${run.baseSha}
- budget: ${run.retryBudget}
- attempts recorded: ${attempts.length}
- generated: ${new Date().toISOString()}

## Attempts

${sections.join("\n")}
## Recommendation

TODO(orchestrator): replace with a concrete recommendation (what was tried, why it failed, what to do) before the final summary.
`;
  const path = join(runDir, `escalation-${opts.task}.md`);
  const tmp = `${path}.tmp.${process.pid}`;
  writeFileSync(tmp, report);
  renameSync(tmp, path);
  return { path, attempts: attempts.length, warnings };
}
