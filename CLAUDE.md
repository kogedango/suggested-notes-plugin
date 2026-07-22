# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Hard constraints

The plugin is a metadata-first suggested-notes recommender. These are product constraints, not implementation preferences — reject suggestions that violate them:

- **No AI, no embeddings, no network, no always-on background process.**
- **Metadata-only by default.** Body-token matching is the one sanctioned exception: it reads note bodies (full-text) but is strictly **opt-in and OFF by default** (`bodyTokenEnabled`). The default experience remains pure metadata; treat body-token as an enrichment, not a baseline.
- **`tiny-segmenter` is sanctioned** despite "no AI": a ~25KB offline, deterministic, dictionary-free tokenizer bundled into the plugin — no network, no background process.

Settled decisions — **do not re-propose** (full rationale in the linked sections):

- Temporal filtering (`onlyOlderNotes`) — rejected (see Scoring).
- Incremental `df` maintenance — rejected (see Body-token corpus/query split).
- Locking for the rebuild/refresh race — rejected (see Body-token trade-offs).

## Architecture

Core pipeline:

1. On Obsidian load, register sidebar view and settings, subscribe to `active-leaf-change`, but render a "loading" placeholder.
2. Wait for `app.metadataCache.on("resolved")` before the first scoring pass — querying earlier yields empty results on cold start.
3. Build in-memory caches from `app.metadataCache.getFileCache(file)`:
   - `file -> { tags, outlinks, backlinks, ctime, mtime, outlinkCount }`
   - Inverted indexes: `tag -> Set<file>`, `link -> Set<file>`
   - IDF tables for tags and links (lazy-recomputed when marked dirty).
4. On active-note change, generate candidates by querying inverted indexes with the active note's tags/outlinks (never full-vault scan), then score that candidate set only. Candidate generation also expands through:
   - Backlink sources with outlinkCount ≤ `FOCUSED_SOURCE_MAX_OUTLINKS` (20) — their other outlinks become candidates, since a focused hub co-citing two notes is discoverable evidence, not just a scoring bonus.
   - Same-folder notes, but only when `folderWeight > 0` (default 0, so no behavior change out of the box).
5. `metadataCache.on("changed")` performs incremental updates; debounce recomputation ~300ms.

### Scoring (mandatory baseline — not optional)

Weighted sum of shared signals (default weights: outlinks 8, tags 5, backlinks 4, direct link 6, title 3, folder 0) with these required adjustments:

- **Direct link** (`directLinkWeight`, default 6): a flat add (no IDF) when the candidate links to the active note but the active note doesn't link back yet — this is distinct from *shared* backlinks (`backlinkWeight`), which score co-citation from a third note, not a direct link between the two notes themselves.
- **Outlink-count penalty**: divide candidate score by `log(1 + outlinkCount)` to suppress MOC/index dominance.
- **Shared-backlink source specificity**: each shared backlink contributes `backlinkWeight / log(1 + sourceOutlinkCount)` — co-citation from a focused note is stronger evidence than co-citation from an MOC (7bdb7ee).
- **Tag IDF**: weight each shared tag by `log(totalNotes / notesWithTag)`.
- **Link IDF**: same for shared outlinks.

Temporal filtering (an `onlyOlderNotes` setting excluding candidates newer than the active note) was considered and **rejected** — do not re-propose it. The owner's workflow allows revising old notes, so linking "forward in time" from an old note to a newer one is legitimate; a chronology filter only makes sense if old notes are immutable.

Displayed scores are **per-query normalized** (top candidate = 100); raw scores stay internal.

Defaults: resolved links only (unresolved `[[wikilinks]]` ignored); aliases not supported in MVP; MVP insertion only **appends to the active note** (never mutates other notes).

### Title-token signal (pure metadata, part of the default experience)

Implemented 2026-07 (plan C). Works with body-token matching off.

- Basenames are tokenized with the segmenter always off — hiragana-only titles are a known gap.
- Shared title tokens add `titleWeight × idf(token)` (default 3, own lazy df/IDF table).
- The n-gram sub-unit gate uses a `standalone` set harvested **from titles themselves** (all titles are in-memory metadata — no body read), so morpheme-straddling 2-grams don't resurface here.
- Candidate expansion (not scoring) is skipped for title tokens with df > 20% of the vault (`TITLE_TOKEN_EXPANSION_MAX_DF_RATIO`) to stop generic title words (メモ, 日記) from exploding the candidate set.

### Body-token matching (optional, OFF by default)

An opt-in enrichment that surfaces notes sharing rare vocabulary even without shared tags/links.

**Tokenization** (note bodies → token → in-body occurrence count map):

- NFKC-normalized; CJK + ASCII; stopword- and markdown-stripped.
- Kanji runs emit the full run plus 2-grams — both gated by the closed-class `KANJI_STOPWORDS` set (pronouns, 以+kanji relative-position compounds), the only JA lexical gate active in the default segmenter-off path.
- Katakana runs emit the full run plus interior sub-words; trailing katakana prolonged marks are normalized.
- All stopword sets live in `src/data/stopwords.ts`, where every entry must belong to a vault-independent rationale category — vault-specific noise belongs in the user's `excludedBodyTokens`, never in source.

**Salience and scoring**:

- Each note keeps its top-N salient tokens (`bodyTokenTopN`) ranked by `log(1 + TF) × IDF` — a token the note genuinely repeats outranks an equally-rare token it only mentions once — **plus a bounded low-df reserve**: after the top-N cut, up to `RESERVE_SIZE` (20) of the note's rarest evicted tokens (`df ≤ RESERVE_DF_MAX`, 10) are added back (`rankSalient`, `bodyTokens.ts`). This recovers genuinely-rare shared vocabulary that a long, vocabulary-rich note pushed out of its top-N when high-TF mid-frequency words filled the budget (see `docs/body-recall-hiragana-decision-2026-07-22.md`). It is **purely additive** — the salient set is always a superset of the top-N — so it touches neither `df` nor `totalNotes` and cannot remove a shared candidate pair (measured: +3,329 pairs, 0 destroyed on the owner's 1,367-note vault). An internal safety valve, not a user setting.
- Each shared salient token adds `bodyTokenWeight × tokenIDF` to the score.
- TF only decides which tokens make the top-N cut. `df` (and therefore IDF, and the df≥2 / df≤40%-of-vault salience gates) stays purely presence-based (0/1 per note), unaffected by within-note repetition, and frozen per rebuild as described below.

**Sub-unit gate (`standalone` set)**: a run's interior sub-units are gated by a corpus `standalone` set — the standalone-word units (kanji 2-grams and whole katakana words) that occur as a word on their own somewhere in the vault.

- A sub-unit is kept only if it appears standalone, so real sub-words survive (`機械`/`学習` from `機械学習`, `バッテリ` from `リチウムバッテリー` when `膨張バッテリー` exists elsewhere) while morpheme-straddling artifacts are dropped (`本語` from `日本語`, `員何` from `全員何も`, the cross-morpheme fragments of katakana compounds). The full run is always kept.
- Katakana sub-words are additionally length-gated (min 3) — 2-char sub-strings are mostly cross-morpheme noise (`ログ` from `ブログ`, `パス` from `コンパス`) and real 2-char words are already caught when they stand alone.
- `standalone` is corpus state built and **frozen per rebuild exactly like `df`** (a unit new to the vault isn't trusted as a word until the next coarse rebuild), harvested from the same single scan that tokenizes each note (`tokenize(body, segment, undefined, collectInto)`); on the query side `tokenize(body, segment, standalone)` applies the same gate.
- This is the one sanctioned corpus dependency inside tokenization — without the set (no corpus yet) every sub-unit is emitted.

**Segmentation**: Japanese segmentation via `tiny-segmenter` (`bodyTokenSegmenterEnabled`, ON by default — promoted 2026-07 after CPU benchmark; see plan F). The corpus and the query must always be tokenized with the same segmenter flag; toggling the setting triggers a corpus rebuild.

When segmentation is enabled, a bounded **hiragana repair lane** patches
context-dependent misses such as `なっていたみかんを` → `たみかん`. Corpus
pass 1 freezes accepted hiragana-only segmenter outputs (length 3+) in a
separate dictionary and provisionally scans maximal hiragana runs for bounded
3..8-character matches; pass 2 drops candidates absent from that dictionary.
Query/refresh gate inline against the frozen dictionary. The repair lane emits
no full hiragana run and deduplicates segmenter/repair output by source span.
It is ranked as an independent additive lane (top 20, df ≤ 10), so baseline
salient sets and candidate pairs cannot be displaced. Segmenter-off behavior is
unchanged. See `docs/body-recall-hiragana-decision-2026-07-22.md`.

**Corpus/query split** — this is what keeps full-text within the constraints, so preserve it:

- **Corpus** (all notes: `df`, per-note `salient`, inverted index) is rebuilt *coarsely* — on enable, on startup, on demand (the settings-tab rebuild button / `Rebuild body-token index` command), and via a **lazy** debounced backstop (~60s after edits settle; manual refresh is the "I need it now" path, so keep the auto rebuild infrequent).
  - The hard boundary is **`df` is never maintained incrementally** — that path caused a df-corruption race and unbounded per-note token retention; df only changes in a full rebuild.
  - Per-note `salient`/`inverted` updates scoped to the affected note ARE sanctioned: an edited note's salient set is re-ranked against the frozen df when its edit settles (Obsidian's autosave → `metadataCache.changed`, ~2s after typing stops), and rename/delete just re-key entries without a body read.
  - The debounced rebuild is event-driven (a trailing debounce), not a polling loop — so it stays within "no always-on background process".
- **Query** (the active note's salient tokens) is computed **fresh on demand** from a single `cachedRead` on each active-note change. This is the only body read in the hot path; it is naturally latest-wins, so the active note always reflects its current text.
- **Persistence**: the corpus is rebuilt from scratch on every startup; nothing is persisted. Fine at current vault sizes. If persistence is ever added, adopt a saved snapshot wholesale and fall back to a full rebuild when anything changed while the vault was closed — never partial-update a persisted corpus (`df` stays rebuild-only).

**Accepted trade-offs**:

- `df` (and therefore IDF, and salience of brand-new vocabulary) lags until the next coarse rebuild. This is intentional — IDF only needs to be statistically right, and vocabulary that is new to the vault cannot produce a shared signal before a rebuild anyway (matching requires df ≥ 2).
- A shared term only matches if it is in **both** notes' salient sets (top-N + low-df reserve), so two long, vocabulary-rich notes can each push a genuinely shared *mid-frequency* topic word out of their own top-N (the low-df reserve only rescues `df ≤ RESERVE_DF_MAX` words). TF×IDF ranking mitigates this (repeated topic words rank high); the ceiling itself is the price of a bounded index — tune `bodyTokenTopN` if it bites, don't index full token sets.
- Benign race: a `refreshNote` whose body read spans a rebuild swap writes a salient set ranked against the old `df` into the new corpus. It self-heals on that note's next edit event, and IDF only needs to be statistically right — **do not add locking for this**.

## Commands

- `npm run dev` — esbuild watch build
- `npm run build` — typecheck (`tsc -noEmit`) + production esbuild bundle to `main.js`
- `npm run typecheck` — typecheck only
- `npm test` / `npm run test:watch` — vitest (pure-function tests under `src/util` and `src/scoring`)
