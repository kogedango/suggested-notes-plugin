export interface PluginSettings {
  maxResults: number;

  outlinkWeight: number;
  tagWeight: number;
  backlinkWeight: number;
  // Flat weight (no IDF) added when the candidate links to the active note
  // but the active note doesn't link back — distinct from `backlinkWeight`,
  // which scores *shared* backlinks (co-citation from a third note).
  directLinkWeight: number;
  folderWeight: number;
  // Weight per shared filename (title) token, applied like tagWeight/
  // outlinkWeight (weight * IDF). Metadata-only, on by default — see
  // cache/titleTokens.ts. No enable/disable toggle; set to 0 to turn it off.
  titleWeight: number;

  bodyTokenEnabled: boolean;
  bodyTokenWeight: number;
  bodyTokenTopN: number;
  // Experimental: TinySegmenter-based Japanese word segmentation, picking up
  // okurigana-mixed (打ち合わせ) and hiragana-only (ひらめき) words the
  // script-run tokenizer cannot see. Offline, deterministic, opt-in.
  bodyTokenSegmenterEnabled: boolean;

  showScores: boolean;
  showSharedReasons: boolean;
  hideAlreadyLinked: boolean;

  excludedFolders: string[];
  excludedTags: string[];
  excludedLinks: string[];
  // Body-token stopwords: words (e.g. recurring heading words like コメント /
  // 結果) that should never count as a shared body signal. Normalized through
  // the same tokenizer the bodies use, so the entered word matches the token.
  excludedBodyTokens: string[];
}

export const DEFAULT_SETTINGS: PluginSettings = {
  maxResults: 20,

  outlinkWeight: 8,
  tagWeight: 5,
  backlinkWeight: 4,
  directLinkWeight: 6,
  folderWeight: 0,
  titleWeight: 3,

  bodyTokenEnabled: false,
  bodyTokenWeight: 1.5,
  bodyTokenTopN: 40,
  bodyTokenSegmenterEnabled: false,

  showScores: true,
  showSharedReasons: true,
  hideAlreadyLinked: false,

  excludedFolders: [],
  excludedTags: [],
  excludedLinks: [],
  excludedBodyTokens: [],
};

export interface FileSnapshot {
  path: string;
  tags: Set<string>;
  outlinks: Set<string>;
  backlinks: Set<string>;
  ctime: number;
  mtime: number;
  outlinkCount: number;
  folder: string;
}

export interface SharedReasons {
  sharedTags: string[];
  sharedOutlinks: string[];
  sharedBacklinks: string[];
  sharedBodyTokens: string[];
  sharedTitleTokens: string[];
  // B links to A (the active note) but A doesn't link back yet. Distinct
  // from `sharedBacklinks` (co-citation from a third note).
  linksToActive: boolean;
}

export interface ScoredCandidate {
  path: string;
  rawScore: number;
  displayScore: number;
  reasons: SharedReasons;
  alreadyLinked: boolean;
}

export interface ScoreResult {
  // What the related-notes list shows: respects `hideAlreadyLinked`.
  results: ScoredCandidate[];
  // What tag suggestions are mined from: the top relevant neighbours
  // regardless of `hideAlreadyLinked`. Already-linked notes are the
  // highest-confidence relevant neighbours, so they stay in the tag pool
  // even when hidden from the list.
  tagPool: ScoredCandidate[];
}

export interface SuggestedTag {
  tag: string;
  weight: number;
  fromCount: number;
}
