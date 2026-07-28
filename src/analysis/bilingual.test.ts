import { describe, expect, it } from "vitest";
import { BilingualMorphologyAnalyzer } from "./bilingual";
import type {
  CanonicalToken,
  EnglishAnalyzer,
  JapaneseAnalyzer,
} from "./types";

class RecordingJapanese implements JapaneseAnalyzer {
  spans: string[] = [];

  analyze(text: string): CanonicalToken[] {
    this.spans.push(text);
    return [...text.matchAll(/[一-龥ぁ-んァ-ヶー]+/g)].map(([key]) => ({
      key,
      language: "ja" as const,
      pos: "TEST",
    }));
  }
}

class RecordingEnglish implements EnglishAnalyzer {
  spans: string[] = [];

  analyze(text: string): CanonicalToken[] {
    this.spans.push(text);
    return [...text.matchAll(/[A-Za-z]+/g)].map(([key]) => ({
      key: key.toLowerCase(),
      language: "en" as const,
      pos: "TEST",
    }));
  }
}

describe("BilingualMorphologyAnalyzer", () => {
  it("routes mixed-language spans without classifying the whole note", () => {
    const ja = new RecordingJapanese();
    const en = new RecordingEnglish();
    const analyzer = new BilingualMorphologyAnalyzer(ja, en);

    expect(
      analyzer
        .analyze("この function returns a value を確認する")
        .map((token) => token.key),
    ).toEqual(["この", "function", "returns", "a", "value", "を確認する"]);
    expect(en.spans).toEqual(["function returns a value"]);
    expect(ja.spans).toEqual(["この ", " を確認する"]);
  });

  it("splits at script boundaries even without whitespace", () => {
    const ja = new RecordingJapanese();
    const en = new RecordingEnglish();
    const analyzer = new BilingualMorphologyAnalyzer(ja, en);

    analyzer.analyze("TypeScriptでVaultを確認");
    expect(en.spans).toEqual(["TypeScript", "Vault"]);
    expect(ja.spans).toEqual(["で", "を確認"]);
  });

  it("protects exact NFKC custom terms with longest match", () => {
    const ja = new RecordingJapanese();
    const en = new RecordingEnglish();
    const analyzer = new BilingualMorphologyAnalyzer(ja, en);
    analyzer.setCustomVocabulary(["ヴァイパー", "ヴァイパーX"]);

    expect(analyzer.analyze("ヴァイパーXを使う")).toEqual([
      { key: "ヴァイパーX", language: "custom", pos: "CUSTOM" },
      { key: "を使う", language: "ja", pos: "TEST" },
    ]);
  });

  it("protects symbol-containing custom terms before symbol removal", () => {
    const analyzer = new BilingualMorphologyAnalyzer(
      new RecordingJapanese(),
      new RecordingEnglish(),
    );
    analyzer.setCustomVocabulary(["C++|cpp"]);

    expect(analyzer.analyze("C++とcppを比較").filter(
      (token) => token.language === "custom",
    )).toEqual([
      { key: "C++", language: "custom", pos: "CUSTOM" },
      { key: "C++", language: "custom", pos: "CUSTOM" },
    ]);
    expect(analyzer.analyze("`C++` と C++").filter(
      (token) => token.language === "custom",
    )).toEqual([
      { key: "C++", language: "custom", pos: "CUSTOM" },
    ]);
  });

  it("keeps removing unregistered symbols before NFKC", () => {
    const analyzer = new BilingualMorphologyAnalyzer(
      new RecordingJapanese(),
      new RecordingEnglish(),
    );

    expect(analyzer.analyze("C++ ™").map((token) => token.key)).toEqual(["c"]);
  });

  it("requires identifier boundaries for ASCII custom terms", () => {
    const analyzer = new BilingualMorphologyAnalyzer(
      new RecordingJapanese(),
      new RecordingEnglish(),
    );
    analyzer.setCustomVocabulary(["AI", "API"]);

    const custom = analyzer
      .analyze("RAIL ai API2 api")
      .filter((token) => token.language === "custom")
      .map((token) => token.key);
    expect(custom).toEqual(["AI", "API"]);
  });

  it("normalizes every spelling in an alias group to its first spelling", () => {
    const analyzer = new BilingualMorphologyAnalyzer(
      new RecordingJapanese(),
      new RecordingEnglish(),
    );
    analyzer.setCustomVocabulary([
      "ツェッテルカステン|Zettelkasten",
    ]);

    expect(
      analyzer
        .analyze("ツェッテルカステンとzettelkasten")
        .filter((token) => token.language === "custom"),
    ).toEqual([
      {
        key: "ツェッテルカステン",
        language: "custom",
        pos: "CUSTOM",
      },
      {
        key: "ツェッテルカステン",
        language: "custom",
        pos: "CUSTOM",
      },
    ]);
    expect(analyzer.tokenize("ツェッテルカステン ZETTELKASTEN")).toEqual(
      new Map([["ツェッテルカステン", 2]]),
    );
  });

  it("merges alias groups transitively when they share a spelling", () => {
    const analyzer = new BilingualMorphologyAnalyzer(
      new RecordingJapanese(),
      new RecordingEnglish(),
    );
    analyzer.setCustomVocabulary(["A|B", "B|C"]);

    expect(
      analyzer
        .analyze("A B C")
        .filter((token) => token.language === "custom")
        .map((token) => token.key),
    ).toEqual(["A", "A", "A"]);
  });

  it("removes markdown structure before routing", () => {
    const ja = new RecordingJapanese();
    const en = new RecordingEnglish();
    const analyzer = new BilingualMorphologyAnalyzer(ja, en);

    expect(analyzer.tokenize("[label](https://example.com) `code` #tag"))
      .toEqual(new Map([["label", 1]]));
  });

  it("removes Unicode symbols before compatibility normalization", () => {
    const analyzer = new BilingualMorphologyAnalyzer(
      new RecordingJapanese(),
      new RecordingEnglish(),
    );

    expect(analyzer.analyze("◯ ✕ ✓ ✔ ™ → ★ Ⅳ 〹 〺")).toEqual([]);
  });

  it("removes standalone numbers without regex lookbehind", () => {
    const analyzer = new BilingualMorphologyAnalyzer(
      new RecordingJapanese(),
      new RecordingEnglish(),
    );

    expect(analyzer.analyze("123, 456 API2 A_3 789")).toEqual([
      { key: "api", language: "en", pos: "TEST" },
      { key: "a", language: "en", pos: "TEST" },
    ]);
  });
});
