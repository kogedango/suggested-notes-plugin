import {
  preprocessTokenizablePlainText,
  stripTokenizableStructures,
} from "./preprocess";
import { emitCrossLaneCompounds } from "./compounds";
import {
  CustomVocabulary,
  foldAsciiCase,
  type CustomTerm,
} from "./customVocabulary";
import {
  analyzeDetailed,
  appendDetailedAnalysis,
} from "./detailed";
import type {
  CanonicalToken,
  DetailedAnalysis,
  EnglishAnalyzer,
  JapaneseAnalyzer,
  MorphologyAnalyzer,
} from "./types";

const ENGLISH_SPAN =
  /[A-Za-z0-9][A-Za-z0-9_'’.-]*(?:[ \t,;:!?()[\]{}\/\\-]+[A-Za-z0-9][A-Za-z0-9_'’.-]*)*/g;
const JAPANESE_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

export class BilingualMorphologyAnalyzer implements MorphologyAnalyzer {
  private customVocabulary = new CustomVocabulary();

  constructor(
    private japanese: JapaneseAnalyzer,
    private english: EnglishAnalyzer,
  ) {}

  setCustomVocabulary(entries: string[]): void {
    this.customVocabulary.setEntries(entries);
  }

  analyze(text: string): CanonicalToken[] {
    const out: CanonicalToken[] = [];
    const prose = stripTokenizableStructures(text, true);
    for (const line of prose.split(/\r?\n/)) {
      this.analyzeLineWithProtectedSymbols(line, out);
    }
    return out;
  }

  tokenize(text: string): Map<string, number> {
    const counts = new Map<string, number>();
    for (const token of this.analyze(text)) {
      counts.set(token.key, (counts.get(token.key) ?? 0) + 1);
    }
    return counts;
  }

  private analyzePreparedLine(
    line: string,
    out: CanonicalToken[],
    placeholder?: string,
    protectedTerms: CustomTerm[] = [],
  ): void {
    const analysis: DetailedAnalysis = {
      tokens: [],
      compoundParts: [],
    };
    const foldedLine = foldAsciiCase(line);
    let plainStart = 0;
    let index = 0;
    let protectedIndex = 0;
    while (index < line.length) {
      const protectedMatch =
        placeholder && line.startsWith(placeholder, index)
          ? protectedTerms[protectedIndex]
          : undefined;
      const regularMatch = protectedMatch
        ? undefined
        : this.customVocabulary.matchFolded(foldedLine, index);
      const match = protectedMatch ?? regularMatch;
      if (!match) {
        index++;
        continue;
      }
      this.analyzePlain(
        line.slice(plainStart, index),
        plainStart,
        analysis,
      );
      analysis.tokens.push({
        key: match.key,
        language: "custom",
        pos: "CUSTOM",
      });
      const matchedLength = protectedMatch
        ? placeholder!.length
        : match.surface.length;
      analysis.compoundParts.push({
        key: match.key,
        kind: "noun",
        source: "custom",
        start: index,
        end: index + matchedLength,
      });
      if (protectedMatch) protectedIndex++;
      index += matchedLength;
      plainStart = index;
    }
    this.analyzePlain(
      line.slice(plainStart),
      plainStart,
      analysis,
    );
    emitCrossLaneCompounds(analysis.compoundParts, analysis.tokens);
    out.push(...analysis.tokens);
  }

  private analyzeLineWithProtectedSymbols(
    line: string,
    out: CanonicalToken[],
  ): void {
    const protectedLine = this.customVocabulary.protectSymbolTerms(line);
    if (!protectedLine) {
      this.analyzePreparedLine(
        preprocessTokenizablePlainText(line),
        out,
      );
      return;
    }
    this.analyzePreparedLine(
      preprocessTokenizablePlainText(protectedLine.text),
      out,
      protectedLine.placeholder,
      protectedLine.terms,
    );
  }

  private analyzePlain(
    text: string,
    baseOffset: number,
    out: DetailedAnalysis,
  ): void {
    let cursor = 0;
    ENGLISH_SPAN.lastIndex = 0;
    for (const match of text.matchAll(ENGLISH_SPAN)) {
      const start = match.index;
      this.analyzeJapaneseGap(
        text.slice(cursor, start),
        baseOffset + cursor,
        out,
      );
      appendDetailedAnalysis(
        analyzeDetailed(this.english, match[0]),
        baseOffset + start,
        out,
      );
      cursor = start + match[0].length;
    }
    this.analyzeJapaneseGap(
      text.slice(cursor),
      baseOffset + cursor,
      out,
    );
  }

  private analyzeJapaneseGap(
    text: string,
    baseOffset: number,
    out: DetailedAnalysis,
  ): void {
    if (!JAPANESE_SCRIPT.test(text)) return;
    appendDetailedAnalysis(
      analyzeDetailed(this.japanese, text),
      baseOffset,
      out,
    );
  }
}
