import { describe, expect, it } from "vitest";
import { POSITIVE_SHARED_TOKEN_BASELINE } from "./tokenizeContrast.dataset";
import { evaluateTokenizerContrasts } from "./tokenizeContrast";

const MODES = [
  { segment: true, identified: 5, identificationRate: 5 / 20 },
  { segment: false, identified: 4, identificationRate: 4 / 20 },
] as const;

describe.each(MODES)("tokenizer contrast set (segment=$segment)", (mode) => {
  const report = evaluateTokenizerContrasts(mode.segment);

  describe("positive pairs", () => {
    for (const pair of report.positivePairs) {
      const [left, right] = pair.variants;
      it(`${left} | ${right}`, () => {
        expect(pair.sharedTokens).toEqual(expectedSharedTokens(mode.segment, left, right));
      });
    }
  });

  describe("negative pairs", () => {
    for (const pair of report.negativePairs) {
      const [left, right] = pair.variants;
      it(`${left} | ${right}`, () => {
        expect(pair.sharedTokens).toEqual([]);
      });
    }
  });

  it("reports the exact aggregate rates", () => {
    expect(report.identification).toEqual({
      count: mode.identified,
      total: 20,
      value: mode.identificationRate,
    });
    expect(report.falseMerge).toEqual({ count: 0, total: 5, value: 0 });
  });
});

function expectedSharedTokens(
  segment: boolean,
  left: string,
  right: string,
): readonly string[] {
  return POSITIVE_SHARED_TOKEN_BASELINE.find(
    (entry) =>
      entry.segment === segment &&
      entry.variants[0] === left &&
      entry.variants[1] === right,
  )?.tokens ?? [];
}
