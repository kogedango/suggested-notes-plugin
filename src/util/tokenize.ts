import TinySegmenter from "tiny-segmenter";

const TOKEN_RE = /[A-Za-z][A-Za-z0-9_\-]{2,}|[ァ-ヶー]{2,}|[一-龥々]{2,}/gu;

const ASCII_STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "this", "that", "have", "are", "was",
  "you", "your", "but", "not", "all", "any", "use", "using", "used", "can",
  "will", "into", "out", "about", "they", "their", "them", "these", "those",
  "http", "https", "www", "com", "org", "net",
]);

// Hiragana-only segments the segmenter emits that carry no topical signal.
// Entries shorter than 3 chars are pointless (the length gate drops them);
// the df cap (rankSalient) catches whatever common filler this list misses.
const JA_STOPWORDS = new Set([
  "について", "として", "という", "といった", "ところ", "ように", "ような",
  "これら", "それら", "ながら", "ください", "ました", "ません", "します",
  "しよう", "できる", "できた", "なかった", "なった", "なって", "あった",
  "あって", "いった", "しまった", "しまう", "そして", "しかし", "だから",
  "なので", "けれど", "それで", "それでも", "でした", "でしょう", "ですが",
  "だけど", "ばかり", "くらい", "ぐらい", "ちょっと", "やっぱり", "やはり",
  "とても", "かなり", "あまり", "たくさん", "それぞれ", "ほとんど",
  "いろいろ", "さまざま", "もちろん", "すべて", "ずっと", "もっと",
  "きっと", "ちゃんと", "しっかり",
]);

// `segment` (experimental, corresponds to the bodyTokenSegmenterEnabled
// setting) additionally runs TinySegmenter to pick up words the script-run
// regex below cannot see: okurigana-mixed words (打ち合わせ, 振り返り) and
// hiragana-only words (ひらめき). Corpus and query must be tokenized with the
// same flag — toggling the setting triggers a corpus rebuild.
export function tokenize(body: string, segment = false): Set<string> {
  // NFKC folds full-width ASCII, half-width katakana, and decomposed kana into
  // their canonical forms so "Ｏbsidian"/"ﾉｰﾄ" tokenize the same as the plain
  // forms. Without this, the same word in different widths produces distinct
  // tokens and never matches.
  const stripped = body
    .normalize("NFKC")
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    // Embeds before plain wikilinks, or the leading "!" would survive.
    .replace(/!\[\[[^\]]*\]\]/g, " ")
    .replace(/\[\[[^\]]*\]\]/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, " $1 ")
    .replace(/(^|[\s(])#[\p{L}\p{N}_\-/]+/gu, " ");

  const out = new Set<string>();
  for (const m of stripped.matchAll(TOKEN_RE)) {
    const tok = m[0];
    const first = tok[0];
    if (/[A-Za-z]/.test(first)) {
      const low = tok.toLowerCase();
      if (!ASCII_STOPWORDS.has(low)) out.add(low);
    } else if (/[ァ-ヶー]/.test(first)) {
      const k = normalizeKatakana(tok);
      if (k) out.add(k);
    } else {
      addKanjiRun(out, tok);
    }
  }
  if (segment) addSegmented(out, stripped);
  return out;
}

// Long-vowel spelling variants (サーバ/サーバー, ユーザ/ユーザー) should match,
// so trailing prolonged marks are stripped — unless that would leave a single
// kana (キー must not collapse to キ).
function normalizeKatakana(tok: string): string | null {
  const core = tok.replace(/^ー+/, "");
  const trimmed = core.replace(/ー+$/, "");
  if (trimmed.length >= 2) return trimmed;
  if (core.length >= 2) return core;
  return null; // ー-only runs or a lone kana are noise
}

// Greedy script-run matching glues kanji compounds together (機械学習基盤 is
// one run), which would only ever match the exact same compound. Standard CJK
// bigram indexing fixes the recall: emit the full run (rare → high IDF when it
// does match) plus every overlapping 2-gram, so 機械学習 still shares 機械 /
// 学習 with notes that use the parts. Junk grams like 械学 only repeat where
// the same compound does, so df/IDF filtering keeps them harmless.
function addKanjiRun(out: Set<string>, run: string): void {
  out.add(run);
  for (let i = 0; i + 2 <= run.length; i++) {
    out.add(run.slice(i, i + 2));
  }
}

let segmenter: TinySegmenter | null = null;

// Only the gap the regex pass cannot see is taken from the segmenter output:
// kanji+hiragana mixed words and hiragana-only words. ASCII / katakana /
// kanji-run segments are already covered (with their own normalization) above.
function addSegmented(out: Set<string>, stripped: string): void {
  if (!segmenter) segmenter = new TinySegmenter();
  for (const seg of segmenter.segment(stripped)) {
    const hasKanji = /[一-龥々]/.test(seg);
    const hasHira = /[ぁ-ん]/.test(seg);
    if (hasKanji && hasHira && seg.length >= 2) {
      out.add(seg);
    } else if (hasHira && !hasKanji && /^[ぁ-んー]+$/.test(seg)) {
      // Hiragana-only words need a higher bar: most short ones are function
      // words, so require length >= 3 and not a known filler.
      if (seg.length >= 3 && !JA_STOPWORDS.has(seg)) out.add(seg);
    }
  }
}
