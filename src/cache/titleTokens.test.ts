import { describe, expect, it } from "vitest";
import type { FileSnapshot } from "../types";
import { SnapshotStore } from "./store";
import { TitleTokenIndex } from "./titleTokens";

function snap(path: string): FileSnapshot {
  return {
    path,
    tags: new Set(),
    outlinks: new Set(),
    backlinks: new Set(),
    ctime: 0,
    mtime: 0,
    outlinkCount: 0,
    folder: "",
  };
}

describe("TitleTokenIndex", () => {
  it("harvests the standalone set from titles themselves, gating morpheme-straddling 2-grams", () => {
    // 日本 stands alone as a title's whole 2-kanji run ("日本の歴史"), so it
    // survives as an interior sub-word of "日本語入門"; 本語 never stands
    // alone anywhere in this title corpus and is dropped.
    const store = new SnapshotStore();
    store.rebuildAll([snap("日本語入門.md"), snap("日本の歴史.md")]);
    const idx = new TitleTokenIndex(store);

    const intro = idx.tokensFor("日本語入門.md");
    expect(intro.has("日本語入門")).toBe(true); // full run always kept
    expect(intro.has("日本")).toBe(true); // standalone elsewhere -> kept
    expect(intro.has("本語")).toBe(false); // straddles the morpheme boundary

    const history = idx.tokensFor("日本の歴史.md");
    expect(history.has("日本")).toBe(true);
    expect(history.has("歴史")).toBe(true);

    // The two titles share exactly 日本, not 本語.
    const shared = [...intro].filter((t) => history.has(t));
    expect(shared).toEqual(["日本"]);
  });

  it("indexes shared tokens for lookup and df/idf", () => {
    const store = new SnapshotStore();
    store.rebuildAll([
      snap("Machine Learning Basics.md"),
      snap("Machine Learning Advanced.md"),
      snap("Cooking Basics.md"),
    ]);
    const idx = new TitleTokenIndex(store);

    expect(idx.totalNotesCount()).toBe(3);
    expect(
      [...idx.filesWithToken("machine")].sort(),
    ).toEqual(["Machine Learning Advanced.md", "Machine Learning Basics.md"]);
    expect(idx.notesWithTokenCount("machine")).toBe(2);
    expect(idx.notesWithTokenCount("basics")).toBe(2);
    // A token in 2 of 3 notes is rarer than one in all 3 (there is none here),
    // so its IDF must be strictly positive.
    expect(idx.idf("machine")).toBeGreaterThan(0);
    // A token absent from the corpus has df 0 -> idf 0 (not NaN/Infinity).
    expect(idx.idf("nonexistent")).toBe(0);
  });

  it("is a known gap: a hiragana-only title yields no tokens (segment is always false)", () => {
    const store = new SnapshotStore();
    store.rebuildAll([snap("ひらめきについて.md")]);
    const idx = new TitleTokenIndex(store);
    expect(idx.tokensFor("ひらめきについて.md").size).toBe(0);
  });

  it("rebuilds lazily on the next read after markDirty, picking up a rename", () => {
    const store = new SnapshotStore();
    store.rebuildAll([snap("Alpha Notes.md")]);
    const idx = new TitleTokenIndex(store);
    expect(idx.tokensFor("Alpha Notes.md").has("alpha")).toBe(true);

    store.rename("Alpha Notes.md", snap("Beta Notes.md"));
    // Without markDirty, the index still serves the stale corpus.
    expect(idx.tokensFor("Beta Notes.md").size).toBe(0);
    idx.markDirty();
    expect(idx.tokensFor("Beta Notes.md").has("beta")).toBe(true);
    expect(idx.tokensFor("Alpha Notes.md").size).toBe(0);
  });
});
