// Codex host install: copy the packaged skills into the Codex skills dir and
// register the MCP server in Codex config. One place to patch if the
// `.agents/skills` convention shifts (spec §Risks).
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const version: string = createRequire(import.meta.url)("../package.json").version;

const HEADER = "[mcp_servers.camerata]";

export interface SetupCodexResult {
  skills: string[];
  skillsDir: string;
  configFile: string;
  mcpServer: "added" | "updated";
  dryRun: boolean;
}

function codexHome(): string {
  return process.env.CODEX_HOME ?? join(homedir(), ".codex");
}

function serverBlock(): string {
  return `${HEADER}\ncommand = "npx"\nargs = ["-y", "camerata@${version}", "mcp"]\n`;
}

// ponytail: line-scan, not a TOML parser — only ever rewrites the block we
// wrote ourselves. A camerata block hand-edited across sections would confuse
// it; a real TOML dep is the upgrade path if that ever happens.
export function upsertServer(toml: string, block: string): { toml: string; mode: "added" | "updated" } {
  const lines = toml.split("\n");
  const start = lines.findIndex((l) => l.trim() === HEADER);
  if (start < 0) {
    const head = toml.trim() === "" ? "" : `${toml.replace(/\n*$/, "")}\n\n`;
    return { toml: head + block, mode: "added" };
  }
  let end = start + 1;
  while (end < lines.length && !lines[end].trimStart().startsWith("[")) end++;
  const rest = lines.slice(end);
  return {
    toml: [...lines.slice(0, start), ...block.trimEnd().split("\n"), ...rest].join("\n"),
    mode: "updated",
  };
}

export function setupCodex(opts: { dryRun?: boolean } = {}): SetupCodexResult {
  const src = join(pkgRoot, "skills");
  const skillsDir = join(homedir(), ".agents", "skills");
  const configFile = join(codexHome(), "config.toml");
  const skills = existsSync(src)
    ? readdirSync(src, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
    : [];

  const before = existsSync(configFile) ? readFileSync(configFile, "utf8") : "";
  const { toml, mode } = upsertServer(before, serverBlock());

  if (!opts.dryRun) {
    if (skills.length > 0) {
      mkdirSync(skillsDir, { recursive: true });
      cpSync(src, skillsDir, { recursive: true });
    }
    mkdirSync(codexHome(), { recursive: true });
    writeFileSync(configFile, toml);
  }

  return { skills, skillsDir, configFile, mcpServer: mode, dryRun: Boolean(opts.dryRun) };
}
