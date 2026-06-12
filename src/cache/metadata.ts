import { App, TFile, getAllTags } from "obsidian";
import type { FileSnapshot } from "../types";
import { SnapshotReader, SnapshotStore } from "./store";

// Backlinks are NOT computed here: they are maintained by SnapshotStore
// (recompute on rebuild, outlink-diffing on update, one store scan for
// genuinely new files) — a resolvedLinks scan per file would make bulk
// rebuilds O(N²).
export function buildSnapshot(app: App, file: TFile): FileSnapshot {
  const cache = app.metadataCache.getFileCache(file);
  const tags = new Set<string>();
  if (cache) {
    const all = getAllTags(cache) ?? [];
    for (const t of all) tags.add(normalizeTag(t));
  }

  const resolved = app.metadataCache.resolvedLinks[file.path] ?? {};
  const outlinks = new Set<string>(Object.keys(resolved));

  const folder = file.parent?.path ?? "";

  return {
    path: file.path,
    tags,
    outlinks,
    backlinks: new Set<string>(),
    ctime: file.stat.ctime,
    mtime: file.stat.mtime,
    outlinkCount: outlinks.size,
    folder,
  };
}

export function normalizeTag(t: string): string {
  return t.startsWith("#") ? t.slice(1) : t;
}

// Thin App-facing adapter: turns vault files into FileSnapshots and delegates
// all bookkeeping (including backlink consistency) to the pure SnapshotStore.
export class MetadataStore implements SnapshotReader {
  private store = new SnapshotStore();

  constructor(private app: App) {}

  rebuildAll(): void {
    this.store.rebuildAll(
      this.app.vault.getMarkdownFiles().map((f) => buildSnapshot(this.app, f)),
    );
  }

  update(file: TFile): { prev: FileSnapshot | undefined; next: FileSnapshot } {
    return this.store.update(buildSnapshot(this.app, file));
  }

  remove(path: string): FileSnapshot | undefined {
    return this.store.remove(path);
  }

  rename(
    oldPath: string,
    file: TFile,
  ): { prev: FileSnapshot | undefined; next: FileSnapshot } {
    return this.store.rename(oldPath, buildSnapshot(this.app, file));
  }

  get(path: string): FileSnapshot | undefined {
    return this.store.get(path);
  }

  all(): IterableIterator<FileSnapshot> {
    return this.store.all();
  }

  size(): number {
    return this.store.size();
  }
}
