import { App, TFile, getAllTags } from "obsidian";
import type { FileSnapshot } from "../types";

export function buildSnapshot(app: App, file: TFile): FileSnapshot {
  const cache = app.metadataCache.getFileCache(file);
  const tags = new Set<string>();
  if (cache) {
    const all = getAllTags(cache) ?? [];
    for (const t of all) tags.add(normalizeTag(t));
  }

  const resolved = app.metadataCache.resolvedLinks[file.path] ?? {};
  const outlinks = new Set<string>(Object.keys(resolved));

  const backlinks = new Set<string>();
  for (const src of Object.keys(app.metadataCache.resolvedLinks)) {
    if (src === file.path) continue;
    const targets = app.metadataCache.resolvedLinks[src];
    if (targets && file.path in targets) backlinks.add(src);
  }

  const folder = file.parent?.path ?? "";

  return {
    path: file.path,
    tags,
    outlinks,
    backlinks,
    ctime: file.stat.ctime,
    mtime: file.stat.mtime,
    outlinkCount: outlinks.size,
    folder,
  };
}

export function normalizeTag(t: string): string {
  return t.startsWith("#") ? t.slice(1) : t;
}

const EMPTY_SET: Set<string> = new Set();

export class MetadataStore {
  private snapshots = new Map<string, FileSnapshot>();

  constructor(private app: App) {}

  rebuildAll(): void {
    this.snapshots.clear();
    for (const f of this.app.vault.getMarkdownFiles()) {
      this.snapshots.set(f.path, buildSnapshot(this.app, f));
    }
    this.recomputeBacklinks();
  }

  private recomputeBacklinks(): void {
    for (const snap of this.snapshots.values()) snap.backlinks.clear();
    for (const [src, snap] of this.snapshots) {
      for (const target of snap.outlinks) {
        const t = this.snapshots.get(target);
        if (t) t.backlinks.add(src);
      }
    }
  }

  update(file: TFile): { prev: FileSnapshot | undefined; next: FileSnapshot } {
    const prev = this.snapshots.get(file.path);
    const next = buildSnapshot(this.app, file);

    // Preserve existing backlinks; outlink-changes drive the diff below.
    if (prev) next.backlinks = prev.backlinks;

    const prevOut = prev?.outlinks ?? EMPTY_SET;
    for (const target of prevOut) {
      if (!next.outlinks.has(target)) {
        this.snapshots.get(target)?.backlinks.delete(file.path);
      }
    }
    for (const target of next.outlinks) {
      if (!prevOut.has(target)) {
        this.snapshots.get(target)?.backlinks.add(file.path);
      }
    }

    this.snapshots.set(file.path, next);
    return { prev, next };
  }

  remove(path: string): FileSnapshot | undefined {
    const snap = this.snapshots.get(path);
    if (!snap) return undefined;
    this.snapshots.delete(path);
    for (const target of snap.outlinks) {
      this.snapshots.get(target)?.backlinks.delete(path);
    }
    // Any backlink-source still pointing to this path is the source's problem
    // — when Obsidian resolves the rename/delete, source's "changed" event
    // will fire and update() above will diff it. We just clean references to
    // this path from inverted indexes (handled by caller).
    return snap;
  }

  rename(oldPath: string, file: TFile): {
    prev: FileSnapshot | undefined;
    next: FileSnapshot;
  } {
    const prev = this.snapshots.get(oldPath);
    this.snapshots.delete(oldPath);
    // Move backlinks set to the new path so we don't lose them.
    if (prev) this.snapshots.set(file.path, { ...prev, path: file.path });
    return this.update(file);
  }

  get(path: string): FileSnapshot | undefined {
    return this.snapshots.get(path);
  }

  all(): IterableIterator<FileSnapshot> {
    return this.snapshots.values();
  }

  size(): number {
    return this.snapshots.size;
  }
}
