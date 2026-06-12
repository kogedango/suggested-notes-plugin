import type { FileSnapshot } from "../types";

// What index/scoring consumers need from the snapshot store. Both the pure
// SnapshotStore and the App-facing MetadataStore adapter satisfy it.
export interface SnapshotReader {
  get(path: string): FileSnapshot | undefined;
  all(): IterableIterator<FileSnapshot>;
  size(): number;
}

const EMPTY_SET: Set<string> = new Set();

// Pure snapshot bookkeeping: holds per-file snapshots and keeps their
// backlink sets consistent across update/rename/remove. No Obsidian imports —
// turning vault files into FileSnapshots is the adapter's job
// (buildSnapshot in cache/metadata.ts) — so this core is testable directly.
export class SnapshotStore implements SnapshotReader {
  private snapshots = new Map<string, FileSnapshot>();

  rebuildAll(snaps: Iterable<FileSnapshot>): void {
    this.snapshots.clear();
    for (const s of snaps) this.snapshots.set(s.path, s);
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

  // One full scan over the store — only paid for genuinely new files, where
  // no incrementally-maintained backlink set exists yet.
  private backlinksFor(path: string): Set<string> {
    const out = new Set<string>();
    for (const [src, snap] of this.snapshots) {
      if (src !== path && snap.outlinks.has(path)) out.add(src);
    }
    return out;
  }

  update(next: FileSnapshot): {
    prev: FileSnapshot | undefined;
    next: FileSnapshot;
  } {
    const prev = this.snapshots.get(next.path);

    // Preserve existing backlinks (outlink-changes drive the diff below);
    // only a genuinely new file pays the full scan.
    next.backlinks = prev ? prev.backlinks : this.backlinksFor(next.path);

    const prevOut = prev?.outlinks ?? EMPTY_SET;
    for (const target of prevOut) {
      if (!next.outlinks.has(target)) {
        this.snapshots.get(target)?.backlinks.delete(next.path);
      }
    }
    for (const target of next.outlinks) {
      if (!prevOut.has(target)) {
        this.snapshots.get(target)?.backlinks.add(next.path);
      }
    }

    this.snapshots.set(next.path, next);
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

  rename(
    oldPath: string,
    next: FileSnapshot,
  ): { prev: FileSnapshot | undefined; next: FileSnapshot } {
    const prev = this.snapshots.get(oldPath);
    this.snapshots.delete(oldPath);
    if (prev) {
      // Targets of this note's outlinks hold the old path in their backlink
      // sets; re-key those references too. update() below won't, because the
      // moved snapshot's outlinks are unchanged so it sees nothing to diff.
      for (const target of prev.outlinks) {
        const t = this.snapshots.get(target);
        if (t?.backlinks.delete(oldPath)) t.backlinks.add(next.path);
      }
      // Move the backlinks set to the new path so we don't lose it.
      this.snapshots.set(next.path, { ...prev, path: next.path });
    }
    return this.update(next);
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
