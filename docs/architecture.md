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

Mobile release readiness is tracked separately in
[mobile-testing.md](mobile-testing.md).
