// Lightweight i18n: English is the source of truth; Japanese is a partial
// overlay that falls back to English for any key it doesn't (yet) translate.
// No build-time extraction, no ICU — just a flat string table plus
// "{param}" interpolation, which is all this plugin's UI needs.

export type Locale = "en" | "ja";

const en = {
  // Command palette / view chrome
  viewName: "Suggested Notes",
  commandOpenSidebar: "Open Suggested Notes sidebar",
  commandRebuildIndex: "Rebuild body-token index",

  // Settings tab — Max results
  settingMaxResults: "Max results",

  // Settings tab — Weights
  settingWeightsHeading: "Weights",
  settingWeightsDesc:
    "Each shared signal contributes weight × IDF to the score. " +
    "'Links to this note' is the exception — a flat weight (no IDF) for a single " +
    "asymmetric link: the candidate links here, but this note doesn't link back yet. " +
    "The total is then divided by log(1 + outlinkCount) of the candidate to suppress MOC / index notes. " +
    "Same folder defaults to 0 — folder co-location often means 'filed together', not 'topically related'. " +
    "Shared title words is on by default and metadata-only (filenames, not bodies) — " +
    "set it to 0 to turn it off.",
  weightOutlinks: "Shared outlinks",
  weightTags: "Shared tags",
  weightBacklinks: "Shared backlinks",
  weightDirectLink: "Links to this note",
  weightFolder: "Same folder",
  weightTitle: "Shared title words",

  // Settings tab — Body-token matching
  settingBodyTokenHeading: "Body-token matching",
  settingBodyTokenDesc:
    "Optional. Picks up notes that share rare vocabulary even without explicit tags or links. " +
    "Off by default: enabling reads every .md file once (async, ~10–20s for 5,000 notes) to build the index. " +
    "The active note is always re-read live, and an edited note's index entry updates as soon as the edit settles (~2s). " +
    "Whole-vault statistics rebuild lazily (~1 min after edits settle), " +
    "or immediately via the Rebuild button below / 'Rebuild body-token index' command. " +
    "For Japanese vaults, also enable Japanese word segmentation below.",
  settingBodyTokenEnable: "Enable body-token matching",
  settingSegmenterName:
    "Japanese word segmentation (recommended for Japanese vaults)",
  settingSegmenterDesc:
    "Splits Japanese text into words with TinySegmenter (offline, no dictionary) " +
    "so okurigana-mixed words like 打ち合わせ・読み込み and hiragana words like " +
    "ひらめき also count as shared vocabulary — without this, such words are " +
    "invisible to body-token matching. Changing this rebuilds the index.",
  settingBodyTokenWeight: "Body-token weight",
  settingTopN: "Salient tokens per note",
  descRebuildsIndex: "Changing this rebuilds the index.",
  settingRebuildNow: "Rebuild index now",
  descRebuildNow:
    "Re-reads every note and rebuilds the whole-vault statistics. " +
    "Rarely needed: edited notes update on save, and statistics refresh " +
    "automatically ~1 min after edits settle.",
  buttonRebuild: "Rebuild",
  noticeBodyTokenDisabled: "Body-token matching is disabled.",

  // Settings tab — Display
  settingDisplayHeading: "Display",
  descDisplayScores:
    "Scores are per-query normalized (top match = 100) and not comparable across different active notes.",
  settingShowScores: "Show scores",
  settingShowSharedReasons: "Show shared reasons",
  settingHideAlreadyLinked: "Hide already-linked",

  // Settings tab — Exclusions
  settingExclusionsHeading: "Exclusions",
  descExclusions:
    "Excluded folders and excluded tags/links behave differently. " +
    "Folders: notes inside are removed from results entirely. " +
    "Tags / links: only that signal is ignored during scoring — a note carrying an excluded tag can still appear if it matches via other signals. " +
    "This lets you down-weight noisy tags without losing genuinely related notes that happen to use them. " +
    "To fully hide a group of notes, put them in a folder and exclude that folder.",
  settingExcludedFolders: "Excluded folders",
  descExcludedFolders:
    "One folder path per line. Both 'Daily/' and '/Daily' are accepted.",
  settingExcludedTags: "Excluded tags",
  descExcludedTags:
    "One tag per line or comma-separated, without the leading #.",
  settingExcludedLinks: "Excluded links",
  descExcludedLinks:
    "One note basename per line (e.g. 'Linux', not '[[Linux]]').",
  settingExcludedBodyTokens: "Excluded body-token words",
  descExcludedBodyTokens:
    "One word per line or comma-separated. Recurring heading words you don't " +
    "want to count as a shared body signal (e.g. コメント, 結果, メモ). " +
    "Only used when body-token matching is on; takes effect immediately, " +
    "no rebuild needed.",

  // Sidebar — status placeholders
  statusIndexing: "Indexing vault…",
  statusNoActive: "Open a note to see related notes.",
  statusEmpty: "No related notes found.",

  // Sidebar — sections
  sectionRelatedNotes: "Related notes",
  sectionSuggestedTags: "Suggested tags",

  // Sidebar — row controls
  ariaCopyLink: "Copy link",
  ariaAddLink: "Add link to note",
  suggestAddTag: "Add #{tag} ({count} notes)",

  // Sidebar — inline reasons line
  reasonLinksToThisNote: "links to this note",
  reasonSharedBacklinks: "+{count} shared backlink(s)",

  // Sidebar — hover info tooltip
  tipLabelSharedTags: "Shared tags",
  tipLabelSharedLinks: "Shared links",
  tipLabelLinksToThisNote: "Links to this note",
  tipLabelSharedBacklinks: "Shared backlinks",
  tipLabelSharedBodyWords: "Shared body words",
  tipLabelSharedTitleWords: "Shared title words",
  tipLinksHereNotBack: "Links here, not linked back yet",

  // main.ts notices
  noticeBodyTokenRebuilt: "Body-token index rebuilt.",
  noticeBodyTokenRebuildFailed: "Body-token index rebuild failed: {message}",
  noticeActiveNoteChanged: "Active note has changed.",
  // Deliberately left out of `ja` below: the format is just "+#tag" with no
  // English words in it, so the English-fallback template already reads
  // correctly in a Japanese vault.
  noticeTagAdded: "+#{tag}",
  noticeLinkAdded: "Added link to {name}",
};

const ja: Partial<Record<keyof typeof en, string>> = {
  viewName: "おすすめノート",
  commandOpenSidebar: "おすすめノートサイドバーを開く",
  commandRebuildIndex: "本文トークンインデックスを再構築",

  settingMaxResults: "最大表示件数",

  settingWeightsHeading: "重み",
  settingWeightsDesc:
    "共有されている各シグナルは、重み × IDF としてスコアに加算されます。" +
    "「このノートへのリンク」は例外で、候補ノートがこのノートにリンクしているのに" +
    "このノートからはまだリンクしていない、という非対称な片方向リンク1件分に対して" +
    "IDFなしの固定値を加えます。合計は候補ノートの log(1 + 発リンク数) で割られ、" +
    "MOCやインデックスノートが上位を占めすぎないようにします。" +
    "「同じフォルダ」の初期値は0です。フォルダが同じというだけでは" +
    "「まとめて置いてあるだけ」であって「内容が関連している」とは限らないためです。" +
    "「共有するタイトル語」は初期状態で有効で、メタデータのみ(本文ではなく" +
    "ファイル名)を使います。無効にするには0に設定してください。",
  weightOutlinks: "共有する発リンク",
  weightTags: "共有するタグ",
  weightBacklinks: "共有する被リンク",
  weightDirectLink: "このノートへのリンク",
  weightFolder: "同じフォルダ",
  weightTitle: "共有するタイトル語",

  settingBodyTokenHeading: "本文トークンマッチング",
  settingBodyTokenDesc:
    "任意機能です。タグやリンクを共有していなくても、珍しい語彙を共有しているノートを" +
    "見つけ出します。初期状態ではオフです。有効にすると、インデックス作成のために" +
    "すべての .md ファイルを一度読み込みます(非同期処理、ノート5,000件でおよそ" +
    "10〜20秒)。アクティブなノートは常にその場で最新の内容を読み直し、編集した" +
    "ノートのインデックス項目は編集が落ち着いてから(約2秒後)すぐに更新されます。" +
    "Vault全体の統計は編集が落ち着いてから約1分後に遅延再構築されるほか、下の" +
    "「再構築」ボタンや「本文トークンインデックスを再構築」コマンドで即座に" +
    "再構築することもできます。日本語のVaultでは、下の日本語分かち書きも" +
    "有効にしてください。",
  settingBodyTokenEnable: "本文トークンマッチングを有効化",
  settingSegmenterName: "日本語分かち書き(日本語Vaultにおすすめ)",
  settingSegmenterDesc:
    "TinySegmenter(オフライン・辞書不要)を使って日本語のテキストを単語に分割します。" +
    "これにより「打ち合わせ」「読み込み」のような送り仮名を含む単語や、" +
    "「ひらめき」のようなひらがなの単語も共有語彙として認識されるようになります。" +
    "これを有効にしないと、こうした単語は本文トークンマッチングから見えないままです。" +
    "この設定を変更するとインデックスが再構築されます。",
  settingBodyTokenWeight: "本文トークンの重み",
  settingTopN: "ノートごとの重要トークン数",
  descRebuildsIndex: "この設定を変更するとインデックスが再構築されます。",
  settingRebuildNow: "今すぐインデックスを再構築",
  descRebuildNow:
    "すべてのノートを読み直し、Vault全体の統計を再構築します。編集したノートは" +
    "保存時に更新され、統計も編集が落ち着いてから約1分後に自動的に更新されるため、" +
    "通常は使う必要はありません。",
  buttonRebuild: "再構築",
  noticeBodyTokenDisabled: "本文トークンマッチングは無効になっています。",

  settingDisplayHeading: "表示",
  descDisplayScores:
    "スコアは表示のたびに正規化されます(最上位の候補が100)。そのため、" +
    "異なるアクティブノート間でスコアを比較することはできません。",
  settingShowScores: "スコアを表示",
  settingShowSharedReasons: "共有理由を表示",
  settingHideAlreadyLinked: "リンク済みのノートを非表示",

  settingExclusionsHeading: "除外設定",
  descExclusions:
    "除外フォルダと除外タグ/リンクでは動作が異なります。フォルダ:中のノートは" +
    "結果から完全に除外されます。タグ・リンク:スコアリング時にそのシグナルだけが" +
    "無視されます。除外したタグを持つノートでも、他のシグナルで一致すれば結果に" +
    "表示されます。これにより、ノイズの多いタグの影響を弱めつつ、そのタグを" +
    "たまたま使っているだけの本当に関連するノートを失わずに済みます。ノートの" +
    "グループを完全に非表示にしたい場合は、フォルダにまとめてそのフォルダを" +
    "除外してください。",
  settingExcludedFolders: "除外フォルダ",
  descExcludedFolders:
    "1行につき1つのフォルダパスを入力します。「Daily/」「/Daily」どちらの表記も" +
    "使えます。",
  settingExcludedTags: "除外タグ",
  descExcludedTags:
    "先頭の # を付けずに、1行につき1つ、またはカンマ区切りでタグを入力します。",
  settingExcludedLinks: "除外リンク",
  descExcludedLinks:
    "1行につき1つ、ノート名を入力します(例:「[[Linux]]」ではなく「Linux」)。",
  settingExcludedBodyTokens: "除外する本文トークン",
  descExcludedBodyTokens:
    "1行につき1つ、またはカンマ区切りで単語を入力します。「コメント」「結果」" +
    "「メモ」のように、共有の本文シグナルとしてカウントしたくない見出しの常連語" +
    "などに使います。本文トークンマッチングが有効なときのみ使用され、再構築なしで" +
    "すぐに反映されます。",

  statusIndexing: "Vaultをインデックス中…",
  statusNoActive: "ノートを開くと関連ノートが表示されます。",
  statusEmpty: "関連ノートが見つかりませんでした。",

  sectionRelatedNotes: "関連ノート",
  sectionSuggestedTags: "おすすめタグ",

  ariaCopyLink: "リンクをコピー",
  ariaAddLink: "ノートにリンクを追加",
  suggestAddTag: "#{tag} を追加({count}件のノート)",

  reasonLinksToThisNote: "このノートへリンク",
  reasonSharedBacklinks: "被リンクを{count}件共有",

  tipLabelSharedTags: "共有タグ",
  tipLabelSharedLinks: "共有リンク",
  tipLabelLinksToThisNote: "このノートへのリンク",
  tipLabelSharedBacklinks: "共有被リンク",
  tipLabelSharedBodyWords: "共有本文ワード",
  tipLabelSharedTitleWords: "共有タイトルワード",
  tipLinksHereNotBack: "リンクされていますが、まだリンクを返していません",

  noticeBodyTokenRebuilt: "本文トークンインデックスを再構築しました。",
  noticeBodyTokenRebuildFailed:
    "本文トークンインデックスの再構築に失敗しました: {message}",
  noticeActiveNoteChanged: "アクティブなノートが変わりました。",
  noticeLinkAdded: "{name} へのリンクを追加しました",
};

export type TranslationKey = keyof typeof en;

// Obsidian stores the user's chosen UI language under this localStorage key
// (absent/null means English; Japanese is "ja"). Resolved lazily per call —
// not cached at module load — so it works in test environments without
// `localStorage` (Node/vitest) and would pick up a language change without
// a reload if Obsidian ever supported that.
export function getLocale(): Locale {
  try {
    if (typeof localStorage === "undefined") return "en";
    return localStorage.getItem("language") === "ja" ? "ja" : "en";
  } catch {
    return "en";
  }
}

function interpolate(
  template: string,
  params?: Record<string, string | number>,
): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name)
      ? String(params[name])
      : match,
  );
}

export function t(
  key: TranslationKey,
  params?: Record<string, string | number>,
): string {
  const template = getLocale() === "ja" ? ja[key] ?? en[key] : en[key];
  return interpolate(template, params);
}
