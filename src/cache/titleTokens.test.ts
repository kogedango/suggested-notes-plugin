import { describe, expect, it } from "vitest";
import type { TokenCounter } from "../analysis/types";
import type { FileSnapshot } from "../types";
import { SnapshotStore } from "./store";
import { TitleTokenIndex } from "./titleTokens";

const words: TokenCounter = {
  tokenize(text) {
    return new Map(
      (text.toLowerCase().match(/[a-z一-龥ぁ-んァ-ヶー]+/g) ?? []).map(
        (token) => [token, 1],
      ),
    );
  },
};

function snapshot(path: string): FileSnapshot {
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
  it("builds canonical title tokens asynchronously", async () => {
    const store = new SnapshotStore();
    store.rebuildAll([snapshot("Plugin Guide.md"), snapshot("Plugin API.md")]);
    const index = new TitleTokenIndex(store, words);

    await index.rebuildAll(1);

    expect(index.filesWithToken("plugin")).toEqual(
      new Set(["Plugin Guide.md", "Plugin API.md"]),
    );
    expect(index.notesWithTokenCount("plugin")).toBe(2);
  });

  it("maintains add, rename, and delete incrementally", async () => {
    const store = new SnapshotStore();
    store.rebuildAll([snapshot("Old Name.md")]);
    const index = new TitleTokenIndex(store, words);
    await index.rebuildAll();
    const oldTokens = index.tokensFor("Old Name.md");

    index.rename("Old Name.md", "New Topic.md");
    expect(oldTokens).toEqual(new Set(["old", "name"]));
    expect(index.tokensFor("Old Name.md")).toEqual(new Set());
    expect(index.tokensFor("New Topic.md")).toEqual(new Set(["new", "topic"]));
    index.remove("New Topic.md");
    expect(index.totalNotesCount()).toBe(0);
  });

  // The caller persists the cache on the strength of this return value: with
  // body matching off, nothing else reports that a create changed it.
  it("reports whether add changed the index", async () => {
    const store = new SnapshotStore();
    store.rebuildAll([snapshot("Known.md")]);
    const index = new TitleTokenIndex(store, words);
    await index.rebuildAll();

    expect(index.add("Fresh Note.md")).toBe(true);
    expect(index.add("Fresh Note.md")).toBe(false);
    expect(index.add("Known.md")).toBe(false);
  });

  it("restores cached titles and analyzes only missing paths", async () => {
    const store = new SnapshotStore();
    store.rebuildAll([snapshot("Cached.md"), snapshot("New Topic.md")]);
    const calls: string[] = [];
    const recording: TokenCounter = {
      tokenize(text) {
        calls.push(text);
        return words.tokenize(text);
      },
    };
    const index = new TitleTokenIndex(store, recording);

    expect(
      index.restore([{ path: "Cached.md", tokens: ["cached"] }]),
    ).toBe(true);
    expect(await index.syncAll(1)).toBe(true);

    expect(calls).toEqual(["New Topic"]);
    expect(index.filesWithToken("cached")).toEqual(new Set(["Cached.md"]));
    expect(index.filesWithToken("new")).toEqual(new Set(["New Topic.md"]));
    expect(index.snapshot()).toHaveLength(2);
  });

  it("reports an unchanged restored title cache", async () => {
    const store = new SnapshotStore();
    store.rebuildAll([snapshot("Cached.md")]);
    const index = new TitleTokenIndex(store, words);
    expect(
      index.restore([{ path: "Cached.md", tokens: ["cached"] }]),
    ).toBe(true);
    const restoredTokens = index.tokensFor("Cached.md");

    expect(await index.syncAll()).toBe(false);
    expect(index.tokensFor("Cached.md")).toBe(restoredTokens);
  });

  it("releases serialized title entries while consuming a valid cache", () => {
    const entries = [{ path: "Cached.md", tokens: ["cached"] }];
    const index = new TitleTokenIndex(new SnapshotStore(), words);

    expect(index.restore(entries, { consume: true })).toBe(true);
    expect(entries).toEqual([]);
    expect(index.tokensFor("Cached.md")).toEqual(new Set(["cached"]));
  });
});
