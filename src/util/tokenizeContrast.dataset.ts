export type PositiveContrastCategory =
  | "okurigana variation"
  | "conjugation"
  | "kana-kanji variation";

export interface PositiveContrastGroup {
  readonly variants: readonly string[];
  readonly category: PositiveContrastCategory;
  readonly note: string;
}

export interface NegativeContrastPair {
  readonly variants: readonly [string, string];
  readonly note: string;
}

export interface SharedTokenBaseline {
  readonly segment: boolean;
  readonly variants: readonly [string, string];
  readonly tokens: readonly string[];
}

export const POSITIVE_CONTRAST_GROUPS: readonly PositiveContrastGroup[] = [
  {
    variants: ["引っ越し", "引越し", "引越"],
    category: "okurigana variation",
    note: "The same word with full, reduced, and omitted okurigana.",
  },
  {
    variants: ["打ち合わせ", "打合せ", "打合"],
    category: "okurigana variation",
    note: "The same compound with full, reduced, and omitted okurigana.",
  },
  {
    variants: ["申し込み", "申込み", "申込"],
    category: "okurigana variation",
    note: "The same nominalized verb with full, reduced, and omitted okurigana.",
  },
  {
    variants: ["問い合わせ", "問合せ"],
    category: "okurigana variation",
    note: "The same compound with full and reduced okurigana.",
  },
  {
    variants: ["振り返り", "振返り"],
    category: "okurigana variation",
    note: "The same nominalized compound with one internal okurigana omitted.",
  },
  {
    variants: ["取り組み", "取組み", "取組"],
    category: "okurigana variation",
    note: "The same nominalized compound with full, reduced, and omitted okurigana.",
  },
  {
    variants: ["育てる", "育てた", "育てて"],
    category: "conjugation",
    note: "Dictionary, past, and te-forms of the same verb.",
  },
  {
    variants: ["考える", "考えた"],
    category: "conjugation",
    note: "Dictionary and past forms; this failure comes from stopword asymmetry, not okurigana normalization.",
  },
  {
    variants: ["気づき", "気付き"],
    category: "kana-kanji variation",
    note: "The same nominalized verb with the medial element written in kana or kanji.",
  },
  {
    variants: ["子ども", "子供"],
    category: "kana-kanji variation",
    note: "The same word with a kana-kanji mixed spelling or an all-kanji spelling.",
  },
];

// 考える is removed by JA_MIXED_STOPWORDS while 考えた emits 考え. The same
// dictionary-form/conjugated-fragment asymmetry occurs for 含む -> 含ん and
// 関する -> 関し. Unlike 考え, 含ん and 関し are not independent words. This
// fixture records the distinction; deciding whether to change the stopword
// policy is outside the scope of this measurement.

export const NEGATIVE_CONTRAST_PAIRS: readonly NegativeContrastPair[] = [
  {
    variants: ["立ち方", "立方"],
    note: "Way of standing versus cube; a kanji-skeleton rule would erase the distinction.",
  },
  {
    variants: ["見せ方", "見方"],
    note: "Way of showing versus viewpoint; a kanji-skeleton rule would conflate different words.",
  },
  {
    variants: ["出し方", "出方"],
    note: "Way of putting something out versus manner of appearing; their lexical meanings differ.",
  },
  {
    variants: ["生き物", "生物"],
    note: "Living creature versus the lexicalized compound organism/biology; naive kana deletion is too broad.",
  },
  {
    variants: ["行き方", "行方"],
    note: "Way of going versus whereabouts; a kanji-skeleton rule would produce a false merge.",
  },
];

// Any positive pair not listed here is expected to share no token. Keeping the
// baseline in the dataset module lets the assertions stay data-driven as new
// contrast pairs are added.
export const POSITIVE_SHARED_TOKEN_BASELINE: readonly SharedTokenBaseline[] = [
  { segment: true, variants: ["引越し", "引越"], tokens: ["引越"] },
  { segment: true, variants: ["打合せ", "打合"], tokens: ["打合"] },
  { segment: true, variants: ["申込み", "申込"], tokens: ["申込"] },
  { segment: true, variants: ["取組み", "取組"], tokens: ["取組"] },
  { segment: true, variants: ["育てた", "育てて"], tokens: ["育て"] },
  { segment: false, variants: ["引越し", "引越"], tokens: ["引越"] },
  { segment: false, variants: ["打合せ", "打合"], tokens: ["打合"] },
  { segment: false, variants: ["申込み", "申込"], tokens: ["申込"] },
  { segment: false, variants: ["取組み", "取組"], tokens: ["取組"] },
];
