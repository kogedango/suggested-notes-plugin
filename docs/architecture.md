# Suggested Notes architecture

This document describes the current, normative architecture of Suggested Notes.
Historical tokenizer experiments and superseded plans remain available in Git
history and the experimental branches; they are not part of the current
specification.

## Product constraints

- Analyze Japanese and English locally without AI, embeddings, or network
  calls.
- Show metadata-based suggestions before morphology initialization finishes.
- Treat mixed-language text by span rather than assigning one language to an
  entire note.
- Use part of speech and analyzer lemmas/basic forms instead of bundled
  stopword lists or word-specific conjugation repairs.
- Do not infer or automatically register Vault-specific vocabulary from corpus
  frequency.
- Keep per-query candidate lookup bounded with inverted indexes.
- Keep the desktop implementation compatible with mobile APIs; actual mobile
  support is gated by the checks in [mobile-testing.md](mobile-testing.md).

## Analysis pipeline

```text
Markdown text
  -> remove frontmatter, code, URLs, links, tags, and structure
  -> protect explicitly registered Vault terms
  -> split the remaining text into Japanese and English spans
  -> Japanese: Kuromoji/IPADIC
  -> English: wink-nlp
  -> identifiers: identifier normalization
  -> common CanonicalToken representation
  -> title/body document frequency and inverted indexes
  -> candidate generation and scoring
```

All analyzers produce:

```ts
interface CanonicalToken {
  key: string;
  language: "ja" | "en" | "identifier" | "custom";
  pos: string;
}
```

`key` is the value used for counting, indexing, exclusions, and scoring.
`language` and `pos` retain enough provenance for tests and auditing.

## Japanese

The Japanese analyzer retains:

- ordinary nouns;
- independent verbs, normalized to their IPADIC basic form;
- independent adjectives, normalized to their IPADIC basic form;
- adverbs;
- unknown and proper nouns unless their part of speech gives a reason to drop
  them.

Particles, auxiliary verbs, conjunctions, pronouns, dependent words, standalone
prefixes/suffixes, counters, numbers, and symbols are excluded.

Examples:

```text
道具を使った           -> 道具, 使う
道具を使わない         -> 道具, 使う
暑かったので窓を開けた -> 暑い, 窓, 開ける
急いだ                 -> 急ぐ
```

### Compound nouns

For a contiguous Japanese noun run, the analyzer retains ordinary component
keys and emits:

- valid two- and three-part contiguous compounds;
- one maximal compound for a run of four or more parts;
- noun-connecting prefixes only when joined to a following noun;
- non-counter suffixes only when joined to a preceding noun.

Numbers, counters, whitespace, punctuation, particles, and verbs break a run.
Component keys are not suppressed or decayed merely because a compound key
also exists.

```text
機械学習
  -> 機械, 学習, 機械学習

自然言語処理
  -> 自然, 言語, 処理, 自然言語, 言語処理, 自然言語処理
```

Adjacent English nouns, proper nouns, identifiers, and atomic custom terms may
participate when their source spans touch exactly:

```text
API設計       -> api, 設計, api設計
Web開発       -> web, 開発, web開発
```

They never join across whitespace, punctuation, or grammatical tokens.

## English and identifiers

The English analyzer retains nouns, proper nouns, main verbs, adjectives, and
adverbs. It uses wink lemmas and applies guarded noun singularization:

```text
uses, using -> use
plugins     -> plugin
values      -> value
```

Singularization is not accepted when it would collapse an `s`-final word to an
unrelated short key, such as `js -> j` or `lens -> len`.

Technical identifiers are normalized to lowercase and retained separately from
ordinary English words. Unknown alphabetic words are preserved unless the
analyzer supplies grammatical evidence to discard them.

## Vault-specific vocabulary

Users can protect product names, personal names, and specialist terms that a
general dictionary would otherwise split.

- One line contains one term or one alias group.
- `canonical|alias|alias` maps every spelling to the first spelling.
- Alias groups that share a spelling are merged transitively.
- The longest valid match wins at a position.
- ASCII matching is case-insensitive and requires identifier boundaries.
- A protected term is atomic internally but may join an adjacent noun compound.
- The same vocabulary is applied to titles and bodies.
- Vocabulary is never learned automatically.

Ordinary custom terms are matched against NFKC-normalized text. Terms containing
Unicode symbol characters, such as `C++`, are protected before symbol removal
and therefore require the same symbol spelling in the source text; their ASCII
letters remain case-insensitive.

## Indexes and startup

Startup order is an invariant:

1. Load settings and register views, settings, commands, and events.
2. Wait for Obsidian metadata resolution.
3. Build metadata snapshots and inverted indexes.
4. Restore a valid persisted morphology cache when available.
5. Render tag/link/backlink results without waiting for morphology.
6. Initialize one Japanese analyzer and one English analyzer.
7. Share the analyzer pair between titles, bodies, and user exclusions.
8. Synchronize title tokens in bounded chunks.
9. Synchronize the body corpus when body matching is enabled.

Titles are updated on create, rename, and delete. A body edit does not rebuild
all titles.

Body matching is enabled by default. Turning it off avoids the Vault-wide body
corpus while retaining title content and metadata signals. Existing note edits
update document frequency exactly and rerank affected notes. Create, rename,
and delete operations recompute the necessary corpus state. Completed rebuilds
are swapped atomically.

The persisted morphology cache is versioned and signed by analysis-affecting
settings. A valid cache can provide early lexical results while changed and new
notes are synchronized in the background.

It is stored in `morphology-cache.json` inside the plugin folder, not in
`data.json`. `saveData` rewrites its entire payload, so a cache kept there made
every settings change write a vault-sized file. `data.json` now holds the
settings alone and its size no longer follows the Vault's.

The cache file is written whole, so writing timing rather than write size is
what bounds the cost:

- a note edit only marks the cache dirty;
- a periodic flush writes it when dirty, as does plugin unload;
- startup synchronization skips the write when restored paths and body file
  stamps are unchanged;
- rebuilds and custom-vocabulary changes flush immediately, because those are
  the states a cold start would otherwise redo.

Nothing in the file is authoritative. A missing, truncated, or stale cache is
treated exactly like a cold start: entry validation in `TitleTokenIndex.restore`
and `BodyTokenIndex.restore` rejects a malformed snapshot whole rather than
restoring part of it, and the corpus is rebuilt. A cache found in an earlier
`data.json` is reused once and moved to the cache file on the next flush.

## Memory

Peak resident memory, not throughput, is the binding constraint. A mobile
Obsidian process is killed for allocating, not for being slow. Three
representations dominate: the IPADIC dictionary buffers, the per-note token maps
of the title and body indexes, and the transient copies made while a cache
snapshot is serialized.

### Dictionary buffers

The shipped IPADIC `.dat` files are the builder's raw allocations rather than its
shrunk output. `tid.dat` is a 10 MB `ByteBuffer` carrying 3.74 MB of records,
`unk.dat` a 10 MB buffer carrying 400 bytes, `unk_invoke.dat` a 1 MB buffer
carrying 153 bytes. Kuromoji loads each buffer whole and holds it for the
session. `base.dat`/`check.dat` are shrunk by doublearray's own constructor, but
with `subarray()`, and that view retains the complete decompressed
`ArrayBuffer`.

`dictionaryBuffers.ts` copies each buffer's live range before it reaches
Kuromoji:

| Buffer | Loaded whole | Live range |
| --- | ---: | ---: |
| `base` + `check` | 16.00 MB | 10.34 MB |
| `tid.dat` | 10.00 MB | 3.74 MB |
| `tid_pos.dat` | 40.00 MB | 34.36 MB |
| `tid_map.dat` | 4.00 MB | 3.98 MB |
| `cc.dat` | 3.30 MB | 3.30 MB |
| `unk.dat` / `unk_pos` / `unk_map` | 21.00 MB | 2.2 KB |
| `unk_compat.dat` | 0.25 MB | 0.12 MB |
| `unk_invoke.dat` | 1.00 MB | 153 B |
| Total | 95.6 MB | 55.9 MB |

`cc.dat` is allocated as exactly `forward × backward + 2` entries and is fully
live, so it is passed through unchanged.

The compaction is lossless by derivation, not by sampling:

- The token-info target map is the authoritative list of record offsets, and each
  ten-byte record points at one null-terminated feature string. The live lengths
  follow from those references, and the discarded tails of `tid.dat`,
  `tid_pos.dat`, `tid_map.dat`, `unk.dat`, `unk_pos.dat`, `unk_map.dat`, and
  `unk_invoke.dat` are entirely zero — they are builder padding and nothing else.
- `compactDoubleArrayBuffers` reproduces doublearray's `shrink()` exactly,
  including the one unused slot retained after the final node. The double-array
  tail holds free-list values rather than zeros, so it is the one buffer whose
  safety rests on matching that routine rather than on a zero tail.
- `unk_compat.dat` is the only buffer whose discarded tail is live-format data.
  Dropping it is equivalent because `lookupCompatibleCategory` treats an
  out-of-range code point exactly like a stored zero. IPADIC defines one
  compatible category (KANJINUMERIC): sixteen nonzero entries, the highest at
  U+767E, which is why the live length is 30335 of 65536.
- Trimming `unk_invoke.dat` cannot produce an out-of-range character class:
  `unk_char.dat` uses class ids 1 through 10 and the compacted invoke map defines
  0 through 10. This matters because `CharacterDefinition.lookup` returns
  `getCharacterClass` without a null check. It also stops
  `InvokeDefinitionMap.load` from constructing roughly 150,000 empty
  `CharacterClass` objects from the zero padding, which costs more than the
  megabyte itself.

These are assumptions about a third-party binary layout: ten-byte records, the
feature offset at `+6`, little-endian words, the target-map header, and
doublearray's free-list convention. A Kuromoji upgrade that changes any of them
produces plausible but wrong lengths. Where the change is detectable the module
throws, `initializeMorphology` catches it, and results degrade to metadata only —
consistent with the startup contract. Where it is not detectable the failure is
silent token corruption, so the guard is a test that asserts the discarded range
of each real dictionary file is entirely zero. Tests built from synthetic buffers
share the module's assumptions and cannot catch a layout change; differential
tokenization is also weak here, because the discarded regions are unreachable by
construction and a deliberately corrupted length still tokenizes ordinary text
identically.

Compaction lowers steady state and raises peak. While
`compactTokenInfoBuffers` runs, the decompressed source and its copy are both
reachable, so the peak moves from about 95.6 MB to about 102 MB. The trade is
worth it overall, but it is not uniform: `tid_pos.dat` spends 34.36 MB of
transient allocation to reclaim 5.64 MB, and passing that one buffer through
unchanged would trade a 5.6 MB larger steady state for a roughly 34 MB lower
peak. Nesting `decompress` calls inside the compaction call is what keeps the
sources reachable; sequential statements would lower the peak without changing
the steady state.

### Index token maps

Per-note token sets in `TitleTokenIndex` and per-note count maps in
`BodyTokenIndex` are immutable once inserted. Add, remove, rename, and refresh
replace the outer map's entry with a newly built set or map; they never mutate an
existing one.

This is normative, and it is what lets `syncAll` share unchanged entries with the
map it is about to replace instead of copying them. Without it, every
synchronization pass would hold two complete copies of the vault's tokens while
the atomic swap was in progress. Any future code that mutates an inner set or map
in place must first stop that sharing.

Tests should assert the invariant, not the sharing. Identity assertions after
`syncAll` still pass if someone later mutates an inner map; a test that runs
`add`, `remove`, and `rename` and then checks that a previously returned set is
unchanged does not.

### The loaded cache snapshot

`loadedMorphologyCache` holds the deserialized cache and is only an input to
`restore`. Once the live indexes exist they can produce the next snapshot
themselves, so the field is released as soon as restoration finishes; keeping it
would hold a second vault-sized representation for the session. The
`currentMorphologyCache` fallback that read it required a matching vocabulary
signature, which no longer holds once the live indexes have diverged, so
releasing it changes no behaviour.

### Unrealized improvements

Costs that remain in the code. Recorded so they are not re-derived, and ordered
by size. The dictionary figures above are measured; the rest are structural
readings of the code and are not profiled, so treat their magnitudes as shapes
rather than numbers.

**Retained compressed dictionary payloads — about 19 MB, steady state.** The
`.gz` imports are base64 literals in `main.js`, decoded by esbuild's binary
loader into module-scope `Uint8Array`s. The module sits behind the dynamic
`import("./analysis/runtime")`, so nothing is decoded until morphology starts —
but once `createJapaneseAnalyzer` returns, the compressed bytes are still bound
at module scope and stay reachable for the session, alongside the decompressed
buffers they produced. An imported binding cannot be reassigned, so releasing
them means not holding them as module bindings: reading the dictionary from
plugin-folder assets would do it, at the cost of the single self-contained
`main.js` that the licensing and distribution rules depend on. This is now the
largest single steady-state item and the least convenient to remove.

**Cache serialization holds three representations — transient, scales with the
Vault.** `flushMorphologyCache` calls `snapshot()` on both indexes, which
materializes every per-note map as a fresh array, and then hands the result to
`JSON.stringify`. The live indexes, the snapshot arrays, and the JSON string are
all reachable at that moment. Reading is the same shape in reverse:
`adapter.read` returns the whole file as one string, `JSON.parse` builds the
whole object, and `restore` then builds the Maps. This is the largest memory
event after startup, and unlike the startup dictionary peak it recurs on every
periodic flush. Reducing it means streaming or chunking the cache format, which
trades against the "written whole, nothing authoritative" property that makes a
truncated file safe to discard.

**`tid_pos.dat` compaction is a poor peak/steady trade.** Covered above: 34.36 MB
transient to reclaim 5.64 MB. Passing that one buffer through uncompacted is a
single-line change if peak turns out to matter more than steady state.

**Index rebuilds duplicate the token → paths sets.** `BodyTokenIndex.recompute`
and `TitleTokenIndex.replaceTokens` construct a complete new inverted index while
the old one is still live. The per-note entries are shared after the change
described under Index token maps, but the inverted and salient maps are not, so a
rebuild still holds two copies of that structure.

**Whole-body token arrays are materialized to be immediately folded.**
`BilingualMorphologyAnalyzer.analyze` returns a `CanonicalToken[]` with one
object per occurrence across the entire note, and `tokenize` — the only caller on
the indexing path — reduces it to a count map. Counting during analysis would
avoid the intermediate array. Related: `analyzePreparedLine` ends with
`out.push(...analysis.tokens)`, which passes one argument per token and will
throw on a pathologically long single line.

**`BodyTokenIndex.pathRevisions` never drops entries.** `remove` and `rename`
bump the revision for a path and delete its counts and stamps, but leave the
revision entry behind. One small entry per path ever touched, growing without
bound across a session. Pruning is safe only where no read for that path is in
flight, which is what the revision exists to detect — so the fix belongs with the
in-flight bookkeeping, not with `remove`.

## Content field and scoring

A note's lexical field is:

```text
all title tokens UNION salient body tokens
```

The same canonical token contributes once even if it appears in both title and
body. Body salience uses `log(1 + TF) * IDF`, document frequency from 2 through
40% of the corpus, a configurable top-N, and a bounded low-df reserve. Title
tokens are retained outside the body top-N.

Candidate generation uses inverted indexes for:

- shared tags;
- shared outlinks;
- shared backlinks and focused co-citation sources;
- asymmetric direct links;
- exact unlinked title mentions;
- shared title/body content;
- same-folder candidates when folder weight is non-zero.

Lexical candidate expansion is capped at 40% document frequency. Common content
words may still explain an already-discovered candidate but do not broaden the
candidate set.

Raw scores combine the configured signal weights and are divided by:

```text
max(1, log(1 + candidate outlink count))
```

Shared content reasons are ordered by descending IDF before display.

## Unlinked title mentions

The active body is checked for an exact plain-text occurrence of a candidate's
full basename. Existing links, frontmatter, code, URLs, tags, and image links
are excluded. Matching is NFKC-normalized and ASCII case-insensitive.
One-character titles and ambiguous duplicate basenames are ignored; the
longest title wins when matches overlap at the same position.

This signal reads only the active body and works when the Vault-wide body index
is disabled. A weight of zero disables the scan.

## Licensing and distribution

Production code and model/dictionary data are bundled into `main.js` so the
plugin works offline and can be installed through standard Obsidian and BRAT
flows. The build generates `THIRD_PARTY_NOTICES.md` from installed license
files and embeds the exact same notices in a legal banner at the beginning of
`main.js`.

Production builds inspect the esbuild metafile and fail if a bundled package has
no declared notice, or if a declared notice no longer corresponds to bundled
code.

## Verification

Every release candidate must pass:

```sh
npm run typecheck
npm test
npm run build
```

Fixed tests cover Japanese inflections, English lemmas and guarded
singularization, mixed-language routing, grammatical-word removal, punctuation,
proper nouns and identifiers, custom vocabulary and aliases, compound nouns,
cache behavior, and scoring.

Dictionary buffer compaction is verified against the installed dictionary files,
not only synthetic buffers. The tests assert the expected live lengths, verify
that token-info and unknown-word discarded ranges are entirely zero, compare the
double-array length with the upstream loader's own `shrink()`, and confirm that
the compacted invoke map defines the expected eleven character classes.

Mobile release readiness is tracked separately in
[mobile-testing.md](mobile-testing.md).
