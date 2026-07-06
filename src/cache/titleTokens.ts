import { basename } from "../util/path";
import { tokenize } from "../util/tokenize";
import type { SnapshotReader } from "./store";

const EMPTY: Set<string> = new Set();

// Title-token signal (plan C): shared filename words. Metadata-only (reads
// only `FileSnapshot.path`, never a note body) and on by default — unlike
// bodyTokenEnabled, there is no toggle to turn this off; `titleWeight` is
// the only knob.
//
// Unlike BodyTokenIndex, there's no corpus/query split here: a basename is
// already sitting in every FileSnapshot's path, so there is no I/O to defer
// or a "live query" to compute — every lookup below is just a read from the
// one corpus, built lazily.
//
// Maintenance is a dirty-flag + full-rebuild-on-next-read, the same lazy
// pattern IDFTables already uses for tag/link IDF — not truly incremental
// per-note updates. A genuinely incremental design would have to re-derive
// the standalone-word set (below) on every add/rename/delete, since a single
// renamed title can introduce or remove a standalone unit that gates OTHER
// titles' interior sub-tokens — exactly the kind of cross-note dependency
// that df/standalone freezing exists to avoid elsewhere in this codebase.
// Titles are short strings, so re-tokenizing the whole title corpus is cheap;
// the full-rebuild fallback the body-token corpus reserves for expensive file
// I/O is the simple, obviously-correct choice here.
export class TitleTokenIndex {
  private dirty = true;
  // path -> that note's title tokens (gated by the title corpus's own
  // standalone set, independent of the body-token corpus's).
  private tokens = new Map<string, Set<string>>();
  // title token -> paths whose title contains it.
  private inverted = new Map<string, Set<string>>();
  // Doc-freq over title tokens, presence-based (0/1 per note), drives IDF.
  private df = new Map<string, number>();
  private totalNotes = 0;
  private idfCache = new Map<string, number>();

  constructor(private store: SnapshotReader) {}

  markDirty(): void {
    this.dirty = true;
  }

  tokensFor(path: string): Set<string> {
    this.ensureFresh();
    return this.tokens.get(path) ?? EMPTY;
  }

  filesWithToken(token: string): Set<string> {
    this.ensureFresh();
    return this.inverted.get(token) ?? EMPTY;
  }

  notesWithTokenCount(token: string): number {
    this.ensureFresh();
    return this.df.get(token) ?? 0;
  }

  totalNotesCount(): number {
    this.ensureFresh();
    return this.totalNotes;
  }

  idf(token: string): number {
    this.ensureFresh();
    const cached = this.idfCache.get(token);
    if (cached !== undefined) return cached;
    const n = this.df.get(token) ?? 0;
    const v = n > 0 && this.totalNotes > 0 ? Math.log(this.totalNotes / n) : 0;
    this.idfCache.set(token, v);
    return v;
  }

  private ensureFresh(): void {
    if (!this.dirty) return;
    this.rebuild();
    this.dirty = false;
  }

  // Two passes over every title, mirroring BodyTokenIndex.rebuildAll's shape
  // (minus the async I/O, since a basename needs no file read):
  //   Pass 1 harvests the title corpus's own standalone-word set (kanji
  //   2-grams / katakana words that occur as a title on their own somewhere
  //   in the vault) — this is what keeps morpheme-straddling 2-grams like
  //   本語 out of "日本語入門" without also losing 日本 as a shared word with
  //   "日本の歴史".
  //   Pass 2 tokenizes each title again, this time gated by that now-final
  //   standalone set, and builds df/inverted off the gated token sets.
  // `segment` is always false: TinySegmenter is tuned for prose (okurigana,
  // hiragana words) and a title is one short noun-phrase-like string, not a
  // sentence — a hiragana-only title (already a known gap; the script-run
  // regex needs kanji/katakana/ascii to fire) would need segmenter support to
  // recover, which is out of scope for this pass. Titles are also indexed
  // regardless of bodyTokenSegmenterEnabled, so query/corpus can't drift.
  private rebuild(): void {
    const standalone = new Set<string>();
    for (const snap of this.store.all()) {
      tokenize(basename(snap.path), false, undefined, standalone);
    }

    const tokens = new Map<string, Set<string>>();
    const inverted = new Map<string, Set<string>>();
    const df = new Map<string, number>();
    let totalNotes = 0;
    for (const snap of this.store.all()) {
      totalNotes++;
      const tf = tokenize(basename(snap.path), false, standalone);
      const set = new Set(tf.keys());
      tokens.set(snap.path, set);
      for (const tok of set) {
        df.set(tok, (df.get(tok) ?? 0) + 1);
        let inv = inverted.get(tok);
        if (!inv) {
          inv = new Set();
          inverted.set(tok, inv);
        }
        inv.add(snap.path);
      }
    }

    this.tokens = tokens;
    this.inverted = inverted;
    this.df = df;
    this.totalNotes = totalNotes;
    this.idfCache.clear();
  }
}
