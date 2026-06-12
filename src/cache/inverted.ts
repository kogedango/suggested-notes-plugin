import type { FileSnapshot } from "../types";
import type { SnapshotReader } from "./store";

export class InvertedIndex {
  // tag -> files containing it
  private tagIndex = new Map<string, Set<string>>();
  // outlink target path -> files linking to it
  private linkIndex = new Map<string, Set<string>>();

  constructor(private store: SnapshotReader) {}

  rebuild(): void {
    this.tagIndex.clear();
    this.linkIndex.clear();
    for (const snap of this.store.all()) this.add(snap);
  }

  add(snap: FileSnapshot): void {
    for (const tag of snap.tags) this.addTo(this.tagIndex, tag, snap.path);
    for (const link of snap.outlinks)
      this.addTo(this.linkIndex, link, snap.path);
  }

  remove(snap: FileSnapshot): void {
    for (const tag of snap.tags) this.removeFrom(this.tagIndex, tag, snap.path);
    for (const link of snap.outlinks)
      this.removeFrom(this.linkIndex, link, snap.path);
  }

  filesWithTag(tag: string): Set<string> {
    return this.tagIndex.get(tag) ?? EMPTY;
  }

  filesLinkingTo(target: string): Set<string> {
    return this.linkIndex.get(target) ?? EMPTY;
  }

  notesWithTagCount(tag: string): number {
    return this.tagIndex.get(tag)?.size ?? 0;
  }

  notesLinkingToCount(target: string): number {
    return this.linkIndex.get(target)?.size ?? 0;
  }

  private addTo(idx: Map<string, Set<string>>, key: string, path: string) {
    let set = idx.get(key);
    if (!set) {
      set = new Set();
      idx.set(key, set);
    }
    set.add(path);
  }

  private removeFrom(
    idx: Map<string, Set<string>>,
    key: string,
    path: string,
  ) {
    const set = idx.get(key);
    if (!set) return;
    set.delete(path);
    if (set.size === 0) idx.delete(key);
  }
}

const EMPTY: Set<string> = new Set();
