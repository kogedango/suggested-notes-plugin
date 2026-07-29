import { App, TFile } from "obsidian";
import type { TokenCounter } from "../analysis/types";
import type { TitleTokenIndex } from "./titleTokens";

export interface BodyTokenCacheEntry {
  path: string;
  mtime: number;
  size: number;
  tokens: Array<[string, number]>;
}

interface FileStamp {
  mtime: number;
  size: number;
}

// Raw per-note counts are retained so corpus df and salience can be updated
// exactly after one file changes, without reading or tokenizing every other
// note again.
export class BodyTokenIndex {
  private counts = new Map<string, Map<string, number>>();
  private stamps = new Map<string, FileStamp>();
  private salient = new Map<string, Set<string>>();
  private inverted = new Map<string, Set<string>>();
  // Raw body occurrence index. Unlike `inverted`, this includes tokens that
  // are not currently salient. It lets a one-note edit rerank exactly the
  // other notes whose score can change when one of those tokens' df changes.
  private rawInverted = new Map<string, Set<string>>();
  private df = new Map<string, number>();
  private totalNotes = 0;
  private idfCache = new Map<string, number>();
  private built = false;
  private generation = 0;
  private topN = 40;
  private pathRevisions = new Map<string, number>();

  constructor(
    private app: App,
    private analyzer: TokenCounter,
    // When available, df is computed over title ∪ raw-body occurrence. This
    // keeps a body word that occurs in only one body when another note uses it
    // in its title — necessary for title/body cross-field matching.
    private titles?: TitleTokenIndex,
  ) {}

  setAnalyzer(analyzer: TokenCounter): void {
    this.analyzer = analyzer;
  }

  clear(): void {
    this.generation++;
    this.counts = new Map();
    this.stamps = new Map();
    this.pathRevisions = new Map();
    this.salient = new Map();
    this.inverted = new Map();
    this.rawInverted = new Map();
    this.df = new Map();
    this.idfCache.clear();
    this.totalNotes = 0;
    this.built = false;
  }

  isBuilt(): boolean {
    return this.built;
  }

  salientFor(path: string): Set<string> {
    return this.salient.get(path) ?? EMPTY;
  }

  filesWithToken(token: string): Set<string> {
    return this.inverted.get(token) ?? EMPTY;
  }

  notesWithTokenCount(token: string): number {
    return this.df.get(token) ?? 0;
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

  computeSalientText(body: string, topN: number): Set<string> {
    if (!this.built) return new Set();
    return rankSalient(
      this.analyzer.tokenize(body),
      topN,
      this.df,
      this.totalNotes,
    );
  }

  async refreshNote(file: TFile, topN: number): Promise<void> {
    if (!this.built) return;
    const path = file.path;
    const revision = (this.pathRevisions.get(path) ?? 0) + 1;
    this.pathRevisions.set(path, revision);
    const body = await this.app.vault.cachedRead(file);
    // A later save, delete, or rename superseded this read while it was in
    // flight. Let that operation own the cache entry.
    if (this.pathRevisions.get(path) !== revision) return;
    this.generation++;
    const nextCounts = this.analyzer.tokenize(body);
    this.stamps.set(path, stampOf(file));
    if (this.counts.has(path)) {
      this.replaceExistingCounts(path, nextCounts, topN);
    } else {
      // Creating a note can change totalNotes and title/body union df, which
      // affects every token's IDF and the 40% eligibility threshold.
      this.counts.set(path, nextCounts);
      this.recompute(topN);
    }
  }

  rename(oldPath: string, newPath: string): void {
    this.generation++;
    this.bumpPathRevision(oldPath);
    this.bumpPathRevision(newPath);
    const counts = this.counts.get(oldPath);
    const stamp = this.stamps.get(oldPath);
    this.counts.delete(oldPath);
    this.stamps.delete(oldPath);
    if (counts) this.counts.set(newPath, counts);
    if (stamp) this.stamps.set(newPath, stamp);
    if (this.built) this.recompute(this.topN);
  }

  remove(path: string): void {
    this.generation++;
    this.bumpPathRevision(path);
    const removed = this.counts.delete(path);
    this.stamps.delete(path);
    if (removed && this.built) this.recompute(this.topN);
  }

  restore(entries: unknown, topN: number): boolean {
    if (!Array.isArray(entries)) return false;
    const nextCounts = new Map<string, Map<string, number>>();
    const nextStamps = new Map<string, FileStamp>();
    for (const entry of entries) {
      if (!isBodyTokenCacheEntry(entry)) return false;
      nextCounts.set(entry.path, new Map(entry.tokens));
      nextStamps.set(entry.path, { mtime: entry.mtime, size: entry.size });
    }
    this.counts = nextCounts;
    this.stamps = nextStamps;
    this.recompute(topN);
    return true;
  }

  snapshot(): BodyTokenCacheEntry[] {
    return [...this.counts].map(([path, tokens]) => {
      const stamp = this.stamps.get(path) ?? { mtime: 0, size: 0 };
      return {
        path,
        mtime: stamp.mtime,
        size: stamp.size,
        tokens: [...tokens],
      };
    });
  }

  rerank(topN: number): void {
    if (this.built) this.recompute(topN);
  }

  async syncAll(topN: number, chunkSize = 32): Promise<boolean> {
    return this.build(topN, false, chunkSize);
  }

  async rebuildAll(topN: number): Promise<void> {
    await this.build(topN, true, 32);
  }

  private async build(
    topN: number,
    force: boolean,
    chunkSize: number,
  ): Promise<boolean> {
    for (;;) {
      const startedAt = this.generation;
      const files = this.app.vault.getMarkdownFiles();
      const nextCounts = new Map<string, Map<string, number>>();
      const nextStamps = new Map<string, FileStamp>();
      let changed = force;

      for (let i = 0; i < files.length; i += chunkSize) {
        await Promise.all(
          files.slice(i, i + chunkSize).map(async (file) => {
            const stamp = stampOf(file);
            const cachedStamp = this.stamps.get(file.path);
            const cached = this.counts.get(file.path);
            if (
              !force &&
              cached &&
              cachedStamp?.mtime === stamp.mtime &&
              cachedStamp.size === stamp.size
            ) {
              nextCounts.set(file.path, new Map(cached));
              nextStamps.set(file.path, stamp);
              return;
            }
            try {
              const body = await this.app.vault.cachedRead(file);
              nextCounts.set(file.path, this.analyzer.tokenize(body));
              nextStamps.set(file.path, stamp);
              changed = true;
            } catch (error) {
              if (cached) changed = true;
              console.error(
                `Suggested Notes: failed to read "${file.path}" during body-token rebuild, skipping it`,
                error,
              );
            }
          }),
        );
        await yieldToEventLoop();
      }
      if (startedAt !== this.generation) continue;
      if (nextCounts.size !== this.counts.size) changed = true;
      this.counts = nextCounts;
      this.stamps = nextStamps;
      this.recompute(topN);
      return changed;
    }
  }

  private recompute(topN: number): void {
    this.topN = topN;
    const nextDf = new Map<string, number>(
      this.titles?.documentFrequencyEntries() ?? [],
    );
    const nextRawInverted = new Map<string, Set<string>>();
    for (const [path, counts] of this.counts) {
      for (const token of counts.keys()) {
        addPathToTokenIndex(nextRawInverted, token, path);
        if (this.titles?.tokensFor(path).has(token)) continue;
        nextDf.set(token, (nextDf.get(token) ?? 0) + 1);
      }
    }

    const totalNotes = Math.max(
      this.counts.size,
      this.titles?.totalNotesCount() ?? 0,
    );
    const nextSalient = new Map<string, Set<string>>();
    const nextInverted = new Map<string, Set<string>>();
    for (const [path, counts] of this.counts) {
      const selected = rankSalient(counts, topN, nextDf, totalNotes);
      nextSalient.set(path, selected);
      addToInverted(nextInverted, path, selected);
    }

    this.df = nextDf;
    this.totalNotes = totalNotes;
    this.salient = nextSalient;
    this.inverted = nextInverted;
    this.rawInverted = nextRawInverted;
    this.idfCache.clear();
    this.built = true;
  }

  private replaceExistingCounts(
    path: string,
    nextCounts: Map<string, number>,
    topN: number,
  ): void {
    const previousCounts = this.counts.get(path);
    if (!previousCounts) {
      this.counts.set(path, nextCounts);
      this.recompute(topN);
      return;
    }

    this.topN = topN;
    const previousTokens = new Set(previousCounts.keys());
    const nextTokens = new Set(nextCounts.keys());
    const changedDfTokens = new Set<string>();

    for (const token of previousTokens) {
      if (!nextTokens.has(token)) {
        removePathFromTokenIndex(this.rawInverted, token, path);
        // Body occurrence does not add another document when the same note's
        // title already carries the token.
        if (!this.titles?.tokensFor(path).has(token)) {
          const value = (this.df.get(token) ?? 1) - 1;
          if (value > 0) this.df.set(token, value);
          else this.df.delete(token);
          changedDfTokens.add(token);
        }
      }
    }
    for (const token of nextTokens) {
      if (!previousTokens.has(token)) {
        addPathToTokenIndex(this.rawInverted, token, path);
        if (!this.titles?.tokensFor(path).has(token)) {
          this.df.set(token, (this.df.get(token) ?? 0) + 1);
          changedDfTokens.add(token);
        }
      }
    }

    this.counts.set(path, nextCounts);
    const affected = new Set<string>([path]);
    for (const token of changedDfTokens) {
      this.idfCache.delete(token);
      for (const affectedPath of this.rawInverted.get(token) ?? EMPTY) {
        affected.add(affectedPath);
      }
    }
    this.rerankPaths(affected);
  }

  private rerankPaths(paths: Iterable<string>): void {
    for (const path of paths) {
      const counts = this.counts.get(path);
      if (!counts) continue;
      const previous = this.salient.get(path) ?? EMPTY;
      for (const token of previous) {
        removePathFromTokenIndex(this.inverted, token, path);
      }
      const selected = rankSalient(
        counts,
        this.topN,
        this.df,
        this.totalNotes,
      );
      this.salient.set(path, selected);
      addToInverted(this.inverted, path, selected);
    }
  }

  private bumpPathRevision(path: string): void {
    this.pathRevisions.set(path, (this.pathRevisions.get(path) ?? 0) + 1);
  }
}

function stampOf(file: TFile): FileStamp {
  return { mtime: file.stat.mtime, size: file.stat.size };
}

function isBodyTokenCacheEntry(value: unknown): value is BodyTokenCacheEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.path === "string" &&
    typeof entry.mtime === "number" &&
    Number.isFinite(entry.mtime) &&
    typeof entry.size === "number" &&
    Number.isFinite(entry.size) &&
    Array.isArray(entry.tokens) &&
    entry.tokens.every(
      (pair) =>
        Array.isArray(pair) &&
        pair.length === 2 &&
        typeof pair[0] === "string" &&
        typeof pair[1] === "number" &&
        Number.isFinite(pair[1]) &&
        pair[1] > 0,
    )
  );
}

const RESERVE_DF_MAX = 10;
const RESERVE_SIZE = 20;

export function rankSalient(
  tokens: Map<string, number>,
  topN: number,
  df: Map<string, number>,
  totalNotes: number,
  reserveDfMax = RESERVE_DF_MAX,
  reserveSize = RESERVE_SIZE,
): Set<string> {
  const maxDf = Math.max(2, Math.floor(totalNotes * 0.4));
  const ranked: Array<{ token: string; df: number; score: number }> = [];
  for (const [token, tf] of tokens) {
    const documentFrequency = df.get(token) ?? 0;
    if (documentFrequency < 2 || documentFrequency > maxDf) continue;
    ranked.push({
      token,
      df: documentFrequency,
      score: Math.log(1 + tf) * Math.log(totalNotes / documentFrequency),
    });
  }
  ranked.sort((a, b) => b.score - a.score);

  const selected = new Set<string>();
  for (const item of ranked.slice(0, topN)) selected.add(item.token);
  let reserved = 0;
  for (let i = topN; i < ranked.length && reserved < reserveSize; i++) {
    if (ranked[i].df > reserveDfMax) continue;
    selected.add(ranked[i].token);
    reserved++;
  }
  return selected;
}

function addToInverted(
  inverted: Map<string, Set<string>>,
  path: string,
  tokens: Iterable<string>,
): void {
  for (const token of tokens) {
    let paths = inverted.get(token);
    if (!paths) {
      paths = new Set();
      inverted.set(token, paths);
    }
    paths.add(path);
  }
}

function addPathToTokenIndex(
  index: Map<string, Set<string>>,
  token: string,
  path: string,
): void {
  let paths = index.get(token);
  if (!paths) {
    paths = new Set();
    index.set(token, paths);
  }
  paths.add(path);
}

function removePathFromTokenIndex(
  index: Map<string, Set<string>>,
  token: string,
  path: string,
): void {
  const paths = index.get(token);
  paths?.delete(path);
  if (paths?.size === 0) index.delete(token);
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const EMPTY: Set<string> = new Set();
