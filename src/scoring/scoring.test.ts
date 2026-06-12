import { describe, expect, it } from "vitest";
import type { BodyTokenIndex } from "../cache/bodyTokens";
import { InvertedIndex } from "../cache/inverted";
import { SnapshotStore } from "../cache/store";
import type { FileSnapshot, PluginSettings } from "../types";
import { DEFAULT_SETTINGS } from "../types";
import { ScoringEngine } from "./index";

function snap(
  path: string,
  opts: { tags?: string[]; outlinks?: string[]; folder?: string } = {},
): FileSnapshot {
  const outlinks = new Set(opts.outlinks ?? []);
  return {
    path,
    tags: new Set(opts.tags ?? []),
    outlinks,
    backlinks: new Set(),
    ctime: 0,
    mtime: 0,
    outlinkCount: outlinks.size,
    folder: opts.folder ?? "",
  };
}

// Body matching is off in DEFAULT_SETTINGS; these methods are never reached.
const noBody = {
  salientFor: () => new Set<string>(),
  filesWithToken: () => new Set<string>(),
  idf: () => 0,
} as unknown as BodyTokenIndex;

const NO_TOKENS: Set<string> = new Set();

function engine(snaps: FileSnapshot[]): ScoringEngine {
  const store = new SnapshotStore();
  store.rebuildAll(snaps);
  const inverted = new InvertedIndex(store);
  inverted.rebuild();
  return new ScoringEngine(store, inverted, noBody);
}

function settings(overrides: Partial<PluginSettings> = {}): PluginSettings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

describe("ScoringEngine.score", () => {
  it("finds candidates via shared tags; top candidate displays 100", () => {
    const e = engine([
      snap("active.md", { tags: ["x"] }),
      snap("match.md", { tags: ["x"] }),
      snap("other.md", { tags: ["y"] }),
    ]);
    const { results } = e.score("active.md", settings(), NO_TOKENS);
    expect(results.map((r) => r.path)).toEqual(["match.md"]);
    expect(results[0].displayScore).toBe(100);
    expect(results[0].reasons.sharedTags).toEqual(["x"]);
  });

  it("weights shared outlinks above shared tags by default", () => {
    const e = engine([
      snap("active.md", { tags: ["x"], outlinks: ["hub.md"] }),
      snap("viatag.md", { tags: ["x"] }),
      snap("vialink.md", { outlinks: ["hub.md"] }),
      snap("hub.md"),
    ]);
    const { results } = e.score("active.md", settings(), NO_TOKENS);
    const paths = results.map((r) => r.path);
    expect(paths.indexOf("vialink.md")).toBeLessThan(
      paths.indexOf("viatag.md"),
    );
  });

  it("penalizes high-outlink (MOC-like) candidates", () => {
    const mocLinks = Array.from({ length: 30 }, (_, i) => `n${i}.md`);
    const e = engine([
      snap("active.md", { tags: ["x"] }),
      snap("note.md", { tags: ["x"] }),
      snap("moc.md", { tags: ["x"], outlinks: mocLinks }),
      // untagged filler: a tag carried by every note has IDF 0 and scores 0
      snap("filler.md"),
    ]);
    const { results } = e.score("active.md", settings(), NO_TOKENS);
    const note = results.find((r) => r.path === "note.md")!;
    const moc = results.find((r) => r.path === "moc.md")!;
    expect(note.rawScore).toBeGreaterThan(moc.rawScore);
  });

  it("scores shared backlinks (co-citation) for candidates", () => {
    // m links to both active and sibling; sibling is also reachable via a
    // shared tag, and the shared backlink adds on top.
    const e = engine([
      snap("active.md", { tags: ["x"] }),
      snap("sibling.md", { tags: ["x"] }),
      snap("plain.md", { tags: ["x"] }),
      snap("m.md", { outlinks: ["active.md", "sibling.md"] }),
    ]);
    const { results } = e.score("active.md", settings(), NO_TOKENS);
    const sibling = results.find((r) => r.path === "sibling.md")!;
    const plain = results.find((r) => r.path === "plain.md")!;
    expect(sibling.reasons.sharedBacklinks).toEqual(["m.md"]);
    expect(sibling.rawScore).toBeGreaterThan(plain.rawScore);
  });

  it("flags already-linked candidates and hides them only from results", () => {
    const e = engine([
      snap("active.md", { tags: ["x"], outlinks: ["linked.md"] }),
      snap("linked.md", { tags: ["x"] }),
      snap("fresh.md", { tags: ["x"] }),
      // untagged filler keeps the shared tag's IDF above zero
      snap("filler.md"),
    ]);
    const visible = e.score("active.md", settings(), NO_TOKENS);
    expect(
      visible.results.find((r) => r.path === "linked.md")?.alreadyLinked,
    ).toBe(true);

    const hidden = e.score(
      "active.md",
      settings({ hideAlreadyLinked: true }),
      NO_TOKENS,
    );
    expect(hidden.results.map((r) => r.path)).toEqual(["fresh.md"]);
    // ...but the tag-mining pool keeps the linked (high-confidence) note.
    expect(hidden.tagPool.map((r) => r.path)).toContain("linked.md");
  });

  it("excluded tags neither generate candidates nor score", () => {
    const e = engine([
      snap("active.md", { tags: ["noise"] }),
      snap("match.md", { tags: ["noise"] }),
    ]);
    const { results } = e.score(
      "active.md",
      settings({ excludedTags: ["noise"] }),
      NO_TOKENS,
    );
    expect(results).toEqual([]);
  });

  it("excluded folders remove candidates entirely", () => {
    const e = engine([
      snap("active.md", { tags: ["x"] }),
      snap("Daily/match.md", { tags: ["x"], folder: "Daily" }),
    ]);
    const { results } = e.score(
      "active.md",
      settings({ excludedFolders: ["Daily/"] }),
      NO_TOKENS,
    );
    expect(results).toEqual([]);
  });
});

describe("ScoringEngine.suggestTags", () => {
  it("suggests tags carried by >=2 pool notes with global df >= 3", () => {
    const e = engine([
      snap("active.md", { tags: ["x"] }),
      snap("p1.md", { tags: ["x", "t"] }),
      snap("p2.md", { tags: ["x", "t"] }),
      // 3rd carrier pushes t's global df to 3; "rare" stays at df 1.
      snap("elsewhere.md", { tags: ["t"] }),
      snap("p3.md", { tags: ["x", "rare"] }),
    ]);
    const s = settings();
    const { tagPool } = e.score("active.md", s, NO_TOKENS);
    const tags = e.suggestTags("active.md", tagPool, s).map((t) => t.tag);
    expect(tags).toContain("t");
    expect(tags).not.toContain("rare");
    // tags already on the active note are never suggested
    expect(tags).not.toContain("x");
  });
});
