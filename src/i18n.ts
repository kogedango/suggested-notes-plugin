// Lightweight i18n: English is the source of truth; Japanese is a partial
// overlay that falls back to English for any key it doesn't (yet) translate.
// No build-time extraction, no ICU — just a flat string table plus
// "{param}" interpolation, which is all this plugin's UI needs.

export type Locale = "en" | "ja";

const en = {
  // Command palette / view chrome
  viewName: "Suggested Notes — Related to active note",
  commandOpenSidebar: "Open related notes for the active note",
  commandRebuildIndex: "Rebuild body-token index",

  // Settings tab — Max results
  settingMaxResults: "Max results",

  // Settings tab — Weights
  settingWeightsHeading: "Weights",
  settingWeightsDesc:
    "Each shared signal contributes weight × IDF to the score. " +
    "'Links to this note' and 'Unlinked title mention' use flat weights (no IDF). " +
    "The former is an " +
    "asymmetric link: the candidate links here, but this note doesn't link back yet. " +
    "The total is then divided by log(1 + outlinkCount) of the candidate to suppress MOC / index notes. " +
    "Same folder defaults to 0 — folder co-location often means 'filed together', not 'topically related'. " +
    "Title words and salient body words form one content-word set; the same word contributes only once.",
  weightOutlinks: "Shared outlinks",
  weightTags: "Shared tags",
  weightBacklinks: "Shared backlinks",
  weightDirectLink: "Links to this note",
  weightUnlinkedMention: "Unlinked title mention",
  weightFolder: "Same folder",
  weightContent: "Shared content words",

  // Settings tab — Body-token matching
  settingBodyTokenHeading: "Body-token matching",
  settingBodyTokenDesc:
    "On by default. Title words and salient body words are matched as one content signal. " +
    "Disabling it avoids a vault-wide body index; the active note may still be read for unlinked title mentions. " +
    "The first build reads every .md file in bounded asynchronous batches; later starts restore the saved index and read only changed notes. " +
    "The active note is always re-read live, and an edited note's index entry updates as soon as the edit settles (~2s). " +
    "Corpus statistics update from that one note without re-reading the rest of the vault. " +
    "The Rebuild button below / 'Rebuild body-token index' command forces a full repair pass.",
  settingBodyTokenEnable: "Enable body-token matching",
  settingCustomVocabularyName: "Vault-specific vocabulary",
  settingCustomVocabularyDesc:
    "One term or alias group per line. Separate equivalent spellings with | " +
    "(for example, ツェッテルカステン|Zettelkasten); the first spelling is shown as the canonical term. " +
    "Every spelling is protected as one token before analysis, and the longest match wins.",
  settingTopN: "Salient tokens per note",
  descRebuildsIndex: "Changing this re-ranks the saved index without re-reading notes.",
  settingRebuildNow: "Rebuild index now",
  descRebuildNow:
    "Re-reads every note and rebuilds the whole-vault statistics. " +
    "Rarely needed: edited notes and corpus statistics update incrementally on save.",
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
  settingExcludedContentTokens: "Excluded content words",
  descExcludedContentTokens:
    "One word per line or comma-separated. Recurring heading words you don't " +
    "want to count as shared content (e.g. コメント, 結果, メモ). " +
    "Applies to both titles and bodies immediately; no rebuild needed.",

  // Sidebar — status placeholders
  statusIndexing: "Indexing vault…",
  statusNoActive: "Open a note to see related notes.",
  statusEmpty: "No related notes found.",

  // Sidebar — sections
  sectionRelatedNotes: "Related notes",
  sectionSuggestedTags: "Suggested tags",

  // Sidebar — row controls
  ariaCopyLink: "Copy link",
  suggestAddTag: "Add #{tag} ({count} notes)",

  // Sidebar — inline reasons line
  reasonLinksToThisNote: "links to this note",
  reasonUnlinkedTitleMention: "title mentioned",
  reasonSharedBacklinks: "+{count} shared backlink(s)",

  // Sidebar — hover info tooltip
  tipLabelSharedTags: "Shared tags",
  tipLabelSharedLinks: "Shared links",
  tipLabelLinksToThisNote: "Links to this note",
  tipLabelUnlinkedTitleMention: "Unlinked title mention",
  tipLabelSharedBacklinks: "Shared backlinks",
  tipLabelSharedContentWords: "Shared content words",
  tipLinksHereNotBack: "Links here, not linked back yet",
  tipTitleAppearsAsPlainText: "Full title appears as plain text",
  tipScore: "Score: {score}",

  // main.ts notices
  noticeBodyTokenRebuilt: "Body-token index rebuilt.",
  noticeBodyTokenRebuildFailed: "Body-token index rebuild failed: {message}",
  noticeMorphologyFailed: "Language analyzers failed to initialize: {message}",
  noticeActiveNoteChanged: "Active note has changed.",
  noticeLinkCopied: "Link copied.",
  noticeLinkCopyFailed: "Could not copy the link.",
  // Deliberately left out of `ja` below: the format is just "+#tag" with no
  // English words in it, so the English-fallback template already reads
  // correctly in a Japanese vault.
  noticeTagAdded: "+#{tag}",
};

const ja: Partial<Record<keyof typeof en, string>> = {
  viewName: "Suggested Notes — 開いているノートに関連",
  commandOpenSidebar: "開いているノートの関連ノートを表示",
  commandRebuildIndex: "本文トークンインデックスを再構築",

  settingMaxResults: "最大表示件数",

  settingWeightsHeading: "重み",
  settingWeightsDesc:
    "共有されている各シグナルは、重み × IDF としてスコアに加算されます。" +
    "「このノートへのリンク」と「タイトルの未リンク言及」は例外で、IDFなしの固定値です。" +
    "前者は候補ノートがこのノートにリンクしているのに" +
    "このノートからはまだリンクしていない、という非対称な片方向リンク1件分に対して" +
    "加点します。合計は候補ノートの log(1 + 発リンク数) で割られ、" +
    "MOCやインデックスノートが上位を占めすぎないようにします。" +
    "「同じフォルダ」の初期値は0です。フォルダが同じというだけでは" +
    "「まとめて置いてあるだけ」であって「内容が関連している」とは限らないためです。" +
    "タイトル語と本文の重要語は一つの内容語集合として扱われ、同じ語は1回だけ加点されます。",
  weightOutlinks: "共有する発リンク",
  weightTags: "共有するタグ",
  weightBacklinks: "共有する被リンク",
  weightDirectLink: "このノートへのリンク",
  weightUnlinkedMention: "タイトルの未リンク言及",
  weightFolder: "同じフォルダ",
  weightContent: "共有する内容語",

  settingBodyTokenHeading: "本文トークンマッチング",
  settingBodyTokenDesc:
    "初期状態で有効です。タイトル語と本文の重要語を一つの内容シグナルとして照合します。" +
    "無効にするとVault全体の本文索引を作らない軽量モードになりますが、タイトルの未リンク" +
    "言及を探すためにアクティブノートだけは読むことがあります。有効にすると、" +
    "タグやリンクを共有していなくても珍しい語彙を共有しているノートを見つけ出し、" +
    "初回のインデックス作成では、すべての .md ファイルを一定件数ずつ非同期に読み込みます。" +
    "次回以降は保存したインデックスを復元し、変更されたノートだけを読み直します。所要時間は端末と" +
    "Vaultによって異なります。アクティブなノートは常にその場で最新の内容を読み直し、編集した" +
    "ノートのインデックス項目は編集が落ち着いてから(約2秒後)すぐに更新されます。" +
    "Vault全体の統計も、他のノートを読み直さずにその1件の差分から更新されます。下の" +
    "「再構築」ボタンや「本文トークンインデックスを再構築」コマンドは、全件を読み直す" +
    "修復処理を明示的に実行します。",
  settingBodyTokenEnable: "本文トークンマッチングを有効化",
  settingCustomVocabularyName: "Vault固有語",
  settingCustomVocabularyDesc:
    "1行につき1語または1グループを登録します。同じ語として扱う表記は | で区切ります" +
    "（例: ツェッテルカステン|Zettelkasten）。先頭表記を代表語として表示し、すべての表記を" +
    "日英解析の前に1トークンとして保護します。同じ位置では最長一致を優先します。",
  settingTopN: "ノートごとの重要トークン数",
  descRebuildsIndex:
    "この設定を変更すると、ノートを読み直さずに保存済みインデックスを再順位付けします。",
  settingRebuildNow: "今すぐインデックスを再構築",
  descRebuildNow:
    "すべてのノートを読み直し、Vault全体の統計を再構築します。編集したノートは" +
    "保存時に差分更新され、Vault全体の統計も同時に更新されるため、" +
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
  settingExcludedContentTokens: "除外する内容語",
  descExcludedContentTokens:
    "1行につき1つ、またはカンマ区切りで単語を入力します。「コメント」「結果」" +
    "「メモ」のように、共有内容としてカウントしたくない見出しやタイトルの常連語" +
    "などに使います。タイトルと本文の両方へ、再構築なしですぐに反映されます。",

  statusIndexing: "Vaultをインデックス中…",
  statusNoActive: "ノートを開くと関連ノートが表示されます。",
  statusEmpty: "関連ノートが見つかりませんでした。",

  sectionRelatedNotes: "関連ノート",
  sectionSuggestedTags: "おすすめタグ",

  ariaCopyLink: "リンクをコピー",
  suggestAddTag: "#{tag} を追加({count}件のノート)",

  reasonLinksToThisNote: "このノートへリンク",
  reasonUnlinkedTitleMention: "タイトルを本文で言及",
  reasonSharedBacklinks: "被リンクを{count}件共有",

  tipLabelSharedTags: "共有タグ",
  tipLabelSharedLinks: "共有リンク",
  tipLabelLinksToThisNote: "このノートへのリンク",
  tipLabelUnlinkedTitleMention: "タイトルの未リンク言及",
  tipLabelSharedBacklinks: "共有被リンク",
  tipLabelSharedContentWords: "共有内容語",
  tipLinksHereNotBack: "リンクされていますが、まだリンクを返していません",
  tipTitleAppearsAsPlainText: "候補タイトル全体が通常テキストとして現れます",
  tipScore: "スコア: {score}",

  noticeBodyTokenRebuilt: "本文トークンインデックスを再構築しました。",
  noticeBodyTokenRebuildFailed:
    "本文トークンインデックスの再構築に失敗しました: {message}",
  noticeMorphologyFailed: "言語解析器の初期化に失敗しました: {message}",
  noticeActiveNoteChanged: "アクティブなノートが変わりました。",
  noticeLinkCopied: "リンクをコピーしました。",
  noticeLinkCopyFailed: "リンクをコピーできませんでした。",
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
