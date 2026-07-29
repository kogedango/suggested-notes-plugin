# Mobile testing for v0.6.4

Status: **basic use through v0.6.1 verified on an iPhone 13; v0.6.4 long-press
copy, startup cache, and full resource checks pending**.

`manifest.json` declares `isDesktopOnly: false`, and the implementation avoids
desktop-only APIs. This document is the release gate for claiming mobile
support in user-facing documentation.

## Build under test

- Version: `0.6.4`
- Distribution: GitHub prerelease installed through BRAT
- Bundle: approximately 27.5 MB, primarily the embedded IPADIC dictionary
- Network access at runtime: none

Record the tested commit and exact bundle size for each test round.

## Test matrix

| Platform | OS version | Device | Obsidian version | Vault size | Result |
|---|---|---|---|---:|---|
| iOS/iPadOS | Not recorded | iPhone 13 | Not recorded | Not recorded | Basic use through v0.6.1 passed; v0.6.4 pending |
| Android | — | — | — | — | Pending |

Only platforms required for the release need a passing result. Untested
platforms must remain explicitly labeled as unverified.

## Installation

1. Back up the Vault or use a representative test Vault.
2. Install and enable BRAT from Community plugins.
3. Add `kogedango/suggested-notes-plugin` as a beta plugin.
4. Select the `0.6.4` prerelease and enable Suggested Notes.
5. Fully quit and restart Obsidian before cold-start measurements.

## Required checks

### Installation and startup

- BRAT downloads and enables the plugin without an error.
- Obsidian can reopen the Vault after a full process termination.
- Metadata-based suggestions appear before morphology initialization finishes.
- The UI remains responsive while the Japanese and English analyzers initialize.
- The plugin does not crash or get disabled after initialization.

### Indexes and cache

- The first title/body index completes with body matching enabled.
- Results refresh after the index becomes available.
- A second cold start restores cached lexical results before synchronization.
- Creating, editing, renaming, and deleting a note updates results.
- Disabling body matching avoids the Vault-wide body corpus.
- Re-enabling body matching and using Rebuild completes successfully.

### User-visible behavior

- Japanese inflections produce sensible shared words.
- English inflections and plurals normalize as expected.
- Mixed terms such as `API設計` remain usable.
- Vault-specific vocabulary and aliases work.
- Unlinked title mentions work without counting existing links.
- A row tap opens the note, a score tap toggles its details, and a row long
  press copies the link without also opening the note.
- Releasing an armed long press flashes the row and shows the check-marked
  copied label clearly without shifting the list.
- The long-pressed link pastes correctly into a note. WebKit refuses clipboard
  writes without user activation, so a silent no-op here means the write is
  running outside the touch handler.
- A row tap immediately after a long press opens the note as usual.
- Dragging away before releasing cancels the copy and leaves no highlight.
- Tag-add and settings controls remain usable.

### Resource observations

Record:

- time from Vault open to metadata suggestions;
- time until morphology-backed title results appear;
- time until the first body index completes;
- second-start behavior with a warm persisted cache;
- visible freezes, OS memory warnings, crashes, or plugin unloads;
- approximate battery impact during the first full index.

Do not treat one fast desktop benchmark as evidence for mobile. Test with a
representative Vault and report the number and approximate size of Markdown
files.

## Release decision

Mobile support can be stated without qualification only when:

- installation succeeds on every required platform;
- repeated cold starts do not crash or leave the plugin unusable;
- the first index completes without unacceptable blocking;
- incremental edits and the persisted cache work;
- no major false tokenization or missing-result regression appears in normal
  use.

If a required platform fails, keep the prerelease label and either reduce the
dictionary/runtime cost or set `isDesktopOnly: true` before a desktop-only
release.
