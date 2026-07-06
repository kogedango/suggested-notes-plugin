import TinySegmenter from "tiny-segmenter";
import {
  ASCII_STOPWORDS,
  JA_MIXED_STOPWORDS,
  JA_STOPWORDS,
  KANJI_STOPWORDS,
} from "../data/stopwords";

const TOKEN_RE = /[A-Za-z][A-Za-z0-9_\-]{2,}|[ァ-ヶー]{2,}|[一-龥々]{2,}/gu;

// ASCII_STOPWORDS / JA_STOPWORDS / JA_MIXED_STOPWORDS / KANJI_STOPWORDS are
// defined in src/data/stopwords.ts, organized by vault-independent rationale
// category (closed-class grammar, JLPT basic vocabulary, conjugation
// fragments, pronouns, URL fragments, honorific suffixes) — see that file's
// header comment for the categorization rule and the audit trail
// (tmp/b3b-audit.md, Plan B-3b). Vault-specific high-frequency words belong
// in the user-facing `excludedBodyTokens` setting, not in those sets.

// Interior katakana sub-words shorter than this are dropped: 2-char katakana
// sub-strings of a longer run are dominated by cross-morpheme noise (ブログ→ログ,
// コンパス→パス, リバース→バー) and the real 2-char words are already captured when
// they stand alone (the full run is always emitted regardless of this gate).
const KATAKANA_SUBWORD_MIN = 3;

// NFKC folds full-width ASCII, half-width katakana, and decomposed kana into
// their canonical forms so "Ｏbsidian"/"ﾉｰﾄ" tokenize the same as the plain
// forms, then markdown/frontmatter/code/links are stripped so only prose text
// reaches the matcher.
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
    // Bare URLs in prose. Must run after the markdown-link rule (or it would
    // eat the ")" out of "[text](url)"), and must stop at non-ASCII: Japanese
    // prose puts text right after a URL with no space (詳細はhttps://…を参照),
    // so \S+ would swallow the rest of the sentence.
    .replace(/https?:\/\/[!-~]+/g, " ")
    // Obsidian tags may START with digits (#2024振り返り) but can't be digits
    // only, so require at least one letter/underscore somewhere — a bare "#1"
    // is an issue reference, not a tag.
    .replace(/(^|[\s(])#(?=[\p{N}\-/]*[\p{L}_])[\p{L}\p{N}_\-/]+/gu, " ");
}

// `segment` (corresponds to the bodyTokenSegmenterEnabled setting, ON by
// default) additionally runs TinySegmenter to pick up words the script-run
// regex below cannot see: okurigana-mixed words (打ち合わせ, 振り返り) and
// hiragana-only words (ひらめき). Corpus and query must be tokenized with the
// same flag — toggling the setting triggers a corpus rebuild.
//
// `standalone` is the corpus's set of standalone-word units: kanji 2-grams and
// katakana words that appear on their own somewhere in the vault. When provided
// it gates interior sub-units of longer runs — a kanji run's 2-grams and a
// katakana run's sub-words are emitted only if they occur standalone elsewhere,
// dropping morpheme-straddling artifacts (本語 from 日本語, リチウム+バッテリー only
// matching the same compound) while keeping real sub-words (機械/学習 from 機械学習,
// バッテリ from リチウムバッテリー). The full run is always kept. When omitted (no
// corpus yet) every sub-unit is emitted, the pre-gate behaviour.
//
// `collectStandaloneInto`, when provided, harvests those standalone-word units
// from the same scan (a length-2 kanji run, a whole katakana word). This folds
// what used to be a separate corpus pass into tokenize's single matchAll, so a
// rebuild reads and scans each note once. Frozen per rebuild, exactly like df.
//
// Returns a token -> in-body occurrence count map (not a Set): salience
// ranking weights by log(1+TF) so a note's genuinely recurring vocabulary
// beats a rare word mentioned once (design-review-2026-07-02 #5). A derived
// sub-unit (a kanji 2-gram, a katakana sub-word) is bumped once per occurrence
// of its *parent run* — i.e. once per matchAll hit that produces it, same as
// the full run — not per corpus document; df/IDF (computed by the caller) stay
// presence-based (0/1 per note) and are unaffected by this change.
export function tokenize(
  body: string,
  segment = false,
  standalone?: Set<string>,
  collectStandaloneInto?: Set<string>,
): Map<string, number> {
  const stripped = strip(body);

  const out = new Map<string, number>();
  for (const m of stripped.matchAll(TOKEN_RE)) {
    const tok = m[0];
    const first = tok[0];
    if (/[A-Za-z]/.test(first)) {
      const low = tok.toLowerCase();
      if (!ASCII_STOPWORDS.has(low)) bump(out, low);
    } else if (/[ァ-ヶー]/.test(first)) {
      addKatakanaRun(out, tok, standalone, collectStandaloneInto);
    } else {
      addKanjiRun(out, tok, standalone, collectStandaloneInto);
    }
  }
  if (segment) addSegmented(out, stripped);
  return out;
}

function bump(out: Map<string, number>, key: string): void {
  out.set(key, (out.get(key) ?? 0) + 1);
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

// A continuous katakana run (リチウムバッテリー) glues loanwords together and would
// only ever match the exact same compound — the same recall problem addKanjiRun
// fixes for kanji. So emit the full run (rare → high IDF on exact match) plus its
// interior sub-words, gated by the corpus standalone set: a sub-word survives
// only if it occurs as a word on its own elsewhere (バッテリ from a note that
// writes 膨張バッテリー), which keeps real loanwords and drops noise. Sub-words are
// length-gated (KATAKANA_SUBWORD_MIN) since short fragments are mostly noise.
// Without the set (no corpus yet) every sub-word is emitted, the pre-gate path.
function addKatakanaRun(
  out: Map<string, number>,
  run: string,
  standalone?: Set<string>,
  collectInto?: Set<string>,
): void {
  const full = normalizeKatakana(run);
  if (!full) return;
  bump(out, full);
  // The full run stood alone here, so it is itself a standalone katakana word —
  // harvest it so longer runs elsewhere can split on it.
  if (collectInto) collectInto.add(full);

  for (let i = 0; i < run.length; i++) {
    for (let j = i + KATAKANA_SUBWORD_MIN; j <= run.length; j++) {
      const sub = normalizeKatakana(run.slice(i, j));
      if (!sub || sub.length < KATAKANA_SUBWORD_MIN || sub === full) continue;
      if (!standalone || standalone.has(sub)) bump(out, sub);
    }
  }
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
//
// KANJI_STOPWORDS (src/data/stopwords.ts) additionally gates both the full
// run and each 2-gram by exact match — a tiny closed-class list (personal
// pronouns, 以-series relative-position compounds) with no plausible
// domain-specific reading. This is the only JA vocabulary gate that has any
// effect when bodyTokenSegmenterEnabled is off, since this script-run path
// always runs regardless of that setting. The match is exact
// only, so a longer run built on a gated unit (自分自身) still survives whole.
function addKanjiRun(
  out: Map<string, number>,
  run: string,
  standalone?: Set<string>,
  collectInto?: Set<string>,
): void {
  if (!KANJI_STOPWORDS.has(run)) bump(out, run);
  // A length-2 kanji run standing on its own is our standalone-word proxy.
  if (collectInto && run.length === 2) collectInto.add(run);
  for (let i = 0; i + 2 <= run.length; i++) {
    const bg = run.slice(i, i + 2);
    // A 2-char run is its own only 2-gram — already bumped as the full run
    // above (mirrors the katakana path's `sub === full` guard).
    if (bg === run) continue;
    if (KANJI_STOPWORDS.has(bg)) continue;
    if (!standalone || standalone.has(bg)) bump(out, bg);
  }
}

let segmenter: TinySegmenter | null = null;

// Only the gap the regex pass cannot see is taken from the segmenter output:
// kanji+hiragana mixed words and hiragana-only words. ASCII / katakana /
// kanji-run segments are already covered (with their own normalization) above.
function addSegmented(out: Map<string, number>, stripped: string): void {
  if (!segmenter) segmenter = new TinySegmenter();
  for (const seg of segmenter.segment(stripped)) {
    const hasKanji = /[一-龥々]/.test(seg);
    const hasHira = /[ぁ-ん]/.test(seg);
    // A token ending in the sokuon っ is always a clipped conjugation (使っ →
    // 使って, なかっ → なかった): っ never ends a real word, and these fragments
    // are high-df noise (~10% of the segmenter's df mass). Drop them outright.
    if (seg.endsWith("っ")) continue;
    if (hasKanji && hasHira && seg.length >= 2) {
      // Mixed segments need their own stopword set: conjugation fragments and
      // generic verbs sit far under the corpus df cap, and JA_STOPWORDS is
      // hiragana-only. A length gate doesn't work here — real nominalized
      // 2-char words exist (学び, 問い) while 4-char fragments do too (早く起き).
      if (!JA_MIXED_STOPWORDS.has(seg)) bump(out, seg);
    } else if (hasHira && !hasKanji && /^[ぁ-んー]+$/.test(seg)) {
      // Hiragana-only words need a higher bar: most short ones are function
      // words, so require length >= 3 and not a known filler.
      if (seg.length >= 3 && !JA_STOPWORDS.has(seg)) bump(out, seg);
    }
  }
}
