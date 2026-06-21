import TinySegmenter from "tiny-segmenter";

const TOKEN_RE = /[A-Za-z][A-Za-z0-9_\-]{2,}|[ァ-ヶー]{2,}|[一-龥々]{2,}/gu;

const ASCII_STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "this", "that", "have", "are", "was",
  "you", "your", "but", "not", "all", "any", "use", "using", "used", "can",
  "will", "into", "out", "about", "they", "their", "them", "these", "those",
  "http", "https", "www", "com", "org", "net",
]);

// Hiragana-only segments the segmenter emits that carry no topical signal.
// Entries shorter than 3 chars are pointless (the length gate drops them).
// The df cap (rankSalient) is meant to catch the rest, but it is tuned for
// stop-word-*like* terms (df > 40% of the vault); high-frequency grammatical
// patterns and conjugation fragments the segmenter produces sit well under
// that (measured df 200-650 on a 3.6k-note vault) and leak through, so the
// worst offenders are enumerated here. Conjugation *fragments* ending in the
// sokuon っ are handled separately in addSegmented (っ never ends a real word).
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
  // High-df grammatical patterns / auxiliaries that slip past the df cap.
  "による", "により", "によって", "における", "おける", "られる", "くれる",
  "やすい", "やすく", "らしい", "ただし", "さらに", "たけど", "わから",
  "なけれ", "ださい", "といけ", "でしょ",
]);

// NFKC folds full-width ASCII, half-width katakana, and decomposed kana into
// their canonical forms so "Ｏbsidian"/"ﾉｰﾄ" tokenize the same as the plain
// forms, then markdown/frontmatter/code/links are stripped so only prose text
// reaches the matcher. Shared by tokenize() and collectStandaloneKanji() so the
// standalone set is built over exactly the text tokenize() sees.
function strip(body: string): string {
  return body
    .normalize("NFKC")
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    // Embeds before plain wikilinks, or the leading "!" would survive.
    .replace(/!\[\[[^\]]*\]\]/g, " ")
    .replace(/\[\[[^\]]*\]\]/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, " $1 ")
    .replace(/(^|[\s(])#[\p{L}\p{N}_\-/]+/gu, " ");
}

// `segment` (experimental, corresponds to the bodyTokenSegmenterEnabled
// setting) additionally runs TinySegmenter to pick up words the script-run
// regex below cannot see: okurigana-mixed words (打ち合わせ, 振り返り) and
// hiragana-only words (ひらめき). Corpus and query must be tokenized with the
// same flag — toggling the setting triggers a corpus rebuild.
//
// `standaloneBigrams` is the corpus's set of kanji 2-grams that appear as a
// word on their own somewhere in the vault (see collectStandaloneKanji). When
// provided, a kanji run's interior 2-grams are emitted only if they are in it,
// which drops morpheme-straddling artifacts (本語 from 日本語, 員何 from 全員何も)
// while keeping real sub-words (機械/学習 from 機械学習). When omitted (no corpus
// yet) every 2-gram is emitted, the pre-gate behaviour.
export function tokenize(
  body: string,
  segment = false,
  standaloneBigrams?: Set<string>,
): Set<string> {
  const stripped = strip(body);

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
      addKanjiRun(out, tok, standaloneBigrams);
    }
  }
  if (segment) addSegmented(out, stripped);
  return out;
}

// Collect the kanji 2-grams that occur as a *standalone* run (a kanji run of
// exactly two characters) — our dictionary-free proxy for "this 2-gram is a
// real word". Only these are trusted as interior bigrams of longer runs; a
// 2-gram that never stands on its own (本語, 員何, 械学) is a morpheme-straddling
// artifact. Built corpus-wide and frozen per rebuild, exactly like df.
export function collectStandaloneKanji(body: string, into: Set<string>): void {
  for (const m of strip(body).matchAll(TOKEN_RE)) {
    const tok = m[0];
    if (tok.length === 2 && /^[一-龥々]+$/.test(tok)) into.add(tok);
  }
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
// does match) plus its 2-grams, so 機械学習 still shares 機械 / 学習 with notes
// that use the parts.
//
// The catch: ~half of a compound's overlapping 2-grams straddle the internal
// morpheme boundary (本語 from 日本語, 員何 from 全員何も, 械学 from 機械学習) and
// are pure noise — they only ever match the same compound, which the full run
// already matches, yet they burn salient slots and add fractional score. So
// when the corpus's standalone-2-gram set is known, interior 2-grams are kept
// only if they appear as a word on their own elsewhere (機械/学習 do; 械学/本語
// don't). The full run is always kept. Without the set (no corpus yet) every
// 2-gram is emitted.
function addKanjiRun(
  out: Set<string>,
  run: string,
  standaloneBigrams?: Set<string>,
): void {
  out.add(run);
  for (let i = 0; i + 2 <= run.length; i++) {
    const bg = run.slice(i, i + 2);
    if (!standaloneBigrams || standaloneBigrams.has(bg)) out.add(bg);
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
    // A token ending in the sokuon っ is always a clipped conjugation (使っ →
    // 使って, なかっ → なかった): っ never ends a real word, and these fragments
    // are high-df noise (~10% of the segmenter's df mass). Drop them outright.
    if (seg.endsWith("っ")) continue;
    if (hasKanji && hasHira && seg.length >= 2) {
      out.add(seg);
    } else if (hasHira && !hasKanji && /^[ぁ-んー]+$/.test(seg)) {
      // Hiragana-only words need a higher bar: most short ones are function
      // words, so require length >= 3 and not a known filler.
      if (seg.length >= 3 && !JA_STOPWORDS.has(seg)) out.add(seg);
    }
  }
}
