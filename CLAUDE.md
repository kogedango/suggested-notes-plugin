# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Architecture

The plugin is a metadata-only suggested-notes recommender. **No AI, no embeddings, no network, no background process, no full-text parsing** — these are hard product constraints, not implementation preferences. Reject suggestions that violate them.

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

## Commands

No build tooling exists yet. When scaffolding from `obsidian-sample-plugin`, expected commands will be `npm run dev` (esbuild watch) and `npm run build`. Update this section once `package.json` lands.
