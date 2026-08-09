// Every install path ships the packed tarball, never a live checkout, so the
// suite drives the packed artifact: a `files` gap or a stray read outside the
// package fails here instead of at a user's first install.
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { commandLine, isWindows } from "../src/platform.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function run(cmd: string, args: string[], cwd?: string): void {
  const c = commandLine(cmd, args);
  const r = spawnSync(c.cmd, c.args, {
    cwd,
    encoding: "utf8",
    windowsVerbatimArguments: c.windowsVerbatimArguments,
  });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
}

/** `npm pack` into `dir`, unpack it, and return the packed CLI entry point. */
export function packCli(dir: string): string {
  mkdirSync(dir, { recursive: true });
  run("npm", ["pack", "--pack-destination", dir], repoRoot);
  const tgz = readdirSync(dir).find((f) => f.endsWith(".tgz"));
  if (!tgz) throw new Error(`npm pack produced no tarball in ${dir}`);
  run("tar", ["-xzf", join(dir, tgz), "-C", dir]);
  const pkg = join(dir, "package");
  // Runtime deps are declared, not packed; borrow the repo's resolved copies.
  symlinkSync(join(repoRoot, "node_modules"), join(pkg, "node_modules"), isWindows ? "junction" : "dir");
  return join(pkg, "dist", "cli.js");
}
