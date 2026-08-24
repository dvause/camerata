// Recovery ledger: one append-only row per dispatch attempt. The budget check
// and the append happen under one lock so a retry can never slip past the
// budget in a race. Rows are appended BEFORE any worktree/branch exists, so a
// dispatch that dies in preflight still consumed its attempt — visible, never
// silently retried.
import { appendFileSync, mkdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fail } from "./errors.js";
import { isAlive } from "./platform.js";

export interface LedgerRow {
  task: string;
  attempt: number;
  name: string;
  policy: string;
  launchedAt: string;
}

export function readLedger(runDir: string): LedgerRow[] {
  let text: string;
  try {
    text = readFileSync(join(runDir, "recovery.jsonl"), "utf8");
  } catch {
    return [];
  }
  return text
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Portable mkdir lock (v1 pattern): steal only when the recorded holder is dead.
async function withLock<T>(lockDir: string, fn: () => T): Promise<T> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      mkdirSync(lockDir);
      break;
    } catch {
      try {
        const holder = Number(readFileSync(join(lockDir, "pid"), "utf8").trim());
        if (Number.isInteger(holder) && holder > 0 && !isAlive(holder)) {
          try {
            unlinkSync(join(lockDir, "pid"));
            rmdirSync(lockDir);
          } catch {
            /* lost the steal race */
          }
          continue;
        }
      } catch {
        /* no pid file yet */
      }
      if (Date.now() > deadline) fail("E_LOCK", `timed out waiting for lock: ${lockDir}`);
      await sleep(100);
    }
  }
  try {
    writeFileSync(join(lockDir, "pid"), String(process.pid));
    return fn();
  } finally {
    try {
      unlinkSync(join(lockDir, "pid"));
    } catch {
      /* ignore */
    }
    try {
      rmdirSync(lockDir);
    } catch {
      /* ignore */
    }
  }
}

export async function appendDispatch(
  runDir: string,
  retryBudget: number,
  row: { task: string; attempt: number; name: string; policy: string },
): Promise<void> {
  await withLock(join(runDir, "recovery.lock"), () => {
    const rows = readLedger(runDir).filter((r) => r.task === row.task);
    if (rows.length >= 1 + retryBudget) {
      fail(
        "E_BUDGET",
        `retry budget exhausted for task ${row.task} (attempts=${rows.length}, budget=${retryBudget}); escalate instead of retrying`,
      );
    }
    const expected = rows.length + 1;
    if (row.attempt !== expected) {
      fail(
        "E_ATTEMPT",
        rows.length === 0
          ? `task ${row.task} has no recorded attempts; expected attempt 1 (got ${row.attempt})`
          : `task ${row.task} has ${rows.length} recorded attempts; expected attempt ${expected} (got ${row.attempt})`,
      );
    }
    appendFileSync(
      join(runDir, "recovery.jsonl"),
      JSON.stringify({ ...row, launchedAt: new Date().toISOString() }) + "\n",
    );
  });
}
