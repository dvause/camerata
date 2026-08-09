import type { Config } from "./config.js";
import { fail } from "./errors.js";
import { findRunDir, readManifest } from "./run.js";
import { isTerminal, readWorkerViews, type WorkerView } from "./status.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Blocks up to timeoutS (required — the only blocking engine call), polling
// status files at 1s. Returns when any/all named workers are in a terminal
// state (done, failed, or stale-running with a dead launcher pid), so a call
// made after completion returns immediately; re-callable.
export async function waitWorkers(
  cfg: Config,
  opts: { project: string; timeoutS: number; workers?: string[]; mode?: "any" | "all" },
): Promise<{ timedOut: boolean; workers: WorkerView[] }> {
  const runDir = findRunDir(cfg, opts.project);
  if (!Number.isInteger(opts.timeoutS) || opts.timeoutS <= 0) {
    fail("E_ARG", "timeoutS is required and must be a positive integer");
  }
  const mode = opts.mode ?? "any";
  if (mode !== "any" && mode !== "all") fail("E_ARG", "mode must be any or all");
  const known = new Set(readManifest(runDir).map((r) => r.name));
  if (known.size === 0) fail("E_NO_WORKERS", "no workers dispatched in this run");
  for (const w of opts.workers ?? []) {
    if (!known.has(w)) fail("E_UNKNOWN_WORKER", `no such worker in this run: ${w}`);
  }

  const deadline = Date.now() + opts.timeoutS * 1000;
  for (;;) {
    const views = readWorkerViews(runDir, opts.workers);
    const settled = mode === "any" ? views.some(isTerminal) : views.every(isTerminal);
    if (settled) return { timedOut: false, workers: views };
    if (Date.now() >= deadline) return { timedOut: true, workers: views };
    await sleep(1000);
  }
}
