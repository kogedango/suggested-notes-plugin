import type {
  DetailedAnalysis,
  DetailedAnalyzer,
} from "./types";

export function analyzeDetailed(
  analyzer: DetailedAnalyzer,
  text: string,
): DetailedAnalysis {
  return (
    analyzer.analyzeDetailed?.(text) ?? {
      tokens: analyzer.analyze(text),
      compoundParts: [],
    }
  );
}

export function appendDetailedAnalysis(
  source: DetailedAnalysis,
  offset: number,
  target: DetailedAnalysis,
): void {
  target.tokens.push(...source.tokens);
  for (const part of source.compoundParts) {
    target.compoundParts.push({
      ...part,
      start: part.start + offset,
      end: part.end + offset,
    });
  }
}

export function locateSurface(
  text: string,
  surface: string,
  cursor: number,
): number {
  const found = text.indexOf(surface, cursor);
  return found >= 0 ? found : cursor;
}
