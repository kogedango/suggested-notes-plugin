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
  // `segment` must match the flag the corpus was built with, or query and
  // corpus tokens drift apart — the caller passes the same setting to both.
  async computeSalient(
    file: TFile,
    topN: number,
    segment: boolean,
  ): Promise<Set<string>> {
    if (!this.built) return new Set();
    const body = await this.app.vault.cachedRead(file);
    return rankSalient(tokenize(body, segment), topN, this.df, this.totalNotes);
  }

  // --- Cheap corpus maintenance ---

  // Single-note touch-up after an edit settles (Obsidian autosaves ~2s after
  // typing stops, which fires metadataCache "changed"): re-rank just this
  // note's salient set against the *current* df, so the note you just wrote
  // becomes discoverable from other notes immediately. `df` is NOT updated —
  // incremental df maintenance is the corruption-prone path this design
  // removed; brand-new vocabulary enters df at the next coarse rebuild (it
  // couldn't match anything before then anyway, since matching needs df >= 2).
  async refreshNote(
    file: TFile,
    topN: number,
    segment: boolean,
  ): Promise<void> {
    if (!this.built) return;
    const tokens = tokenize(await this.app.vault.cachedRead(file), segment);
    const next = rankSalient(tokens, topN, this.df, this.totalNotes);
    this.remove(file.path);
    this.salient.set(file.path, next);
    for (const t of next) {
      let inv = this.inverted.get(t);
      if (!inv) {
        inv = new Set();
        this.inverted.set(t, inv);
      }
      inv.add(file.path);
    }
  }

  // Rename/delete don't change note text, so a full rebuild is wasted I/O —
  // just re-key the salient/inverted entries. `df` is deliberately left
  // untouched (slightly stale until the next coarse rebuild): incremental df
  // maintenance is the path that caused the corruption race this design
  // removed, and IDF only needs to be statistically right.

  rename(oldPath: string, newPath: string): void {
    const sal = this.salient.get(oldPath);
    if (!sal) return;
    this.salient.delete(oldPath);
    this.salient.set(newPath, sal);
    for (const t of sal) {
      const inv = this.inverted.get(t);
      if (inv?.delete(oldPath)) inv.add(newPath);
    }
  }

  remove(path: string): void {
    const sal = this.salient.get(path);
    if (!sal) return;
    this.salient.delete(path);
    for (const t of sal) {
      const inv = this.inverted.get(t);
      if (!inv) continue;
      inv.delete(path);
      if (inv.size === 0) this.inverted.delete(t);
    }
  }

  // --- Corpus rebuild (coarse) ---

  async rebuildAll(topN: number, segment: boolean): Promise<void> {
    const files = this.app.vault.getMarkdownFiles();
    const nextDf = new Map<string, number>();
    const perFileTokens = new Map<string, Set<string>>();

    const CHUNK = 32;
    for (let i = 0; i < files.length; i += CHUNK) {
      await Promise.all(
        files.slice(i, i + CHUNK).map(async (f) => {
          const tokens = tokenize(await this.app.vault.cachedRead(f), segment);
          if (tokens.size === 0) return; // skip empty notes: they only dilute IDF
          perFileTokens.set(f.path, tokens);
          for (const t of tokens) nextDf.set(t, (nextDf.get(t) ?? 0) + 1);
        }),
      );
      await yieldToEventLoop(); // keep large / mobile vaults responsive
    }

    // Derive the whole new corpus into locals first. The live corpus keeps
    // serving queries until the single swap at the end, so a refresh that
    // lands mid-rebuild (we yield below) never sees a half-built index.
    const totalNotes = perFileTokens.size;
    const nextSalient = new Map<string, Set<string>>();
    const nextInverted = new Map<string, Set<string>>();
    let processed = 0;
    for (const [path, tokens] of perFileTokens) {
      const salient = rankSalient(tokens, topN, nextDf, totalNotes);
      nextSalient.set(path, salient);
      for (const t of salient) {
        let inv = nextInverted.get(t);
        if (!inv) {
          inv = new Set();
          nextInverted.set(t, inv);
        }
        inv.add(path);
      }
      if ((++processed & 0xff) === 0) await yieldToEventLoop();
    }

    this.df = nextDf;
    this.totalNotes = totalNotes;
    this.salient = nextSalient;
    this.inverted = nextInverted;
    this.idfCache.clear();
    this.built = true;
  }
}

// Rank a token set by IDF against the given doc-freq table and keep the
// top-N. Pure: used both for corpus builds (against the under-construction
// df) and for live queries (against the current corpus df).
function rankSalient(
  tokens: Set<string>,
  topN: number,
  df: Map<string, number>,
  totalNotes: number,
): Set<string> {
  const maxDf = Math.max(2, Math.floor(totalNotes * 0.4));
  const ranked: Array<{ t: string; idf: number }> = [];
  for (const t of tokens) {
    const n = df.get(t) ?? 0;
    if (n < 2) continue; // singletons can't produce shared signal
    if (n > maxDf) continue; // stop-word-like
    ranked.push({ t, idf: Math.log(totalNotes / n) });
  }
  ranked.sort((a, b) => b.idf - a.idf);

  const set = new Set<string>();
  for (const r of ranked.slice(0, topN)) set.add(r.t);
  return set;
}

const EMPTY: Set<string> = new Set();

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
