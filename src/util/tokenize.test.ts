import { describe, expect, it } from "vitest";
import {
  preprocessTokenizableText,
  tokenize,
  tokenizeWithOptions,
} from "./tokenize";

describe("tokenize", () => {
  it("keeps the options API equivalent to the legacy positional inputs", () => {
    const text = "---\ntitle: hidden\n---\n機械学習 リチウムバッテリー Obsidian";
    const standalone = new Set(["機械", "学習", "バッテリ"]);
    const legacyStandalone = new Set<string>();
    const optionsStandalone = new Set<string>();

    const legacy = tokenize(text, true, standalone, legacyStandalone);
    const options = tokenizeWithOptions(text, {
      segment: true,
      corpus: { standalone },
      collectors: { standalone: optionsStandalone },
    });

    expect(options).toEqual(legacy);
    expect(optionsStandalone).toEqual(legacyStandalone);
  });

  it("exposes the same preprocessing boundary used by every token lane", () => {
    const preprocessed = preprocessTokenizableText(
      "---\ntitle: Secret\n---\nＯｂｓｉｄｉａｎ `hidden` [表示](https://example.com)",
    );
    expect(preprocessed).not.toContain("Secret");
    expect(preprocessed).not.toContain("hidden");
    expect(preprocessed).not.toContain("https://example.com");
    expect(preprocessed).toContain("Obsidian");
    expect(preprocessed).toContain("表示");
  });

  it("distinguishes an unknown standalone vocabulary from a known empty one", () => {
    const ungated = tokenizeWithOptions("日本語");
    const gated = tokenizeWithOptions("日本語", {
      corpus: { standalone: new Set() },
    });

    expect(ungated.has("日本")).toBe(true);
    expect(ungated.has("本語")).toBe(true);
    expect(gated.has("日本語")).toBe(true);
    expect(gated.has("日本")).toBe(false);
    expect(gated.has("本語")).toBe(false);
  });

  it("extracts ascii words, lowercased", () => {
    const out = tokenize("Hello World Foo");
    expect(out.has("hello")).toBe(true);
    expect(out.has("world")).toBe(true);
    expect(out.has("foo")).toBe(true);
  });

  it("requires minimum length of 3 for ascii except uppercase acronyms", () => {
    const out = tokenize("ab abc abcd AI ML");
    expect(out.has("ab")).toBe(false);
    expect(out.has("abc")).toBe(true);
    expect(out.has("abcd")).toBe(true);
    expect(out.has("ai")).toBe(true);
    expect(out.has("ml")).toBe(true);
  });

  it("keeps longer ascii tokens whole and does not find uppercase pairs inside words", () => {
    const out = tokenize("AIX machineID ABCD");
    expect(out.has("aix")).toBe(true);
    expect(out.has("ai")).toBe(false);
    expect(out.has("machineid")).toBe(true);
    expect(out.has("id")).toBe(false);
    expect(out.has("abcd")).toBe(true);
  });

  it("still does not emit lowercase two-letter function words", () => {
    const out = tokenize("in of");
    expect(out.has("in")).toBe(false);
    expect(out.has("of")).toBe(false);
  });

  it("drops ascii stopwords", () => {
    const out = tokenize("the quick brown fox jumps over the lazy dog");
    expect(out.has("the")).toBe(false);
    expect(out.has("quick")).toBe(true);
  });

  it("gates the inflected surface forms of already-gated relational verbs", () => {
    // 含む / 関する / に関する are gated as functional. The segmenter emits
    // 含ん, 関し and に関し for their inflected forms, which leaked through and
    // carried the IDF of a df-26 topical word. Gating them closes that leak;
    // it is not a general rule about conjugation fragments.
    expect(tokenize("税を含んだ価格", true).has("含ん")).toBe(false);
    expect(tokenize("手数料を含んで計算", true).has("含ん")).toBe(false);
    expect(tokenize("本件に関し検討する", true).has("関し")).toBe(false);
    expect(tokenize("この件に関して報告する", true).has("に関し")).toBe(false);
    // The surrounding content words must survive.
    expect(tokenize("税を含んだ価格", true).has("価格")).toBe(true);
    expect(tokenize("本件に関し検討する", true).has("検討")).toBe(true);
  });

  it("keeps fragments that still carry the source verb's topical sense", () => {
    // 死ん / 置い / 見て / 変わら / 思わ are not independent words either, but
    // "not a word" is not "no topical signal" — a vault about death, storage or
    // observation can legitimately match on them. A stopword entry is global
    // and unrecoverable, so they stay out.
    expect(tokenize("猫が死んだ", true).has("死ん")).toBe(true);
    expect(tokenize("棚に置いた", true).has("置い")).toBe(true);
    expect(tokenize("映画を見て", true).has("見て")).toBe(true);
  });

  it("adds no source stopwords for the two-letter acronym path", () => {
    // These read as date/time format placeholders, but each also has a real
    // topical reading in some vault (SS: screenshot, DD: due diligence, OK: UI
    // copy). A stopword entry is global and unrecoverable, while the df >= 2 /
    // df <= 40% salience gates already suppress genuine format-string noise —
    // so the acronym path ships without widening this file.
    const out = tokenize("MM DD YY HH SS OK AA AB");
    for (const kept of ["mm", "dd", "yy", "hh", "ss", "ok", "aa", "ab"]) {
      expect(out.has(kept)).toBe(true);
    }
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

  it("emits katakana sub-words gated by the corpus standalone set", () => {
    // バッテリ stands alone elsewhere (in 膨張バッテリー); リチウム does not.
    const standalone = new Set(["バッテリ"]);
    const out = tokenize("リチウムバッテリー", false, standalone);
    expect(out.has("リチウムバッテリ")).toBe(true); // full run always kept
    expect(out.has("バッテリ")).toBe(true); // standalone sub-word -> kept
    expect(out.has("リチウム")).toBe(false); // not standalone -> dropped
    // so a note saying just 膨張バッテリー shares バッテリ with this one
    expect(tokenize("膨張バッテリー").has("バッテリ")).toBe(true);
  });

  it("does not emit katakana sub-words shorter than 3", () => {
    // ログ is a real word that stands alone, but extracting it from ブログ is
    // noise (blog != log), so 2-char sub-words are never emitted.
    const standalone = new Set(["ログ"]);
    const out = tokenize("ブログ", false, standalone);
    expect(out.has("ブログ")).toBe(true); // full run
    expect(out.has("ログ")).toBe(false); // 2-char sub-word -> never emitted
  });

  it("without a standalone set, every katakana sub-word >= 3 is emitted", () => {
    const out = tokenize("リチウムバッテリー");
    expect(out.has("リチウム")).toBe(true);
    expect(out.has("バッテリ")).toBe(true);
  });

  it("counts each normalized katakana sub-word once per parent-run occurrence", () => {
    const standalone = new Set(["サーバ"]);
    expect(tokenize("クラウドサーバー", false, standalone).get("サーバ")).toBe(1);
    expect(tokenize("クラウドサーバー クラウドサーバー", false, standalone).get("サーバ")).toBe(2);
  });

  it("harvests standalone-word units (kanji 2-grams, katakana words) via the 4th arg", () => {
    const s = new Set<string>();
    tokenize("機械 と 日本語 を 学習 と 膨張バッテリー", false, undefined, s);
    expect(s.has("機械")).toBe(true); // standalone 2-kanji run
    expect(s.has("学習")).toBe(true); // standalone 2-kanji run
    expect(s.has("日本")).toBe(false); // part of the 3-kanji run 日本語
    expect(s.has("日本語")).toBe(false); // length 3, not a 2-gram
    expect(s.has("バッテリ")).toBe(true); // standalone katakana word
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

  it("deduplicates repeated occurrences (as distinct map keys)", () => {
    const out = tokenize("repeat repeat repeat");
    expect(out.size).toBe(1);
    expect(out.has("repeat")).toBe(true);
  });

  it("counts in-body occurrences per token (TF)", () => {
    const out = tokenize("repeat repeat repeat once");
    expect(out.get("repeat")).toBe(3);
    expect(out.get("once")).toBe(1);
  });

  it("counts a 2-char kanji run once, not as full run plus its own 2-gram", () => {
    // A length-2 run IS its only 2-gram; without the guard the TF doubled,
    // biasing salience toward 2-char kanji words.
    expect(tokenize("関連").get("関連")).toBe(1);
    expect(tokenize("関連の話。また関連について。").get("関連")).toBe(2);
  });

  it("counts a repeated kanji bigram once per parent-run occurrence", () => {
    expect(tokenize("代々木代々木").get("代々")).toBe(1);
    expect(tokenize("代々木代々木 代々木代々木").get("代々")).toBe(2);
  });

  it("strips bare URLs without eating adjacent Japanese text", () => {
    // Japanese prose puts text right after a URL with no space — the URL must
    // go, the surrounding sentence must survive.
    const out = tokenize("詳細はhttps://example.com/wiki/秘密pathを参照。手順は明日");
    expect(out.has("example")).toBe(false);
    expect(out.has("wiki")).toBe(false);
    expect(out.has("詳細")).toBe(true);
    expect(out.has("手順")).toBe(true);
    expect(out.has("明日")).toBe(true);
  });

  it("still strips digit-leading tags (valid in Obsidian) after the digits-only fix", () => {
    // #2024レビュー is a valid tag — the tag regex requires "contains a
    // letter", NOT "starts with a letter", or レビュー would leak as a token.
    // A digits-only "#1" is an issue reference, not a tag, and is left alone.
    const out = tokenize("見た #2024レビュー と issue #1 の話");
    // (レビュー would surface as レビュ after prolonged-mark normalization)
    expect(out.has("レビュ")).toBe(false);
    expect(out.has("issue")).toBe(true);
  });

  it("segmenter mode drops mixed-script conjugation fragments and generic verbs", () => {
    const seg = tokenize("毎日ご飯を食べた。早く起きた。本を読んだ", true);
    expect(seg.has("食べ")).toBe(false);
    expect(seg.has("起き")).toBe(false);
    expect(seg.has("読ん")).toBe(false);
  });

  it("segmenter mode drops plan B-3 hiragana stopword additions", () => {
    const seg = tokenize("こちらの資料をちゃんと確認して。みんなで進めよう", true);
    expect(seg.has("こちら")).toBe(false);
    expect(seg.has("ちゃん")).toBe(false);
    expect(seg.has("みんな")).toBe(false);
  });

  it("segmenter mode drops plan B-3 mixed-script stopword additions", () => {
    const seg = tokenize("会議の内容に対する意見と、その後の対応について", true);
    expect(seg.has("に対する")).toBe(false);
    expect(seg.has("その後")).toBe(false);
  });

  it("segmenter mode keeps held-back real vocabulary despite public stopword lists", () => {
    // 違い/扱い are real PKM content (nominalized verb forms) and were
    // deliberately NOT added in plan B-3 — see the JA_MIXED_STOPWORDS comment.
    const seg = tokenize("AとBの違いを整理する。データの扱いを見直す", true);
    expect(seg.has("違い")).toBe(true);
    expect(seg.has("扱い")).toBe(true);
    // 半ば is held back too (progress-note vocabulary: 道半ば, 任期半ば), while
    // はじめ IS dropped for notation consistency with the already-listed 始め.
    const segHeld = tokenize("任期の半ばで退任した。はじめに結論を書く", true);
    expect(segHeld.has("半ば")).toBe(true);
    expect(segHeld.has("はじめ")).toBe(false);
    // existing nominalized vocabulary must keep surviving too.
    const seg2 = tokenize("読書からの学びを記録する。この問いに向き合う。設定の読み込み", true);
    expect(seg2.has("学び")).toBe(true);
    expect(seg2.has("問い")).toBe(true);
    expect(seg2.has("読み込み")).toBe(true);
  });

  it("segmenter mode keeps nominalized mixed-script nouns", () => {
    // 学び / 問い are real 2-char PKM vocabulary — a blanket length gate would
    // kill them, which is why the mixed branch uses a stopword set instead.
    const seg = tokenize("読書からの学びを記録する。この問いに向き合う", true);
    expect(seg.has("学び")).toBe(true);
    expect(seg.has("問い")).toBe(true);
    // longer okurigana compounds keep working
    const seg2 = tokenize("設定の読み込みと打ち合わせの記録", true);
    expect(seg2.has("読み込み")).toBe(true);
    expect(seg2.has("打ち合わせ")).toBe(true);
  });

  it("bumps a derived sub-unit's count once per occurrence of its parent run", () => {
    // 機械学習 appears twice -> 機械/学習 (its 2-grams) are each bumped twice too.
    const out = tokenize("機械学習の話。もう一度、機械学習について。");
    expect(out.get("機械学習")).toBe(2);
    expect(out.get("機械")).toBe(2);
    expect(out.get("学習")).toBe(2);
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

  describe("KANJI_STOPWORDS gate (B-4)", () => {
    it("drops 自分 and 以下 with the segmenter off (the default)", () => {
      const out = tokenize("自分の意見は以下の通り");
      expect(out.has("自分")).toBe(false);
      expect(out.has("以下")).toBe(false);
    });

    it("drops 自分 and 以下 with the segmenter on too", () => {
      // The gate lives on the always-on kanji-run regex path, not the
      // segmenter path, so toggling bodyTokenSegmenterEnabled must not
      // change this outcome.
      const out = tokenize("自分の意見は以下の通り", true);
      expect(out.has("自分")).toBe(false);
      expect(out.has("以下")).toBe(false);
    });

    it("keeps 時間/場合/方法 (deliberately out of scope)", () => {
      // These have both a functional use (formal-noun-like: 〜する場合,
      // 〜する方法, 〜の時間) and a genuine content-word use (時間管理,
      // 場合分け, 方法論) — unlike KANJI_STOPWORDS's closed-class entries,
      // so they are intentionally not gated.
      const out = tokenize("会議の時間を確認する。この場合の対処方法");
      expect(out.has("時間")).toBe(true);
      expect(out.has("場合")).toBe(true);
      expect(out.has("方法")).toBe(true);
    });

    it("keeps 彼女 (excluded from KANJI_STOPWORDS on purpose)", () => {
      // 彼女 has a lexicalized noun sense ("girlfriend") beyond the pronoun
      // sense, unlike 彼ら/自分/我々/私達/貴方, so it is not gated.
      const out = tokenize("彼女と話した");
      expect(out.has("彼女")).toBe(true);
    });

    it("keeps the full run when a longer run merely contains a gated unit", () => {
      // The gate is exact-match only: 自分自身 is not itself a KANJI_STOPWORDS
      // entry, so the full run survives even though its 自分 2-gram is gated.
      const out = tokenize("自分自身を見つめ直す");
      expect(out.has("自分自身")).toBe(true);
      expect(out.has("自分")).toBe(false);
    });

    it("keeps representative examples of the 16 audit-purged JA_MIXED_STOPWORDS entries", () => {
      // Plan B-3b (tmp/b3b-audit.md) removed these from JA_MIXED_STOPWORDS
      // because their ren'yōkei form lexicalizes into real, potentially
      // topical vocabulary in some domain (受け=武道, 読み=将棋・囲碁,
      // 買い=金融). They must now survive the segmenter's mixed-segment path.
      const seg = tokenize("柔道の受けを覚える。将棋の読みが深い。株の買いを検討する", true);
      expect(seg.has("受け")).toBe(true);
      expect(seg.has("読み")).toBe(true);
      expect(seg.has("買い")).toBe(true);
    });
  });
});
