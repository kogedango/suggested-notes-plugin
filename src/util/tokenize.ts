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
  // Plan B-3 (2026-07-05): cross-referenced against the union of the
  // stopwords-iso/stopwords-ja and SlothLib public Japanese stopword lists,
  // then filtered to this vault's measured df (tmp/b3-analysis.md §5/§6) to
  // exclude anything carrying real PKM-topical content. Demonstrative
  // pronouns, personal pronouns, generic quantifiers/conjunctions, and
  // discourse fillers.
  "あそこ", "あたり", "あちら", "あっち", "あなた", "いくつ", "おまえ",
  "および", "かつて", "こちら", "こっち", "ごっちゃ", "ぜんぶ", "そちら",
  "そっち", "ちゃん", "とおり", "どこか", "どちら", "どっか", "どっち",
  "とともに", "において", "はじめ", "ひとつ", "みたい", "みなさん", "みんな",
  "ものの", "わたし",
]);

// Kanji+hiragana mixed segments the segmenter emits that carry no topical
// signal, measured over the owner's vault (1.3k notes, 2026-07, df 19-121 —
// far under the 40%-of-vault df cap, so the cap never catches them). Two
// shapes, both the mixed-script analogue of the hiragana entries above:
// conjugation fragments (調べ→調べた, 読ん→読んだ, 気づい→気づいた) and generic
// dictionary-form verbs/adjectives (使う, 多い, 新しい). Nominalized ren'yōkei
// nouns are deliberately NOT listed (学び, 動き, 考え, 楽しみ, 答え, 違い,
// 見通し…): those are real PKM vocabulary — except 読み/書き, which in a
// note-taking vault are as generic as the verbs they come from.
const JA_MIXED_STOPWORDS = new Set([
  "感じ", "調べ", "読ん", "書い", "使う", "向け", "同じ", "少し", "新しい",
  "大きな", "思う", "知ら", "学ん", "使わ", "初めて", "受け", "多く", "高い",
  "書く", "覚え", "読み", "多い", "聞い", "入れ", "借り", "好き", "読め",
  "続き", "進め", "特に", "改め", "読む", "見つけ", "書か", "始め", "使い",
  "に対し", "使える", "見る", "増え", "続い", "使え", "求め", "投げ", "出し",
  "食べ", "言う", "通り", "作る", "関する", "一つ", "変え", "行く", "嬉しい",
  "難しい", "考える", "含む", "決め", "行わ", "明らか", "示す", "済み",
  "変わる", "出る", "大きく", "強い", "与え", "詳しく", "進ん", "強く",
  "入り", "続く", "続け", "与える", "入れる", "忘れ", "感じる", "言わ",
  "持つ", "良い", "行う", "報じ", "気づい", "付き", "入る", "求める",
  "新しく", "残し", "見え", "近く", "当たり", "示し", "彼ら", "合わせ",
  "迎え", "起き", "探し", "書き", "周り", "分かり", "確か", "集め", "新た",
  "付け", "応じ", "加え", "買い",
  // Plan B-3 (2026-07-05): same public-list cross-reference as JA_STOPWORDS
  // above, filtered to this vault's measured df (tmp/b3-analysis.md §5/§6).
  // Grammatical postposition constructions (kanji+hiragana cousins of the
  // already-listed による/により/によって/における) and temporal/directional
  // connectives — not nominalized content nouns, so consistent with the
  // 違い/学び/等 exclusion above.
  "その後", "と共に", "に関する", "に対して", "に対する", "幾つ", "及び",
  "向こう",
]);

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

// `segment` (experimental, corresponds to the bodyTokenSegmenterEnabled
// setting) additionally runs TinySegmenter to pick up words the script-run
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
function addKanjiRun(
  out: Map<string, number>,
  run: string,
  standalone?: Set<string>,
  collectInto?: Set<string>,
): void {
  bump(out, run);
  // A length-2 kanji run standing on its own is our standalone-word proxy.
  if (collectInto && run.length === 2) collectInto.add(run);
  for (let i = 0; i + 2 <= run.length; i++) {
    const bg = run.slice(i, i + 2);
    // A 2-char run is its own only 2-gram — already bumped as the full run
    // above (mirrors the katakana path's `sub === full` guard).
    if (bg === run) continue;
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
