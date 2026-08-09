import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { EngineError } from "../src/errors.js";
import { appendDispatch, readLedger } from "../src/ledger.js";

let runDir: string;
beforeEach(() => {
  runDir = mkdtempSync(join(tmpdir(), "camerata-ledger-"));
});

const row = (task: string, attempt: number, name: string) => ({
  task,
  attempt,
  name,
  policy: "-",
});

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "";
  } catch (e) {
    expect(e).toBeInstanceOf(EngineError);
    return (e as EngineError).code;
  }
}

describe("recovery ledger", () => {
  it("records each attempt with task, name, policy, launchedAt", async () => {
    await appendDispatch(runDir, 2, { task: "t1", attempt: 1, name: "w1", policy: "p" });
    const rows = readLedger(runDir);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ task: "t1", attempt: 1, name: "w1", policy: "p" });
    expect(rows[0].launchedAt).toBeTruthy();
  });

  it("enforces the retry budget: initial + budget attempts, then refuses", async () => {
    await appendDispatch(runDir, 2, row("t1", 1, "a"));
    await appendDispatch(runDir, 2, row("t1", 2, "b"));
    await appendDispatch(runDir, 2, row("t1", 3, "c"));
    expect(await codeOf(appendDispatch(runDir, 2, row("t1", 4, "d")))).toBe("E_BUDGET");
    expect(readLedger(runDir)).toHaveLength(3);
  });

  it("budget 0 allows only the initial attempt", async () => {
    await appendDispatch(runDir, 0, row("t1", 1, "a"));
    expect(await codeOf(appendDispatch(runDir, 0, row("t1", 2, "b")))).toBe("E_BUDGET");
  });

  it("refuses out-of-sequence attempt numbers", async () => {
    expect(await codeOf(appendDispatch(runDir, 2, row("t1", 2, "a")))).toBe("E_ATTEMPT");
    await appendDispatch(runDir, 2, row("t1", 1, "a"));
    expect(await codeOf(appendDispatch(runDir, 2, row("t1", 1, "b")))).toBe("E_ATTEMPT");
    expect(await codeOf(appendDispatch(runDir, 2, row("t1", 3, "b")))).toBe("E_ATTEMPT");
  });

  it("a refused dispatch appends nothing", async () => {
    await appendDispatch(runDir, 0, row("t1", 1, "a"));
    await codeOf(appendDispatch(runDir, 0, row("t1", 2, "b")));
    expect(readLedger(runDir)).toHaveLength(1);
  });

  it("tasks have independent budgets", async () => {
    await appendDispatch(runDir, 0, row("t1", 1, "a"));
    await appendDispatch(runDir, 0, row("t2", 1, "b"));
    expect(readLedger(runDir)).toHaveLength(2);
  });

  it("releases the lock (a second append does not time out)", async () => {
    await appendDispatch(runDir, 2, row("t1", 1, "a"));
    await appendDispatch(runDir, 2, row("t1", 2, "b"));
    expect(readFileSync(join(runDir, "recovery.jsonl"), "utf8").trim().split("\n")).toHaveLength(2);
  });
});
