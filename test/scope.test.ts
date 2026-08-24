import { describe, expect, it } from "vitest";
import { allowRegExp } from "../src/status.js";

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
