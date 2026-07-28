import { describe, expect, it } from "vitest";
import type { FileSnapshot } from "../types";
import {
  TitleMentionIndex,
  findUnlinkedTitleMentions,
} from "./titleMentions";

function snapshot(path: string): FileSnapshot {
  return {
    path,
    tags: new Set(),
    outlinks: new Set(),
    backlinks: new Set(),
    ctime: 0,
    mtime: 0,
    outlinkCount: 0,
    folder: "",
  };
}

const notes = [
  snapshot("active.md"),
  snapshot("ヴァイパー.md"),
  snapshot("Obsidian.md"),
  snapshot("AI.md"),
];

describe("findUnlinkedTitleMentions", () => {
  it("finds exact Japanese and case-insensitive English title mentions", () => {
    const found = findUnlinkedTitleMentions(
      "ヴァイパーについて考える。ＯＢＳＩＤＩＡＮを使う。",
      "active.md",
      notes,
      new Set(),
    );
    expect(found).toEqual(new Set(["ヴァイパー.md", "Obsidian.md"]));
  });

  it("ignores wikilinks, Markdown links, code, URLs, and frontmatter", () => {
    const found = findUnlinkedTitleMentions(
      [
        "---",
        "topic: ヴァイパー",
        "---",
        "[[ヴァイパー]]",
        "[Obsidian](https://obsidian.md)",
        "`AI`",
        "```",
        "ヴァイパー",
        "```",
        "https://example.com/Obsidian",
      ].join("\n"),
      "active.md",
      notes,
      new Set(),
    );
    expect(found).toEqual(new Set());
  });

  it("does not report an already-linked note", () => {
    expect(
      findUnlinkedTitleMentions(
        "ヴァイパー",
        "active.md",
        notes,
        new Set(["ヴァイパー.md"]),
      ),
    ).toEqual(new Set());
  });

  it("requires ASCII identifier boundaries", () => {
    expect(
      findUnlinkedTitleMentions(
        "RAIL is not an AI mention, but AI is.",
        "active.md",
        notes,
        new Set(),
      ),
    ).toEqual(new Set(["AI.md"]));
  });

  it("skips ambiguous duplicate basenames and one-character titles", () => {
    const found = findUnlinkedTitleMentions(
      "Topicと本について",
      "active.md",
      [
        snapshot("active.md"),
        snapshot("A/Topic.md"),
        snapshot("B/Topic.md"),
        snapshot("本.md"),
      ],
      new Set(),
    );
    expect(found).toEqual(new Set());
  });

  it("uses the longest title when multiple titles start at one position", () => {
    const found = findUnlinkedTitleMentions(
      "Plugin Designを見直す",
      "active.md",
      [
        snapshot("active.md"),
        snapshot("Plugin.md"),
        snapshot("Plugin Design.md"),
      ],
      new Set(),
    );
    expect(found).toEqual(new Set(["Plugin Design.md"]));
  });

  it("maintains the reusable title index across add, rename, and remove", () => {
    const index = new TitleMentionIndex();
    index.rebuild([snapshot("active.md"), snapshot("Old Topic.md")]);
    expect(index.find("Old Topic", "active.md", new Set())).toEqual(
      new Set(["Old Topic.md"]),
    );

    index.rename("Old Topic.md", "New Topic.md");
    index.add("Another.md");
    expect(index.find("Old Topic New Topic Another", "active.md", new Set()))
      .toEqual(new Set(["New Topic.md", "Another.md"]));

    index.remove("New Topic.md");
    expect(index.find("New Topic", "active.md", new Set())).toEqual(new Set());
  });

  it("resolves duplicate titles against the active query's linked paths", () => {
    const index = new TitleMentionIndex();
    index.rebuild([
      snapshot("active.md"),
      snapshot("A/Topic.md"),
      snapshot("B/Topic.md"),
    ]);

    expect(index.find("Topic", "active.md", new Set())).toEqual(new Set());
    expect(index.find("Topic", "active.md", new Set(["A/Topic.md"]))).toEqual(
      new Set(["B/Topic.md"]),
    );
  });
});
