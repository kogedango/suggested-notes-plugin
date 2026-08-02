export interface PluginSettings {
  maxResults: number;
  // Restrict candidates to the active note's first path segment. Notes at
  // the vault root form their own group.
  sameRootFolderOnly: boolean;

  outlinkWeight: number;
  tagWeight: number;
  backlinkWeight: number;
  // Flat weight (no IDF) added when the candidate links to the active note
  // but the active note doesn't link back — distinct from `backlinkWeight`,
  // which scores *shared* backlinks (co-citation from a third note).
  directLinkWeight: number;
  // Flat weight for an exact plain-text mention of the candidate's full title
  // in the active body, excluding existing links and non-prose structures.
  unlinkedMentionWeight: number;
  folderWeight: number;
  // Title tokens and salient body tokens form one content-token set. A token
  // present in both fields contributes only once.
  contentWeight: number;

  bodyTokenEnabled: boolean;
  bodyTokenTopN: number;
  // NFKC-normalized vault terms protected before language routing. Each line
  // may be `canonical|alias|alias`; every spelling emits the first one.
  // Longest match wins, so terms Kuromoji would split remain one token.
  customVocabulary: string[];

  showScores: boolean;
  showSharedReasons: boolean;
  hideAlreadyLinked: boolean;

  excludedFolders: string[];
  excludedTags: string[];
  excludedLinks: string[];
  // Content-token exclusions: words (e.g. recurring heading/title words like
  // コメント / 結果) that should never count as shared lexical evidence.
  excludedContentTokens: string[];
}

export const DEFAULT_SETTINGS: PluginSettings = {
  maxResults: 20,
  sameRootFolderOnly: false,

  outlinkWeight: 8,
  tagWeight: 5,
  backlinkWeight: 4,
  directLinkWeight: 6,
  unlinkedMentionWeight: 8,
  folderWeight: 0,
  contentWeight: 1.5,

  bodyTokenEnabled: true,
  bodyTokenTopN: 40,
  customVocabulary: [],

  showScores: true,
  showSharedReasons: true,
  hideAlreadyLinked: false,

  excludedFolders: [],
  excludedTags: [],
  excludedLinks: [],
  excludedContentTokens: [],
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
  // Union of title tokens and (when enabled) salient body tokens. The same
  // canonical token appears at most once even if both fields contain it.
  sharedContentTokens: string[];
  mentionsCandidateTitle: boolean;
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
