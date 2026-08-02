import { describe, expect, it, vi } from "vitest";
import type { TokenCounter } from "../analysis/types";
import type { BodyTokenIndex } from "../cache/bodyTokens";
import { InvertedIndex } from "../cache/inverted";
import { SnapshotStore } from "../cache/store";
import { TitleTokenIndex } from "../cache/titleTokens";
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
  isBuilt: () => false,
  salientFor: () => new Set<string>(),
  filesWithToken: () => new Set<string>(),
  notesWithTokenCount: () => 0,
  idf: () => 0,
} as unknown as BodyTokenIndex;

const NO_TOKENS: Set<string> = new Set();
const words: TokenCounter = {
  tokenize(text) {
    const out = new Map<string, number>();
    for (const word of text.toLowerCase().match(/[a-z一-龥ぁ-んァ-ヶー]+/g) ?? []) {
      out.set(word, (out.get(word) ?? 0) + 1);
    }
    return out;
  },
};

function engine(snaps: FileSnapshot[]): ScoringEngine {
  const store = new SnapshotStore();
  store.rebuildAll(snaps);
  const inverted = new InvertedIndex(store);
  inverted.rebuild();
  // A real TitleTokenIndex (not a mock): it has no I/O dependency, and the
  // test fixture basenames below are distinct English words that never
  // collide, so it contributes nothing unless a test's own title-token
  // assertions rely on it deliberately (see the "title tokens" describe block).
  const titles = new TitleTokenIndex(store, words);
  for (const snapshot of store.all()) titles.add(snapshot.path);
  return new ScoringEngine(store, inverted, noBody, titles, words);
}

function engineWithBody(
  snaps: FileSnapshot[],
  bodyTokens: Record<string, string[]>,
): ScoringEngine {
  const store = new SnapshotStore();
  store.rebuildAll(snaps);
  const inverted = new InvertedIndex(store);
  inverted.rebuild();
  const titles = new TitleTokenIndex(store, words);
  for (const snapshot of store.all()) titles.add(snapshot.path);
  const perPath = new Map(
    Object.entries(bodyTokens).map(([path, tokens]) => [
      path,
      new Set(tokens),
    ]),
  );
  const body = {
    isBuilt: () => true,
    salientFor: (path: string) => perPath.get(path) ?? new Set<string>(),
    filesWithToken: (token: string) =>
      new Set(
        [...perPath]
          .filter(([, tokens]) => tokens.has(token))
          .map(([path]) => path),
      ),
    notesWithTokenCount: (token: string) => {
      const paths = new Set(titles.filesWithToken(token));
      for (const [path, tokens] of perPath) {
        if (tokens.has(token)) paths.add(path);
      }
      return paths.size;
    },
  } as unknown as BodyTokenIndex;
  return new ScoringEngine(store, inverted, body, titles, words);
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

  it("weights a backlink from a focused source above one from a MOC", () => {
    // Both candidates are co-cited with active, but `focused` shares a source
    // that links to just the two of them, while `viamoc` shares a source that
    // links to everything. The focused co-citation should score higher.
    // Both siblings enter the candidate set via the shared tag; the backlink
    // only boosts (a pure co-citation does not generate a candidate on its own).
    const mocLinks = Array.from({ length: 40 }, (_, i) => `f${i}.md`);
    const e = engine([
      snap("active.md", { tags: ["x"] }),
      snap("focused.md", { tags: ["x"] }),
      snap("viamoc.md", { tags: ["x"] }),
      snap("src.md", { outlinks: ["active.md", "focused.md"] }),
      snap("moc.md", { outlinks: ["active.md", "viamoc.md", ...mocLinks] }),
    ]);
    const { results } = e.score("active.md", settings(), NO_TOKENS);
    const focused = results.find((r) => r.path === "focused.md")!;
    const viamoc = results.find((r) => r.path === "viamoc.md")!;
    expect(focused.reasons.sharedBacklinks).toEqual(["src.md"]);
    expect(viamoc.reasons.sharedBacklinks).toEqual(["moc.md"]);
    expect(focused.rawScore).toBeGreaterThan(viamoc.rawScore);
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

  it("excluded content words neither generate candidates nor score", () => {
    // A body mock where both notes share the salient token コメント.
    const body = {
      isBuilt: () => true,
      salientFor: (p: string) =>
        p === "match.md" ? new Set(["コメント"]) : new Set<string>(),
      filesWithToken: (t: string) =>
        t === "コメント"
          ? new Set(["active.md", "match.md"])
          : new Set<string>(),
      notesWithTokenCount: (t: string) => (t === "コメント" ? 2 : 0),
      idf: () => 1,
    } as unknown as BodyTokenIndex;
    const store = new SnapshotStore();
    store.rebuildAll([
      snap("active.md"),
      snap("match.md"),
      snap("filler1.md"),
      snap("filler2.md"),
      snap("filler3.md"),
      snap("filler4.md"),
    ]);
    const inverted = new InvertedIndex(store);
    inverted.rebuild();
    const titles = new TitleTokenIndex(store, words);
    for (const snapshot of store.all()) titles.add(snapshot.path);
    const e = new ScoringEngine(store, inverted, body, titles, words);

    const active = new Set(["コメント"]);
    // Without exclusion the shared token surfaces match.md.
    const on = e.score("active.md", settings({ bodyTokenEnabled: true }), active);
    expect(on.results.map((r) => r.path)).toEqual(["match.md"]);
    // Excluding the word drops the only signal -> no candidate.
    const off = e.score(
      "active.md",
      settings({ bodyTokenEnabled: true, excludedContentTokens: ["コメント"] }),
      active,
    );
    expect(off.results).toEqual([]);
  });

  it("surfaces a backlink-only candidate (B->A, no other shared signal) via directLinkWeight", () => {
    const e = engine([
      snap("active.md"),
      // linksBack links to active but shares no tags/outlinks/folder.
      snap("linksBack.md", { outlinks: ["active.md"] }),
    ]);
    const { results } = e.score("active.md", settings(), NO_TOKENS);
    expect(results.map((r) => r.path)).toEqual(["linksBack.md"]);
    expect(results[0].reasons.linksToActive).toBe(true);
  });

  it("surfaces a candidate whose full title is mentioned as plain text", () => {
    const e = engine([
      snap("active.md"),
      snap("Target Note.md"),
      snap("filler.md"),
    ]);
    const { results } = e.score(
      "active.md",
      settings(),
      NO_TOKENS,
      "Target Noteについて考える。",
    );
    expect(results.map((result) => result.path)).toEqual(["Target Note.md"]);
    expect(results[0].reasons.mentionsCandidateTitle).toBe(true);
    expect(results[0].rawScore).toBe(DEFAULT_SETTINGS.unlinkedMentionWeight);
  });

  it("does not score an existing link as an unlinked title mention", () => {
    const e = engine([
      snap("active.md", { outlinks: ["Target Note.md"] }),
      snap("Target Note.md"),
      snap("filler.md"),
    ]);
    const { results } = e.score(
      "active.md",
      settings(),
      NO_TOKENS,
      "[[Target Note]] Target Note",
    );
    expect(results).toEqual([]);
  });

  it("disables title-mention discovery when its weight is 0", () => {
    const e = engine([
      snap("active.md"),
      snap("Target Note.md"),
      snap("filler.md"),
    ]);
    const { results } = e.score(
      "active.md",
      settings({ unlinkedMentionWeight: 0 }),
      NO_TOKENS,
      "Target Note",
    );
    expect(results).toEqual([]);
  });

  it("does not flag linksToActive when the active note doesn't have that backlink", () => {
    const e = engine([
      snap("active.md", { tags: ["x"] }),
      snap("match.md", { tags: ["x"] }),
      // untagged filler keeps tag "x"'s IDF above zero (see other tests).
      snap("filler.md"),
    ]);
    const { results } = e.score("active.md", settings(), NO_TOKENS);
    const match = results.find((r) => r.path === "match.md")!;
    expect(match).toBeDefined();
    expect(match.reasons.linksToActive).toBe(false);
  });

  it("does not flag linksToActive for a mutual link (already linked back)", () => {
    const e = engine([
      snap("active.md", { tags: ["x"], outlinks: ["mutual.md"] }),
      snap("mutual.md", { tags: ["x"], outlinks: ["active.md"] }),
      // untagged filler keeps tag "x"'s IDF above zero (see other tests).
      snap("filler.md"),
    ]);
    const { results } = e.score("active.md", settings(), NO_TOKENS);
    const mutual = results.find((r) => r.path === "mutual.md")!;
    expect(mutual).toBeDefined();
    expect(mutual.alreadyLinked).toBe(true);
    expect(mutual.reasons.linksToActive).toBe(false);
  });

  it("discovers a co-cited candidate through a focused backlink hub", () => {
    // hub links to both active and b, and has few enough outlinks to count
    // as "focused". b shares no tags/outlinks/folder with active on its own.
    const e = engine([
      snap("active.md"),
      snap("b.md"),
      snap("hub.md", { outlinks: ["active.md", "b.md"] }),
    ]);
    const { results } = e.score("active.md", settings(), NO_TOKENS);
    const b = results.find((r) => r.path === "b.md");
    expect(b).toBeDefined();
    expect(b!.reasons.sharedBacklinks).toEqual(["hub.md"]);
  });

  it("does not expand through a hub whose outlinkCount exceeds the focused-source threshold", () => {
    const mocLinks = Array.from({ length: 25 }, (_, i) => `f${i}.md`);
    const e = engine([
      snap("active.md"),
      snap("b.md"),
      snap("hub.md", { outlinks: ["active.md", "b.md", ...mocLinks] }),
    ]);
    const { results } = e.score("active.md", settings(), NO_TOKENS);
    expect(results.find((r) => r.path === "b.md")).toBeUndefined();
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

  it("limits candidates to the active note's root folder when enabled", () => {
    const e = engine([
      snap("Projects/Alpha/active.md", {
        tags: ["x"],
        folder: "Projects/Alpha",
      }),
      snap("Projects/Beta/match.md", {
        tags: ["x"],
        folder: "Projects/Beta",
      }),
      snap("Archive/match.md", { tags: ["x"], folder: "Archive" }),
      snap("filler.md"),
    ]);
    const { results } = e.score(
      "Projects/Alpha/active.md",
      settings({ sameRootFolderOnly: true }),
      NO_TOKENS,
    );
    expect(results.map((result) => result.path)).toEqual([
      "Projects/Beta/match.md",
    ]);
  });

  it("keeps cross-root candidates when the setting is off by default", () => {
    const e = engine([
      snap("Projects/active.md", { tags: ["x"], folder: "Projects" }),
      snap("Archive/match.md", { tags: ["x"], folder: "Archive" }),
      snap("filler.md"),
    ]);
    const { results } = e.score(
      "Projects/active.md",
      settings(),
      NO_TOKENS,
    );
    expect(results.map((result) => result.path)).toEqual([
      "Archive/match.md",
    ]);
  });

  it("groups vault-root notes together when root-folder limiting is enabled", () => {
    const e = engine([
      snap("active.md", { tags: ["x"] }),
      snap("match.md", { tags: ["x"] }),
      snap("Projects/match.md", { tags: ["x"], folder: "Projects" }),
      snap("filler.md"),
    ]);
    const { results } = e.score(
      "active.md",
      settings({ sameRootFolderOnly: true }),
      NO_TOKENS,
    );
    expect(results.map((result) => result.path)).toEqual(["match.md"]);
  });
});

describe("ScoringEngine.score — content tokens", () => {
  it("treats title words as content and discovers a title-only match", () => {
    // "topic" is shared by exactly 2 of 10 notes, so
    // the df-ratio guard does not block it from generating a candidate.
    const filler = Array.from({ length: 8 }, (_, i) => snap(`Filler${i}.md`));
    const e = engine([
      snap("Active Topic.md"),
      snap("Related Topic.md"),
      ...filler,
    ]);
    const { results } = e.score("Active Topic.md", settings(), NO_TOKENS);
    const related = results.find((r) => r.path === "Related Topic.md");
    expect(related).toBeDefined();
    expect(related!.reasons.sharedContentTokens).toEqual(["topic"]);
    expect(related!.rawScore).toBeGreaterThan(0);
  });

  it("guards candidate expansion for an overly common content token, but still scores an independently discovered candidate", () => {
    // "notes" is carried by 5 of 11 notes (5/11 ≈ 45% > 40%): too common to
    // fan out on. "Notes Only" shares nothing else with the active note, so
    // it must never become a candidate. "Notes ViaTag" shares tag x (its own
    // route into the candidate set) AND the word "notes" — computeReasons/
    // rawScore aren't gated by the expansion guard, so it should score above
    // "Plain Baseline", which shares only the tag.
    const filler = Array.from({ length: 5 }, (_, i) => snap(`Filler${i}.md`));
    const e = engine([
      snap("Notes Active.md", { tags: ["x"] }),
      snap("Notes Only.md"),
      snap("Notes ViaTag.md", { tags: ["x"] }),
      snap("Notes Extra One.md"),
      snap("Notes Extra Two.md"),
      snap("Plain Baseline.md", { tags: ["x"] }),
      ...filler,
    ]);
    const { results } = e.score("Notes Active.md", settings(), NO_TOKENS);

    expect(results.find((r) => r.path === "Notes Only.md")).toBeUndefined();

    const viaTag = results.find((r) => r.path === "Notes ViaTag.md");
    const baseline = results.find((r) => r.path === "Plain Baseline.md");
    expect(viaTag).toBeDefined();
    expect(baseline).toBeDefined();
    expect(viaTag!.reasons.sharedContentTokens).toEqual(["notes"]);
    expect(baseline!.reasons.sharedContentTokens).toEqual([]);
    expect(viaTag!.rawScore).toBeGreaterThan(baseline!.rawScore);
  });

  it("orders shared content reasons by descending IDF", () => {
    const e = engine([
      snap("Common Rare.md"),
      snap("Common Rare Candidate.md"),
      snap("Common Extra One.md"),
      snap("Common Extra Two.md"),
      snap("Common Extra Three.md"),
      ...Array.from({ length: 5 }, (_, i) => snap(`Filler${i}.md`)),
    ]);
    const { results } = e.score("Common Rare.md", settings(), NO_TOKENS);
    const candidate = results.find(
      (result) => result.path === "Common Rare Candidate.md",
    );

    expect(candidate?.reasons.sharedContentTokens).toEqual([
      "rare",
      "common",
    ]);
  });

  it("scores compound and component keys without containment suppression", () => {
    const compoundAnalyzer: TokenCounter = {
      tokenize(text) {
        if (!text.includes("Compound")) return words.tokenize(text);
        return new Map([
          ["機械", 1],
          ["学習", 1],
          ["機械学習", 1],
        ]);
      },
    };
    const store = new SnapshotStore();
    store.rebuildAll([
      snap("Compound Active.md"),
      snap("Compound Related.md"),
      ...Array.from({ length: 8 }, (_, i) => snap(`Filler${i}.md`)),
    ]);
    const inverted = new InvertedIndex(store);
    inverted.rebuild();
    const titles = new TitleTokenIndex(store, compoundAnalyzer);
    for (const snapshot of store.all()) titles.add(snapshot.path);
    const e = new ScoringEngine(
      store,
      inverted,
      noBody,
      titles,
      compoundAnalyzer,
    );

    const related = e.score(
      "Compound Active.md",
      settings(),
      NO_TOKENS,
    ).results.find((result) => result.path === "Compound Related.md");
    const oneTokenContribution =
      DEFAULT_SETTINGS.contentWeight * Math.log(10 / 2);

    expect(related?.reasons.sharedContentTokens).toEqual([
      "機械",
      "学習",
      "機械学習",
    ]);
    expect(related?.rawScore).toBeCloseTo(3 * oneTokenContribution);
  });

  it("contentWeight of 0 removes lexical score contribution", () => {
    const filler = Array.from({ length: 8 }, (_, i) => snap(`Filler${i}.md`));
    const e = engine([
      snap("Active Topic.md"),
      snap("Related Topic.md"),
      ...filler,
    ]);
    const { results } = e.score(
      "Active Topic.md",
      settings({ contentWeight: 0 }),
      NO_TOKENS,
    );
    expect(results.find((r) => r.path === "Related Topic.md")).toBeUndefined();
  });

  it("applies content exclusions to title words in lightweight mode", () => {
    const filler = Array.from({ length: 8 }, (_, i) => snap(`Filler${i}.md`));
    const e = engine([
      snap("Active Memo.md"),
      snap("Related Memo.md"),
      ...filler,
    ]);
    const { results } = e.score(
      "Active Memo.md",
      settings({
        bodyTokenEnabled: false,
        excludedContentTokens: ["memo"],
      }),
      NO_TOKENS,
    );
    expect(results).toEqual([]);
  });

  it("uses restored title indexes before the analyzer is ready", () => {
    const snaps = [
      snap("Active Topic.md"),
      snap("Related Topic.md"),
      ...Array.from({ length: 8 }, (_, i) => snap(`Filler${i}.md`)),
    ];
    const store = new SnapshotStore();
    store.rebuildAll(snaps);
    const inverted = new InvertedIndex(store);
    inverted.rebuild();
    const titles = new TitleTokenIndex(store, words);
    for (const snapshot of store.all()) titles.add(snapshot.path);
    const scoring = new ScoringEngine(store, inverted);
    scoring.attachCachedMorphology(noBody, titles);

    expect(
      scoring
        .score("Active Topic.md", settings(), NO_TOKENS)
        .results.map((result) => result.path),
    ).toContain("Related Topic.md");
    expect(
      scoring.score(
        "Active Topic.md",
        settings({ excludedContentTokens: ["topic"] }),
        NO_TOKENS,
      ).results,
    ).toEqual([]);
  });

  it("matches an active title word against a candidate body word", () => {
    const e = engineWithBody(
      [
        snap("Alpha.md"),
        snap("Candidate.md"),
        snap("FillerOne.md"),
        snap("FillerTwo.md"),
        snap("FillerThree.md"),
        snap("FillerFour.md"),
      ],
      { "Candidate.md": ["alpha"] },
    );
    const { results } = e.score("Alpha.md", settings(), NO_TOKENS);
    expect(results.map((result) => result.path)).toEqual(["Candidate.md"]);
    expect(results[0].reasons.sharedContentTokens).toEqual(["alpha"]);
  });

  it("counts a word only once when it appears in both title and body", () => {
    const e = engineWithBody(
      [
        snap("Alpha.md"),
        snap("Alpha Candidate.md"),
        snap("FillerOne.md"),
        snap("FillerTwo.md"),
        snap("FillerThree.md"),
        snap("FillerFour.md"),
      ],
      {
        "Alpha.md": ["alpha"],
        "Alpha Candidate.md": ["alpha"],
      },
    );
    const { results } = e.score(
      "Alpha.md",
      settings(),
      new Set(["alpha"]),
    );
    expect(results[0].reasons.sharedContentTokens).toEqual(["alpha"]);
  });

  it("rejects a common content token before reading its posting lists", () => {
    const snaps = [
      snap("Common.md"),
      snap("First.md"),
      snap("Second.md"),
      snap("Third.md"),
    ];
    const store = new SnapshotStore();
    store.rebuildAll(snaps);
    const inverted = new InvertedIndex(store);
    inverted.rebuild();
    const titles = new TitleTokenIndex(store, words);
    for (const snapshot of store.all()) titles.add(snapshot.path);
    const titlePostings = vi.spyOn(titles, "filesWithToken");
    const bodyPostings = vi.fn(() => new Set<string>());
    const body = {
      isBuilt: () => true,
      salientFor: () => NO_TOKENS,
      filesWithToken: bodyPostings,
      notesWithTokenCount: () => snaps.length,
    } as unknown as BodyTokenIndex;
    const scoring = new ScoringEngine(store, inverted, body, titles, words);

    scoring.score(
      "Common.md",
      settings({ bodyTokenEnabled: true }),
      NO_TOKENS,
    );

    expect(titlePostings).not.toHaveBeenCalled();
    expect(bodyPostings).not.toHaveBeenCalled();
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
