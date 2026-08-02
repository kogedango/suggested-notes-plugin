import type { BodyTokenIndex } from "../cache/bodyTokens";
import type { InvertedIndex } from "../cache/inverted";
import type { SnapshotReader } from "../cache/store";
import type { TitleTokenIndex } from "../cache/titleTokens";
import type { TokenCounter } from "../analysis/types";
import { TitleMentionIndex } from "../analysis/titleMentions";
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
  normalizeContentTokenSet,
  normalizeLinkSet,
  normalizeTagSet,
} from "../util/normalize";
import { basename, rootFolder } from "../util/path";
import { inverseDocumentFrequency } from "../util/idf";
import { IDFTables } from "./idf";
import { outlinkCountPenalty } from "./penalties";

const EMPTY_TOKENS: Set<string> = new Set();

// Avoid expanding candidates through broad MOC/index notes.
const FOCUSED_SOURCE_MAX_OUTLINKS = 20;

// Common words may score candidates but do not expand the candidate pool.
const CONTENT_TOKEN_EXPANSION_MAX_DF_RATIO = 0.4;

export class ScoringEngine {
  private idf: IDFTables;
  private body?: BodyTokenIndex;
  private titles?: TitleTokenIndex;
  private analyzer?: TokenCounter;
  private titleMentions = new TitleMentionIndex();

  constructor(
    private store: SnapshotReader,
    private inverted: InvertedIndex,
    body?: BodyTokenIndex,
    titles?: TitleTokenIndex,
    analyzer?: TokenCounter,
  ) {
    this.idf = new IDFTables(store, inverted);
    this.titleMentions.rebuild(store.all());
    if (body && titles && analyzer) this.attachMorphology(body, titles, analyzer);
  }

  rebuildTitleMentionIndex(): void {
    this.titleMentions.rebuild(this.store.all());
  }

  addTitleMentionPath(path: string): void {
    this.titleMentions.add(path);
  }

  removeTitleMentionPath(path: string): void {
    this.titleMentions.remove(path);
  }

  renameTitleMentionPath(oldPath: string, newPath: string): void {
    this.titleMentions.rename(oldPath, newPath);
  }

  attachMorphology(
    body: BodyTokenIndex,
    titles: TitleTokenIndex,
    analyzer: TokenCounter,
  ): void {
    this.attachCachedMorphology(body, titles);
    this.analyzer = analyzer;
  }

  attachCachedMorphology(
    body: BodyTokenIndex,
    titles: TitleTokenIndex,
  ): void {
    this.body = body;
    this.titles = titles;
  }

  markDirty(): void {
    this.idf.markDirty();
  }

  score(
    activePath: string,
    settings: PluginSettings,
    activeBodyTokens: ReadonlySet<string>,
    activeBodyText = "",
  ): ScoreResult {
    const active = this.store.get(activePath);
    if (!active) return { results: [], tagPool: [] };

    const activeRootFolder = rootFolder(activePath);
    const excludedTags = normalizeTagSet(settings.excludedTags);
    const excludedLinks = normalizeLinkSet(settings.excludedLinks);
    // Exclusions require the analyzer for canonical matching.
    const contentReady =
      settings.excludedContentTokens.length === 0 || !!this.analyzer;
    const useBody =
      contentReady &&
      !!this.body &&
      settings.bodyTokenEnabled &&
      this.body.isBuilt();
    const excludedContent =
      this.analyzer &&
      settings.excludedContentTokens.length > 0
        ? normalizeContentTokenSet(
            settings.excludedContentTokens,
            this.analyzer,
          )
        : EMPTY_TOKENS;
    const activeContentTokens = contentReady
      ? this.contentTokensFor(
          activePath,
          useBody ? activeBodyTokens : EMPTY_TOKENS,
        )
      : EMPTY_TOKENS;
    const contentIdf = new Map<string, number>();
    const mentionedTitlePaths =
      settings.unlinkedMentionWeight > 0 && activeBodyText
        ? this.titleMentions.find(
            activeBodyText,
            activePath,
            active.outlinks,
          )
        : EMPTY_TOKENS;

    const candidates = new Set<string>();

    const addCandidates = (files: Iterable<string>): void => {
      for (const p of files) {
        if (p !== activePath) candidates.add(p);
      }
    };
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
    // Discover co-cited notes through focused backlink sources.
    addCandidatesByKey(
      active.backlinks,
      (src) => {
        const source = this.store.get(src);
        return !source || source.outlinkCount > FOCUSED_SOURCE_MAX_OUTLINKS;
      },
      (src) => this.store.get(src)!.outlinks,
    );
    addCandidates(active.outlinks);
    addCandidates(mentionedTitlePaths);
    if (settings.folderWeight > 0) {
      addCandidates(this.inverted.filesInFolder(active.folder));
    }
    // Titles and salient bodies form one lexical field.
    if (settings.contentWeight > 0 && activeContentTokens.size > 0) {
      const total = this.store.size();
      for (const tok of activeContentTokens) {
        if (excludedContent.has(tok)) continue;
        const df = this.contentDocumentFrequency(tok, useBody);
        contentIdf.set(
          tok,
          inverseDocumentFrequency(total, df),
        );
        if (
          total > 0 &&
          df > CONTENT_TOKEN_EXPANSION_MAX_DF_RATIO * total
        ) {
          continue;
        }
        // Do not materialize a merged posting list: both sources are only
        // iterated, and the candidates Set already performs the union.
        addCandidates(this.titles?.filesWithToken(tok) ?? EMPTY_TOKENS);
        if (useBody) {
          addCandidates(this.body?.filesWithToken(tok) ?? EMPTY_TOKENS);
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
      if (
        settings.sameRootFolderOnly &&
        rootFolder(snap.path) !== activeRootFolder
      ) {
        continue;
      }
      if (isExcludedByFolder(snap.folder, settings.excludedFolders)) continue;

      const reasons = this.computeReasons(
        active,
        snap,
        excludedTags,
        excludedLinks,
        activeContentTokens,
        excludedContent,
        useBody,
        mentionedTitlePaths,
      );
      reasons.sharedContentTokens.sort(
        (left, right) =>
          (contentIdf.get(right) ?? 0) - (contentIdf.get(left) ?? 0),
      );
      const raw = this.rawScore(
        snap,
        reasons,
        settings,
        snap.folder === active.folder,
        contentIdf,
      );
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

    // Hiding linked notes does not remove them from tag mining.
    const tagPool = sorted.slice(0, settings.maxResults);
    const results = (
      settings.hideAlreadyLinked
        ? sorted.filter((c) => !c.alreadyLinked)
        : sorted
    ).slice(0, settings.maxResults);

    return { results, tagPool };
  }

  // score = pool coverage × global IDF × average neighbour score
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
        // Suppress globally rare typos and one-off tags.
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
      if (v.count < 2) continue;
      const coverage = v.count / total;
      const avgWeight = v.weightSum / v.count;
      const score = coverage * this.idf.tag(tag) * avgWeight;
      out.push({ tag, weight: score, fromCount: v.count });
    }
    return out.sort((a, b) => b.weight - a.weight).slice(0, limit);
  }

  private computeReasons(
    a: FileSnapshot,
    b: FileSnapshot,
    excludedTags: Set<string>,
    excludedLinks: Set<string>,
    activeContentTokens: ReadonlySet<string>,
    excludedContent: Set<string>,
    useBody: boolean,
    mentionedTitlePaths: ReadonlySet<string>,
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
    const sharedContentTokens: string[] = [];
    if (activeContentTokens.size > 0) {
      const candidateTitleTokens =
        this.titles?.tokensFor(b.path) ?? EMPTY_TOKENS;
      const candidateBodyTokens = useBody
        ? this.body?.salientFor(b.path) ?? EMPTY_TOKENS
        : EMPTY_TOKENS;
      for (const tok of activeContentTokens) {
        if (excludedContent.has(tok)) continue;
        if (
          candidateTitleTokens.has(tok) ||
          candidateBodyTokens.has(tok)
        ) {
          sharedContentTokens.push(tok);
        }
      }
    }
    // Only asymmetric links represent a link-back opportunity.
    const linksToActive = a.backlinks.has(b.path) && !a.outlinks.has(b.path);
    const mentionsCandidateTitle = mentionedTitlePaths.has(b.path);
    return {
      sharedTags,
      sharedOutlinks,
      sharedBacklinks,
      sharedContentTokens,
      linksToActive,
      mentionsCandidateTitle,
    };
  }

  private rawScore(
    b: FileSnapshot,
    r: SharedReasons,
    settings: PluginSettings,
    sameFolder: boolean,
    contentIdf: ReadonlyMap<string, number>,
  ): number {
    let s = 0;
    for (const t of r.sharedTags) s += settings.tagWeight * this.idf.tag(t);
    for (const l of r.sharedOutlinks)
      s += settings.outlinkWeight * this.idf.link(l);
    // Co-citation from a focused note is stronger than from a broad MOC.
    for (const src of r.sharedBacklinks) {
      const source = this.store.get(src);
      const weight = source ? 1 / outlinkCountPenalty(source.outlinkCount) : 1;
      s += settings.backlinkWeight * weight;
    }
    if (r.linksToActive) s += settings.directLinkWeight;
    if (r.mentionsCandidateTitle) s += settings.unlinkedMentionWeight;
    if (settings.folderWeight > 0 && sameFolder) {
      s += settings.folderWeight;
    }
    for (const tok of r.sharedContentTokens)
      s += settings.contentWeight * (contentIdf.get(tok) ?? 0);
    return s / outlinkCountPenalty(b.outlinkCount);
  }

  private contentTokensFor(
    path: string,
    bodyTokens: ReadonlySet<string>,
  ): ReadonlySet<string> {
    const titleTokens = this.titles?.tokensFor(path) ?? EMPTY_TOKENS;
    if (bodyTokens.size === 0) return titleTokens;
    return new Set([...titleTokens, ...bodyTokens]);
  }

  private contentDocumentFrequency(token: string, useBody: boolean): number {
    if (useBody) return this.body?.notesWithTokenCount(token) ?? 0;
    return this.titles?.notesWithTokenCount(token) ?? 0;
  }
}
