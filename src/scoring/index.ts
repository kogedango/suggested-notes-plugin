import type { BodyTokenIndex } from "../cache/bodyTokens";
import type { InvertedIndex } from "../cache/inverted";
import type { MetadataStore } from "../cache/metadata";
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
  normalizeLinkSet,
  normalizeTagSet,
} from "../util/normalize";
import { basename } from "../util/path";
import { IDFTables } from "./idf";
import { outlinkCountPenalty } from "./penalties";

const EMPTY_TOKENS: Set<string> = new Set();

export class ScoringEngine {
  private idf: IDFTables;

  constructor(
    private store: MetadataStore,
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

    const candidates = new Set<string>();

    for (const tag of active.tags) {
      if (excludedTags.has(tag)) continue;
      for (const p of this.inverted.filesWithTag(tag)) {
        if (p !== activePath) candidates.add(p);
      }
    }
    for (const link of active.outlinks) {
      if (excludedLinks.has(basename(link))) continue;
      for (const p of this.inverted.filesLinkingTo(link)) {
        if (p !== activePath) candidates.add(p);
      }
    }
    for (const p of active.backlinks) candidates.add(p);
    for (const p of active.outlinks) {
      if (p !== activePath) candidates.add(p);
    }
    if (useBody) {
      for (const tok of activeBodyTokens) {
        for (const p of this.body.filesWithToken(tok)) {
          if (p !== activePath) candidates.add(p);
        }
      }
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
          if (bTokens.has(tok)) sharedBodyTokens.push(tok);
        }
      }
    }
    return { sharedTags, sharedOutlinks, sharedBacklinks, sharedBodyTokens };
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
    s += settings.backlinkWeight * r.sharedBacklinks.length;
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
