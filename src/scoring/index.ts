import type { BodyTokenIndex } from "../cache/bodyTokens";
import type { InvertedIndex } from "../cache/inverted";
import type { SnapshotReader } from "../cache/store";
import type {
  FileSnapshot,
  PluginSettings,
  ScoreResult,
  ScoredCandidate,
  SharedReasons,
  SuggestedTag,
} from "../types";
import {
  isExcludedByFolder,
  normalizeBodyTokenSet,
  normalizeLinkSet,
  normalizeTagSet,
} from "../util/normalize";
import { basename } from "../util/path";
import { IDFTables } from "./idf";
import { outlinkCountPenalty } from "./penalties";

const EMPTY_TOKENS: Set<string> = new Set();

// Backlink sources with more outlinks than this look like MOC/index notes —
// their outlink lists aren't a meaningful "these two are related" signal, so
// candidate expansion doesn't follow them (mirrors the outlink-count penalty
// used elsewhere to suppress MOC dominance).
const FOCUSED_SOURCE_MAX_OUTLINKS = 20;

export class ScoringEngine {
  private idf: IDFTables;

  constructor(
    private store: SnapshotReader,
    private inverted: InvertedIndex,
    private body: BodyTokenIndex,
  ) {
    this.idf = new IDFTables(store, inverted);
  }

  markDirty(): void {
    this.idf.markDirty();
  }

  // `activeBodyTokens` is the active note's freshly-computed salient set
  // (empty when body matching is off or the corpus isn't built yet). The
  // caller computes it on demand; scoring only consumes the corpus here.
  score(
    activePath: string,
    settings: PluginSettings,
    activeBodyTokens: Set<string>,
  ): ScoreResult {
    const active = this.store.get(activePath);
    if (!active) return { results: [], tagPool: [] };

    const excludedTags = normalizeTagSet(settings.excludedTags);
    const excludedLinks = normalizeLinkSet(settings.excludedLinks);
    const useBody = settings.bodyTokenEnabled && activeBodyTokens.size > 0;
    const excludedBody =
      useBody && settings.excludedBodyTokens.length > 0
        ? normalizeBodyTokenSet(
            settings.excludedBodyTokens,
            settings.bodyTokenSegmenterEnabled,
          )
        : EMPTY_TOKENS;

    const candidates = new Set<string>();

    // Adds every file in `files` except the active note itself. Shared by
    // every candidate source below, whether the files come straight from a
    // set on the active note (backlinks, outlinks) or from an inverted-index
    // lookup.
    const addCandidates = (files: Iterable<string>): void => {
      for (const p of files) {
        if (p !== activePath) candidates.add(p);
      }
    };
    // Shared shape for sources that fan out through an index: iterate the
    // active note's own keys (tags / outlinks / body tokens / backlink
    // sources), skip excluded/disqualified keys, and pull in whatever files
    // that key maps to. A future signal (e.g. title tokens) is one more call
    // to this, not a new loop shape.
    const addCandidatesByKey = (
      keys: Iterable<string>,
      isExcluded: (key: string) => boolean,
      filesForKey: (key: string) => Iterable<string>,
    ): void => {
      for (const key of keys) {
        if (isExcluded(key)) continue;
        addCandidates(filesForKey(key));
      }
    };

    addCandidatesByKey(
      active.tags,
      (t) => excludedTags.has(t),
      (t) => this.inverted.filesWithTag(t),
    );
    addCandidatesByKey(
      active.outlinks,
      (l) => excludedLinks.has(basename(l)),
      (l) => this.inverted.filesLinkingTo(l),
    );
    addCandidates(active.backlinks);
    // Item 2: notes co-cited from a "focused" hub are discoverable even
    // without a shared tag/link of their own. A hub with too many outlinks
    // (MOC/index) is skipped; sharedBacklinks scoring (already weighted by
    // source specificity) naturally scores whatever surfaces here.
    addCandidatesByKey(
      active.backlinks,
      (src) => {
        const source = this.store.get(src);
        return !source || source.outlinkCount > FOCUSED_SOURCE_MAX_OUTLINKS;
      },
      (src) => this.store.get(src)!.outlinks,
    );
    addCandidates(active.outlinks);
    // Item 7: folderWeight only ever scored same-folder notes that were
    // already candidates via another signal; discover them directly, but
    // only when the setting is actually in use (default 0 -> no change).
    if (settings.folderWeight > 0) {
      addCandidates(this.inverted.filesInFolder(active.folder));
    }
    if (useBody) {
      addCandidatesByKey(
        activeBodyTokens,
        (tok) => excludedBody.has(tok),
        (tok) => this.body.filesWithToken(tok),
      );
    }

    const scored: Array<{
      snap: FileSnapshot;
      raw: number;
      reasons: SharedReasons;
    }> = [];

    for (const path of candidates) {
      const snap = this.store.get(path);
      if (!snap) continue;
      if (isExcludedByFolder(snap.folder, settings.excludedFolders)) continue;

      const reasons = this.computeReasons(
        active,
        snap,
        excludedTags,
        excludedLinks,
        useBody ? activeBodyTokens : EMPTY_TOKENS,
        excludedBody,
      );
      const raw = this.rawScore(snap, reasons, settings, snap.folder === active.folder);
      if (raw <= 0) continue;
      scored.push({ snap, raw, reasons });
    }

    if (scored.length === 0) return { results: [], tagPool: [] };

    const top = scored.reduce((m, s) => (s.raw > m ? s.raw : m), 0) || 1;
    const sorted: ScoredCandidate[] = scored
      .map((s) => ({
        path: s.snap.path,
        rawScore: s.raw,
        displayScore: Math.round((s.raw / top) * 100),
        reasons: s.reasons,
        alreadyLinked: active.outlinks.has(s.snap.path),
      }))
      .sort((a, b) => b.rawScore - a.rawScore);

    // Tag mining draws from the top relevant neighbours including
    // already-linked ones; `hideAlreadyLinked` only declutters the list.
    const tagPool = sorted.slice(0, settings.maxResults);
    const results = (
      settings.hideAlreadyLinked
        ? sorted.filter((c) => !c.alreadyLinked)
        : sorted
    ).slice(0, settings.maxResults);

    return { results, tagPool };
  }

  // Item 3: candidate-pool Jaccard-style coverage × IDF.
  // For each tag T not on the active note, score by
  //   coverage(T) * idf(T) * avgNoteScore(T)
  // where coverage is the fraction of top-K pool notes that carry T.
  // `pool` is the tag-mining set (top neighbours regardless of
  // `hideAlreadyLinked`), not the displayed list — so hiding a linked note
  // from the list does not drop its tags from suggestions.
  // Filters: must appear in >=2 pool notes AND have global df >=3
  // (kills typos and one-off tags).
  // `limit` (12) caps the chip row so the tags section stays a glanceable
  // strip above the results list; deliberately not a user setting.
  suggestTags(
    activePath: string,
    pool: ScoredCandidate[],
    settings: PluginSettings,
    limit = 12,
  ): SuggestedTag[] {
    const active = this.store.get(activePath);
    if (!active || pool.length === 0) return [];

    const excluded = normalizeTagSet(settings.excludedTags);
    const total = pool.length;
    const maxRaw =
      pool.reduce((m, r) => (r.rawScore > m ? r.rawScore : m), 0) || 1;

    const agg = new Map<
      string,
      { count: number; weightSum: number }
    >();

    for (const r of pool) {
      const snap = this.store.get(r.path);
      if (!snap) continue;
      const noteWeight = r.rawScore / maxRaw;
      for (const t of snap.tags) {
        if (active.tags.has(t)) continue;
        if (excluded.has(t)) continue;
        const idf = this.idf.tag(t);
        if (idf <= 0) continue;
        // Global rarity guard: ignore typos / one-off tags. With the existing
        // tag inverted index, df=1 means only this candidate uses it.
        if (this.inverted.notesWithTagCount(t) < 3) continue;
        const cur = agg.get(t);
        if (cur) {
          cur.count += 1;
          cur.weightSum += noteWeight;
        } else {
          agg.set(t, { count: 1, weightSum: noteWeight });
        }
      }
    }

    const out: SuggestedTag[] = [];
    for (const [tag, v] of agg) {
      if (v.count < 2) continue; // must co-occur in >=2 pool notes
      const coverage = v.count / total;
      const avgWeight = v.weightSum / v.count;
      const score = coverage * this.idf.tag(tag) * avgWeight;
      out.push({ tag, weight: score, fromCount: v.count });
    }
    return out.sort((a, b) => b.weight - a.weight).slice(0, limit);
  }

  // Exclusion sets are normalized once per score() call and passed in —
  // recomputing them here would cost O(candidates × excluded-list length).
  private computeReasons(
    a: FileSnapshot,
    b: FileSnapshot,
    excludedTags: Set<string>,
    excludedLinks: Set<string>,
    activeBodyTokens: Set<string>,
    excludedBody: Set<string>,
  ): SharedReasons {
    const sharedTags: string[] = [];
    for (const t of a.tags) {
      if (excludedTags.has(t)) continue;
      if (b.tags.has(t)) sharedTags.push(t);
    }
    const sharedOutlinks: string[] = [];
    for (const l of a.outlinks) {
      if (excludedLinks.has(basename(l))) continue;
      if (b.outlinks.has(l)) sharedOutlinks.push(l);
    }
    const sharedBacklinks: string[] = [];
    for (const bl of a.backlinks) {
      if (b.backlinks.has(bl)) sharedBacklinks.push(bl);
    }
    const sharedBodyTokens: string[] = [];
    if (activeBodyTokens.size > 0) {
      const bTokens = this.body.salientFor(b.path);
      if (bTokens.size > 0) {
        for (const tok of activeBodyTokens) {
          if (excludedBody.has(tok)) continue;
          if (bTokens.has(tok)) sharedBodyTokens.push(tok);
        }
      }
    }
    // Item 1: the direct, asymmetric link signal — b links to a AND a hasn't
    // linked back yet. A mutual pair is excluded: the point of this signal is
    // surfacing link-back opportunities, and the UI copy ("not linked back
    // yet") depends on the asymmetry. Distinct from sharedBacklinks'
    // co-citation.
    const linksToActive = a.backlinks.has(b.path) && !a.outlinks.has(b.path);
    return {
      sharedTags,
      sharedOutlinks,
      sharedBacklinks,
      sharedBodyTokens,
      linksToActive,
    };
  }

  private rawScore(
    b: FileSnapshot,
    r: SharedReasons,
    settings: PluginSettings,
    sameFolder: boolean,
  ): number {
    let s = 0;
    for (const t of r.sharedTags) s += settings.tagWeight * this.idf.tag(t);
    for (const l of r.sharedOutlinks)
      s += settings.outlinkWeight * this.idf.link(l);
    // Weight each shared backlink by the source's specificity: a co-citation
    // from a focused note is a stronger relatedness signal than one from a
    // MOC/index that links to everything. Reuses the outlink-count penalty on
    // the source note (few outlinks -> weight ~1, many -> approaches 0).
    for (const src of r.sharedBacklinks) {
      const source = this.store.get(src);
      const weight = source ? 1 / outlinkCountPenalty(source.outlinkCount) : 1;
      s += settings.backlinkWeight * weight;
    }
    // Item 1: flat add, no IDF/specificity factor — the final
    // outlinkCountPenalty(b.outlinkCount) division already suppresses
    // MOC-like candidates.
    if (r.linksToActive) s += settings.directLinkWeight;
    if (settings.folderWeight > 0 && sameFolder) {
      s += settings.folderWeight;
    }
    if (settings.bodyTokenEnabled) {
      for (const tok of r.sharedBodyTokens)
        s += settings.bodyTokenWeight * this.body.idf(tok);
    }
    return s / outlinkCountPenalty(b.outlinkCount);
  }
}
