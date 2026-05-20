export interface PluginSettings {
  maxResults: number;

  outlinkWeight: number;
  tagWeight: number;
  backlinkWeight: number;
  folderWeight: number;

  bodyTokenEnabled: boolean;
  bodyTokenWeight: number;
  bodyTokenTopN: number;

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

  bodyTokenEnabled: true,
  bodyTokenWeight: 1.5,
  bodyTokenTopN: 40,

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

export interface SuggestedTag {
  tag: string;
  weight: number;
  fromCount: number;
}
