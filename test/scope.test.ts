import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { allowRegExp, scopeViolations } from "../src/status.js";

describe("allowRegExp", () => {
  it("lets * cross directories", () => {
    expect(allowRegExp("docs/*").test("docs/a/b.md")).toBe(true);
    expect(allowRegExp("docs/*").test("src/docs.md")).toBe(false);
  });

  it("lets * match dotfiles and directories", () => {
    const matcher = allowRegExp("*.md");
    expect(matcher.test("README.md")).toBe(true);
    expect(matcher.test("docs/notes.md")).toBe(true);
    expect(matcher.test(".hidden.md")).toBe(true);
  });

  it("treats regex metacharacters other than * as literals", () => {
    expect(allowRegExp("a.b").test("a.b")).toBe(true);
    expect(allowRegExp("a.b").test("aXb")).toBe(false);
    expect(allowRegExp("a?b").test("a?b")).toBe(true);
    expect(allowRegExp("a?b").test("axb")).toBe(false);
  });

  it("matches nested skill paths", () => {
    expect(allowRegExp("skills/*/SKILL.md").test("skills/camerata-build/SKILL.md")).toBe(true);
  });
});

describe("scopeViolations", () => {
  let runDir: string;

  beforeEach(() => {
    runDir = mkdtempSync(join(tmpdir(), "camerata-scope-"));
    mkdirSync(join(runDir, "allow"));
  });

  it("returns null when the allow file is missing", () => {
    expect(scopeViolations(runDir, "w", ["a.ts"])).toBeNull();
  });

  it("treats comments and blank lines as allowing no files", () => {
    writeFileSync(join(runDir, "allow", "w.allow"), "# c\n\n");
    expect(scopeViolations(runDir, "w", ["a.ts", "b.md"])).toEqual(["a.ts", "b.md"]);
  });

  it("handles CRLF and comments in the allow file", () => {
    writeFileSync(join(runDir, "allow", "w.allow"), "# c\r\ndocs/*\r\n\n");
    expect(scopeViolations(runDir, "w", ["docs/x.md", "src/y.ts"])).toEqual(["src/y.ts"]);
  });
});
