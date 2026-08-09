// Feature detection: git, each backend CLI, codex sandbox support on this OS.
// Same probes dispatch runs as preflight, reported instead of enforced.
import { spawnSync } from "node:child_process";
import type { Config } from "./config.js";
import { getDriver } from "./drivers/index.js";

export interface Probe {
  available: boolean;
  version?: string;
  reason?: string;
}

export interface DoctorReport {
  ok: boolean;
  platform: string;
  node: string;
  dataDir: string;
  git: Probe;
  backends: { codex: Probe; claude: Probe };
}

function probeGit(): Probe {
  const r = spawnSync("git", ["--version"], { encoding: "utf8" });
  if (r.error || r.status !== 0) {
    return { available: false, reason: "git CLI not found on PATH" };
  }
  return { available: true, version: (r.stdout ?? "").trim() };
}

export async function doctor(cfg: Config): Promise<DoctorReport> {
  const git = probeGit();
  const [codex, claude] = await Promise.all([
    getDriver("codex", cfg).check(),
    getDriver("claude", cfg).check(),
  ]);
  return {
    ok: git.available && (codex.available || claude.available),
    platform: process.platform,
    node: process.version,
    dataDir: cfg.dataDir,
    git,
    backends: { codex, claude },
  };
}
