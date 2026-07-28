export type TokenLanguage = "ja" | "en" | "identifier" | "custom";

export interface CanonicalToken {
  key: string;
  language: TokenLanguage;
  pos: string;
}

export type CompoundPartKind = "noun" | "prefix" | "suffix";
export type CompoundPartSource = "ja" | "ascii" | "custom";

export interface PositionedCompoundPart {
  key: string;
  kind: CompoundPartKind;
  source: CompoundPartSource;
  start: number;
  end: number;
}

export interface DetailedAnalysis {
  tokens: CanonicalToken[];
  compoundParts: PositionedCompoundPart[];
}

export interface TokenCounter {
  tokenize(text: string): Map<string, number>;
}

export interface MorphologyAnalyzer extends TokenCounter {
  analyze(text: string): CanonicalToken[];
  setCustomVocabulary(entries: string[]): void;
}

export interface DetailedAnalyzer {
  analyze(text: string): CanonicalToken[];
  analyzeDetailed?(text: string): DetailedAnalysis;
}

export type JapaneseAnalyzer = DetailedAnalyzer;
export type EnglishAnalyzer = DetailedAnalyzer;
