import {
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

export default class RelatedNotesPlugin extends Plugin {
  settings!: PluginSettings;
  private store!: MetadataStore;
  private inverted!: InvertedIndex;
  private body!: BodyTokenIndex;
  private scoring!: ScoringEngine;
  private ready = false;
  private scheduleRefresh!: () => void;
  private bodyIndexBuilding = false;
  private lastRefreshedPath: string | null = null;

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
      // false = preview on plain hover (no Cmd/Ctrl needed). Obsidian's core
      // "Page preview" plugin must be enabled for this to work.
      defaultMod: false,
    });

    this.addSettingTab(new RelatedNotesSettingTab(this.app, this));

    this.addCommand({
      id: "open-suggested-notes",
      name: "Open Suggested Notes sidebar",
      callback: () => this.activateView(),
    });

    this.scheduleRefresh = debounce(() => this.refresh(), 300, true);

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
        this.refresh();
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
        this.onFileChanged(file);
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
        this.onFileResolved(file);
      }),
    );

    this.registerEvent(
      this.app.vault.on("delete", (af: TAbstractFile) => {
        if (!(af instanceof TFile) || af.extension !== "md") return;
        if (!this.ready) return;
        const snap = this.store.remove(af.path);
        if (snap) this.inverted.remove(snap);
        if (this.settings.bodyTokenEnabled) this.body.removeFile(af.path);
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
        if (this.settings.bodyTokenEnabled) {
          this.body.renameFile(oldPath, af.path);
        }
        this.scoring.markDirty();
        this.scheduleRefresh();
      }),
    );
  }

  onunload(): void {}

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

  invalidateAll(): void {
    this.scoring.markDirty();
    this.refresh();
  }

  // Called by settings tab when bodyTokenEnabled toggles on, or topN changes.
  async rebuildBodyIndex(): Promise<void> {
    if (!this.ready) return;
    if (!this.settings.bodyTokenEnabled) {
      this.body.clear();
      this.refresh();
      return;
    }
    if (this.bodyIndexBuilding) return;
    this.bodyIndexBuilding = true;
    try {
      await this.body.rebuildAll(this.settings.bodyTokenTopN);
    } finally {
      this.bodyIndexBuilding = false;
    }
    this.refresh();
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
    this.refresh();
    if (this.settings.bodyTokenEnabled) {
      void this.rebuildBodyIndex();
    }
  }

  private onFileChanged(file: TFile): void {
    if (!this.ready) return;
    const { prev, next } = this.store.update(file);
    if (prev) this.inverted.remove(prev);
    this.inverted.add(next);
    this.scoring.markDirty();
    if (this.settings.bodyTokenEnabled) {
      void this.body
        .updateFile(file, this.settings.bodyTokenTopN)
        .then(() => this.scheduleRefresh());
    }
    this.scheduleRefresh();
  }

  // Re-snapshot when link resolution catches up. Body tokens don't depend on
  // resolvedLinks so we skip the (expensive) async re-tokenize here.
  private onFileResolved(file: TFile): void {
    if (!this.ready) return;
    const { prev, next } = this.store.update(file);
    if (prev) this.inverted.remove(prev);
    this.inverted.add(next);
    this.scoring.markDirty();
    this.scheduleRefresh();
  }

  private setLoadingOnAllViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(
      VIEW_TYPE_RELATED_NOTES,
    )) {
      const view = leaf.view as RelatedNotesView;
      view.setLoading();
    }
  }

  private refresh(): void {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_RELATED_NOTES);
    if (leaves.length === 0) return;

    const active = this.app.workspace.getActiveFile();
    if (!active || active.extension !== "md") {
      this.lastRefreshedPath = null;
      for (const l of leaves) (l.view as RelatedNotesView).setNoActive();
      return;
    }
    if (!this.ready) {
      for (const l of leaves) (l.view as RelatedNotesView).setLoading();
      return;
    }
    this.lastRefreshedPath = active.path;

    const results = this.scoring.score(active.path, this.settings);
    const suggestedTags = this.scoring.suggestTags(
      active.path,
      results,
      this.settings,
    );
    for (const l of leaves)
      (l.view as RelatedNotesView).setResults(
        active.path,
        results,
        suggestedTags,
      );
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
