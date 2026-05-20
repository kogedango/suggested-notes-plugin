import { describe, expect, it } from "vitest";
import { basename, displayName } from "./path";

describe("basename", () => {
  it("returns the file name without .md", () => {
    expect(basename("Daily/2026-01-01.md")).toBe("2026-01-01");
  });
  it("handles top-level files", () => {
    expect(basename("Foo.md")).toBe("Foo");
  });
  it("handles files without .md extension", () => {
    expect(basename("Foo")).toBe("Foo");
    expect(basename("path/Foo")).toBe("Foo");
  });
  it("only strips trailing .md, not internal", () => {
    expect(basename("Foo.md.md")).toBe("Foo.md");
  });
});

describe("displayName", () => {
  it("delegates to basename", () => {
    expect(displayName("a/b/c.md")).toBe("c");
  });
});
