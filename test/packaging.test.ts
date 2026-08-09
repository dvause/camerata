// M3: install paths. The three manifests must agree on one version, and
// setup-codex must be re-runnable without duplicating its config block.
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { upsertServer } from "../src/setup-codex.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const cliJs = join(repoRoot, "dist", "cli.js");
const readJson = (...p: string[]) => JSON.parse(readFileSync(join(repoRoot, ...p), "utf8"));

let root: string;
let home: string;
let codexHome: string;

function setup(args: string[] = []) {
  const r = spawnSync(process.execPath, [cliJs, "setup-codex", ...args], {
    encoding: "utf8",
    env: { ...process.env, HOME: home, USERPROFILE: home, CODEX_HOME: codexHome },
  });
  expect(r.stderr).toBe("");
  expect(r.status).toBe(0);
  return JSON.parse(r.stdout);
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "camerata-pkg-"));
  home = join(root, "home");
  codexHome = join(root, "codex");
  mkdirSync(home, { recursive: true });
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("packaging manifests", () => {
  it("plugin, marketplace, and the MCP pin all track the package version", () => {
    const { version, name } = readJson("package.json");
    expect(readJson(".claude-plugin", "plugin.json").version).toBe(version);
    expect(readJson(".mcp.json").mcpServers.camerata.args).toEqual([
      "-y",
      `${name}@${version}`,
      "mcp",
    ]);
    const market = readJson(".claude-plugin", "marketplace.json");
    expect(market.plugins.map((p: { name: string }) => p.name)).toContain(name);
  });

  it("the packed artifact ships dist and skills only", () => {
    expect(readJson("package.json").files).toEqual(["dist", "skills"]);
  });
});

describe("playbook skills", () => {
  const skillsDir = join(repoRoot, "skills");
  const names = readdirSync(skillsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  it("ships the four core playbooks", () => {
    expect(names.sort()).toEqual([
      "camerata-audit",
      "camerata-build",
      "camerata-plan",
      "camerata-spec",
    ]);
  });

  it.each(names)("%s carries frontmatter whose name matches its directory", (name) => {
    const text = readFileSync(join(skillsDir, name, "SKILL.md"), "utf8");
    const front = /^---\n([\s\S]*?)\n---\n/.exec(text);
    expect(front).not.toBeNull();
    expect(front![1]).toContain(`name: ${name}`);
    expect(/^description: \S.*/m.test(front![1])).toBe(true);
  });

  // The porting rules: engine interactions by MCP tool name, never by the v1
  // harness path or script names.
  it.each(names)("%s references the engine by tool name, not v1 paths", (name) => {
    for (const file of readdirSync(join(skillsDir, name), { recursive: true, encoding: "utf8" })) {
      const path = join(skillsDir, name, file);
      if (!file.endsWith(".md")) continue;
      const text = readFileSync(path, "utf8");
      expect(text, `${name}/${file}`).not.toMatch(/\$ORCH|maestro|orchestrate-init|codex-worker/);
    }
  });
});

describe("setup-codex", () => {
  it("adds the server block, leaving other sections intact", () => {
    const { toml, mode } = upsertServer('[mcp_servers.other]\ncommand = "x"\n', "[mcp_servers.camerata]\ncommand = \"npx\"\n");
    expect(mode).toBe("added");
    expect(toml).toContain("[mcp_servers.other]");
    expect(toml).toContain("[mcp_servers.camerata]");
  });

  it("rewrites an existing block in place rather than duplicating it", () => {
    const first = upsertServer("", '[mcp_servers.camerata]\nargs = ["-y", "camerata@0.0.1", "mcp"]\n');
    const second = upsertServer(
      `${first.toml}[mcp_servers.after]\ncommand = "y"\n`,
      '[mcp_servers.camerata]\nargs = ["-y", "camerata@9.9.9", "mcp"]\n',
    );
    expect(second.mode).toBe("updated");
    expect(second.toml.match(/\[mcp_servers\.camerata\]/g)).toHaveLength(1);
    expect(second.toml).toContain("camerata@9.9.9");
    expect(second.toml).not.toContain("camerata@0.0.1");
    expect(second.toml).toContain("[mcp_servers.after]");
  });

  it("dry run reports the plan and writes nothing", () => {
    const r = setup(["--dry-run"]);
    expect(r.dryRun).toBe(true);
    expect(r.configFile).toBe(join(codexHome, "config.toml"));
    expect(r.skillsDir).toBe(join(home, ".agents", "skills"));
    expect(existsSync(r.configFile)).toBe(false);
  });

  it("registers the version-pinned server and stays idempotent", () => {
    const { version } = readJson("package.json");
    const first = setup();
    expect(first.mcpServer).toBe("added");
    expect(first.skills.sort()).toEqual([
      "camerata-audit",
      "camerata-build",
      "camerata-plan",
      "camerata-spec",
    ]);
    expect(existsSync(join(first.skillsDir, "camerata-build", "SKILL.md"))).toBe(true);
    expect(
      existsSync(join(first.skillsDir, "camerata-build", "templates", "worker-goal.md")),
    ).toBe(true);
    const toml = readFileSync(first.configFile, "utf8");
    expect(toml).toContain("[mcp_servers.camerata]");
    expect(toml).toContain(`camerata@${version}`);

    // a hand-written neighbour section must survive the second run
    writeFileSync(first.configFile, `${toml}\n[mcp_servers.other]\ncommand = "x"\n`);
    const again = setup();
    expect(again.mcpServer).toBe("updated");
    const after = readFileSync(first.configFile, "utf8");
    expect(after.match(/\[mcp_servers\.camerata\]/g)).toHaveLength(1);
    expect(after).toContain("[mcp_servers.other]");
  });
});
