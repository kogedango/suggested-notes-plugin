import { describe, expect, it } from "vitest";
import { WinkEnglishAnalyzer } from "./english";

describe("WinkEnglishAnalyzer", () => {
  const analyzer = new WinkEnglishAnalyzer();
  const keys = (text: string) => analyzer.analyze(text).map((t) => t.key);

  it("keeps content POS and removes grammatical POS", () => {
    expect(keys("The plugin is useful in this vault.")).toEqual([
      "plugin",
      "useful",
      "vault",
    ]);
  });

  it("normalizes required verb and noun inflections", () => {
    expect(keys("plugins uses using values")).toEqual([
      "plugin",
      "use",
      "use",
      "value",
    ]);
  });

  it("does not collapse short s-final words into unrelated keys", () => {
    expect(keys("js ops gis lens docs plugins")).toEqual([
      "js",
      "ops",
      "gis",
      "lens",
      "doc",
      "plugin",
    ]);
  });

  it("retains proper nouns and technical identifiers", () => {
    expect(keys("Obsidian TypeScript APIClient")).toEqual([
      "obsidian",
      "typescript",
      "apiclient",
    ]);
  });

  it("drops punctuation and numbers", () => {
    expect(keys("plugin, 123; useful!")).toEqual(["plugin", "useful"]);
  });
});
