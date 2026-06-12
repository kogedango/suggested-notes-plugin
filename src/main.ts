import {
  Debouncer,
  Notice,
  Plugin,
  TAbstractFile,
  TFile,
  WorkspaceLeaf,
  debounce,
} from "obsidian";
import { BodyTokenIndex } from "./cache/bodyTokens";
import { InvertedIndex } from "./cache/inverted";
import { MetadataStore } from "./cache/metadata";
import { ScoringEngine } from "./scoring";
import { RelatedNotesSettingTab } from "./settings/tab";
import { DEFAULT_SETTINGS, PluginSettings } from "./types";
import { RelatedNotesView, VIEW_TYPE_RELATED_NOTES } from "./view/sidebar";

const EMPTY_TOKENS: Set<string> = new Set();

const BODY_REBUILD_DEBOUNCE_MS = 60_000;

export default class RelatedNotesPlugin extends Plugin {
  settings!: PluginSettings;
  private store!: MetadataStore;
  private inverted!: InvertedIndex;
  private body!: BodyTokenIndex;
  private scoring!: ScoringEngine;
  private ready = false;
  private scheduleRefresh!: Debouncer<[], void>;
  private bodyIndexBuilding = false;
  private bodyRebuildPending = false;
  private bodyRebuildNotify = false;
  private scheduleBodyRebuild!: Debouncer<[], void>;
  private lastRefreshedPath: string | null = null;
  private refreshVersion = 0;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.store = new MetadataStore(this.app);
    this.inverted = new InvertedIndex(this.store);
    this.body = new BodyTokenIndex(this.app);
    this.scoring = new ScoringEngine(this.store, this.inverted, this.body);

    this.registerView(
      VIEW_TYPE_RELATED_NOTES,
      (leaf) => new RelatedNotesView(leaf, this),
    );

    this.registerHoverLinkSource(VIEW_TYPE_RELATED_NOTES, {
      display: "Suggested Notes",
      // true = require the Cmd/Ctrl modifier to preview, matching Obsidian's
      // default link-hover behaviour (Page Preview owns the modifier gating
      // and its own hover delay). Obsidian's core "Page preview" plugin must
      // be enabled for this to work.
      defaultMod: true,
    });

    this.addSettingTab(new RelatedNotesSettingTab(this.app, this));

    this.addCommand({
      id: "open-suggested-notes",
      name: "Open Suggested Notes sidebar",
      callback: () => this.activateView(),
    });

    this.addCommand({
      id: "rebuild-body-index",
      name: "Rebuild body-token index",
      callback: () => {
        if (!this.settings.bodyTokenEnabled) {
          new Notice("Body-token matching is disabled.");
          return;
        }
        void this.rebuildBodyIndex();
      },
    });

    this.scheduleRefresh = debounce(() => void this.refresh(), 300, true);

    // Auto corpus rebuild: a lazy backstop, not the primary path. Fires only
    // after edits have settled for a full minute — re-tokenizing the whole
    // vault per 3s typing pause was significant CPU (especially with the
    // segmenter on), for a signal that mostly concerns *other* notes. When
    // the corpus needs to be current right now, the settings-tab rebuild
    // button / rebuild command do it on demand. Event-driven (a trailing
    // debounce), not a polling loop — so "no background process" holds.
    this.scheduleBodyRebuild = debounce(
      () => void this.rebuildBodyIndex(),
      BODY_REBUILD_DEBOUNCE_MS,
      true,
    );

    // Active-leaf-change updates immediately if ready, otherwise leaves the
    // loading placeholder in place until resolved fires.
    // Active-leaf-change fires when ANY leaf gains focus, including this
    // sidebar itself. If we re-render unconditionally, clicking a button in
    // the sidebar tears down its own DOM before the click event finishes —
    // hence "copy needs two clicks". Skip when the active file is unchanged.
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        if (!this.ready) {
          this.setLoadingOnAllViews();
          return;
        }
        const active = this.app.workspace.getActiveFile();
        const path = active?.path ?? null;
        if (path === this.lastRefreshedPath) return;
        void this.refresh();
      }),
    );

    this.app.workspace.onLayoutReady(() => {
      this.activateView();
      this.waitForMetadataResolved().then(() => this.initialIndex());
    });

    this.registerEvent(
      this.app.metadataCache.on("changed", (file) => {
        if (!(file instanceof TFile)) return;
        if (file.extension !== "md") return;
        this.reindexFile(file, true);
      }),
    );

    // "changed" fires when the file's metadata is re-parsed, but link
    // resolution (resolvedLinks) updates asynchronously after that. Without
    // also listening to "resolve", a snapshot built on "changed" reflects the
    // PREVIOUS resolution state — which is why newly-added links don't update
    // the already-linked badge until the *next* edit. Per-file "resolve"
    // fires once Obsidian finishes resolving links for one file.
    this.registerEvent(
      this.app.metadataCache.on("resolve", (file) => {
        if (!(file instanceof TFile)) return;
        if (file.extension !== "md") return;
        this.reindexFile(file, false);
      }),
    );

    this.registerEvent(
      this.app.vault.on("delete", (af: TAbstractFile) => {
        if (!(af instanceof TFile) || af.extension !== "md") return;
        if (!this.ready) return;
        const snap = this.store.remove(af.path);
        if (snap) this.inverted.remove(snap);
        // No body re-read needed: text didn't change, just drop the entry.
        this.body.remove(af.path);
        this.scoring.markDirty();
        this.scheduleRefresh();
      }),
    );

    this.registerEvent(
      this.app.vault.on("rename", (af: TAbstractFile, oldPath: string) => {
        if (!(af instanceof TFile) || af.extension !== "md") return;
        if (!this.ready) return;
        const { prev, next } = this.store.rename(oldPath, af);
        if (prev) this.inverted.remove({ ...prev, path: oldPath });
        this.inverted.add(next);
        // No body re-read needed: text didn't change, just re-key the entry.
        this.body.rename(oldPath, af.path);
        this.scoring.markDirty();
        this.scheduleRefresh();
      }),
    );
  }

  onunload(): void {
    // Drop any pending trailing debounces so they can't fire after unload.
    this.scheduleRefresh.cancel();
    this.scheduleBodyRebuild.cancel();
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      await this.loadData(),
    );
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  // Settings text fields call this per keystroke; route through the debounced
  // refresh so typing "20" doesn't run a full scoring pass on the "2".
  invalidateAll(): void {
    this.scoring.markDirty();
    this.scheduleRefresh();
  }

  // Rebuilds the body-token corpus. Triggered on enable, on startup, by the
  // manual command / settings-tab button, and by the lazy post-edit timer.
  // If a rebuild is requested while one is running, we run once more
  // afterwards rather than dropping it — so the corpus always ends up
  // reflecting the latest edits. `notify` posts a Notice when this (or, if a
  // build is already running, that build's final pass) has finished.
  async rebuildBodyIndex(notify = false): Promise<void> {
    // Whatever queued this lazy timer, the work is happening now.
    this.scheduleBodyRebuild.cancel();
    if (!this.ready) return;
    if (!this.settings.bodyTokenEnabled) {
      this.body.clear();
      void this.refresh();
      return;
    }
    if (notify) this.bodyRebuildNotify = true;
    if (this.bodyIndexBuilding) {
      this.bodyRebuildPending = true;
      return;
    }
    this.bodyIndexBuilding = true;
    try {
      do {
        this.bodyRebuildPending = false;
        await this.body.rebuildAll(
          this.settings.bodyTokenTopN,
          this.settings.bodyTokenSegmenterEnabled,
        );
      } while (this.bodyRebuildPending);
    } finally {
      this.bodyIndexBuilding = false;
    }
    if (this.bodyRebuildNotify) {
      this.bodyRebuildNotify = false;
      new Notice("Body-token index rebuilt.");
    }
    void this.refresh();
  }

  private waitForMetadataResolved(): Promise<void> {
    return new Promise((resolve) => {
      // If already resolved (resolvedLinks populated for at least one file),
      // proceed; otherwise wait once for the event.
      const cache = this.app.metadataCache;
      if (Object.keys(cache.resolvedLinks).length > 0) return resolve();
      const ref = cache.on("resolved", () => {
        cache.offref(ref);
        resolve();
      });
      this.registerEvent(ref);
    });
  }

  private initialIndex(): void {
    this.store.rebuildAll();
    this.inverted.rebuild();
    this.scoring.markDirty();
    this.ready = true;
    void this.refresh();
    if (this.settings.bodyTokenEnabled) {
      void this.rebuildBodyIndex();
    }
  }

  // Shared by the "changed" and "resolve" handlers: re-snapshot the file and
  // refresh. Only "changed" implies the body text moved — "resolve" is link
  // resolution catching up, and body tokens don't depend on resolvedLinks, so
  // it skips scheduling the (expensive) corpus rebuild.
  private reindexFile(file: TFile, bodyMayHaveChanged: boolean): void {
    if (!this.ready) return;
    const { prev, next } = this.store.update(file);
    if (prev) this.inverted.remove(prev);
    this.inverted.add(next);
    this.scoring.markDirty();
    if (bodyMayHaveChanged && this.settings.bodyTokenEnabled) {
      // Two corpus paths: the edited note's salient set is touched up right
      // away (cheap, df untouched) so fresh text is discoverable from other
      // notes immediately; the full rebuild stays a lazy backstop that
      // refreshes df. The active note's own query tokens are read fresh at
      // refresh time regardless.
      void this.body
        .refreshNote(
          file,
          this.settings.bodyTokenTopN,
          this.settings.bodyTokenSegmenterEnabled,
        )
        .then(() => this.scheduleRefresh());
      this.scheduleBodyRebuild();
    }
    this.scheduleRefresh();
  }

  private relatedViews(): RelatedNotesView[] {
    return this.app.workspace
      .getLeavesOfType(VIEW_TYPE_RELATED_NOTES)
      .map((l) => l.view)
      .filter((v): v is RelatedNotesView => v instanceof RelatedNotesView);
  }

  private setLoadingOnAllViews(): void {
    for (const view of this.relatedViews()) view.setLoading();
  }

  private async refresh(): Promise<void> {
    // Generation guard: every refresh claims a version up front. The async
    // body read below lets refreshes overlap (and even two for the *same*
    // note can finish out of order), so before rendering we check we are
    // still the latest — otherwise a slower earlier pass could overwrite a
    // newer one with stale results.
    const version = ++this.refreshVersion;

    const views = this.relatedViews();
    if (views.length === 0) return;

    const active = this.app.workspace.getActiveFile();
    if (!active || active.extension !== "md") {
      this.lastRefreshedPath = null;
      for (const v of views) v.setNoActive();
      return;
    }
    if (!this.ready) {
      for (const v of views) v.setLoading();
      return;
    }

    // The active note's body tokens are read fresh on demand.
    const activeBodyTokens =
      this.settings.bodyTokenEnabled && this.body.isBuilt()
        ? await this.body.computeSalient(
            active,
            this.settings.bodyTokenTopN,
            this.settings.bodyTokenSegmenterEnabled,
          )
        : EMPTY_TOKENS;
    // A newer refresh started while we were reading — let it render instead.
    if (version !== this.refreshVersion) return;

    // Set only once we've committed to rendering this note: a discarded
    // pass must not leave lastRefreshedPath claiming a note we never showed.
    this.lastRefreshedPath = active.path;

    const { results, tagPool } = this.scoring.score(
      active.path,
      this.settings,
      activeBodyTokens,
    );
    const suggestedTags = this.scoring.suggestTags(
      active.path,
      tagPool,
      this.settings,
    );
    for (const v of views) v.setResults(active.path, results, suggestedTags);
  }

  async addTagToActive(activePath: string, tag: string): Promise<void> {
    const active = this.app.workspace.getActiveFile();
    if (!active || active.path !== activePath) {
      new Notice("Active note has changed.");
      return;
    }
    await this.app.fileManager.processFrontMatter(active, (fm) => {
      const existing = fm.tags;
      if (Array.isArray(existing)) {
        if (!existing.includes(tag)) existing.push(tag);
      } else if (typeof existing === "string") {
        const parts = existing
          .split(/[\s,]+/)
          .map((s) => s.replace(/^#/, ""))
          .filter(Boolean);
        if (!parts.includes(tag)) parts.push(tag);
        fm.tags = parts;
      } else {
        fm.tags = [tag];
      }
    });
    new Notice(`+#${tag}`);
  }

  async activateView(): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null =
      workspace.getLeavesOfType(VIEW_TYPE_RELATED_NOTES)[0] ?? null;
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      if (leaf)
        await leaf.setViewState({
          type: VIEW_TYPE_RELATED_NOTES,
          active: true,
        });
    }
    if (leaf) workspace.revealLeaf(leaf);
  }

  async copyLinkToClipboard(
    activePath: string,
    targetPath: string,
  ): Promise<void> {
    const targetFile = this.app.vault.getAbstractFileByPath(targetPath);
    if (!(targetFile instanceof TFile)) return;
    const link = this.app.fileManager.generateMarkdownLink(
      targetFile,
      activePath,
    );
    await navigator.clipboard.writeText(link);
  }
}
