# Suggested Notes

An [Obsidian](https://obsidian.md) sidebar plugin that shows notes related to the active note. **Designed first for Japanese-language vaults** — the tokenizer is built for text without word boundaries — and works just as well for English notes.

Related notes are picked by a weighted score over shared tags, links, backlinks, filename words, and (optionally) body vocabulary. Everything runs locally: no AI, no network, no background process.

![Suggested Notes sidebar showing related notes and suggested tags for the active note](docs/screenshot.png)

[日本語 README](./README.ja.md)

## Highlights

- **Japanese-first tokenizer** — extracts vocabulary matches from unsegmented Japanese bodies and filenames ([details](#japanese-language-support))
- **Metadata first** — by default no note bodies are read; tags, links, and filenames are enough to run. Body matching is opt-in
- **Offline, no AI** — no embeddings, no external APIs
- **Lightweight** — candidates are narrowed via inverted indexes, never a full-vault scan. Mobile supported
- **Never writes to your notes** — plugin state is not stored in frontmatter or tags. Notes change only when you explicitly press the append-link / add-tag buttons
- **UI in Japanese and English** — follows Obsidian's language setting

## Japanese-language support

Japanese text has no spaces between words, so naive word splitting cannot find shared vocabulary. This plugin handles it as follows:

- Kanji runs are tokenized as both the full run and its 2-character pairs, and **only pairs that exist as standalone words somewhere in the vault are kept** — so 機械学習 matches 学習, while morpheme-straddling fragments like 本語 (from 日本語) are dropped
- Katakana compounds (リチウムバッテリー) get the same treatment for sub-words (バッテリ), and trailing prolonged-mark variants (サーバー / サーバ) are normalized
- Okurigana-mixed words (打ち合わせ) and hiragana words (ひらめき) are extracted by the bundled TinySegmenter (~25KB, offline, dictionary-free), on by default
- Full-width / half-width variants are folded by NFKC normalization
- The built-in Japanese stopword list contains only words vetted against public lists (SlothLib, stopwords-iso) and grammatical categories ([policy](#built-in-stopwords))

## Install

Not in the community plugin store. Two options:

### Via BRAT (recommended)

1. Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin from the community store.
2. Open BRAT settings → "Add Beta plugin" → enter `kogedango/suggested-notes-plugin`.
3. Enable "Suggested Notes" under Community plugins.

BRAT auto-updates the plugin when a new version is released.

### Manual

1. Download `main.js`, `manifest.json` (and `styles.css` if present) from the latest [Release](https://github.com/kogedango/suggested-notes-plugin/releases).
2. Place them in `<vault>/.obsidian/plugins/suggested-notes/`.
3. Reload Obsidian and enable "Suggested Notes" under Community plugins.

## How it scores

For each active note, candidates are narrowed via inverted indexes (`tag → files`, `link → files`, `token → files`). Each candidate's score is a weighted sum of shared signals:

| Signal | Default weight | Adjusted by |
|---|---|---|
| Shared outlinks | 8 | per-link IDF |
| Shared tags | 5 | per-tag IDF |
| Shared backlinks | 4 | source specificity (co-citation from a note with few outlinks counts as stronger evidence) |
| Shared title words | 3 | per-token IDF |
| Shared body tokens | 1.5 | per-token IDF |

The raw score is divided by the candidate's `log(1 + outlink count)` to keep MOC / index notes from dominating. Displayed scores are normalized per query (top match = 100).

Folder weight defaults to 0: same-folder notes are often close simply because you put them there, and surfacing them crowds out genuinely useful suggestions (configurable).

### Title-word matching

**Metadata-only, on by default.** Reads filenames only, never bodies. Notes whose filenames share a word ("Machine Learning Basics" / "Machine Learning Advanced") get IDF-weighted credit. It uses the same tokenizer as body matching but never the segmenter, so hiragana-only titles are a known gap. To keep generic words like "notes" or 日記 from fanning out, a title word carried by more than 20% of the vault is not used to discover new candidates (it still scores candidates found via other signals). Set the weight to 0 to disable.

### Body-token matching

**Optional, off by default.** Picks up notes that share rare vocabulary even without explicit tags or links. This is the only feature that reads note bodies.

- Strips frontmatter, code blocks, wikilinks, hashtags, and URLs before tokenizing
- Keeps the top-N tokens per note by `log(1+TF) × IDF` (default 40) and scores each shared token
- Tokens appearing in more than 40% of the vault are auto-excluded

Enabling it reads every `.md` once to build the index (~10–20s for 5,000 notes, async, non-blocking). After that, the active note is re-read on every switch (your latest edits count immediately), an edited note's entry updates once the edit settles (~2s), and the vault-wide vocabulary statistics rebuild lazily about a minute after edits — or immediately via the Rebuild button / command.

## Features

- Sidebar listing related notes for the active file
- Hover a row for the score breakdown; Cmd/Ctrl-hover for the note preview
- Per-row **append-link button** (appends a `[[link]]` to the active note; other notes are never modified) and **copy button**
- Suggested tags — tags frequent in the result set but missing from the active note; click to add to frontmatter
- Exclusions: folders / tags / outlinks / body tokens ([semantics](#exclusion-semantics))

## Settings

| Setting | Default | Notes |
|---|---|---|
| Max results | 20 | |
| Shared outlinks weight | 8 | |
| Shared tags weight | 5 | |
| Shared backlinks weight | 4 | |
| Shared title words weight | 3 | Metadata-only (filenames). Set to 0 to disable |
| Enable body-token matching | off | On reads all note bodies; off is metadata-only |
| Body-token weight | 1.5 | Keep low (1–2) |
| Salient tokens per note | 40 | Tokens retained per note |
| Japanese word segmentation | on | TinySegmenter; turn off for mostly non-Japanese vaults to speed up indexing |
| Show scores | on | |
| Show shared reasons | on | What each match shares |
| Hide already-linked | off | |
| Excluded folders | — | One per line. `Daily/` and `/Daily` both work |
| Excluded tags | — | One per line, no leading `#` |
| Excluded links | — | One basename per line |
| Excluded body tokens | — | Frequent-but-meaningless words specific to your vault |

### Exclusion semantics

`excludedFolders` removes notes from results entirely.

`excludedTags` and `excludedLinks` only ignore that signal during scoring — a note isn't hidden just because it carries an excluded tag, as long as it matches via other signals. This lets you silence a noisy tag without losing genuinely related notes that happen to use it.

To fully hide a class of notes, put them in a folder and exclude that folder.

### Built-in stopwords

The stopwords baked into body-token matching live in [`src/data/stopwords.ts`](./src/data/stopwords.ts). Every entry must belong to a vault-independent rationale category (closed-class grammar, basic vocabulary, conjugation fragments, pronouns, …) — no vault- or domain-specific word belongs there. If a word is common only in *your* vault, add it to the **Excluded body tokens** setting instead. Suggestions for the built-in list are welcome via [GitHub issue or PR](https://github.com/kogedango/suggested-notes-plugin).

## License

MIT
