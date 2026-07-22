import { describe, expect, it } from "vitest";
import { BodyTokenIndex, rankSalient } from "./bodyTokens";

// rankSalient is the pure ranking step shared by rebuildAll, refreshNote, and
// computeSalient: given a note's token -> in-body occurrence count map plus
// the corpus df table, it keeps the top-N by log(1+TF) * IDF
// (design-review-2026-07-02 #5). These tests exercise the formula directly,
// independent of the App/vault plumbing around it.

describe("rankSalient", () => {
  it("prefers the more frequent token within the same IDF band", () => {
    // Same df (hence same idf) for both tokens; only TF differs.
    const df = new Map([
      ["frequent", 5],
      ["rare-once", 5],
    ]);
    const tokens = new Map([
      ["frequent", 4],
      ["rare-once", 1],
    ]);
    // reserveSize 0 isolates the top-N ranking formula from the low-df reserve.
    const salient = rankSalient(tokens, 1, df, 100, 10, 0);
    expect(salient.has("frequent")).toBe(true);
    expect(salient.has("rare-once")).toBe(false);
  });

  it("lets a recurring mid-rarity token outrank a rarer one-off mention", () => {
    // "superrare" has higher IDF (df=2) but only occurs once; "topic" is
    // somewhat less rare (df=10) but recurs 5 times in the note. With pure
    // IDF ranking "superrare" would win; with log(1+TF)*IDF "topic" should.
    const totalNotes = 200;
    const df = new Map([
      ["superrare", 2],
      ["topic", 10],
    ]);
    const tokens = new Map([
      ["superrare", 1],
      ["topic", 5],
    ]);
    // reserveSize 0 isolates the top-N ranking formula from the low-df reserve
    // (which would otherwise re-admit the evicted rare "superrare").
    const salient = rankSalient(tokens, 1, df, totalNotes, 10, 0);

    const idfSuperrare = Math.log(totalNotes / 2);
    const idfTopic = Math.log(totalNotes / 10);
    // Sanity-check the premise: pure IDF would have ranked superrare first.
    expect(idfSuperrare).toBeGreaterThan(idfTopic);
    // log(1+TF) * IDF flips the order.
    const scoreSuperrare = Math.log(1 + 1) * idfSuperrare;
    const scoreTopic = Math.log(1 + 5) * idfTopic;
    expect(scoreTopic).toBeGreaterThan(scoreSuperrare);

    expect(salient.has("topic")).toBe(true);
    expect(salient.has("superrare")).toBe(false);
  });

  it("recovers a rare token evicted from the top-N via the low-df reserve", () => {
    const totalNotes = 1000;
    // "topic" recurs and outranks the rare word for the single top-N slot, so
    // without a reserve "rare" is lost. df=3 (<= reserve cap) so the reserve
    // keeps it; "mid" (df=50, > reserve cap) evicted from top-N stays out.
    const df = new Map([
      ["topic", 40],
      ["rare", 3],
      ["mid", 50],
    ]);
    const tokens = new Map([
      ["topic", 8],
      ["rare", 1],
      ["mid", 6],
    ]);
    const salient = rankSalient(tokens, 1, df, totalNotes);
    expect(salient.has("topic")).toBe(true); // won the top-N slot
    expect(salient.has("rare")).toBe(true); // reserved (df <= 10)
    expect(salient.has("mid")).toBe(false); // evicted, too common to reserve
  });

  it("reserves at the df boundary: df == cap in, df == cap+1 out", () => {
    const totalNotes = 1000;
    // "topic" wins the single top-N slot; the two rare words are both evicted.
    // With the default cap 10, df=10 is reserved and df=11 is not.
    const df = new Map([
      ["topic", 40],
      ["at-cap", 10],
      ["over-cap", 11],
    ]);
    const tokens = new Map([
      ["topic", 8],
      ["at-cap", 1],
      ["over-cap", 1],
    ]);
    const salient = rankSalient(tokens, 1, df, totalNotes); // defaults (10, 20)
    expect(salient.has("at-cap")).toBe(true);
    expect(salient.has("over-cap")).toBe(false);
  });

  it("reserves exactly RESERVE_SIZE (20) evicted rare tokens by default", () => {
    const totalNotes = 1000;
    const df = new Map<string, number>();
    const tokens = new Map<string, number>();
    df.set("topic", 40);
    tokens.set("topic", 9); // fills the single top-N slot
    // 25 rare singletons all miss the cut; the default reserve admits 20.
    for (let i = 0; i < 25; i++) {
      df.set(`rare${i}`, 3);
      tokens.set(`rare${i}`, 1);
    }
    const salient = rankSalient(tokens, 1, df, totalNotes); // defaults (10, 20)
    expect(salient.size).toBe(1 + 20); // top-N slot + full reserve
  });

  it("keeps the reserve a superset of the top-N and bounds its size", () => {
    const totalNotes = 1000;
    const df = new Map<string, number>();
    const tokens = new Map<string, number>();
    // 5 mid-frequency (recurring) words that fill a top-N of 3, plus 30 rare
    // singletons that all miss the cut. Reserve (size 2) may add at most 2.
    for (let i = 0; i < 5; i++) {
      df.set(`mid${i}`, 30);
      tokens.set(`mid${i}`, 9);
    }
    for (let i = 0; i < 30; i++) {
      df.set(`rare${i}`, 2);
      tokens.set(`rare${i}`, 1);
    }
    const topN = rankSalient(tokens, 3, df, totalNotes, 10, 0); // no reserve
    const withReserve = rankSalient(tokens, 3, df, totalNotes, 10, 2);
    for (const t of topN) expect(withReserve.has(t)).toBe(true); // superset
    expect(withReserve.size).toBe(topN.size + 2); // bounded add
  });

  it("still excludes tokens below df 2 or above the df cap, regardless of TF", () => {
    const df = new Map([
      ["singleton", 1], // df < 2: can't produce a shared signal
      ["everywhere", 90], // df > 40% of 100 notes: stop-word-like
      ["good", 5],
    ]);
    const tokens = new Map([
      ["singleton", 50], // huge TF doesn't rescue a singleton
      ["everywhere", 50],
      ["good", 1],
    ]);
    const salient = rankSalient(tokens, 10, df, 100);
    expect(salient.has("singleton")).toBe(false);
    expect(salient.has("everywhere")).toBe(false);
    expect(salient.has("good")).toBe(true);
  });
});

describe("BodyTokenIndex hiragana repair lane", () => {
  function fakeApp(bodies: Record<string, string>) {
    const files = Object.keys(bodies).map((path) => ({ path }));
    return {
      vault: {
        getMarkdownFiles: () => files,
        cachedRead: async (file: { path: string }) => bodies[file.path],
      },
    } as never;
  }

  // TinySegmenter splits みかん correctly on its own but glues it to the
  // preceding hiragana in "…ていたみかんを", yielding たみかん — so note B
  // produces no shared token until the repair lane recovers it from the
  // frozen vocabulary note A contributed.
  it("freezes segmenter vocabulary and repairs a contextual miss", async () => {
    const a = "a.md";
    const b = "b.md";
    const index = new BodyTokenIndex(fakeApp({
      [a]: "みかんをたべた",
      [b]: "ひえていたみかんをたべた",
    }));

    await index.rebuildAll(40, true);

    expect(index.salientFor(a).has("みかん")).toBe(true);
    expect(index.salientFor(b).has("みかん")).toBe(true);
    expect(index.filesWithToken("みかん")).toEqual(new Set([a, b]));
    expect(index.notesWithTokenCount("みかん")).toBe(2);
  });

  it("keeps the repair lane disabled when segmentation is disabled", async () => {
    const a = "a.md";
    const b = "b.md";
    const index = new BodyTokenIndex(fakeApp({
      [a]: "みかん",
      [b]: "なっていたみかんを取った",
    }));

    await index.rebuildAll(40, false);

    expect(index.filesWithToken("みかん").size).toBe(0);
  });
});
