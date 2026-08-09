// All platform differences (process-tree kill, command resolution, home dir)
// live here.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

export const isWindows = process.platform === "win32";

function resolveOnPath(cmd: string): string | null {
  // Windows never executes extensionless files, so an extensionless candidate
  // (e.g. a POSIX sh wrapper next to its .cmd twin) must not shadow the .cmd.
  const exts = /\.[^\\/.]+$/.test(cmd)
    ? [""]
    : (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";");
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (dir === "") continue;
    for (const ext of exts) {
      const file = join(dir, cmd + ext.toLowerCase());
      if (existsSync(file)) return file;
    }
  }
  return null;
}

// ponytail: quote-wrap only; args with embedded double quotes are unsupported
// on Windows .cmd shims — none of the claude driver's args contain them.
function quoteWinArg(a: string): string {
  return /[\s()%^&|<>"]/.test(a) ? `"${a}"` : a;
}

export interface Command {
  cmd: string;
  args: string[];
  windowsVerbatimArguments?: boolean;
}

// Node refuses to spawn .cmd/.bat directly (CVE-2024-27980); route those
// through cmd.exe. Everything else spawns as-is.
export function commandLine(cmd: string, args: string[]): Command {
  if (!isWindows) return { cmd, args };
  const file = resolveOnPath(cmd) ?? cmd;
  if (!/\.(cmd|bat)$/i.test(file)) return { cmd: file, args };
  const line = [`"${file}"`, ...args.map(quoteWinArg)].join(" ");
  return {
    cmd: process.env.ComSpec ?? "cmd.exe",
    args: ["/d", "/s", "/c", `"${line}"`],
    windowsVerbatimArguments: true,
  };
}

export function cameraHome(): string {
  return process.env.CAMERATA_HOME ?? join(homedir(), ".camerata");
}

export function expandHome(p: string): string {
  return p === "~" || p.startsWith("~/") ? join(homedir(), p.slice(1)) : p;
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

// Drivers are spawned detached, so on POSIX the pid is its own process group.
export function killTree(pid: number, signal: "SIGTERM" | "SIGKILL" = "SIGTERM"): void {
  if (isWindows) {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"]);
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      /* already gone */
    }
  }
}
