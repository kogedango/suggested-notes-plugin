# CLAUDE.md

## Product constraints

- No AI, embeddings, network calls, or always-on background process.
- Metadata results must be available before morphology initialization finishes.
- Body-token matching is on by default. Turning it off is the lightweight mode
  that avoids a Vault-wide body corpus while retaining title tokens.
- Japanese and English are equal analysis targets; mixed-language notes are
  routed by text span, never classified as one language.
- Do not add built-in stopword lists or word-specific conjugation repairs.
- Do not use one vault's counts as a general language-policy justification.

The normative implementation design is `docs/architecture.md`.

## Startup

1. Load settings and register the view, settings, commands, and events.
2. Wait for Obsidian metadata resolution.
3. Build metadata caches and render tag/link/backlink results.
4. Restore a valid persisted morphology cache for early lexical results. It
   lives in `morphology-cache.json` in the plugin folder; `data.json` holds
   settings only. Edits mark the cache dirty and a periodic flush writes it —
   never write it per edit.
5. Dynamically initialize one Kuromoji/IPADIC analyzer and one wink-nlp
   English analyzer.
6. Share that analyzer pair between titles, bodies, and user exclusions.
7. Synchronize title tokens in bounded chunks and refresh.
8. Synchronize the body corpus only when `bodyTokenEnabled` is true.

Do not move morphology initialization ahead of metadata rendering.

## Canonical vocabulary

All analysis produces:

```ts
interface CanonicalToken {
  key: string;
  language: "ja" | "en" | "identifier" | "custom";
  pos: string;
}
```

- Japanese: retain nouns, independent verbs/adjectives, and adverbs; use
  IPADIC basic forms.
- Japanese noun runs: retain ordinary noun components, emit valid contiguous
  two- and three-part compounds, and add one maximal key for runs of four or
  more parts. Noun-connecting prefixes and non-counter suffixes participate
  only inside valid compounds. Numbers, counters, spaces, punctuation,
  particles, and verbs break runs. Do not suppress or decay component keys.
- Adjacent English nouns/proper nouns/identifiers and atomic custom terms may
  join a Japanese noun run when their source spans touch exactly. Preserve
  source offsets internally; never join across whitespace, punctuation, or
  grammatical tokens, and never reanalyze a custom term's interior.
- English: retain nouns, main verbs, adjectives, and adverbs; use wink lemmas
  and noun singularization.
- Drop grammatical POS, numbers, punctuation, Markdown structure, code, URLs,
  links, and tags.
- Preserve unknown words and proper nouns unless there is grammatical evidence
  to discard them.
- Apply NFKC consistently to ordinary analysis and custom terms. Symbol-bearing
  custom terms are protected before symbol removal and require the same symbol
  spelling in source text.
- Protect user vocabulary by exact longest match before language routing.
  Support `canonical|alias|alias` groups, including transitive alias merging.

Vocabulary filtering has three layers only: POS, corpus df, and explicit user
exclusions.

## Indexes

- Metadata: incremental snapshots and inverted indexes.
- Titles: asynchronous initial build, then add/rename/delete updates. A body
  edit must not trigger a full title rebuild.
- Bodies: coarse full rebuilds atomically swap df and salient/inverted maps.
  An existing note edit updates df exactly and reranks the affected notes;
  create, rename, and delete operations recompute the corpus. Active-note
  tokens are computed fresh.
- Titles and salient bodies form one lexical candidate field whose expansion
  is gated at 40% df. Body salience uses df >= 2, df <= 40% of the corpus,
  TF×IDF top-N, and the bounded low-df reserve.

## Verification

- `npm run typecheck`
- `npm test`
- `npm run build`

Fixed examples must cover Japanese inflections, English lemma/singular forms,
mixed-language routing, grammatical-word removal, punctuation removal,
proper nouns/identifiers, and longest-match custom vocabulary.
