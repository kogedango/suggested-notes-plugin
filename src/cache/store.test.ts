import { describe, expect, it } from "vitest";
import type { FileSnapshot } from "../types";
import { SnapshotStore } from "./store";

function snap(
  path: string,
  opts: { tags?: string[]; outlinks?: string[]; folder?: string } = {},
): FileSnapshot {
  const outlinks = new Set(opts.outlinks ?? []);
  return {
    path,
    tags: new Set(opts.tags ?? []),
    outlinks,
    backlinks: new Set(),
    ctime: 0,
    mtime: 0,
    outlinkCount: outlinks.size,
    folder: opts.folder ?? "",
  };
}

describe("SnapshotStore", () => {
  it("rebuildAll derives backlinks from outlinks", () => {
    const s = new SnapshotStore();
    s.rebuildAll([
      snap("a.md", { outlinks: ["b.md"] }),
      snap("b.md"),
      snap("c.md", { outlinks: ["b.md", "a.md"] }),
    ]);
    expect([...s.get("b.md")!.backlinks].sort()).toEqual(["a.md", "c.md"]);
    expect([...s.get("a.md")!.backlinks]).toEqual(["c.md"]);
    expect(s.get("c.md")!.backlinks.size).toBe(0);
  });

  it("update adds backlinks for newly added outlinks", () => {
    const s = new SnapshotStore();
    s.rebuildAll([snap("a.md"), snap("b.md")]);
    s.update(snap("a.md", { outlinks: ["b.md"] }));
    expect([...s.get("b.md")!.backlinks]).toEqual(["a.md"]);
  });

  it("update removes backlinks for dropped outlinks", () => {
    const s = new SnapshotStore();
    s.rebuildAll([snap("a.md", { outlinks: ["b.md"] }), snap("b.md")]);
    s.update(snap("a.md"));
    expect(s.get("b.md")!.backlinks.size).toBe(0);
  });

  it("update preserves the existing backlink set across re-snapshots", () => {
    const s = new SnapshotStore();
    s.rebuildAll([snap("a.md", { outlinks: ["b.md"] }), snap("b.md")]);
    // Re-snapshot b (fresh object with empty backlinks, as buildSnapshot
    // produces); the maintained set must survive.
    s.update(snap("b.md", { tags: ["x"] }));
    expect([...s.get("b.md")!.backlinks]).toEqual(["a.md"]);
  });

  it("update of a brand-new file scans existing outlinks for backlinks", () => {
    const s = new SnapshotStore();
    // a links to c.md before c exists (unresolved at the time).
    s.rebuildAll([snap("a.md", { outlinks: ["c.md"] }), snap("b.md")]);
    s.update(snap("c.md"));
    expect([...s.get("c.md")!.backlinks]).toEqual(["a.md"]);
  });

  it("remove drops the note and its backlink references", () => {
    const s = new SnapshotStore();
    s.rebuildAll([snap("a.md", { outlinks: ["b.md"] }), snap("b.md")]);
    const removed = s.remove("a.md");
    expect(removed?.path).toBe("a.md");
    expect(s.get("a.md")).toBeUndefined();
    expect(s.get("b.md")!.backlinks.size).toBe(0);
    expect(s.size()).toBe(1);
  });

  it("rename moves the snapshot and its backlinks to the new path", () => {
    const s = new SnapshotStore();
    s.rebuildAll([
      snap("a.md", { outlinks: ["b.md"] }),
      snap("b.md", { outlinks: ["a.md"] }),
    ]);
    // Obsidian renames b -> c; a's outlinks still say b.md until its own
    // "changed"/"resolve" events catch up, but c must keep the backlink.
    const { next } = s.rename("b.md", snap("c.md", { outlinks: ["a.md"] }));
    expect(s.get("b.md")).toBeUndefined();
    expect(next.path).toBe("c.md");
    expect([...s.get("c.md")!.backlinks]).toEqual(["a.md"]);
    expect([...s.get("a.md")!.backlinks]).toEqual(["c.md"]);
  });
});
