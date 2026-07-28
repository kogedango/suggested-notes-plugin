import type { IpadicFeatures, Tokenizer } from "kuromoji";
import { emitCompoundRun } from "./compounds";
import { locateSurface } from "./detailed";
import type {
  CanonicalToken,
  DetailedAnalysis,
  JapaneseAnalyzer,
  PositionedCompoundPart,
} from "./types";

const CONTENT_POS = new Set(["名詞", "動詞", "形容詞", "副詞"]);
const NON_CONTENT_NOUN_DETAILS = new Set(["代名詞", "非自立", "接尾", "数"]);
const JAPANESE_ITERATION_MARKS_ONLY =
  /^[々〻〱-〵ゝゞヽヾ]+$/u;

export class KuromojiJapaneseAnalyzer implements JapaneseAnalyzer {
  constructor(private tokenizer: Tokenizer<IpadicFeatures>) {}

  analyze(text: string): CanonicalToken[] {
    return this.analyzeDetailed(text).tokens;
  }

  analyzeDetailed(text: string): DetailedAnalysis {
    const out: CanonicalToken[] = [];
    const compoundParts: PositionedCompoundPart[] = [];
    let compoundRun: PositionedCompoundPart[] = [];
    let cursor = 0;
    for (const token of this.tokenizer.tokenize(text)) {
      const start = locateSurface(text, token.surface_form, cursor);
      const end = start + token.surface_form.length;
      cursor = end;
      const canonical = canonicalJapaneseToken(token);
      const compoundPart = japaneseCompoundPart(
        token,
        canonical,
        start,
        end,
      );
      if (compoundPart) {
        compoundRun.push(compoundPart);
        compoundParts.push(compoundPart);
      } else {
        emitCompoundRun(compoundRun, out);
        compoundRun = [];
      }
      if (canonical) out.push(canonical);
    }
    emitCompoundRun(compoundRun, out);
    return { tokens: out, compoundParts };
  }
}

function japaneseCompoundPart(
  token: IpadicFeatures,
  canonical: CanonicalToken | null,
  start: number,
  end: number,
): PositionedCompoundPart | null {
  if (token.pos === "接頭詞") {
    if (token.pos_detail_1 !== "名詞接続") return null;
    const key = normalizedJapaneseSurface(token.surface_form);
    return key
      ? { key, kind: "prefix", source: "ja", start, end }
      : null;
  }

  if (token.pos !== "名詞") return null;
  if (token.pos_detail_1 === "数") return null;
  if (token.pos_detail_1 === "接尾") {
    // IPADIC counters divide noun runs rather than joining compounds.
    if (token.pos_detail_2 === "助数詞") return null;
    const key = normalizedJapaneseSurface(token.surface_form);
    return key
      ? { key, kind: "suffix", source: "ja", start, end }
      : null;
  }
  if (!canonical || canonical.pos !== "名詞") return null;
  return {
    key: canonical.key,
    kind: "noun",
    source: "ja",
    start,
    end,
  };
}

function normalizedJapaneseSurface(surface: string): string | null {
  const key = surface.normalize("NFKC").trim();
  return key && /\p{L}/u.test(key) ? key : null;
}

export function canonicalJapaneseToken(
  token: IpadicFeatures,
): CanonicalToken | null {
  if (!CONTENT_POS.has(token.pos)) return null;
  if (
    token.pos === "名詞" &&
    NON_CONTENT_NOUN_DETAILS.has(token.pos_detail_1)
  )
    return null;
  if (
    (token.pos === "動詞" || token.pos === "形容詞") &&
    token.pos_detail_1 !== "自立"
  )
    return null;

  const source =
    token.basic_form && token.basic_form !== "*"
      ? token.basic_form
      : token.surface_form;
  const key = source.normalize("NFKC").trim();
  // IPADIC can classify unknown visual symbols as nouns.
  if (
    !key ||
    !/\p{L}/u.test(key) ||
    /^\p{N}+$/u.test(key) ||
    JAPANESE_ITERATION_MARKS_ONLY.test(key)
  )
    return null;
  return { key, language: "ja", pos: token.pos };
}
