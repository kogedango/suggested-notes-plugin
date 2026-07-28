import type { IpadicFeatures } from "kuromoji";
import { describe, expect, it } from "vitest";
import { canonicalJapaneseToken } from "./japanese";

function token(
  surface: string,
  pos: string,
  detail: string,
  base = surface,
): IpadicFeatures {
  return {
    word_id: 1,
    word_type: "KNOWN",
    word_position: 1,
    surface_form: surface,
    pos,
    pos_detail_1: detail,
    pos_detail_2: "*",
    pos_detail_3: "*",
    conjugated_type: "*",
    conjugated_form: "*",
    basic_form: base,
    reading: "*",
    pronunciation: "*",
  };
}

describe("canonicalJapaneseToken", () => {
  it("normalizes inflected independent verbs to their base form", () => {
    expect(canonicalJapaneseToken(token("使っ", "動詞", "自立", "使う"))?.key)
      .toBe("使う");
    expect(
      canonicalJapaneseToken(token("使わ", "動詞", "自立", "使う"))?.key,
    ).toBe("使う");
  });

  it("keeps content POS", () => {
    expect(canonicalJapaneseToken(token("確認", "名詞", "サ変接続"))?.key)
      .toBe("確認");
    expect(canonicalJapaneseToken(token("速く", "副詞", "一般"))?.key)
      .toBe("速く");
  });

  it("drops particles, auxiliaries, pronouns, suffixes, and numbers", () => {
    expect(canonicalJapaneseToken(token("を", "助詞", "格助詞"))).toBeNull();
    expect(canonicalJapaneseToken(token("ない", "助動詞", "*"))).toBeNull();
    expect(canonicalJapaneseToken(token("これ", "名詞", "代名詞"))).toBeNull();
    expect(canonicalJapaneseToken(token("個", "名詞", "接尾"))).toBeNull();
    expect(canonicalJapaneseToken(token("三", "名詞", "数"))).toBeNull();
  });

  it("drops symbol-only unknowns even when IPADIC labels them as nouns", () => {
    for (const surface of ["◯", "✕", "✓", "✔", "〻", "〱"]) {
      expect(canonicalJapaneseToken(token(surface, "名詞", "一般"))).toBeNull();
    }
  });
});
