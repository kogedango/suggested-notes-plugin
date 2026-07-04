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
4. On active-note change, generate candidates by querying inverted indexes with the active note's tags/outlinks (never full-vault scan), then score that candidate set only. Candidate generation also expands through: (a) backlink sources with outlinkCount ≤ `FOCUSED_SOURCE_MAX_OUTLINKS` (20) — their other outlinks become candidates, since a focused hub co-citing two notes is discoverable evidence, not just a scoring bonus; and (b) same-folder notes, but only when `folderWeight > 0` (default 0, so no behavior change out of the box).
5. `metadataCache.on("changed")` performs incremental updates; debounce recomputation ~300ms.

### Scoring (mandatory baseline — not optional)

Weighted sum of shared signals (default weights: outlinks 8, tags 5, backlinks 4, direct link 6, folder 0) with these required adjustments:

- **Direct link** (`directLinkWeight`, default 6): a flat add (no IDF) when the candidate links to the active note but the active note doesn't link back yet — this is distinct from *shared* backlinks (`backlinkWeight`), which score co-citation from a third note, not a direct link between the two notes themselves.

- **Outlink-count penalty**: divide candidate score by `log(1 + outlinkCount)` to suppress MOC/index dominance.
- **Tag IDF**: weight each shared tag by `log(totalNotes / notesWithTag)`.
- **Link IDF**: same for shared outlinks.

Temporal filtering (an `onlyOlderNotes` setting excluding candidates newer than the active note) was considered and **rejected** — do not re-propose it. The owner's workflow allows revising old notes, so linking "forward in time" from an old note to a newer one is legitimate; a chronology filter only makes sense if old notes are immutable.

Displayed scores are **per-query normalized** (top candidate = 100); raw scores stay internal.

Defaults: resolved links only (unresolved `[[wikilinks]]` ignored); aliases not supported in MVP; MVP insertion only **appends to the active note** (never mutates other notes).

Note titles (filenames) are deliberately unused as a signal for now. They are the natural next candidate if the baseline needs another signal: pure metadata, no body read, works with body-token matching off.

### Body-token matching (optional, OFF by default)

An opt-in enrichment that surfaces notes sharing rare vocabulary even without shared tags/links. It tokenizes note bodies (NFKC-normalized; CJK + ASCII, stopword- and markdown-stripped; kanji runs emit the full run plus 2-grams, katakana runs emit the full run plus interior sub-words, trailing katakana prolonged marks are normalized) into a token → in-body occurrence count map, keeps the top-N salient tokens per note ranked by `log(1 + TF) × IDF` (so a token the note genuinely repeats outranks an equally-rare token it only mentions once), and adds `bodyTokenWeight × tokenIDF` per shared salient token to the score. TF only decides which tokens make the top-N cut — `df` (and therefore IDF, and the df≥2 / df≤40%-of-vault salience gates) stays purely presence-based (0/1 per note) and is unaffected by within-note repetition; it is still frozen per rebuild exactly as described below.

A run's interior sub-units are **gated by a corpus `standalone` set** (the standalone-word units — kanji 2-grams and whole katakana words — that occur as a word on their own somewhere in the vault): a sub-unit is kept only if it appears standalone, so real sub-words survive (`機械`/`学習` from `機械学習`, `バッテリ` from `リチウムバッテリー` when `膨張バッテリー` exists elsewhere) while morpheme-straddling artifacts are dropped (`本語` from `日本語`, `員何` from `全員何も`, the cross-morpheme fragments of katakana compounds). The full run is always kept. Katakana sub-words are additionally length-gated (min 3) — 2-char sub-strings are mostly cross-morpheme noise (`ログ` from `ブログ`, `パス` from `コンパス`) and real 2-char words are already caught when they stand alone. `standalone` is corpus state built and **frozen per rebuild exactly like `df`** (a unit new to the vault isn't trusted as a word until the next coarse rebuild) and harvested from the same single scan that tokenizes each note (`tokenize(body, segment, undefined, collectInto)`); on the query side `tokenize(body, segment, standalone)` applies the same gate. This is the one sanctioned corpus dependency inside tokenization — without the set (no corpus yet) every sub-unit is emitted.

Japanese segmentation via `tiny-segmenter` (`bodyTokenSegmenterEnabled`, experimental, OFF by default) is **sanctioned** despite the "no AI" constraint: it is a ~25KB offline, deterministic, dictionary-free tokenizer bundled into the plugin — no network, no background process. The corpus and the query must always be tokenized with the same segmenter flag; toggling the setting triggers a corpus rebuild.

Architecture is a **corpus/query split** — this is what keeps full-text within the constraints, so preserve it:

- **Corpus** (all notes: `df`, per-note `salient`, inverted index) is rebuilt *coarsely* — on enable, on startup, on demand (the settings-tab rebuild button / `Rebuild body-token index` command), and via a **lazy** debounced backstop (~60s after edits settle; manual refresh is the "I need it now" path, so keep the auto rebuild infrequent). The hard boundary is **`df` is never maintained incrementally** — that path caused a df-corruption race and unbounded per-note token retention; df only changes in a full rebuild. Per-note `salient`/`inverted` updates scoped to the affected note ARE sanctioned: an edited note's salient set is re-ranked against the frozen df when its edit settles (Obsidian's autosave → `metadataCache.changed`, ~2s after typing stops), and rename/delete just re-key entries without a body read. The debounced rebuild is event-driven (a trailing debounce), not a polling loop — so it stays within "no always-on background process".
- **Query** (the active note's salient tokens) is computed **fresh on demand** from a single `cachedRead` on each active-note change. This is the only body read in the hot path; it is naturally latest-wins, so the active note always reflects its current text.
- Accepted trade-off: `df` (and therefore IDF, and salience of brand-new vocabulary) lags until the next coarse rebuild. This is intentional — IDF only needs to be statistically right, and vocabulary that is new to the vault cannot produce a shared signal before a rebuild anyway (matching requires df ≥ 2).
- Accepted trade-off: a shared term only matches if it is in **both** notes' salient top-N (`bodyTokenTopN`), so two long, vocabulary-rich notes can each push a genuinely shared topic word out of their own top-N. TF×IDF ranking mitigates this (repeated topic words rank high); the ceiling itself is the price of a bounded index — tune `bodyTokenTopN` if it bites, don't index full token sets.
- Accepted (benign) race: a `refreshNote` whose body read spans a rebuild swap writes a salient set ranked against the old `df` into the new corpus. It self-heals on that note's next edit event, and IDF only needs to be statistically right — do not add locking for this.
- The corpus is rebuilt from scratch on every startup; nothing is persisted. Fine at current vault sizes. If persistence is ever added, adopt a saved snapshot wholesale and fall back to a full rebuild when anything changed while the vault was closed — never partial-update a persisted corpus (`df` stays rebuild-only).

## Commands

- `npm run dev` — esbuild watch build
- `npm run build` — typecheck (`tsc -noEmit`) + production esbuild bundle to `main.js`
- `npm run typecheck` — typecheck only
- `npm test` / `npm run test:watch` — vitest (pure-function tests under `src/util` and `src/scoring`)
