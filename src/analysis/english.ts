import pluralize from "pluralize";
import winkNLP, { ItemToken, PartOfSpeech, WinkMethods } from "wink-nlp";
import model from "wink-eng-lite-web-model";
import { locateSurface } from "./detailed";
import type {
  CanonicalToken,
  DetailedAnalysis,
  EnglishAnalyzer,
  PositionedCompoundPart,
} from "./types";

const CONTENT_POS = new Set<PartOfSpeech>([
  "NOUN",
  "PROPN",
  "VERB",
  "ADJ",
  "ADV",
]);
const IDENTIFIER =
  /^(?:[A-Z]{2,}[A-Za-z0-9]*|[A-Za-z]*[a-z][A-Z][A-Za-z0-9]*|[A-Za-z][A-Za-z0-9]*[_\d][A-Za-z0-9_-]*)$/;
const WORD = /[A-Za-z]/;

export class WinkEnglishAnalyzer implements EnglishAnalyzer {
  private nlp: WinkMethods = winkNLP(model);

  analyze(text: string): CanonicalToken[] {
    return this.analyzeDetailed(text).tokens;
  }

  analyzeDetailed(text: string): DetailedAnalysis {
    const out: CanonicalToken[] = [];
    const compoundParts: PositionedCompoundPart[] = [];
    let cursor = 0;
    const tokens = this.nlp.readDoc(text).tokens();
    tokens.each((token: ItemToken) => {
      const rawSurface = String(token.out(this.nlp.its.value));
      const start = locateSurface(text, rawSurface, cursor);
      const end = start + rawSurface.length;
      cursor = end;
      const surface = rawSurface.normalize("NFKC");
      if (!WORD.test(surface)) return;

      if (IDENTIFIER.test(surface)) {
        const canonical: CanonicalToken = {
          key: surface.toLowerCase(),
          language: "identifier",
          pos: "IDENTIFIER",
        };
        out.push(canonical);
        compoundParts.push({
          key: canonical.key,
          kind: "noun",
          source: "ascii",
          start,
          end,
        });
        return;
      }

      const pos = token.out(this.nlp.its.pos) as PartOfSpeech;
      // Preserve alphabetic unknowns unless POS supplies evidence to drop them.
      if (!CONTENT_POS.has(pos) && pos !== "X") return;

      // wink-nlp 2.4's lemma declaration conflicts with ItemToken.out.
      const modelLemma = String(token.out(this.nlp.its.lemma as never))
        .normalize("NFKC")
        .toLowerCase();
      let key = modelLemma;
      if (pos === "NOUN") {
        const singular = pluralize.singular(modelLemma);
        // pluralize misclassifies short s-final words (js -> j, lens -> len).
        if (singular.length >= 4) key = singular;
      }
      if (!key || !WORD.test(key)) return;
      out.push({ key, language: "en", pos });
      if (pos === "NOUN" || pos === "PROPN") {
        compoundParts.push({
          key,
          kind: "noun",
          source: "ascii",
          start,
          end,
        });
      }
    });
    return { tokens: out, compoundParts };
  }
}
