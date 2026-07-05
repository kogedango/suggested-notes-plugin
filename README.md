# Suggested Notes

A sidebar for [Obsidian](https://obsidian.md) that shows notes related to the active note.

Uses shared tags, outlinks, backlinks, and — optionally — rare body tokens as signals, with IDF and an outlink-count penalty as adjustments. Offline, no AI.

[日本語 README](./README.ja.md)

## Install

Not in the community plugin store. Two options:

### Via BRAT (recommended)

1. Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin from the community store.
2. Open BRAT settings → "Add Beta plugin" → enter `kogedango/suggested-notes-plugin`.
3. Enable "Suggested Notes" under Community plugins.

BRAT auto-updates the plugin when you release a new version.

### Manual

1. Download `main.js`, `manifest.json` (and `styles.css` if present) from the latest [Release](https://github.com/kogedango/suggested-notes-plugin/releases).
2. Place them in `<vault>/.obsidian/plugins/suggested-notes/`.
3. Reload Obsidian and enable "Suggested Notes" under Community plugins.

## How it scores

For each active note, candidates are narrowed via inverted indexes (`tag → files`, `link → files`, `token → files`) — never a full-vault scan. Each candidate is scored as a weighted sum of shared signals:

| Signal | Default weight | Adjusted by |
|---|---|---|
| Shared outlinks | 8 | per-link IDF |
| Shared tags | 5 | per-tag IDF |
| Shared backlinks | 4 | — |
| Shared body tokens | 1.5 | per-token IDF |

The raw score is divided by the candidate's `log(1 + outlinkCount)` to suppress MOC / index notes from dominating results.

Displayed scores are per-query normalized (top match = 100). Absolute values are not comparable across notes.

### Why folder weight defaults to 0

Notes in the same folder are often related for boring reasons (you put them there). Surfacing them as "related" crowds out genuinely useful suggestions. Configurable.

## Body-token matching

**Optional, off by default.** Picks up notes that share rare vocabulary even without explicit tags or links. This is the only feature that reads note bodies; with it off, the plugin is metadata-only.

- Strips frontmatter, code blocks, wikilinks, and hashtags from the body
- NFKC-normalizes (so full-width / half-width variants match), then extracts English, katakana (2+ chars), and kanji (2+ chars) by regex
- Kanji runs also emit overlapping bigrams (機械学習 → 機械 / 械学 / 学習), so compounds match notes that use only their parts
- Trailing prolonged marks are normalized (サーバー and サーバ match)
- Optional **Japanese word segmentation (experimental)**: runs TinySegmenter (offline, no dictionary) to also catch okurigana-mixed words (打ち合わせ) and hiragana words (ひらめき) the regex cannot see
- Retains top-N salient tokens per note by IDF (default 40)
- Tokens appearing in >40% of the vault are auto-excluded as stopwords

When enabled, it reads every `.md` once to build a whole-vault index (~10–20s for 5,000 notes, async, doesn't block the UI). After that:

- The **active note is always re-read live**, so it reflects your latest edits immediately.
- An **edited note's index entry updates as soon as the edit settles** (~2s, on Obsidian's autosave), so what you just wrote is immediately discoverable from other notes.
- The whole-vault statistics (token rarity) **rebuild lazily** — automatically ~1 minute after edits settle, or immediately via the **Rebuild** button in settings / the **Rebuild body-token index** command — never on every keystroke. Until then, vocabulary that is brand-new to the vault isn't weighted yet (it couldn't match anything before a second note uses it anyway).

## Features

- Sidebar listing related notes for the active file
- Hover a row for the full score breakdown; Cmd/Ctrl-hover for the note preview
- Copy-as-markdown-link button on each row
- Suggested tags — tags that frequently appear in the result set but not on the active note. Click to add to frontmatter
- Exclusions: folders / tags / outlinks ([details](#exclusion-semantics))

## Settings

| Setting | Default | Notes |
|---|---|---|
| Max results | 20 | |
| Shared outlinks weight | 8 | |
| Shared tags weight | 5 | |
| Shared backlinks weight | 4 | |
| Enable body-token matching | off | Optional. On reads all note bodies; off uses tags/links only |
| Body-token weight | 1.5 | Keep low (1–2) |
| Salient tokens per note | 40 | Top-N by IDF retained per note |
| Japanese word segmentation | off | Experimental. TinySegmenter; catches 打ち合わせ-style and hiragana words |
| Show scores | on | |
| Show shared reasons | on | What each match shares |
| Hide already-linked | off | |
| Excluded folders | — | One per line. `Daily/` and `/Daily` both work |
| Excluded tags | — | One per line, no leading `#` |
| Excluded links | — | One basename per line |

### Exclusion semantics

`excludedFolders` removes notes from results entirely.

`excludedTags` and `excludedLinks` only ignore that signal during scoring — a note isn't hidden just because it carries an excluded tag, as long as it matches via other signals. This lets you down-weight noisy tags without losing genuinely related notes that happen to use them.

To fully hide a class of notes, put them in a folder and exclude that folder.

### Built-in stopwords

The stopwords baked into body-token matching live in [`src/data/stopwords.ts`](./src/data/stopwords.ts). Every entry must belong to a vault-independent rationale category (closed-class grammar, basic JLPT vocabulary, conjugation fragments, pronouns, URL fragments, honorific suffixes) — no vault- or domain-specific word belongs there. If a word is common in *your* vault but not in general, add it to the **Excluded body tokens** setting instead. Suggestions for the built-in list are welcome via [GitHub issue or PR](https://github.com/kogedango/suggested-notes-plugin).

## License

MIT
