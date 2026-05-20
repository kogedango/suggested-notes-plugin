import { describe, expect, it } from "vitest";
import {
  isExcludedByFolder,
  normalizeFolder,
  normalizeLinkSet,
  normalizeTagSet,
} from "./normalize";

describe("normalizeFolder", () => {
  it("strips leading and trailing slashes", () => {
    expect(normalizeFolder("/Daily/")).toBe("Daily");
    expect(normalizeFolder("///Notes//")).toBe("Notes");
  });
  it("preserves nested paths", () => {
    expect(normalizeFolder("Inbox/Web")).toBe("Inbox/Web");
  });
  it("trims whitespace", () => {
    expect(normalizeFolder("  Daily  ")).toBe("Daily");
  });
});

describe("normalizeTagSet", () => {
  it("strips leading # and whitespace", () => {
    const s = normalizeTagSet(["#foo", "bar", "  #baz  "]);
    expect([...s].sort()).toEqual(["bar", "baz", "foo"]);
  });
  it("drops empty entries", () => {
    expect(normalizeTagSet(["", "#", "   "]).size).toBe(0);
  });
  it("deduplicates regardless of # prefix", () => {
    expect(normalizeTagSet(["foo", "#foo"]).size).toBe(1);
  });
  it("strips multiple leading #s", () => {
    expect(normalizeTagSet(["##bar"])).toEqual(new Set(["bar"]));
  });
});

describe("normalizeLinkSet", () => {
  it("accepts bare basenames", () => {
    expect(normalizeLinkSet(["Foo"])).toEqual(new Set(["Foo"]));
  });
  it("strips folder paths", () => {
    expect(normalizeLinkSet(["path/to/Foo"])).toEqual(new Set(["Foo"]));
  });
  it("strips .md suffix", () => {
    expect(normalizeLinkSet(["Foo.md"])).toEqual(new Set(["Foo"]));
  });
  it("strips wikilink brackets", () => {
    expect(normalizeLinkSet(["[[Foo]]"])).toEqual(new Set(["Foo"]));
  });
  it("uses target before |alias", () => {
    expect(normalizeLinkSet(["[[Foo|別名]]"])).toEqual(new Set(["Foo"]));
  });
  it("deduplicates equivalent forms", () => {
    expect(
      normalizeLinkSet(["Foo", "Foo.md", "[[Foo]]", "path/Foo.md"]).size,
    ).toBe(1);
  });
  it("drops empty entries", () => {
    expect(normalizeLinkSet(["", "  ", "[[]]"]).size).toBe(0);
  });
});

describe("isExcludedByFolder", () => {
  it("matches exact folder", () => {
    expect(isExcludedByFolder("Daily", ["Daily"])).toBe(true);
  });
  it("matches subfolders by prefix", () => {
    expect(isExcludedByFolder("Daily/2026", ["Daily"])).toBe(true);
  });
  it("does not match by partial-name prefix", () => {
    // "Daily" should not exclude "DailyArchive"
    expect(isExcludedByFolder("DailyArchive", ["Daily"])).toBe(false);
  });
  it("returns false for empty folder", () => {
    expect(isExcludedByFolder("", ["Daily"])).toBe(false);
  });
  it("tolerates trailing slash in setting", () => {
    expect(isExcludedByFolder("Daily", ["Daily/"])).toBe(true);
    expect(isExcludedByFolder("Daily/x", ["Daily/"])).toBe(true);
  });
  it("tolerates leading slash in setting", () => {
    expect(isExcludedByFolder("Daily", ["/Daily"])).toBe(true);
  });
  it("ignores empty entries", () => {
    expect(isExcludedByFolder("Daily", ["", "   ", "Daily"])).toBe(true);
    expect(isExcludedByFolder("Foo", ["", "   "])).toBe(false);
  });
});
