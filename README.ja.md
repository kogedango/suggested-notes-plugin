# Suggested Notes

[Obsidian](https://obsidian.md) のサイドバーに、アクティブノートに関連するノートを表示します。

共有タグ・アウトリンク・バックリンク・（オプションで）本文の希少語をシグナルとして、IDF とアウトリンク数ペナルティでスコアを補正します。オフライン、AI なし。

[English README](./README.md)

## インストール

コミュニティプラグインストアには登録していません。以下のいずれかでインストールできます。

### BRAT 経由（推奨）

1. コミュニティプラグインストアから [BRAT](https://github.com/TfTHacker/obsidian42-brat) をインストール
2. BRAT の設定 → "Add Beta plugin" → `kogedango/suggested-notes-plugin` を入力
3. コミュニティプラグイン一覧で "Suggested Notes" を有効化

BRAT は新しいリリースが出ると自動更新します。

### 手動インストール

1. 最新の [Release](https://github.com/kogedango/suggested-notes-plugin/releases) から `main.js`, `manifest.json`（および `styles.css` があれば）をダウンロード
2. `<vault>/.obsidian/plugins/suggested-notes/` に配置
3. Obsidian を再読み込みし、コミュニティプラグイン一覧で "Suggested Notes" を有効化

## スコアリングの仕組み

アクティブノートごとに、転置インデックス（`tag → files`, `link → files`, `token → files`）で候補集合を絞ってからスコアリングします（vault 全件スキャンしません）。各候補は共有シグナルの重み付き和：

| シグナル | デフォルト重み | 補正 |
|---|---|---|
| 共有アウトリンク | 8 | リンクごとの IDF |
| 共有タグ | 5 | タグごとの IDF |
| 共有バックリンク | 4 | — |
| 共有 body トークン | 1.5 | トークンごとの IDF |

生スコアは候補ノートの `log(1 + outlinkCount)` で除算し、MOC / インデックスノートが上位を独占するのを抑制します。

表示スコアはクエリごとに正規化（最上位 = 100）。絶対値はノート間で比較不可能です。

### フォルダ重みのデフォルトが 0 の理由

同じフォルダのノートは「そこに置いたから」という理由で関連しているケースが多く、上位に出すと本当に有用な提案が押し出されます。設定で変更可能。

## body-token マッチング

**オプション機能。デフォルトで無効。** タグやリンクが明示的に張られていなくても、本文中の希少な語彙を共有していれば関連として拾います。本文を読むのはこの機能だけで、無効なら完全にメタデータのみで動作します。

- 本文から frontmatter / コードブロック / wikilink / ハッシュタグを除去
- NFKC 正規化（全角・半角の揺れを吸収）してから、英語、カタカナ (2文字以上)、漢字 (2文字以上) を正規表現で抽出
- 漢字の連続はバイグラムも生成（機械学習 → 機械 / 械学 / 学習）し、複合語が部分語としか書かれていないノートともマッチ
- 末尾の長音を正規化（サーバー と サーバ がマッチ）
- オプションの**日本語分かち書き（実験的）**: TinySegmenter（オフライン・辞書不要）で、正規表現では拾えない送り仮名混じり語（打ち合わせ）やひらがな語（ひらめき）も抽出
- 各ノートで IDF 上位 N 個 (デフォルト 40) を salient 語として保持
- vault の 40% 以上に出るストップワード級は自動除外

有効化すると全 `.md` を一度読み込んで vault 全体のインデックスを構築します（5,000 ノートで 10〜20 秒、非同期で UI はブロックしない）。その後は：

- **アクティブノートは常にその場で読み直す**ため、最新の編集が即座に反映されます。
- **vault 全体のインデックスは粗く再構築**します — 編集が落ち着いた後に自動で、またはコマンド **Rebuild body-token index** で手動で。キー入力ごとには更新しません。最近編集した*他の*ノートは、次の再構築まで本文類似では出てこない場合があります。

## 機能

- アクティブファイルの関連ノートをサイドバーに表示
- 行ホバーでプレビュー（約600ms 静止）
- 各行にコピーボタン
- タグ提案 — 結果セットに頻出するがアクティブノートには無いタグ。クリックで frontmatter に追加
- 除外設定: フォルダ / タグ / アウトリンク（[詳細](#除外設定の仕様)）

## 設定

| 項目 | デフォルト | 備考 |
|---|---|---|
| Max results | 20 | |
| Shared outlinks weight | 8 | |
| Shared tags weight | 5 | |
| Shared backlinks weight | 4 | |
| Enable body-token matching | off | オプション。ON で全ノート本文を読み込む。OFF はタグ・リンクのみで判定 |
| Body-token weight | 1.5 | 低めに保つ (1〜2) |
| Salient tokens per note | 40 | ノートあたり IDF 上位N |
| Japanese word segmentation | off | 実験的。TinySegmenter で送り仮名混じり語・ひらがな語も対象に |
| Show scores | on | |
| Show shared reasons | on | 何を共有しているか表示 |
| Hide already-linked | off | |
| Excluded folders | — | 1行1件。`Daily/` も `/Daily` も可 |
| Excluded tags | — | 1行1件、先頭 `#` 不要 |
| Excluded links | — | 1行1件 basename |

### 除外設定の仕様

`excludedFolders` はノートを結果から完全に除外します。

`excludedTags` と `excludedLinks` はそのシグナルをスコア計算で無視するだけで、除外タグを持つノートでも他のシグナルで一致すれば結果に残ります。ノイズの多いタグを down-weight しつつ、たまたまそのタグを持つ関連ノートを失わないための設計です。

特定のノート群を完全に隠したい場合は、フォルダに分けて `excludedFolders` を使ってください。

## ライセンス

MIT
