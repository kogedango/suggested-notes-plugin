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
import {
  morphologyCachePath,
  readMorphologyCacheFile,
  writeMorphologyCacheFile,
  writeMorphologyCacheFileStreaming,
} from "./cache/cacheFile";
import {
  MORPHOLOGY_CACHE_VERSION,
  extractLegacyMorphologyCache,
  hasLegacyMorphologyCache,
  isPersistedPluginData,
  isUsableMorphologyCache,
  morphologyCacheSignature,
  type MorphologyCacheSnapshot,
} from "./cache/morphologyCache";
import { TitleTokenIndex } from "./cache/titleTokens";
import type { MorphologyAnalyzer, TokenCounter } from "./analysis/types";
import { t } from "./i18n";
import { ScoringEngine } from "./scoring";
import { RelatedNotesSettingTab } from "./settings/tab";
import { DEFAULT_SETTINGS, PluginSettings } from "./types";
import { parseListInput } from "./util/list";
import { RelatedNotesView, VIEW_TYPE_RELATED_NOTES } from "./view/sidebar";

const EMPTY_TOKENS: Set<string> = new Set();
// The cache is written whole, so writing it per edit meant rewriting a
// vault-sized file every time typing paused. It is only a cache: losing the
// last few minutes of tokenization costs one background resync, so edits just
// mark it dirty and this interval — not the edit — decides when to write.
const MORPHOLOGY_FLUSH_INTERVAL_MS = 180_000;
const RESTORED_CACHE_ANALYZER: TokenCounter = {
  tokenize: () => new Map(),
};

// Wiring contract for anything that needs to track vault changes to stay
// current (store/inverted index, body-token corpus, title-token corpus).
// Each hook is optional and independent — a layer that doesn't care
// about deletes simply doesn't implement onDelete. `bodyMayHaveChanged`
// distinguishes a real edit ("changed") from link resolution catching up
// ("resolve"); a layer decides for itself whether that matters. Whether a
// layer is active at all (e.g. body matching being off) is likewise the
// layer's own call, not something the interface or the wiring loop encodes.
interface CacheLayer {
  onChanged?(file: TFile, bodyMayHaveChanged: boolean): void;
  onDelete?(path: string): void;
  onRename?(oldPath: string, file: TFile): void;
}

export default class RelatedNotesPlugin extends Plugin {
  settings!: PluginSettings;
  private store!: MetadataStore;
  private inverted!: InvertedIndex;
  private body?: BodyTokenIndex;
  private titles?: TitleTokenIndex;
  private analyzer?: MorphologyAnalyzer;
  private scoring!: ScoringEngine;
  private cacheLayers: CacheLayer[] = [];
  // Metadata suggestions work before the heavier analyzers are ready.
  private ready = false;
  private morphologyReady = false;
  private unloaded = false;
  private scheduleRefresh!: Debouncer<[], void>;
  private scheduleVocabularyRebuild!: Debouncer<[], void>;
  private bodyRebuildPromise: Promise<void> | null = null;
  private bodyRebuildPending = false;
  private bodyRebuildNotify = false;
  private loadedMorphologyCache?: MorphologyCacheSnapshot;
  private restoredMorphologyCache = false;
  private analysisSignature?: string;
  private dataSaveQueue: Promise<void> = Promise.resolve();
  private morphologyCachePath!: string;
  private morphologyCacheDirty = false;
  private legacyCacheInDataJson = false;
  private lastRefreshedPath: string | null = null;
  private refreshVersion = 0;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.store = new MetadataStore(this.app);
    this.inverted = new InvertedIndex(this.store);
    this.scoring = new ScoringEngine(this.store, this.inverted);
    this.cacheLayers = this.buildCacheLayers();

    this.registerView(
      VIEW_TYPE_RELATED_NOTES,
      (leaf) => new RelatedNotesView(leaf, this),
    );

    this.registerHoverLinkSource(VIEW_TYPE_RELATED_NOTES, {
      display: t("viewName"),
      // true = require the Cmd/Ctrl modifier to preview, matching Obsidian's
      // default link-hover behaviour (Page Preview owns the modifier gating
      // and its own hover delay). Obsidian's core "Page preview" plugin must
      // be enabled for this to work.
      defaultMod: true,
    });

    this.addSettingTab(new RelatedNotesSettingTab(this.app, this));

    this.addCommand({
      id: "open-suggested-notes",
      name: t("commandOpenSidebar"),
      callback: () => this.activateView(),
    });

    this.addCommand({
      id: "rebuild-body-index",
      name: t("commandRebuildIndex"),
      callback: () => {
        if (!this.settings.bodyTokenEnabled) {
          new Notice(t("noticeBodyTokenDisabled"));
          return;
        }
        void this.rebuildBodyIndex();
      },
    });

    this.scheduleRefresh = debounce(() => void this.refresh(), 300, true);
    this.scheduleVocabularyRebuild = debounce(
      () => void this.applyCustomVocabulary(),
      800,
      true,
    );

    this.registerInterval(
      window.setInterval(
        () => void this.flushMorphologyCache(),
        MORPHOLOGY_FLUSH_INTERVAL_MS,
      ),
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
      this.waitForMetadataResolved().then(() => this.initialMetadataIndex());
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
        for (const layer of this.cacheLayers) layer.onDelete?.(af.path);
        this.scoring.markDirty();
        this.markMorphologyCacheDirty();
        this.scheduleRefresh();
      }),
    );

    this.registerEvent(
      this.app.vault.on("rename", (af: TAbstractFile, oldPath: string) => {
        if (!(af instanceof TFile) || af.extension !== "md") return;
        if (!this.ready) return;
        for (const layer of this.cacheLayers) layer.onRename?.(oldPath, af);
        this.scoring.markDirty();
        this.markMorphologyCacheDirty();
        this.scheduleRefresh();
      }),
    );
  }

  onunload(): void {
    this.unloaded = true;
    // Drop any pending trailing debounces so they can't fire after unload.
    this.scheduleRefresh.cancel();
    this.scheduleVocabularyRebuild.cancel();
    // Obsidian does not await `onunload`, so this last write may not finish.
    // The periodic flush — not this one — is what actually bounds how much
    // tokenization a hard quit can cost.
    if (this.morphologyCacheDirty) void this.flushMorphologyCache();
  }

  async loadSettings(): Promise<void> {
    const raw = (await this.loadData()) as unknown;
    const saved = (
      isPersistedPluginData(raw) ? raw.settings : raw
    ) as (Partial<PluginSettings> & Record<string, unknown>) | null;
    if (saved) {
      delete saved.bodyTokenSegmenterEnabled;
      delete saved.builtinStopwordsEnabled;
      // v0.4/v0.5 migration: lexical title/body overlap is now one content
      // signal. Preserve the user's body weight and explicit body ON/OFF
      // choice; a fresh install receives DEFAULT_SETTINGS (body ON).
      if (
        typeof saved.contentWeight !== "number" &&
        typeof saved.bodyTokenWeight === "number"
      ) {
        saved.contentWeight = saved.bodyTokenWeight;
      }
      if (
        !Array.isArray(saved.excludedContentTokens) &&
        Array.isArray(saved.excludedBodyTokens)
      ) {
        saved.excludedContentTokens = saved.excludedBodyTokens;
      }
      delete saved.titleWeight;
      delete saved.bodyTokenWeight;
      delete saved.excludedBodyTokens;
    }
    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      saved,
    );
    // Heal lists saved before the comma-aware parser: a comma-separated line
    // used to be stored as one entry that could never match anything.
    for (const key of ["excludedTags", "excludedContentTokens"] as const) {
      this.settings[key] = parseListInput(this.settings[key].join("\n"), true);
    }
    this.settings.customVocabulary = parseListInput(
      this.settings.customVocabulary.join("\n"),
      false,
    );
    this.morphologyCachePath = morphologyCachePath(
      this.manifest.dir,
      this.app.vault.configDir,
      this.manifest.id,
    );
    // An earlier data.json may still hold a usable cache. Reuse it so upgrading
    // doesn't cost a full rebuild, and mark it dirty so the first flush moves
    // it into the cache file and drops it from data.json.
    this.legacyCacheInDataJson = hasLegacyMorphologyCache(raw);
    const legacy = extractLegacyMorphologyCache(raw, this.settings);
    if (legacy) {
      this.loadedMorphologyCache = legacy;
      this.morphologyCacheDirty = true;
      return;
    }
    this.loadedMorphologyCache = await readMorphologyCacheFile(
      this.app.vault.adapter,
      this.morphologyCachePath,
      this.settings,
    );
  }

  scheduleVocabularyApply(): void {
    this.scheduleVocabularyRebuild();
  }

  private async applyCustomVocabulary(): Promise<void> {
    if (!this.analyzer || !this.titles || !this.body) return;
    if (this.bodyRebuildPromise) await this.bodyRebuildPromise;
    this.body.clear();
    this.titles.invalidateAnalysis();
    this.analyzer.setCustomVocabulary(this.settings.customVocabulary);
    await this.titles.rebuildAll();
    this.analysisSignature = morphologyCacheSignature(
      this.settings.customVocabulary,
    );
    if (this.settings.bodyTokenEnabled) await this.rebuildBodyIndex();
    else {
      await this.persistMorphologyCache();
      void this.refresh();
    }
  }

  async saveSettings(): Promise<void> {
    await this.queueSettingsSave();
  }

  // Settings text fields call this per keystroke; route through the debounced
  // refresh so typing "20" doesn't run a full scoring pass on the "2".
  invalidateAll(): void {
    this.scoring.markDirty();
    this.scheduleRefresh();
  }

  // Rebuilds the body-token corpus. Normal startup and file edits use the
  // differential path; this forced pass is retained for the manual repair
  // command and for explicitly enabling the feature after its cache was
  // cleared.
  // If a rebuild is requested while one is running, we run once more
  // afterwards rather than dropping it — so the corpus always ends up
  // reflecting the latest edits. `notify` posts a Notice when this (or, if a
  // build is already running, that build's final pass) has finished.
  async rebuildBodyIndex(notify = false): Promise<void> {
    if (!this.morphologyReady || !this.body) return;
    if (!this.settings.bodyTokenEnabled) {
      if (this.bodyRebuildPromise) await this.bodyRebuildPromise;
      this.body.clear();
      await this.persistMorphologyCache();
      void this.refresh();
      return;
    }
    if (notify) this.bodyRebuildNotify = true;
    if (this.bodyRebuildPromise) {
      this.bodyRebuildPending = true;
      await this.bodyRebuildPromise;
      return;
    }
    const body = this.body;
    const rebuild = (async () => {
      try {
        do {
          this.bodyRebuildPending = false;
          await body.rebuildAll(this.settings.bodyTokenTopN);
        } while (this.bodyRebuildPending);
        if (this.bodyRebuildNotify) {
          new Notice(t("noticeBodyTokenRebuilt"));
        }
        await this.persistMorphologyCache();
      } catch (err) {
        console.error("Suggested Notes: body-token index rebuild failed", err);
        new Notice(
          t("noticeBodyTokenRebuildFailed", {
            message: err instanceof Error ? err.message : String(err),
          }),
        );
      } finally {
        this.bodyRebuildNotify = false;
      }
      void this.refresh();
    })();
    this.bodyRebuildPromise = rebuild;
    try {
      await rebuild;
    } finally {
      if (this.bodyRebuildPromise === rebuild) this.bodyRebuildPromise = null;
    }
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

  private initialMetadataIndex(): void {
    this.store.rebuildAll();
    this.inverted.rebuild();
    this.scoring.rebuildTitleMentionIndex();
    this.restoreCachedMorphologyForEarlyDisplay();
    this.scoring.markDirty();
    this.ready = true;
    void this.refresh();
    void this.initializeMorphology();
  }

  private async initializeMorphology(): Promise<void> {
    try {
      const { createBilingualAnalyzer } = await import("./analysis/runtime");
      const analyzer = await createBilingualAnalyzer(
        this.settings.customVocabulary,
      );
      if (this.unloaded) return;

      const hadLoadedMorphologyCache =
        this.restoredMorphologyCache || !!this.loadedMorphologyCache;
      const hadRestoredIndexes = !!this.titles;
      const titles =
        this.titles ?? new TitleTokenIndex(this.store, analyzer);
      const body =
        this.body ?? new BodyTokenIndex(this.app, analyzer, titles);
      titles.setAnalyzer(analyzer);
      body.setAnalyzer(analyzer);
      this.analyzer = analyzer;
      this.body = body;
      this.titles = titles;
      this.analysisSignature = morphologyCacheSignature(
        this.settings.customVocabulary,
      );
      this.scoring.attachMorphology(body, titles, analyzer);

      const cached = hadRestoredIndexes
        ? undefined
        : this.loadedMorphologyCache;
      if (cached) {
        const titlesRestored = titles.restore(cached.titles);
        if (titlesRestored && this.settings.bodyTokenEnabled) {
          body.restore(cached.bodies, this.settings.bodyTokenTopN);
        }
      }
      // The serialized arrays are only an input to restore. From here on the
      // live indexes can produce the next snapshot themselves, so retaining
      // the loaded object would keep a second vault-sized representation in
      // memory for the rest of the session.
      this.loadedMorphologyCache = undefined;
      this.morphologyReady = true;
      // A restored corpus is usable immediately. Render it before checking
      // file stamps and analyzing only changed/new notes in the background.
      void this.refresh();

      const titlesChanged = await titles.syncAll();
      if (this.unloaded) return;
      let bodiesChanged = false;
      if (this.settings.bodyTokenEnabled) {
        bodiesChanged = await body.syncAll(this.settings.bodyTokenTopN);
      }
      if (this.unloaded) return;
      // A valid restored cache whose paths and file stamps still match is
      // already the snapshot we would write. Avoid rewriting the vault-sized
      // file on every plugin startup; missing/migrated caches and real sync
      // changes still take the normal queued write path.
      if (
        titlesChanged ||
        bodiesChanged ||
        !hadLoadedMorphologyCache
      ) {
        this.markMorphologyCacheDirty();
      }
      await this.flushMorphologyCache();
      void this.refresh();
    } catch (error) {
      console.error("Suggested Notes: morphology initialization failed", error);
      new Notice(
        t("noticeMorphologyFailed", {
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  private restoreCachedMorphologyForEarlyDisplay(): void {
    const cached = this.loadedMorphologyCache;
    if (!cached) return;
    const titles = new TitleTokenIndex(
      this.store,
      RESTORED_CACHE_ANALYZER,
    );
    if (!titles.restore(cached.titles, { consume: true })) return;
    const body = new BodyTokenIndex(
      this.app,
      RESTORED_CACHE_ANALYZER,
      titles,
    );
    if (
      this.settings.bodyTokenEnabled &&
      !body.restore(cached.bodies, this.settings.bodyTokenTopN, {
        consume: true,
      })
    ) {
      return;
    }
    if (!this.settings.bodyTokenEnabled) cached.bodies.length = 0;
    this.titles = titles;
    this.body = body;
    this.scoring.attachCachedMorphology(body, titles);
    // The live Maps now own all restored data. The consumed arrays are no
    // longer needed while the heavier analyzer initializes in the background.
    this.loadedMorphologyCache = undefined;
    this.restoredMorphologyCache = true;
  }

  // Wires up the cache layers once: metadata, titles, then bodies. The order
  // matters because body df includes title occurrence.
  private buildCacheLayers(): CacheLayer[] {
    return [
      {
        onChanged: (file) => {
          const { prev, next } = this.store.update(file);
          if (prev) this.inverted.remove(prev);
          this.inverted.add(next);
          if (!prev) this.scoring.addTitleMentionPath(next.path);
        },
        onDelete: (path) => {
          const snap = this.store.remove(path);
          if (snap) this.inverted.remove(snap);
          this.scoring.removeTitleMentionPath(path);
        },
        onRename: (oldPath, file) => {
          const { prev, next } = this.store.rename(oldPath, file);
          if (prev) this.inverted.remove({ ...prev, path: oldPath });
          this.inverted.add(next);
          this.scoring.renameTitleMentionPath(oldPath, next.path);
        },
      },
      {
        // Titles are keyed by path, so edits are a no-op while create,
        // delete, and rename are updated exactly one file at a time.
        // A new note changes the title cache here. With body matching off the
        // layer below never runs, so this is the only place that can mark the
        // cache dirty for a create — without it, a restart would show the note
        // missing from early results until morphology finishes initializing.
        onChanged: (file) => {
          if (!this.morphologyReady) return;
          if (this.titles?.add(file.path)) this.markMorphologyCacheDirty();
        },
        onDelete: (path) => {
          if (this.morphologyReady) this.titles?.remove(path);
        },
        onRename: (oldPath, file) => {
          if (this.morphologyReady) {
            this.titles?.rename(oldPath, file.path);
          }
        },
      },
      {
        // Keep this layer after titles: body df is the union of title and body
        // occurrence, so a create/rename/delete must see the new title state.
        onChanged: (file, bodyMayHaveChanged) => {
          if (!bodyMayHaveChanged || !this.settings.bodyTokenEnabled) return;
          if (!this.body || !this.morphologyReady) return;
          void this.body
            .refreshNote(file, this.settings.bodyTokenTopN)
            .then(() => {
              this.markMorphologyCacheDirty();
              this.scheduleRefresh();
            })
            .catch((error) => {
              console.error(
                `Suggested Notes: failed to update body tokens for "${file.path}"`,
                error,
              );
            });
        },
        onDelete: (path) => {
          if (this.morphologyReady) this.body?.remove(path);
        },
        onRename: (oldPath, file) => {
          if (this.morphologyReady) {
            this.body?.rename(oldPath, file.path);
          }
        },
      },
    ];
  }

  // The top-N setting is a text field, so this runs per keystroke. Rerank and
  // re-render immediately, but let the periodic flush persist it — writing the
  // whole cache on every keystroke is what this design exists to avoid.
  async rerankBodyIndex(): Promise<void> {
    if (!this.body || !this.morphologyReady) return;
    this.body.rerank(this.settings.bodyTokenTopN);
    this.markMorphologyCacheDirty();
    void this.refresh();
  }

  // Rebuilds and vocabulary changes write immediately: they are rare, and they
  // are exactly the states a cold start would otherwise have to redo.
  private persistMorphologyCache(): Promise<void> {
    return this.flushMorphologyCache(true);
  }

  private markMorphologyCacheDirty(): void {
    if (this.unloaded) return;
    this.morphologyCacheDirty = true;
  }

  // data.json now carries the settings alone, so its size no longer follows
  // the vault's.
  private queueSettingsSave(): Promise<void> {
    const save = async () => {
      await this.saveData(this.settings);
      this.legacyCacheInDataJson = false;
    };
    const queued = this.dataSaveQueue.catch(() => undefined).then(save);
    this.dataSaveQueue = queued;
    return queued;
  }

  private flushMorphologyCache(force = false): Promise<void> {
    if (!force && !this.morphologyCacheDirty) return Promise.resolve();
    this.morphologyCacheDirty = false;
    const write = async () => {
      const signature = morphologyCacheSignature(
        this.settings.customVocabulary,
      );
      const liveIndexes =
        this.titles &&
        this.body &&
        this.analysisSignature === signature
          ? { titles: this.titles, body: this.body }
          : undefined;
      const loadedCache = liveIndexes
        ? undefined
        : this.loadedMorphologyCacheForWrite();
      if (!liveIndexes && !loadedCache) return;
      try {
        if (liveIndexes) {
          await writeMorphologyCacheFileStreaming(
            this.app.vault.adapter,
            this.morphologyCachePath,
            {
              version: MORPHOLOGY_CACHE_VERSION,
              signature,
            },
            liveIndexes.titles.snapshotEntries(),
            liveIndexes.body.snapshotEntries(),
          );
        } else if (loadedCache) {
          await writeMorphologyCacheFile(
            this.app.vault.adapter,
            this.morphologyCachePath,
            loadedCache,
          );
        }
        // The copy inside an earlier data.json is redundant only once the cache
        // file itself is on disk.
        if (this.legacyCacheInDataJson) await this.saveData(this.settings);
        this.legacyCacheInDataJson = false;
      } catch (error) {
        console.error(
          "Suggested Notes: failed to persist the morphology cache",
          error,
        );
        this.morphologyCacheDirty = true;
      }
    };
    const queued = this.dataSaveQueue.catch(() => undefined).then(write);
    this.dataSaveQueue = queued;
    return queued;
  }

  private loadedMorphologyCacheForWrite(): MorphologyCacheSnapshot | undefined {
    return isUsableMorphologyCache(
      this.loadedMorphologyCache,
      this.settings,
    )
      ? this.loadedMorphologyCache
      : undefined;
  }

  // Shared by the "changed" and "resolve" handlers: re-snapshot the file and
  // refresh. Only "changed" implies the body text moved — "resolve" is link
  // resolution catching up, and body tokens don't depend on resolvedLinks, so
  // it skips scheduling the (expensive) corpus rebuild.
  private reindexFile(file: TFile, bodyMayHaveChanged: boolean): void {
    if (!this.ready) return;
    for (const layer of this.cacheLayers) {
      layer.onChanged?.(file, bodyMayHaveChanged);
    }
    this.scoring.markDirty();
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

    // Body vocabulary and unlinked-title mentions share one active-note read.
    // Mention detection remains available in lightweight mode; it never
    // builds or reads a vault-wide body corpus.
    const cachedContentIsSafe =
      this.morphologyReady ||
      this.settings.excludedContentTokens.length === 0;
    const useBodyTokens =
      cachedContentIsSafe &&
      this.settings.bodyTokenEnabled &&
      !!this.body?.isBuilt();
    const needsActiveBody =
      (useBodyTokens && this.morphologyReady) ||
      this.settings.unlinkedMentionWeight > 0;
    const activeBodyText = needsActiveBody
      ? await this.app.vault.cachedRead(active)
      : "";
    const activeBodyTokens =
      useBodyTokens && this.body
        ? this.morphologyReady
          ? this.body.computeSalientText(
              activeBodyText,
              this.settings.bodyTokenTopN,
            )
          : this.body.salientFor(active.path)
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
      activeBodyText,
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
      new Notice(t("noticeActiveNoteChanged"));
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
    new Notice(t("noticeTagAdded", { tag }));
  }

  // Lets a view request a render of the current active note outside the
  // active-leaf-change flow — namely from its own onOpen, so a sidebar
  // reopened on the same note it was showing before (which active-leaf-change
  // won't re-trigger, since lastRefreshedPath is unchanged) doesn't stay
  // stuck on the loading placeholder. refresh() doesn't consult
  // lastRefreshedPath, so calling it here is always safe to repeat.
  requestRefresh(): void {
    void this.refresh();
  }

  async activateView(): Promise<void> {
    const { workspace } = this.app;
    const [existing, ...duplicates] = workspace.getLeavesOfType(
      VIEW_TYPE_RELATED_NOTES,
    );
    // A restored mobile layout can contain more than one leaf for the same
    // custom view. Obsidian then lists the identical view twice in the sidebar
    // picker. This view is intentionally a singleton, so retain the first
    // restored leaf and remove only duplicate instances of our own view.
    for (const duplicate of duplicates) duplicate.detach();

    let leaf: WorkspaceLeaf | null = existing ?? null;
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      if (leaf)
        await leaf.setViewState({
          type: VIEW_TYPE_RELATED_NOTES,
          active: true,
        });
    }
    if (leaf) await workspace.revealLeaf(leaf);
  }

  async copyLinkToClipboard(
    activePath: string,
    targetPath: string,
  ): Promise<boolean> {
    const targetFile = this.app.vault.getAbstractFileByPath(targetPath);
    if (!(targetFile instanceof TFile)) return false;
    const link = this.app.fileManager.generateMarkdownLink(
      targetFile,
      activePath,
    );
    await navigator.clipboard.writeText(link);
    return true;
  }
}
