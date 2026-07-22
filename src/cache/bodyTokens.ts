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
  // Corpus: per-note salient tokens (top-N by log(1+TF) * IDF), used for
  // candidate notes.
  private salient = new Map<string, Set<string>>();
  // Corpus: token -> notes whose salient set contains it.
  private inverted = new Map<string, Set<string>>();
  // Corpus: global doc-freq over full token sets (drives IDF).
  private df = new Map<string, number>();
  // Baseline df excludes the additive hiragana repair lane, so existing
  // salient sets and candidate pairs cannot be displaced by repair tokens.
  private baselineDf = new Map<string, number>();
  // Corpus: standalone-word units seen on their own somewhere in the vault
  // (kanji 2-grams and whole katakana words), used to gate interior sub-units
  // of longer runs. Frozen per rebuild like df (a unit new to the vault is not
  // trusted as a word until the next coarse rebuild — the same staleness
  // trade-off df already accepts).
  private standalone = new Set<string>();
  // Hiragana-only vocabulary candidates accepted by TinySegmenter somewhere
  // in the corpus. Kept separate because their evidence differs from the
  // script-run standalone units above. Frozen per rebuild like df.
  private hiraganaDictionary = new Set<string>();
  private totalNotes = 0;
  private idfCache = new Map<string, number>();
  private built = false;

  constructor(private app: App) {}

  clear(): void {
    this.salient = new Map();
    this.inverted = new Map();
    this.df = new Map();
    this.baselineDf = new Map();
    this.standalone = new Set();
    this.hiraganaDictionary = new Set();
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
    const repairs = new Map<string, number>();
    const tokens = tokenize(
      body,
      segment,
      this.standalone,
      undefined,
      this.hiraganaDictionary,
      undefined,
      repairs,
    );
    const result = rankSalient(
      tokens,
      topN,
      this.baselineDf,
      this.totalNotes,
    );
    addHiraganaRepairSalient(
      result,
      tokens,
      repairs,
      this.hiraganaDictionary,
      this.df,
      this.totalNotes,
    );
    return result;
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
    const repairs = new Map<string, number>();
    const tokens = tokenize(
      await this.app.vault.cachedRead(file),
      segment,
      this.standalone,
      undefined,
      this.hiraganaDictionary,
      undefined,
      repairs,
    );
    const next = rankSalient(tokens, topN, this.baselineDf, this.totalNotes);
    addHiraganaRepairSalient(
      next,
      tokens,
      repairs,
      this.hiraganaDictionary,
      this.df,
      this.totalNotes,
    );
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
    const nextStandalone = new Set<string>();
    const nextHiraganaDictionary = new Set<string>();
    const perFileTokens = new Map<string, Map<string, number>>();
    const perFileHiraganaRepairs = new Map<string, Map<string, number>>();

    // Pass 1: one read AND one scan per note. Tokenize ungated (the standalone
    // set isn't complete yet, so interior sub-units can't be filtered here) and
    // harvest the standalone-word units from the same matchAll via the fourth
    // arg — no separate corpus pass over the body.
    const CHUNK = 32;
    for (let i = 0; i < files.length; i += CHUNK) {
      await Promise.all(
        files.slice(i, i + CHUNK).map(async (f) => {
          // A single file's read failing (permission error, race with a
          // delete mid-rebuild, etc.) must not abort the whole rebuild — it
          // just drops that note from this corpus generation, same as if it
          // were empty. Errors are logged, not swallowed silently.
          try {
            const body = await this.app.vault.cachedRead(f);
            const repairs = new Map<string, number>();
            const tokens = tokenize(
              body,
              segment,
              undefined,
              nextStandalone,
              undefined,
              nextHiraganaDictionary,
              repairs,
            );
            if (tokens.size !== 0) perFileTokens.set(f.path, tokens);
            if (repairs.size !== 0) perFileHiraganaRepairs.set(f.path, repairs);
          } catch (err) {
            console.error(
              `Suggested Notes: failed to read "${f.path}" during body-token rebuild, skipping it`,
              err,
            );
          }
        }),
      );
      await yieldToEventLoop(); // keep large / mobile vaults responsive
    }

    // Pass 2: the standalone set is now final, so gate each note's interior
    // sub-units (drop morpheme-straddling kanji 2-grams like 本語 / 員何 and
    // never-standalone katakana sub-words) and build df over the gated tokens.
    // Gating in place avoids a second read of every note; it is equivalent to
    // tokenize()'s standalone gate — a full run is always in nextStandalone (it
    // was harvested above), so only never-standalone interior sub-units drop.
    // df stays a presence count (0/1 per note) — TF (the per-note occurrence
    // counts tokenize() returns) only feeds salience ranking below, never df.
    const nextBaselineDf = new Map<string, number>();
    for (const tokens of perFileTokens.values()) {
      for (const t of tokens.keys()) {
        if (isInteriorArtifact(t, nextStandalone)) {
          tokens.delete(t);
          continue;
        }
        nextBaselineDf.set(t, (nextBaselineDf.get(t) ?? 0) + 1);
      }
    }
    for (const repairs of perFileHiraganaRepairs.values()) {
      for (const t of [...repairs.keys()]) {
        if (!nextHiraganaDictionary.has(t)) repairs.delete(t);
      }
    }
    for (const [path, tokens] of perFileTokens) {
      if (tokens.size === 0) perFileTokens.delete(path);
    }
    for (const [path, repairs] of perFileHiraganaRepairs) {
      if (repairs.size === 0) perFileHiraganaRepairs.delete(path);
    }

    // Scoring df is presence over the union of baseline and repair tokens.
    // Baseline ranking continues to use nextBaselineDf, keeping its salient
    // set byte-for-byte independent from the additive repair lane.
    const nextDf = new Map<string, number>();
    for (const path of perFileTokens.keys()) {
      const present = new Set(perFileTokens.get(path)?.keys());
      for (const t of perFileHiraganaRepairs.get(path)?.keys() ?? []) {
        present.add(t);
      }
      for (const t of present) nextDf.set(t, (nextDf.get(t) ?? 0) + 1);
    }

    // Derive the whole new corpus into locals first. The live corpus keeps
    // serving queries until the single swap at the end, so a refresh that
    // lands mid-rebuild (we yield below) never sees a half-built index.
    const totalNotes = perFileTokens.size;
    const nextSalient = new Map<string, Set<string>>();
    const nextInverted = new Map<string, Set<string>>();
    let processed = 0;
    for (const [path, tokens] of perFileTokens) {
      // Preserve baseline ranking against baseline statistics; then add a
      // small independent hiragana concept lane.
      const baselineSalient = rankSalient(
        tokens,
        topN,
        nextBaselineDf,
        totalNotes,
      );
      addHiraganaRepairSalient(
        baselineSalient,
        tokens,
        perFileHiraganaRepairs.get(path) ?? EMPTY_MAP,
        nextHiraganaDictionary,
        nextDf,
        totalNotes,
      );
      nextSalient.set(path, baselineSalient);
      for (const t of baselineSalient) {
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
    this.baselineDf = nextBaselineDf;
    this.standalone = nextStandalone;
    this.hiraganaDictionary = nextHiraganaDictionary;
    this.totalNotes = totalNotes;
    this.salient = nextSalient;
    this.inverted = nextInverted;
    this.idfCache.clear();
    this.built = true;
  }
}

// An interior sub-unit that never appears as a standalone word is pure noise:
// it only re-matches the compound the full run already matches. Two shapes —
// a length-2 kanji 2-gram straddling a morpheme boundary (本語 from 日本語, 員何
// from 全員何も), or a katakana sub-word that never stands alone (the cross-
// morpheme fragments of リチウムバッテリー). A genuine full run is always in the
// standalone set (self-harvested), so it survives. Mirrors tokenize()'s gate
// for the query side.
function isInteriorArtifact(token: string, standalone: Set<string>): boolean {
  if (/^[一-龥々]{2}$/.test(token)) return !standalone.has(token);
  if (/^[ァ-ヶー]+$/.test(token)) return !standalone.has(token);
  return false;
}

function isHiraganaToken(token: string): boolean {
  return /^[ぁ-んー]+$/.test(token);
}

const HIRAGANA_REPAIR_TOP_N = 20;
const HIRAGANA_REPAIR_DF_MAX = 10;

// Additive concept lane: a repaired occurrence in one note must be able to
// match a normal segmenter occurrence in another. Build that lane from both
// sources, rank it independently, then union it into the immutable baseline
// salient set. This can add candidate pairs but cannot remove baseline pairs.
function addHiraganaRepairSalient(
  into: Set<string>,
  baselineTokens: Map<string, number>,
  repairTokens: Map<string, number>,
  dictionary: Set<string>,
  combinedDf: Map<string, number>,
  totalNotes: number,
): void {
  const concepts = new Map<string, number>();
  for (const [t, tf] of baselineTokens) {
    if (
      isHiraganaToken(t) &&
      dictionary.has(t) &&
      (combinedDf.get(t) ?? 0) <= HIRAGANA_REPAIR_DF_MAX
    ) {
      concepts.set(t, tf);
    }
  }
  for (const [t, tf] of repairTokens) {
    if ((combinedDf.get(t) ?? 0) <= HIRAGANA_REPAIR_DF_MAX) {
      concepts.set(t, (concepts.get(t) ?? 0) + tf);
    }
  }
  const repairSalient = rankSalient(
    concepts,
    HIRAGANA_REPAIR_TOP_N,
    combinedDf,
    totalNotes,
    0,
    0,
  );
  for (const t of repairSalient) into.add(t);
}

// Low-df reserve: after the top-N cut, a small extra allowance for the note's
// rarest eligible tokens (df <= RESERVE_DF_MAX) that the cut evicted. A long,
// vocabulary-rich note can push a genuinely rare shared word out of its top-N
// when high-TF mid-frequency words fill the budget (body-recall-hiragana-
// decision-2026-07-22.md, mechanism 2). The reserve recovers those without
// enlarging the budget for common words. It is *purely additive* — the
// returned set is always a superset of the top-N — so it can only add shared
// candidate pairs, never remove one (non-destructive by construction, since it
// touches neither df nor totalNotes, which are fixed before ranking).
const RESERVE_DF_MAX = 10;
const RESERVE_SIZE = 20;

// Rank a note's tokens (with their in-body occurrence counts) against the
// given doc-freq table and keep the top-N by log(1+TF) * IDF, so a token the
// note repeats beats an equally-rare token it only mentions once (design-
// review-2026-07-02 #5) while df/IDF themselves stay presence-based (0/1 per
// note) — TF only decides which tokens make the cut, not what "rare" means.
// Plus a bounded low-df reserve (see RESERVE_DF_MAX above). Pure: used both for
// corpus builds (against the under-construction df) and for live queries
// (against the current corpus df). Exported for direct unit testing.
export function rankSalient(
  tokens: Map<string, number>,
  topN: number,
  df: Map<string, number>,
  totalNotes: number,
  reserveDfMax = RESERVE_DF_MAX,
  reserveSize = RESERVE_SIZE,
): Set<string> {
  const maxDf = Math.max(2, Math.floor(totalNotes * 0.4));
  const ranked: Array<{ t: string; n: number; score: number }> = [];
  for (const [t, tf] of tokens) {
    const n = df.get(t) ?? 0;
    if (n < 2) continue; // singletons can't produce shared signal
    if (n > maxDf) continue; // stop-word-like
    const idf = Math.log(totalNotes / n);
    ranked.push({ t, n, score: Math.log(1 + tf) * idf });
  }
  ranked.sort((a, b) => b.score - a.score);

  const set = new Set<string>();
  for (const r of ranked.slice(0, topN)) set.add(r.t);
  // Reserve pass over the tokens the top-N cut evicted (already score-sorted,
  // so the most salient rare ones come first): keep only the genuinely rare
  // (df <= reserveDfMax), up to reserveSize. Adds to the top-N set, never
  // removes from it.
  let reserved = 0;
  for (let i = topN; i < ranked.length && reserved < reserveSize; i++) {
    if (ranked[i].n > reserveDfMax) continue;
    set.add(ranked[i].t);
    reserved++;
  }
  return set;
}

const EMPTY: Set<string> = new Set();
const EMPTY_MAP: Map<string, number> = new Map();

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
