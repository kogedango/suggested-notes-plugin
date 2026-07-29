import type { App, TFile } from "obsidian";
import { describe, expect, it } from "vitest";
import type { TokenCounter } from "../analysis/types";
import type { TitleTokenIndex } from "./titleTokens";
import { BodyTokenIndex, rankSalient } from "./bodyTokens";

const words: TokenCounter = {
  tokenize(text) {
    const out = new Map<string, number>();
    for (const token of text.split(/\s+/).filter(Boolean)) {
      out.set(token, (out.get(token) ?? 0) + 1);
    }
    return out;
  },
};

function file(path: string, mtime = 1, size = 1): TFile {
  return { path, stat: { mtime, size } } as TFile;
}

describe("BodyTokenIndex", () => {
  it("releases serialized body entries while consuming a valid cache", () => {
    const entries = [
      {
        path: "cached.md",
        mtime: 1,
        size: 10,
        tokens: [["cached", 1] as [string, number]],
      },
    ];
    const app = {
      vault: {
        getMarkdownFiles: () => [],
        cachedRead: async () => "",
      },
    } as unknown as App;
    const index = new BodyTokenIndex(app, words);

    expect(index.restore(entries, 40, { consume: true })).toBe(true);
    expect(entries).toEqual([]);
    expect(index.snapshot()).toEqual([
      {
        path: "cached.md",
        mtime: 1,
        size: 10,
        tokens: [["cached", 1]],
      },
    ]);
  });

  it("builds df and swaps a complete salient corpus", async () => {
    const bodies = new Map([
      ["a.md", "shared shared alpha"],
      ["b.md", "shared beta"],
      ["c.md", "gamma"],
      ["d.md", "delta"],
      ["e.md", "epsilon"],
    ]);
    const files = [...bodies.keys()].map((path) => file(path));
    const app = {
      vault: {
        getMarkdownFiles: () => files,
        cachedRead: async (file: TFile) => bodies.get(file.path) ?? "",
      },
    } as unknown as App;
    const index = new BodyTokenIndex(app, words);

    await index.rebuildAll(40);

    expect(index.isBuilt()).toBe(true);
    expect(index.filesWithToken("shared")).toEqual(new Set(["a.md", "b.md"]));
  });

  it("ranks only terms with useful corpus frequency", () => {
    const selected = rankSalient(
      new Map([
        ["unique", 5],
        ["useful", 2],
        ["common", 1],
      ]),
      40,
      new Map([
        ["unique", 1],
        ["useful", 2],
        ["common", 9],
      ]),
      10,
    );
    expect(selected).toEqual(new Set(["useful"]));
  });

  it("keeps a body-unique term when another note uses it in the title", async () => {
    const bodies = new Map([
      ["active.md", ""],
      ["candidate.md", "alpha"],
      ["filler1.md", "one"],
      ["filler2.md", "two"],
      ["filler3.md", "three"],
    ]);
    const files = [...bodies.keys()].map((path) => file(path));
    const app = {
      vault: {
        getMarkdownFiles: () => files,
        cachedRead: async (file: TFile) => bodies.get(file.path) ?? "",
      },
    } as unknown as App;
    const titles = {
      documentFrequencyEntries: () =>
        new Map([["alpha", 1]]).entries(),
      tokensFor: (path: string) =>
        path === "active.md" ? new Set(["alpha"]) : new Set<string>(),
      totalNotesCount: () => files.length,
    } as unknown as TitleTokenIndex;
    const index = new BodyTokenIndex(app, words, titles);

    await index.rebuildAll(40);

    expect(index.filesWithToken("alpha")).toEqual(
      new Set(["candidate.md"]),
    );
    expect(index.notesWithTokenCount("alpha")).toBe(2);
  });

  it("restores counts and tokenizes only files with changed stamps", async () => {
    const bodies = new Map([
      ["unchanged.md", "shared old"],
      ["changed.md", "shared new"],
    ]);
    const files = [file("unchanged.md", 1, 10), file("changed.md", 2, 20)];
    const calls: string[] = [];
    const recording: TokenCounter = {
      tokenize(text) {
        calls.push(text);
        return words.tokenize(text);
      },
    };
    const app = {
      vault: {
        getMarkdownFiles: () => files,
        cachedRead: async (target: TFile) => bodies.get(target.path) ?? "",
      },
    } as unknown as App;
    const index = new BodyTokenIndex(app, recording);

    expect(
      index.restore(
        [
          {
            path: "unchanged.md",
            mtime: 1,
            size: 10,
            tokens: [["shared", 1], ["old", 1]],
          },
          {
            path: "changed.md",
            mtime: 1,
            size: 20,
            tokens: [["stale", 1]],
          },
        ],
        40,
      ),
    ).toBe(true);
    expect(await index.syncAll(40, 1)).toBe(true);

    expect(calls).toEqual(["shared new"]);
    expect(index.snapshot()).toEqual([
      {
        path: "unchanged.md",
        mtime: 1,
        size: 10,
        tokens: [["shared", 1], ["old", 1]],
      },
      {
        path: "changed.md",
        mtime: 2,
        size: 20,
        tokens: [["shared", 1], ["new", 1]],
      },
    ]);
    expect(index.filesWithToken("shared")).toEqual(
      new Set(["unchanged.md", "changed.md"]),
    );
  });

  it("reports an unchanged restored body cache", async () => {
    const target = file("cached.md", 1, 10);
    const app = {
      vault: {
        getMarkdownFiles: () => [target],
        cachedRead: async () => {
          throw new Error("an unchanged cache should not read the body");
        },
      },
    } as unknown as App;
    const index = new BodyTokenIndex(app, words);
    expect(
      index.restore(
        [
          {
            path: "cached.md",
            mtime: 1,
            size: 10,
            tokens: [["cached", 1]],
          },
        ],
        40,
      ),
    ).toBe(true);
    const restoredCounts = (
      index as unknown as {
        counts: Map<string, Map<string, number>>;
      }
    ).counts.get("cached.md");

    expect(await index.syncAll(40)).toBe(false);
    expect(
      (
        index as unknown as {
          counts: Map<string, Map<string, number>>;
        }
      ).counts.get("cached.md"),
    ).toBe(restoredCounts);
  });

  it("reports paths removed from a restored body cache", async () => {
    const app = {
      vault: {
        getMarkdownFiles: () => [],
        cachedRead: async () => "",
      },
    } as unknown as App;
    const index = new BodyTokenIndex(app, words);
    expect(
      index.restore(
        [
          {
            path: "deleted.md",
            mtime: 1,
            size: 10,
            tokens: [["deleted", 1]],
          },
        ],
        40,
      ),
    ).toBe(true);

    expect(await index.syncAll(40)).toBe(true);
    expect(index.snapshot()).toEqual([]);
  });

  it("updates corpus frequency exactly after one note changes", async () => {
    const bodies = new Map([
      ["a.md", "shared"],
      ["b.md", "shared"],
      ["c.md", "other"],
      ["d.md", "fourth"],
      ["e.md", "fifth"],
    ]);
    const files = [...bodies.keys()].map((path) => file(path));
    const app = {
      vault: {
        getMarkdownFiles: () => files,
        cachedRead: async (target: TFile) => bodies.get(target.path) ?? "",
      },
    } as unknown as App;
    const index = new BodyTokenIndex(app, words);
    await index.rebuildAll(40);
    expect(index.notesWithTokenCount("shared")).toBe(2);

    bodies.set("b.md", "replacement");
    files[1] = file("b.md", 2);
    await index.refreshNote(files[1], 40);

    expect(index.notesWithTokenCount("shared")).toBe(1);
    expect(index.filesWithToken("shared")).toEqual(new Set());
  });

  it("reranks only notes affected by an edited note's df changes", async () => {
    const bodies = new Map([
      ["a.md", "shared"],
      ["b.md", "shared"],
      ["c.md", "stable"],
      ["d.md", "stable"],
      ["e.md", "other"],
    ]);
    const files = [...bodies.keys()].map((path) => file(path));
    const app = {
      vault: {
        getMarkdownFiles: () => files,
        cachedRead: async (target: TFile) => bodies.get(target.path) ?? "",
      },
    } as unknown as App;
    const index = new BodyTokenIndex(app, words);
    await index.rebuildAll(40);

    const affectedBefore = index.salientFor("a.md");
    const unaffectedBefore = index.salientFor("c.md");
    bodies.set("b.md", "replacement");
    files[1] = file("b.md", 2);
    await index.refreshNote(files[1], 40);

    expect(index.salientFor("a.md")).not.toBe(affectedBefore);
    expect(index.salientFor("a.md")).toEqual(new Set());
    expect(affectedBefore).toEqual(new Set(["shared"]));
    // A full recompute would replace every Set. Keeping this identity proves
    // the unrelated note did not get reranked.
    expect(index.salientFor("c.md")).toBe(unaffectedBefore);
    expect(index.salientFor("c.md")).toEqual(new Set(["stable"]));
  });

  it("does not let an older asynchronous refresh overwrite a newer one", async () => {
    const target = file("a.md", 1);
    const pending: Array<(value: string) => void> = [];
    const app = {
      vault: {
        getMarkdownFiles: () => [target],
        cachedRead: () =>
          new Promise<string>((resolve) => {
            pending.push(resolve);
          }),
      },
    } as unknown as App;
    const index = new BodyTokenIndex(app, words);
    expect(
      index.restore(
        [
          {
            path: "a.md",
            mtime: 0,
            size: 1,
            tokens: [["initial", 1]],
          },
        ],
        40,
      ),
    ).toBe(true);

    const older = index.refreshNote(target, 40);
    const newer = index.refreshNote(target, 40);
    pending[1]("newer");
    await newer;
    pending[0]("older");
    await older;

    expect(index.snapshot()[0].tokens).toEqual([["newer", 1]]);
    expect(inFlightReadCount(index)).toBe(0);
  });

  it("invalidates a pending refresh on removal without retaining a tombstone", async () => {
    const target = file("removed.md", 1);
    let finishRead!: (value: string) => void;
    const app = {
      vault: {
        getMarkdownFiles: () => [target],
        cachedRead: () =>
          new Promise<string>((resolve) => {
            finishRead = resolve;
          }),
      },
    } as unknown as App;
    const index = new BodyTokenIndex(app, words);
    expect(
      index.restore(
        [
          {
            path: target.path,
            mtime: 0,
            size: 1,
            tokens: [["initial", 1]],
          },
        ],
        40,
      ),
    ).toBe(true);

    const refresh = index.refreshNote(target, 40);
    expect(inFlightReadCount(index)).toBe(1);
    index.remove(target.path);
    expect(inFlightReadCount(index)).toBe(0);
    finishRead("stale");
    await refresh;

    expect(index.snapshot()).toEqual([]);
    expect(inFlightReadCount(index)).toBe(0);
  });

  it("releases an in-flight ticket when reading fails", async () => {
    const target = file("failed.md", 1);
    const app = {
      vault: {
        getMarkdownFiles: () => [target],
        cachedRead: async () => {
          throw new Error("read failed");
        },
      },
    } as unknown as App;
    const index = new BodyTokenIndex(app, words);
    expect(
      index.restore(
        [
          {
            path: target.path,
            mtime: 0,
            size: 1,
            tokens: [["initial", 1]],
          },
        ],
        40,
      ),
    ).toBe(true);

    await expect(index.refreshNote(target, 40)).rejects.toThrow("read failed");
    expect(inFlightReadCount(index)).toBe(0);
  });
});

function inFlightReadCount(index: BodyTokenIndex): number {
  return (
    index as unknown as {
      inFlightReads: Map<string, object>;
    }
  ).inFlightReads.size;
}
