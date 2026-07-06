import { describe, expect, it } from "vitest";
import { rankSalient } from "./bodyTokens";

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
    const salient = rankSalient(tokens, 1, df, 100);
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
    const salient = rankSalient(tokens, 1, df, totalNotes);

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
