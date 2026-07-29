import type { TokenCounter } from "../analysis/types";
import { basename } from "../util/path";
import type { SnapshotReader } from "./store";

export interface TitleTokenCacheEntry {
  path: string;
  tokens: string[];
}

// One analyzer instance and one canonical representation are shared with the
// body index. Initial title analysis yields between bounded batches.
export class TitleTokenIndex {
  private tokens = new Map<string, Set<string>>();
  private inverted = new Map<string, Set<string>>();
  private df = new Map<string, number>();
  private totalNotes = 0;
  private idfCache = new Map<string, number>();
  private generation = 0;

  constructor(
    private store: SnapshotReader,
    private analyzer: TokenCounter,
  ) {}

  setAnalyzer(analyzer: TokenCounter): void {
    this.analyzer = analyzer;
  }

  invalidateAnalysis(): void {
    this.generation++;
  }

  restore(
    entries: unknown,
    options: { consume?: boolean } = {},
  ): boolean {
    if (
      !Array.isArray(entries) ||
      !entries.every(isTitleTokenCacheEntry)
    ) {
      return false;
    }
    const nextTokens = new Map<string, Set<string>>();
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index];
      nextTokens.set(entry.path, new Set(entry.tokens));
      if (options.consume) entry.tokens.length = 0;
    }
    if (options.consume) entries.length = 0;
    this.replaceTokens(nextTokens);
    return true;
  }

  snapshot(): TitleTokenCacheEntry[] {
    return [...this.snapshotEntries()];
  }

  *snapshotEntries(): IterableIterator<TitleTokenCacheEntry> {
    for (const [path, tokens] of this.tokens) {
      yield { path, tokens: [...tokens] };
    }
  }

  // Reuses restored entries and analyzes only new/renamed titles. Deleted
  // paths disappear when the complete current map is swapped in.
  async syncAll(chunkSize = 32): Promise<boolean> {
    for (;;) {
      const startedAt = this.generation;
      const paths = [...this.store.all()].map((snapshot) => snapshot.path);
      const nextTokens = new Map<string, Set<string>>();
      let changed = paths.length !== this.tokens.size;

      for (let i = 0; i < paths.length; i += chunkSize) {
        for (const path of paths.slice(i, i + chunkSize)) {
          const cached = this.tokens.get(path);
          if (!cached) changed = true;
          nextTokens.set(
            path,
            cached
              // Per-note sets are immutable after insertion; add/remove/rename
              // replace outer-map entries instead of changing these sets.
              // Sharing unchanged sets avoids doubling the title corpus during
              // the atomic synchronization pass.
              ? cached
              : new Set(this.analyzer.tokenize(basename(path)).keys()),
          );
        }
        await yieldToEventLoop();
      }
      if (startedAt !== this.generation) continue;
      this.replaceTokens(nextTokens);
      return changed;
    }
  }

  async rebuildAll(chunkSize = 32): Promise<void> {
    // Metadata events may add/rename/delete paths while a long initial pass is
    // yielding. Repeat from the current snapshot until one generation is
    // stable, then swap the complete maps atomically.
    for (;;) {
      const startedAt = this.generation;
      const paths = [...this.store.all()].map((snapshot) => snapshot.path);
      const nextTokens = new Map<string, Set<string>>();
      const nextInverted = new Map<string, Set<string>>();
      const nextDf = new Map<string, number>();

      for (let i = 0; i < paths.length; i += chunkSize) {
        for (const path of paths.slice(i, i + chunkSize)) {
          const set = new Set(this.analyzer.tokenize(basename(path)).keys());
          nextTokens.set(path, set);
          addPath(nextInverted, nextDf, path, set);
        }
        await yieldToEventLoop();
      }
      if (startedAt !== this.generation) continue;

      this.tokens = nextTokens;
      this.inverted = nextInverted;
      this.df = nextDf;
      this.totalNotes = paths.length;
      this.idfCache.clear();
      return;
    }
  }

  // Reports whether the path was actually new, so a caller can tell a real
  // change from the no-op an already-known path produces.
  add(path: string): boolean {
    if (this.tokens.has(path)) return false;
    this.generation++;
    const set = new Set(this.analyzer.tokenize(basename(path)).keys());
    this.tokens.set(path, set);
    this.totalNotes++;
    addPath(this.inverted, this.df, path, set);
    this.idfCache.clear();
    return true;
  }

  remove(path: string): void {
    this.generation++;
    const set = this.tokens.get(path);
    if (!set) return;
    this.tokens.delete(path);
    this.totalNotes--;
    for (const token of set) {
      const nextDf = (this.df.get(token) ?? 1) - 1;
      if (nextDf > 0) this.df.set(token, nextDf);
      else this.df.delete(token);
      const paths = this.inverted.get(token);
      paths?.delete(path);
      if (paths?.size === 0) this.inverted.delete(token);
    }
    this.idfCache.clear();
  }

  rename(oldPath: string, newPath: string): void {
    this.remove(oldPath);
    this.add(newPath);
  }

  tokensFor(path: string): ReadonlySet<string> {
    return this.tokens.get(path) ?? EMPTY;
  }

  filesWithToken(token: string): ReadonlySet<string> {
    return this.inverted.get(token) ?? EMPTY;
  }

  notesWithTokenCount(token: string): number {
    return this.df.get(token) ?? 0;
  }

  totalNotesCount(): number {
    return this.totalNotes;
  }

  documentFrequencyEntries(): IterableIterator<[string, number]> {
    return this.df.entries();
  }

  idf(token: string): number {
    const cached = this.idfCache.get(token);
    if (cached !== undefined) return cached;
    const n = this.df.get(token) ?? 0;
    const value =
      n > 0 && this.totalNotes > 0 ? Math.log(this.totalNotes / n) : 0;
    this.idfCache.set(token, value);
    return value;
  }

  private replaceTokens(nextTokens: Map<string, Set<string>>): void {
    const nextInverted = new Map<string, Set<string>>();
    const nextDf = new Map<string, number>();
    for (const [path, tokens] of nextTokens) {
      addPath(nextInverted, nextDf, path, tokens);
    }
    this.tokens = nextTokens;
    this.inverted = nextInverted;
    this.df = nextDf;
    this.totalNotes = nextTokens.size;
    this.idfCache.clear();
  }
}

export function isTitleTokenCacheEntry(
  value: unknown,
): value is TitleTokenCacheEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.path === "string" &&
    Array.isArray(entry.tokens) &&
    entry.tokens.every((token) => typeof token === "string")
  );
}

function addPath(
  inverted: Map<string, Set<string>>,
  df: Map<string, number>,
  path: string,
  tokens: Iterable<string>,
): void {
  for (const token of tokens) {
    df.set(token, (df.get(token) ?? 0) + 1);
    let paths = inverted.get(token);
    if (!paths) {
      paths = new Set();
      inverted.set(token, paths);
    }
    paths.add(path);
  }
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const EMPTY: ReadonlySet<string> = new Set();
