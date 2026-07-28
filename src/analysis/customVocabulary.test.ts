import { describe, expect, it } from "vitest";
import {
  CustomVocabulary,
  foldAsciiCase,
} from "./customVocabulary";

describe("CustomVocabulary", () => {
  it("uses the first spelling across transitively connected aliases", () => {
    const vocabulary = new CustomVocabulary();
    vocabulary.setEntries(["Alpha|Beta", "Beta|Gamma"]);

    expect(
      vocabulary.matchFolded(foldAsciiCase("GAMMA"), 0)?.key,
    ).toBe("Alpha");
  });

  it("prefers the longest valid match and respects identifier boundaries", () => {
    const vocabulary = new CustomVocabulary();
    vocabulary.setEntries(["AI", "AI Lab"]);

    expect(vocabulary.matchFolded("ai lab", 0)?.key).toBe("AI Lab");
    expect(vocabulary.matchFolded("rail", 1)).toBeUndefined();
  });

  it("replaces symbol terms without exposing their interior to preprocessing", () => {
    const vocabulary = new CustomVocabulary();
    vocabulary.setEntries(["C++|cpp"]);

    const protectedTerms = vocabulary.protectSymbolTerms("C++ and cpp");
    expect(protectedTerms?.terms).toEqual([
      { surface: "c++", key: "C++" },
    ]);
    expect(protectedTerms?.text).not.toContain("C++");
    expect(protectedTerms?.text).toContain("cpp");
  });
});
