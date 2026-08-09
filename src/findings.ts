// Copy each worker's single output file from its worktree to the run-dir bus
// at findings/<name>.<suffix>.md. All manifest workers are scanned (claude
// audit workers run gitMode none, so filtering on ro would skip them).
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "./config.js";
import { fail } from "./errors.js";
import { findRunDir, readManifest, validateSlug } from "./run.js";

export function collectFindings(cfg: Config, opts: { project: string; file?: string }) {
  const runDir = findRunDir(cfg, opts.project);
  const file = opts.file ?? "FINDINGS.md";
  validateSlug("file", file);
  const rows = readManifest(runDir);
  if (rows.length === 0) fail("E_NO_WORKERS", "no workers dispatched in this run");

  mkdirSync(join(runDir, "findings"), { recursive: true });
  const suffix = file.replace(/\.md$/, "").toLowerCase();
  const sectionRe = file === "FINDINGS.md" ? /^## F[0-9]/ : /^## /;

  const collected: { name: string; path: string; sections: number }[] = [];
  const skipped: { name: string; reason: string }[] = [];
  for (const row of rows) {
    if (!existsSync(row.worktree)) {
      skipped.push({ name: row.name, reason: `worktree missing (${row.worktree})` });
      continue;
    }
    const src = join(row.worktree, file);
    if (existsSync(src) && lstatSync(src).isSymbolicLink()) {
      skipped.push({ name: row.name, reason: `${file} is a symlink; refusing to collect it` });
      continue;
    }
    if (!existsSync(src)) {
      skipped.push({ name: row.name, reason: `no ${file} in worktree` });
      continue;
    }
    const dest = join(runDir, "findings", `${row.name}.${suffix}.md`);
    copyFileSync(src, dest);
    const sections = readFileSync(src, "utf8")
      .split("\n")
      .filter((l) => sectionRe.test(l)).length;
    collected.push({ name: row.name, path: dest, sections });
  }
  if (collected.length === 0) fail("E_NO_FINDINGS", `no ${file} collected from any worker`);
  return { collected, skipped };
}
