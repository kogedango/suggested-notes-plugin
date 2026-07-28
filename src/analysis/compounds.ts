import type { CanonicalToken, PositionedCompoundPart } from "./types";

type CompoundFilter = (parts: PositionedCompoundPart[]) => boolean;

export function emitCompoundRun(
  run: PositionedCompoundPart[],
  out: CanonicalToken[],
  filter: CompoundFilter = () => true,
): void {
  for (const length of [2, 3]) {
    for (let start = 0; start + length <= run.length; start++) {
      emitCompoundSlice(run.slice(start, start + length), out, filter);
    }
  }

  // Retain exact long compounds without generating every O(n²) substring.
  let start = 0;
  let end = run.length;
  while (start < end && run[start].kind === "suffix") start++;
  while (end > start && run[end - 1].kind === "prefix") end--;
  if (end - start >= 4) {
    emitCompoundSlice(run.slice(start, end), out, filter);
  }
}

export function emitCrossLaneCompounds(
  parts: PositionedCompoundPart[],
  out: CanonicalToken[],
): void {
  const ordered = [...parts].sort(
    (left, right) => left.start - right.start || left.end - right.end,
  );
  let run: PositionedCompoundPart[] = [];
  for (const part of ordered) {
    if (run.length > 0 && run[run.length - 1].end !== part.start) {
      emitMixedCompoundRun(run, out);
      run = [];
    }
    run.push(part);
  }
  emitMixedCompoundRun(run, out);
}

function emitMixedCompoundRun(
  run: PositionedCompoundPart[],
  out: CanonicalToken[],
): void {
  emitCompoundRun(run, out, (parts) => {
    const hasJapanese = parts.some((part) => part.source === "ja");
    const hasExternal = parts.some((part) => part.source !== "ja");
    return hasJapanese && hasExternal;
  });
}

function emitCompoundSlice(
  parts: PositionedCompoundPart[],
  out: CanonicalToken[],
  filter: CompoundFilter,
): void {
  if (parts.length < 2) return;
  if (parts[0].kind === "suffix") return;
  if (parts[parts.length - 1].kind === "prefix") return;
  if (!parts.some((part) => part.kind === "noun")) return;
  if (!filter(parts)) return;
  out.push({
    key: parts.map((part) => part.key).join(""),
    language: "ja",
    pos: "複合名詞",
  });
}
