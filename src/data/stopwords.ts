// Built-in stopword lists for the tokenizer (src/util/tokenize.ts).
//
// RULE: every entry in this file must belong to one of the vault-independent
// rationale categories below — closed-class grammar/particles, JLPT basic
// vocabulary, conjugation fragments, closed-class pronouns, URL fragments, or
// honorific suffixes. High-frequency words that are specific to a particular
// vault or domain are NOT this file's problem — they belong in the
// user-facing `excludedBodyTokens` setting.
//
// The rule has teeth because the two directions are not symmetric. An entry
// here is global and unrecoverable: no user setting can add a word back once
// this file removes it. Leaving a noisy word out is recoverable — the df >= 2
// and df <= 40%-of-vault salience gates and IDF already suppress anything
// genuinely high-frequency, and `excludedBodyTokens` handles the rest per
// vault. So when a word has any plausible topical reading in SOME vault, it
// stays out of this file even if it is noise in the vault at hand.
//
// KNOWN TENSION: the G2 group below predates that rule and does not satisfy
// it. 高い, 強い, 感じ, 調べ, 起き are open-class words with obvious topical
// readings (price, intensity, impression, investigation). They were kept on a
// different basis — that the basic-verb reading dominates in general PKM prose
// — which is a judgement about the average vault, exactly what the rule above
// rejects. The rule governs ADDITIONS from now on; whether to shrink G2 to
// match is an open decision, not an oversight. Removing entries is the
// recoverable direction, so it is safe to defer.
//
// 含む/含ん belong to that deferred audit as a pair. 含ん was added to match
// 含む, which is correct as consistency, but consistency inherits whatever
// justification the parent had — and 含む rests on the same average-vault
// judgement the rule rejects. Reverting 含ん alone would only re-open the leak,
// so either both stay or both go, and "both go" is a decision about G2, not
// about 含ん.
// Do not add a word whose ren'yōkei
// (連用形) form can nominalize into real, potentially topical vocabulary
// (学び, 違い, 扱い, 買い, and the like) — see the "audit-confirmed removals"
// note on JA_MIXED_STOPWORDS below for the 16 entries that were purged from
// this file for exactly that reason (Plan B-3b, tmp/b3b-audit.md).
//
// Category legend (from tmp/b3b-audit.md, Plan B-3b):
//   G1 活用断片          — inflected fragments that are incomplete as standalone words
//   G2 基礎語彙          — JLPT N5-N4 basic verbs/adjectives (and their conjugations),
//                          plus a small number of N3 generic verbs whose noun-reading
//                          use (Aを含む/Aを示す) is functional rather than topical
//   G3 指示・関係・程度語 — demonstratives, relational/degree adverbs, formal-noun uses
//   G4 文法構文          — closed-class grammar: particle-equivalent phrases, conjunctions,
//                          auxiliary verb inflections
//   G5 閉クラス代名詞     — closed-class personal/demonstrative pronouns
//   URL断片              — URL scheme/domain/TLD fragments (markup noise, not vocabulary)
//   敬称接尾辞           — honorific/diminutive name suffixes (closed sociolinguistic class)

// ============================================================================
// ASCII_STOPWORDS — English stopwords, matched case-insensitively.
// Cross-referenced against the NLTK standard English stopword list (179
// words, a widely used public baseline) in tmp/b3b-audit.md.
// ============================================================================

// G4 文法構文: articles, prepositions, conjunctions, modal/auxiliary verbs —
// closed-class function words, all in the NLTK standard list.
const ASCII_G4_GRAMMAR = [
  "the", "and", "for", "with", "from", "have", "are", "was", "but", "not",
  "can", "will", "into", "out", "about",
];

// G5 閉クラス代名詞: personal/demonstrative pronouns (NLTK standard list).
const ASCII_G5_PRONOUNS = [
  "this", "that", "you", "your", "they", "their", "them", "these", "those",
];

// G3 指示・関係・程度語: quantifying determiners (NLTK standard list).
const ASCII_G3_QUANTIFIERS = ["all", "any"];

// URL断片: URL scheme/domain/TLD fragments left behind by markdown/prose
// stripping, not natural-language vocabulary in any domain.
const ASCII_URL_FRAGMENTS = ["http", "https", "www", "com", "org", "net"];

// Considered and rejected: MM/DD/YY/HH/SS and OK, which the uppercase
// two-letter token path admits. Each reads as a date/time format placeholder,
// but each also has a real topical reading somewhere — SS (screenshot,
// stainless, 二次創作), DD (due diligence, the dd command), OK (UI copy). By
// the asymmetry above they stay out: a format string like HH:MM:SS produces
// tokens with vault-wide df, which the salience gates already suppress.
// Borderline, kept (tmp/b3b-audit.md): "use"/"using"/"used" are not in the
// NLTK canonical list, and "used car"/"use case" could conceivably topicalize
// in a specific vault. But they are the direct English counterpart of the JA
// G2 basic verb 使う (kept below), and are not among the 16 audit-confirmed
// removals, so they stay for scoring consistency with 使う.
const ASCII_BORDERLINE_KEPT = ["use", "using", "used"];

export const ASCII_STOPWORDS: Set<string> = new Set([
  ...ASCII_G4_GRAMMAR,
  ...ASCII_G5_PRONOUNS,
  ...ASCII_G3_QUANTIFIERS,
  ...ASCII_URL_FRAGMENTS,
  ...ASCII_BORDERLINE_KEPT,
]);

// ============================================================================
// JA_STOPWORDS — hiragana-only segments the segmenter emits that carry no
// topical signal (used only when bodyTokenSegmenterEnabled is on). Entries
// shorter than 3 chars are pointless (addSegmented's length gate drops them).
// ============================================================================

// G1 活用断片: fragments left over from a clipped conjugation or a
// segmenter mis-split — none is a complete word on its own.
const JA_G1_FRAGMENTS = [
  "たけど", "わから", "なけれ", "ださい", "といけ", "でしょ",
];

// G2 基礎語彙: N5 dictionary/conjugated forms of する/できる/ある/なる/言う/行く.
const JA_G2_BASIC_VOCAB = [
  "します", "しよう", "できる", "できた", "なかった", "なった", "なって",
  "あった", "あって", "いった",
];

// G3 指示・関係・程度語: demonstratives (これら/それら/あそこ/こちら/...),
// degree/manner adverbs (とても/かなり/ちょっと/...), and formal-noun uses
// (ところ/はじめ/ひとつ/とおり, the hiragana spelling variants of already-listed
// kanji forms 始め/一つ/通り).
const JA_G3_DEICTIC_DEGREE = [
  "ところ", "ように", "ような", "これら", "それら",
  "ばかり", "くらい", "ぐらい", "ちょっと", "やっぱり", "やはり",
  "とても", "かなり", "あまり", "たくさん", "それぞれ", "ほとんど",
  "いろいろ", "さまざま", "もちろん", "すべて", "ずっと", "もっと",
  "きっと", "ちゃんと", "しっかり",
  "あそこ", "あたり", "あちら", "あっち", "いくつ", "かつて",
  "こちら", "こっち", "ごっちゃ", "ぜんぶ", "そちら", "そっち",
  "とおり", "どこか", "どちら", "どっか", "どっち",
  "はじめ", "ひとつ",
];

// G4 文法構文: particle-equivalent phrases (について/として/による/における/...),
// conjunctions (そして/しかし/だから/および/...), and auxiliary-verb inflections
// (ください/ました/ません/でした/られる/やすい/らしい/...).
const JA_G4_GRAMMAR = [
  "について", "として", "という", "といった", "ながら", "ください",
  "ました", "ません", "しまった", "しまう", "そして", "しかし", "だから",
  "なので", "けれど", "それで", "それでも", "でした", "でしょう", "ですが",
  "だけど",
  "による", "により", "によって", "における", "おける", "られる", "くれる",
  "やすい", "やすく", "らしい", "ただし", "さらに",
  "および", "とともに", "において", "みたい", "ものの",
];

// G5 閉クラス代名詞: personal pronouns.
const JA_G5_PRONOUNS = ["あなた", "おまえ", "みなさん", "みんな", "わたし"];

// 敬称接尾辞: honorific/diminutive name suffix — closed sociolinguistic class
// (same class as さん/くん/様), not a content word in any domain.
const JA_HONORIFIC_SUFFIX = ["ちゃん"];

export const JA_STOPWORDS: Set<string> = new Set([
  ...JA_G1_FRAGMENTS,
  ...JA_G2_BASIC_VOCAB,
  ...JA_G3_DEICTIC_DEGREE,
  ...JA_G4_GRAMMAR,
  ...JA_G5_PRONOUNS,
  ...JA_HONORIFIC_SUFFIX,
]);

// ============================================================================
// JA_MIXED_STOPWORDS — kanji+hiragana mixed segments the segmenter emits that
// carry no topical signal (used only when bodyTokenSegmenterEnabled is on).
// A length gate doesn't work here: real nominalized 2-char words exist (学び,
// 問い — deliberately NOT listed, see below) alongside 2-4 char fragments that
// are pure noise, so an explicit stopword set is required.
//
// Nominalized ren'yōkei (連用形) nouns are deliberately NOT listed (学び, 動き,
// 考え, 楽しみ, 答え, 違い, 見通し, 扱い…): those are real PKM vocabulary.
//
// Audit-confirmed removals (Plan B-3b, tmp/b3b-audit.md): 16 entries were
// purged from an earlier version of this list because their ren'yōkei form
// has lexicalized into independent, potentially-topical vocabulary in a
// specific domain — the same pattern as the protected 学び/違い/扱い above,
// just measured to be common enough (or plausible enough) elsewhere to be a
// real risk: 受け (武道: 技を受ける側), 読み (将棋・囲碁: 先読み/形勢判断), 続き
// (物語の続き), 使い (魔法使い/お使い), 投げ (柔道: 投げ技), 出し (料理: 出汁),
// 入り (大入り/サ活), 報じ (報道語彙), 付き (条件付き), 見え (歌舞伎: 見得),
// 付け (味付け/片付け), 買い (金融: 買い注文), 迎え (お迎え), 当たり (くじの当選),
// 集め (切手集め), 探し (家探し/職探し). Do not re-add them here — if a vault
// needs them stopped, use `excludedBodyTokens`.
// ============================================================================

// G1 活用断片: conjugation fragments (音便/未然形/連用形の中止用法) with no
// independent-noun sense — the mixed-script cousins of JA_G1_FRAGMENTS above.
const JA_MIXED_G1_FRAGMENTS = [
  "読ん", "書い", "知ら", "学ん", "使わ", "聞い", "入れ", "読め", "進め",
  "改め", "見つけ", "書か", "増え", "続い", "使え", "変え", "決め", "行わ",
  "与え", "進ん", "続け", "忘れ", "言わ", "気づい", "残し", "示し",
];

// G2 基礎語彙: N5-N4 dictionary/conjugated forms of basic verbs and
// adjectives (使う/思う/見る/食べる/大きい/難しい/...). Also includes 含む/示す —
// N3-level, but "Aを含む"/"Aを示す" are functional enumerate/relate patterns
// that stay non-topical regardless of domain (tmp/b3b-audit.md BORDERLINE,
// kept — the audit's N3-generic-verb carve-out for this category).
const JA_MIXED_G2_BASIC_VOCAB = [
  "使う", "新しい", "大きな", "思う", "多く", "高い", "書く", "多い", "好き",
  "読む", "使える", "見る", "食べ", "言う", "作る", "行く", "嬉しい",
  "難しい", "考える", "変わる", "出る", "大きく", "強い", "強く", "続く",
  "与える", "入れる", "感じる", "持つ", "良い", "入る", "求める", "新しく",
  "書き", "分かり",
  // Borderline, kept (see comment above): N3 generic relational verbs.
  // 含ん is the onbin stem the segmenter emits for 含んだ/含んで. It is not a
  // leniency about fragments in general — it closes a leak in the decision
  // already made about 含む, which this file gates as functional. 含ん has no
  // independent noun sense in any domain, so the unrecoverability rule in the
  // header does not protect it.
  "含む", "示す", "含ん",
  // Borderline, kept (tmp/b3b-audit.md): ren'yōkei of N5/N4 basic verbs
  // (感じる/調べる/覚える/借りる/求める/合わせる/起きる). Each has a dictionary
  // independent-noun sense too (感じ=impression, 調べ=investigation, 起き=waking),
  // but — unlike the 16 audit-confirmed removals above — the audit judged the
  // basic-verb reading to still dominate in general PKM prose (measured vault
  // df 1.6-9.6%, without a clearly dominant domain-specific sense). Revisit
  // via `excludedBodyTokens` if a specific vault disagrees.
  "感じ", "調べ", "覚え", "借り", "求め", "合わせ", "起き",
];

// G3 指示・関係・程度語: relational/degree words and formal-noun uses
// (同じ/少し/特に/近く/確か/...) plus kanji spelling variants of hiragana G3
// entries above (始め/一つ/通り ↔ はじめ/ひとつ/とおり).
const JA_MIXED_G3_DEICTIC_DEGREE = [
  "同じ", "少し", "初めて", "特に", "始め", "通り", "一つ", "明らか",
  "詳しく", "近く", "周り", "確か", "新た", "幾つ", "向こう",
];

// G4 文法構文: particle-equivalent phrases (に対し/に関する/による-family) and
// support-verb / suffix constructions (関する/行う/済み/向け/応じ/加え/その後/と共に).
// 関し / に関し are the ren'yōkei surface forms the segmenter returns for
// 〜に関して / 〜に関し — the same relational construction 関する and に関する
// are already gated as. Both surface forms occur (本件に関し検討 yields 関し,
// この件に関して yields に関し), so gating only one leaves the other indexed.
const JA_MIXED_G4_GRAMMAR = [
  "向け", "に対し", "関する", "済み", "行う", "応じ", "加え",
  "その後", "と共に", "に関する", "に対して", "に対する", "及び",
  "関し", "に関し",
];

// G5 閉クラス代名詞: personal pronoun.
const JA_MIXED_G5_PRONOUNS = ["彼ら"];

export const JA_MIXED_STOPWORDS: Set<string> = new Set([
  ...JA_MIXED_G1_FRAGMENTS,
  ...JA_MIXED_G2_BASIC_VOCAB,
  ...JA_MIXED_G3_DEICTIC_DEGREE,
  ...JA_MIXED_G4_GRAMMAR,
  ...JA_MIXED_G5_PRONOUNS,
]);

// ============================================================================
// KANJI_STOPWORDS — closed-class gate on the plain kanji-run path
// (addKanjiRun in tokenize.ts). Unlike the three sets above, this one applies
// unconditionally — even with bodyTokenSegmenterEnabled off — because the
// kanji-run regex path always runs. This is the only JA vocabulary gate that
// has any effect when the segmenter is off.
//
// Kept deliberately tiny and exact-match-only (no length gate, no df
// threshold): both sub-groups are closed classes with no plausible
// topical/domain reading.
// ============================================================================

// 人称代名詞: personal pronouns. 彼女 is deliberately NOT included — it has a
// lexicalized noun sense ("girlfriend") in addition to the pronoun sense,
// unlike 彼ら/自分/我々/私達/貴方/貴方方 which have no comparable content-word
// reading.
const KANJI_PERSONAL_PRONOUNS = ["自分", "我々", "私達", "貴方", "貴方方"];

// 「以」系複合語: relative-position/degree compounds built on 以 (以下/以上/...).
// Purely relational (bounds a range relative to some other quantity) in every
// domain — never itself the topic.
const KANJI_ITHRESHOLD_COMPOUNDS = [
  "以下", "以上", "以内", "以外", "以前", "以後", "以降", "未満",
];

export const KANJI_STOPWORDS: Set<string> = new Set([
  ...KANJI_PERSONAL_PRONOUNS,
  ...KANJI_ITHRESHOLD_COMPOUNDS,
]);
