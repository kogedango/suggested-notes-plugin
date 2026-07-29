import type { InvertedIndex } from "../cache/inverted";
import type { SnapshotReader } from "../cache/store";
import { inverseDocumentFrequency } from "../util/idf";

export class IDFTables {
  private dirty = true;
  private totalNotes = 0;
  private tagIDF = new Map<string, number>();
  private linkIDF = new Map<string, number>();

  constructor(
    private store: SnapshotReader,
    private inverted: InvertedIndex,
  ) {}

  markDirty(): void {
    this.dirty = true;
  }

  private ensureFresh(): void {
    if (!this.dirty) return;
    this.totalNotes = this.store.size();
    this.tagIDF.clear();
    this.linkIDF.clear();
    this.dirty = false;
  }

  tag(tag: string): number {
    this.ensureFresh();
    const cached = this.tagIDF.get(tag);
    if (cached !== undefined) return cached;
    const n = this.inverted.notesWithTagCount(tag);
    const idf = inverseDocumentFrequency(this.totalNotes, n);
    this.tagIDF.set(tag, idf);
    return idf;
  }

  link(target: string): number {
    this.ensureFresh();
    const cached = this.linkIDF.get(target);
    if (cached !== undefined) return cached;
    const n = this.inverted.notesLinkingToCount(target);
    const idf = inverseDocumentFrequency(this.totalNotes, n);
    this.linkIDF.set(target, idf);
    return idf;
  }
}
