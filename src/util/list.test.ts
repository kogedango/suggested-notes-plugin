import { describe, expect, it } from "vitest";
import { parseListInput } from "./list";

describe("parseListInput", () => {
  it("splits on newlines and trims", () => {
    expect(parseListInput(" a \nb\n\n c ", false)).toEqual(["a", "b", "c"]);
  });

  it("splits comma-separated input when splitCommas is on", () => {
    // The trap that motivated this helper: a whole list typed on one line.
    expect(parseListInput("コメント, 結果, メモ", true)).toEqual([
      "コメント",
      "結果",
      "メモ",
    ]);
  });

  it("accepts fullwidth and Japanese commas", () => {
    expect(parseListInput("感じ、結果,途中", true)).toEqual([
      "感じ",
      "結果",
      "途中",
    ]);
  });

  it("mixes newlines and commas", () => {
    expect(parseListInput("a, b\nc", true)).toEqual(["a", "b", "c"]);
  });

  it("keeps commas inside entries when splitCommas is off", () => {
    // Folder / note names may legally contain commas.
    expect(parseListInput("Meetings, notes\nDaily", false)).toEqual([
      "Meetings, notes",
      "Daily",
    ]);
  });

  it("preserves custom-vocabulary alias separators", () => {
    expect(
      parseListInput("ツェッテルカステン|Zettelkasten\nヴァイパー", false),
    ).toEqual(["ツェッテルカステン|Zettelkasten", "ヴァイパー"]);
  });

  it("returns [] for blank input", () => {
    expect(parseListInput("  \n , ", true)).toEqual([]);
  });
});
