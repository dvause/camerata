// M3: install paths. The three manifests must agree on one version, and
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { packCli } from "./pack.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const readJson = (...p: string[]) => JSON.parse(readFileSync(join(repoRoot, ...p), "utf8"));

let root: string;
let packDir: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "camerata-pkg-"));
  packDir = join(root, "pack");
  packCli(packDir);
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

  it("the packed artifact ships dist and skills, and no source tree", () => {
    const pkg = join(packDir, "package");
    const shipped = readdirSync(pkg).sort();
    expect(shipped).toContain("dist");
    expect(shipped).toContain("skills");
    expect(shipped).not.toContain("src");
    expect(shipped).not.toContain("test");
    // What the CLI reads at runtime must live inside the package.
    expect(existsSync(join(pkg, "package.json"))).toBe(true);
    expect(existsSync(join(pkg, "skills", "camerata-build", "SKILL.md"))).toBe(true);
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
    const front = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
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
