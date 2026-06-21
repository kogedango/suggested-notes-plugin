import { describe, expect, it } from "vitest";
import { collectStandaloneKanji, tokenize } from "./tokenize";

describe("tokenize", () => {
  it("extracts ascii words, lowercased", () => {
    const out = tokenize("Hello World Foo");
    expect(out.has("hello")).toBe(true);
    expect(out.has("world")).toBe(true);
    expect(out.has("foo")).toBe(true);
  });

  it("requires minimum length of 3 for ascii", () => {
    const out = tokenize("ab abc abcd");
    expect(out.has("ab")).toBe(false);
    expect(out.has("abc")).toBe(true);
    expect(out.has("abcd")).toBe(true);
  });

  it("drops ascii stopwords", () => {
    const out = tokenize("the quick brown fox jumps over the lazy dog");
    expect(out.has("the")).toBe(false);
    expect(out.has("quick")).toBe(true);
  });

  it("extracts katakana of length >= 2", () => {
    const out = tokenize("プラグイン ノート バグ ア");
    expect(out.has("プラグイン")).toBe(true);
    expect(out.has("ノート")).toBe(true);
    expect(out.has("バグ")).toBe(true);
    expect(out.has("ア")).toBe(false);
  });

  it("normalizes trailing prolonged marks so spelling variants match", () => {
    expect(tokenize("サーバー").has("サーバ")).toBe(true);
    expect(tokenize("サーバ").has("サーバ")).toBe(true);
    expect(tokenize("ユーザー").has("ユーザ")).toBe(true);
    // ...but never down to a single kana.
    expect(tokenize("キー").has("キー")).toBe(true);
    expect(tokenize("キー").has("キ")).toBe(false);
  });

  it("extracts kanji of length >= 2", () => {
    const out = tokenize("関連 機能 一");
    expect(out.has("関連")).toBe(true);
    expect(out.has("機能")).toBe(true);
    expect(out.has("一")).toBe(false);
  });

  it("emits kanji bigrams alongside the full run", () => {
    const out = tokenize("機械学習");
    expect(out.has("機械学習")).toBe(true);
    expect(out.has("機械")).toBe(true);
    expect(out.has("学習")).toBe(true);
    // so a note saying just 機械 still shares a token with this one
    expect(tokenize("機械").has("機械")).toBe(true);
  });

  it("gates interior kanji 2-grams by the corpus standalone set", () => {
    // 機械 and 学習 are known standalone words; 械学 (and 本語/員何) are not.
    const standalone = new Set(["機械", "学習", "日本", "全員", "文句"]);
    const ml = tokenize("機械学習", false, standalone);
    expect(ml.has("機械学習")).toBe(true); // full run always kept
    expect(ml.has("機械")).toBe(true); // standalone -> kept
    expect(ml.has("学習")).toBe(true); // standalone -> kept
    expect(ml.has("械学")).toBe(false); // morpheme-straddling artifact -> dropped

    // the reported cases: keep the real sub-word, drop the straddling 2-gram
    const a = tokenize("日本語", false, standalone);
    expect(a.has("日本語")).toBe(true);
    expect(a.has("日本")).toBe(true);
    expect(a.has("本語")).toBe(false);
    const b = tokenize("全員何も言う", false, standalone);
    expect(b.has("全員")).toBe(true);
    expect(b.has("員何")).toBe(false);
    const c = tokenize("文句言うが", false, standalone);
    expect(c.has("文句")).toBe(true);
    expect(c.has("句言")).toBe(false);
  });

  it("without a standalone set, every kanji 2-gram is emitted (pre-gate)", () => {
    const out = tokenize("日本語");
    expect(out.has("日本")).toBe(true);
    expect(out.has("本語")).toBe(true);
  });

  it("collectStandaloneKanji gathers only length-2 kanji runs", () => {
    const s = new Set<string>();
    collectStandaloneKanji("機械 と 日本語 を 学習", s);
    expect(s.has("機械")).toBe(true); // standalone 2-kanji run
    expect(s.has("学習")).toBe(true); // standalone 2-kanji run
    expect(s.has("日本")).toBe(false); // part of the 3-kanji run 日本語
    expect(s.has("日本語")).toBe(false); // length 3, not a 2-gram
  });

  it("segmenter mode picks up okurigana-mixed and hiragana words", () => {
    const text = "会議で打ち合わせの記録をふりかえりとして書いた";
    const seg = tokenize(text, true);
    expect(seg.has("打ち合わせ")).toBe(true);
    expect(seg.has("ふりかえり")).toBe(true);
    // the default regex pass cannot see either word
    const plain = tokenize(text);
    expect(plain.has("打ち合わせ")).toBe(false);
    expect(plain.has("ふりかえり")).toBe(false);
  });

  it("segmenter mode drops hiragana function words", () => {
    const seg = tokenize("日記にひらめきを書く。サーバーの監視について", true);
    expect(seg.has("ひらめき")).toBe(true);
    expect(seg.has("について")).toBe(false);
    expect(seg.has("の")).toBe(false);
  });

  it("segmenter mode drops sokuon-clipped conjugation fragments", () => {
    // 使った/思った/なかった clip to 使っ/思っ/なかっ — っ never ends a real
    // word, so these are dropped while the dictionary form survives elsewhere.
    const seg = tokenize("資料を使った。結果は思ったほど良くなかった", true);
    expect(seg.has("使っ")).toBe(false);
    expect(seg.has("思っ")).toBe(false);
    expect(seg.has("なかっ")).toBe(false);
  });

  it("segmenter mode drops high-df grammatical patterns", () => {
    const seg = tokenize("これは設定による挙動で、ユーザーにより変わるらしい", true);
    expect(seg.has("による")).toBe(false);
    expect(seg.has("により")).toBe(false);
    expect(seg.has("らしい")).toBe(false);
    // ...but real content words around them survive.
    expect(seg.has("挙動") || seg.has("設定")).toBe(true);
  });

  it("strips frontmatter", () => {
    const md = "---\ntitle: Foo\ntag: SecretTagValue\n---\nbody mention bodyword";
    const out = tokenize(md);
    expect(out.has("secrettagvalue")).toBe(false);
    expect(out.has("bodyword")).toBe(true);
  });

  it("strips fenced code blocks", () => {
    const md = "before\n```\nhiddenword inside code\n```\nafter visible";
    const out = tokenize(md);
    expect(out.has("hiddenword")).toBe(false);
    expect(out.has("inside")).toBe(false);
    expect(out.has("after")).toBe(true);
    expect(out.has("visible")).toBe(true);
  });

  it("strips inline code", () => {
    const out = tokenize("normal `codeword stuff` afterward");
    expect(out.has("codeword")).toBe(false);
    expect(out.has("normal")).toBe(true);
    expect(out.has("afterward")).toBe(true);
  });

  it("strips wikilinks (handled by separate signal)", () => {
    const out = tokenize("see [[LinkTarget]] and prose");
    expect(out.has("linktarget")).toBe(false);
    expect(out.has("prose")).toBe(true);
  });

  it("strips embeds", () => {
    const out = tokenize("![[Embedded]] words around");
    expect(out.has("embedded")).toBe(false);
    expect(out.has("words")).toBe(true);
  });

  it("strips markdown link URLs but keeps anchor text", () => {
    const out = tokenize("[click here](https://example.com/path)");
    expect(out.has("click")).toBe(true);
    expect(out.has("here")).toBe(true);
    expect(out.has("example")).toBe(false);
  });

  it("strips hashtags (handled by tag signal)", () => {
    const out = tokenize("text #mytag-foo more #another/sub end");
    expect(out.has("mytag")).toBe(false);
    expect(out.has("another")).toBe(false);
    expect(out.has("text")).toBe(true);
    expect(out.has("more")).toBe(true);
    expect(out.has("end")).toBe(true);
  });

  it("deduplicates repeated occurrences", () => {
    const out = tokenize("repeat repeat repeat");
    expect(out.size).toBe(1);
    expect(out.has("repeat")).toBe(true);
  });

  it("NFKC-normalizes full-width ascii and half-width katakana", () => {
    // Full-width "Ｏbsidian" and half-width "ﾉｰﾄ" must fold to the same tokens
    // as their plain forms, otherwise width variants never match.
    const out = tokenize("Ｏｂｓｉｄｉａｎ のﾉｰﾄ");
    expect(out.has("obsidian")).toBe(true);
    expect(out.has("ノート")).toBe(true);
  });

  it("mixes English and Japanese in one document", () => {
    const out = tokenize("これは Obsidian のプラグインの 関連ノート 機能");
    expect(out.has("obsidian")).toBe(true);
    expect(out.has("プラグイン")).toBe(true);
    expect(out.has("関連")).toBe(true);
    expect(out.has("機能")).toBe(true);
  });
});
