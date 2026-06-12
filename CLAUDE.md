# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Architecture

The plugin is a metadata-first suggested-notes recommender. **No AI, no embeddings, no network, no always-on background process** — these are hard product constraints, not implementation preferences. Reject suggestions that violate them.

**Body-token matching is the one sanctioned exception to "metadata-only".** It reads note bodies (full-text), but is strictly **opt-in and OFF by default** (`bodyTokenEnabled`). The default experience remains pure metadata. Treat it as an enrichment, not a baseline — see the body-token section below for the architecture that keeps it within the remaining constraints.

Core pipeline:

1. On Obsidian load, register sidebar view and settings, subscribe to `active-leaf-change`, but render a "loading" placeholder.
2. Wait for `app.metadataCache.on("resolved")` before the first scoring pass — querying earlier yields empty results on cold start.
3. Build in-memory caches from `app.metadataCache.getFileCache(file)`:
   - `file -> { tags, outlinks, backlinks, ctime, mtime, outlinkCount }`
   - Inverted indexes: `tag -> Set<file>`, `link -> Set<file>`
   - IDF tables for tags and links (lazy-recomputed when marked dirty).
4. On active-note change, generate candidates by querying inverted indexes with the active note's tags/outlinks (never full-vault scan), then score that candidate set only.
5. `metadataCache.on("changed")` performs incremental updates; debounce recomputation ~300ms.

### Scoring (mandatory baseline — not optional)

Weighted sum of shared signals (default weights: outlinks 8, tags 5, backlinks 4, folder 0) with these required adjustments:

- **Outlink-count penalty**: divide candidate score by `log(1 + outlinkCount)` to suppress MOC/index dominance.
- **Tag IDF**: weight each shared tag by `log(totalNotes / notesWithTag)`.
- **Link IDF**: same for shared outlinks.
- **Temporal-DAG filter** (optional setting `onlyOlderNotes`): exclude candidates with `ctime > activeNote.ctime`.

Displayed scores are **per-query normalized** (top candidate = 100); raw scores stay internal.

Defaults: resolved links only (unresolved `[[wikilinks]]` ignored); aliases not supported in MVP; MVP insertion only **appends to the active note** (never mutates other notes).

### Body-token matching (optional, OFF by default)

An opt-in enrichment that surfaces notes sharing rare vocabulary even without shared tags/links. It tokenizes note bodies (NFKC-normalized; CJK + ASCII, stopword- and markdown-stripped; kanji runs also emit bigrams, trailing katakana prolonged marks are normalized), keeps the top-N salient tokens per note by IDF, and adds `bodyTokenWeight × tokenIDF` per shared salient token to the score.

Japanese segmentation via `tiny-segmenter` (`bodyTokenSegmenterEnabled`, experimental, OFF by default) is **sanctioned** despite the "no AI" constraint: it is a ~25KB offline, deterministic, dictionary-free tokenizer bundled into the plugin — no network, no background process. The corpus and the query must always be tokenized with the same segmenter flag; toggling the setting triggers a corpus rebuild.

Architecture is a **corpus/query split** — this is what keeps full-text within the constraints, so preserve it:

- **Corpus** (all notes: `df`, per-note `salient`, inverted index) is rebuilt *coarsely* — on enable, on startup, on the manual `Rebuild body-token index` command, and via a debounced pass after edits settle. It is **not** maintained per keystroke. Do not reintroduce incremental per-edit corpus updates: that path caused a df-corruption race and unbounded per-note token retention. The debounced rebuild is event-driven (a trailing debounce), not a polling loop — so it stays within "no always-on background process".
- **Query** (the active note's salient tokens) is computed **fresh on demand** from a single `cachedRead` on each active-note change. This is the only body read in the hot path; it is naturally latest-wins, so the active note always reflects its current text.
- Accepted trade-off: a recently-edited *other* note's body signal lags until the next corpus rebuild. This is intentional — match engineering effort to a marginal enrichment signal; don't chase per-edit corpus freshness.

## Commands

- `npm run dev` — esbuild watch build
- `npm run build` — typecheck (`tsc -noEmit`) + production esbuild bundle to `main.js`
- `npm run typecheck` — typecheck only
- `npm test` / `npm run test:watch` — vitest (pure-function tests under `src/util` and `src/scoring`)
