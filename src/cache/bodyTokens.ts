import { App, TFile } from "obsidian";
import { tokenize } from "../util/tokenize";

export class BodyTokenIndex {
  // Per-file salient tokens (top-N by IDF). Used both as the candidate-source
  // for scoring and as what we display in the reasons UI.
  private salient = new Map<string, Set<string>>();
  // Full per-file token sets retained so we can re-rank salient tokens after
  // global df shifts without re-reading files. Memory cost is the main risk
  // here; if it becomes a problem we can drop and lazy-recompute on rebuild.
  private full = new Map<string, Set<string>>();
  // token -> files whose salient set contains it
  private inverted = new Map<string, Set<string>>();
  // global doc-freq over FULL token sets (used for IDF)
  private df = new Map<string, number>();
  private totalNotes = 0;
  private idfCache = new Map<string, number>();

  constructor(private app: App) {}

  clear(): void {
    this.salient.clear();
    this.full.clear();
    this.inverted.clear();
    this.df.clear();
    this.idfCache.clear();
    this.totalNotes = 0;
  }

  has(path: string): boolean {
    return this.salient.has(path);
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
    const v = n > 0 && this.totalNotes > 0 ? Math.log(this.totalNotes / n) : 0;
    this.idfCache.set(token, v);
    return v;
  }

  async rebuildAll(topN: number): Promise<void> {
    this.clear();
    const files = this.app.vault.getMarkdownFiles();
    this.totalNotes = files.length;

    const CHUNK = 32;
    for (let i = 0; i < files.length; i += CHUNK) {
      const chunk = files.slice(i, i + CHUNK);
      await Promise.all(
        chunk.map(async (f) => {
          const body = await this.app.vault.cachedRead(f);
          const tokens = tokenize(body);
          this.full.set(f.path, tokens);
          for (const t of tokens) {
            this.df.set(t, (this.df.get(t) ?? 0) + 1);
          }
        }),
      );
    }

    // Build salient sets now that df is final.
    for (const [path, tokens] of this.full) {
      this.recomputeSalient(path, tokens, topN);
    }
  }

  async updateFile(file: TFile, topN: number): Promise<void> {
    const path = file.path;
    const prevFull = this.full.get(path);
    const prevSalient = this.salient.get(path);

    if (prevFull) {
      for (const t of prevFull) {
        const n = (this.df.get(t) ?? 0) - 1;
        if (n <= 0) this.df.delete(t);
        else this.df.set(t, n);
      }
    } else {
      this.totalNotes += 1;
    }

    if (prevSalient) {
      for (const t of prevSalient) {
        this.invertedRemove(t, path);
      }
    }

    const body = await this.app.vault.cachedRead(file);
    const tokens = tokenize(body);
    this.full.set(path, tokens);
    for (const t of tokens) this.df.set(t, (this.df.get(t) ?? 0) + 1);

    this.idfCache.clear();
    this.recomputeSalient(path, tokens, topN);
  }

  removeFile(path: string): void {
    const prevFull = this.full.get(path);
    const prevSalient = this.salient.get(path);
    if (!prevFull) return;
    for (const t of prevFull) {
      const n = (this.df.get(t) ?? 0) - 1;
      if (n <= 0) this.df.delete(t);
      else this.df.set(t, n);
    }
    if (prevSalient) {
      for (const t of prevSalient) this.invertedRemove(t, path);
    }
    this.full.delete(path);
    this.salient.delete(path);
    this.totalNotes -= 1;
    this.idfCache.clear();
  }

  renameFile(oldPath: string, newPath: string): void {
    const full = this.full.get(oldPath);
    const salient = this.salient.get(oldPath);
    if (full) {
      this.full.delete(oldPath);
      this.full.set(newPath, full);
    }
    if (salient) {
      this.salient.delete(oldPath);
      this.salient.set(newPath, salient);
      for (const t of salient) {
        const set = this.inverted.get(t);
        if (set) {
          set.delete(oldPath);
          set.add(newPath);
        }
      }
    }
  }

  private recomputeSalient(
    path: string,
    tokens: Set<string>,
    topN: number,
  ): void {
    const prev = this.salient.get(path);
    if (prev) {
      for (const t of prev) this.invertedRemove(t, path);
    }

    const maxDf = Math.max(2, Math.floor(this.totalNotes * 0.4));
    const ranked: Array<{ t: string; idf: number }> = [];
    for (const t of tokens) {
      const df = this.df.get(t) ?? 0;
      if (df < 2) continue; // singletons can't produce shared signal
      if (df > maxDf) continue; // stop-word-like
      const idf = Math.log(this.totalNotes / df);
      ranked.push({ t, idf });
    }
    ranked.sort((a, b) => b.idf - a.idf);
    const top = ranked.slice(0, topN);

    const set = new Set<string>();
    for (const r of top) {
      set.add(r.t);
      let inv = this.inverted.get(r.t);
      if (!inv) {
        inv = new Set();
        this.inverted.set(r.t, inv);
      }
      inv.add(path);
    }
    this.salient.set(path, set);
  }

  private invertedRemove(token: string, path: string): void {
    const set = this.inverted.get(token);
    if (!set) return;
    set.delete(path);
    if (set.size === 0) this.inverted.delete(token);
  }
}

const EMPTY: Set<string> = new Set();
