export interface PluginSettings {
  maxResults: number;

  outlinkWeight: number;
  tagWeight: number;
  backlinkWeight: number;
  folderWeight: number;

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
}

export const DEFAULT_SETTINGS: PluginSettings = {
  maxResults: 20,

  outlinkWeight: 8,
  tagWeight: 5,
  backlinkWeight: 4,
  folderWeight: 0,

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
