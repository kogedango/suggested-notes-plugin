import {
  NEGATIVE_CONTRAST_PAIRS,
  POSITIVE_CONTRAST_GROUPS,
  type NegativeContrastPair,
  type PositiveContrastCategory,
} from "./tokenizeContrast.dataset";
import { tokenize } from "./tokenize";

export interface PositivePairResult {
  readonly kind: "positive";
  readonly variants: readonly [string, string];
  readonly category: PositiveContrastCategory;
  readonly note: string;
  readonly sharedTokens: readonly string[];
}

export interface NegativePairResult {
  readonly kind: "negative";
  readonly variants: readonly [string, string];
  readonly note: string;
  readonly sharedTokens: readonly string[];
}

export interface TokenizerContrastReport {
  readonly segment: boolean;
  readonly positivePairs: readonly PositivePairResult[];
  readonly negativePairs: readonly NegativePairResult[];
  readonly identification: Rate;
  readonly falseMerge: Rate;
}

export interface Rate {
  readonly count: number;
  readonly total: number;
  readonly value: number;
}

// Token overlap is necessary but not sufficient for two notes to match. The
// downstream salient-token and df layers can only remove tokens, so this
// tokenizer-level identification rate is an upper bound on identification.
export function evaluateTokenizerContrasts(segment: boolean): TokenizerContrastReport {
  const positivePairs = POSITIVE_CONTRAST_GROUPS.flatMap((group) =>
    unorderedPairs(group.variants).map(([left, right]): PositivePairResult => ({
      kind: "positive",
      variants: [left, right],
      category: group.category,
      note: group.note,
      sharedTokens: findSharedTokens(left, right, segment),
    })),
  );
  const negativePairs = NEGATIVE_CONTRAST_PAIRS.map(
    (pair): NegativePairResult => evaluateNegativePair(pair, segment),
  );

  const identified = positivePairs.filter((pair) => pair.sharedTokens.length > 0).length;
  const falseMerges = negativePairs.filter((pair) => pair.sharedTokens.length > 0).length;

  return {
    segment,
    positivePairs,
    negativePairs,
    identification: rate(identified, positivePairs.length),
    falseMerge: rate(falseMerges, negativePairs.length),
  };
}

export function formatTokenizerContrastReports(
  reports: readonly TokenizerContrastReport[],
): string {
  const lines = ["Okurigana/conjugation tokenizer contrast report"];
  for (const report of reports) {
    lines.push(
      "",
      `segment=${report.segment}`,
      `identification rate: ${formatRate(report.identification)}`,
      `false-merge rate: ${formatRate(report.falseMerge)}`,
      "positive pairs:",
    );
    for (const pair of report.positivePairs) {
      lines.push(`  ${formatPair(pair.variants, pair.sharedTokens)} [${pair.category}]`);
    }
    lines.push("negative pairs:");
    for (const pair of report.negativePairs) {
      lines.push(`  ${formatPair(pair.variants, pair.sharedTokens)}`);
    }
  }
  return lines.join("\n");
}

function unorderedPairs(variants: readonly string[]): Array<readonly [string, string]> {
  return variants.flatMap((left, index) =>
    variants.slice(index + 1).map((right) => [left, right] as const),
  );
}

function evaluateNegativePair(
  pair: NegativeContrastPair,
  segment: boolean,
): NegativePairResult {
  const [left, right] = pair.variants;
  return {
    kind: "negative",
    variants: pair.variants,
    note: pair.note,
    sharedTokens: findSharedTokens(left, right, segment),
  };
}

function findSharedTokens(left: string, right: string, segment: boolean): string[] {
  const leftTokens = tokenize(left, segment);
  const rightTokens = tokenize(right, segment);
  return [...leftTokens.keys()].filter((token) => rightTokens.has(token)).sort();
}

function rate(count: number, total: number): Rate {
  return { count, total, value: total === 0 ? 0 : count / total };
}

function formatRate(value: Rate): string {
  return `${value.count}/${value.total} (${(value.value * 100).toFixed(2)}%)`;
}

function formatPair(
  [left, right]: readonly [string, string],
  sharedTokens: readonly string[],
): string {
  const sharing = sharedTokens.length > 0
    ? `shared [${sharedTokens.join(", ")}]`
    : "shared []";
  return `${left} | ${right}: ${sharing}`;
}
