import { App, TFile } from "obsidian";
import { tokenize } from "../util/tokenize";

// Body-token matching uses a corpus/query split:
//
//   Corpus  — the slow-moving index over ALL notes (df + per-note salient
//             tokens + inverted index). Rebuilt coarsely (on enable, on
//             startup, manually, and a debounced pass after edits settle),
//             NOT maintained per keystroke. This is what candidate notes are
//             matched against.
//   Query   — the active note's salient tokens, computed fresh on demand from
//             a single cachedRead each time you switch notes. Always current.
//
// Keeping only the active note live (and the corpus coarse) removes the
// incremental-update machinery that previously caused the df-corruption race
// and the unbounded per-note token retention. The deliberate trade-off: a
// recently-edited *other* note's body signal lags until the next rebuild.
export class BodyTokenIndex {
  // Corpus: per-note salient tokens (top-N by IDF), used for candidate notes.
  private salient = new Map<string, Set<string>>();
  // Corpus: token -> notes whose salient set contains it.
  private inverted = new Map<string, Set<string>>();
  // Corpus: global doc-freq over full token sets (drives IDF).
  private df = new Map<string, number>();
  private totalNotes = 0;
  private idfCache = new Map<string, number>();
  private built = false;

  constructor(private app: App) {}

  clear(): void {
    this.salient = new Map();
    this.inverted = new Map();
    this.df = new Map();
    this.idfCache.clear();
    this.totalNotes = 0;
    this.built = false;
  }

  isBuilt(): boolean {
    return this.built;
  }

  // --- Corpus lookups (candidate notes / scoring) ---

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

  // --- Query (active note, on demand) ---

  // Tokenize the active note now and rank against the current corpus df.
  // Nothing is retained — this is the live query, so it can't go stale and
  // can't race with a concurrent edit. Returns empty until the corpus exists.
  async computeSalient(file: TFile, topN: number): Promise<Set<string>> {
    if (!this.built) return new Set();
    const body = await this.app.vault.cachedRead(file);
    return this.rankSalient(tokenize(body), topN);
  }

  // --- Corpus rebuild (coarse) ---

  async rebuildAll(topN: number): Promise<void> {
    const files = this.app.vault.getMarkdownFiles();
    const nextDf = new Map<string, number>();
    const perFileTokens = new Map<string, Set<string>>();

    const CHUNK = 32;
    for (let i = 0; i < files.length; i += CHUNK) {
      await Promise.all(
        files.slice(i, i + CHUNK).map(async (f) => {
          const tokens = tokenize(await this.app.vault.cachedRead(f));
          if (tokens.size === 0) return; // skip empty notes: they only dilute IDF
          perFileTokens.set(f.path, tokens);
          for (const t of tokens) nextDf.set(t, (nextDf.get(t) ?? 0) + 1);
        }),
      );
      await yieldToEventLoop(); // keep large / mobile vaults responsive
    }

    // Swap the corpus in atomically once df is final, then derive salient sets.
    this.df = nextDf;
    this.totalNotes = perFileTokens.size;
    this.idfCache.clear();
    this.salient = new Map();
    this.inverted = new Map();

    let processed = 0;
    for (const [path, tokens] of perFileTokens) {
      this.salient.set(path, this.rankSalient(tokens, topN, path));
      if ((++processed & 0xff) === 0) await yieldToEventLoop();
    }
    this.built = true;
  }

  // Rank a token set by IDF and keep the top-N. When `path` is given, also
  // register the kept tokens in the inverted index (corpus build); when it is
  // omitted, this is a throwaway query ranking.
  private rankSalient(
    tokens: Set<string>,
    topN: number,
    path?: string,
  ): Set<string> {
    const maxDf = Math.max(2, Math.floor(this.totalNotes * 0.4));
    const ranked: Array<{ t: string; idf: number }> = [];
    for (const t of tokens) {
      const df = this.df.get(t) ?? 0;
      if (df < 2) continue; // singletons can't produce shared signal
      if (df > maxDf) continue; // stop-word-like
      ranked.push({ t, idf: Math.log(this.totalNotes / df) });
    }
    ranked.sort((a, b) => b.idf - a.idf);

    const set = new Set<string>();
    for (const r of ranked.slice(0, topN)) {
      set.add(r.t);
      if (path !== undefined) {
        let inv = this.inverted.get(r.t);
        if (!inv) {
          inv = new Set();
          this.inverted.set(r.t, inv);
        }
        inv.add(path);
      }
    }
    return set;
  }
}

const EMPTY: Set<string> = new Set();

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
