import { ItemView, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import type RelatedNotesPlugin from "../main";
import type { ScoredCandidate, SuggestedTag } from "../types";
import { displayName } from "../util/path";

export const VIEW_TYPE_RELATED_NOTES = "suggested-notes-view";

const HOVER_DELAY_MS = 600;

export class RelatedNotesView extends ItemView {
  private state:
    | { kind: "loading" }
    | { kind: "no-active" }
    | { kind: "empty" }
    | {
        kind: "ready";
        activePath: string;
        results: ScoredCandidate[];
        suggestedTags: SuggestedTag[];
      } = {
    kind: "loading",
  };

  constructor(leaf: WorkspaceLeaf, private plugin: RelatedNotesPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_RELATED_NOTES;
  }

  getDisplayText(): string {
    return "Suggested Notes";
  }

  getIcon(): string {
    return "waypoints";
  }

  async onOpen(): Promise<void> {
    this.render();
  }

  async onClose(): Promise<void> {}

  setLoading(): void {
    this.state = { kind: "loading" };
    this.render();
  }

  setNoActive(): void {
    this.state = { kind: "no-active" };
    this.render();
  }

  setResults(
    activePath: string,
    results: ScoredCandidate[],
    suggestedTags: SuggestedTag[],
  ): void {
    this.state =
      results.length === 0
        ? { kind: "empty" }
        : { kind: "ready", activePath, results, suggestedTags };
    this.render();
  }

  private render(): void {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("suggested-notes-view");


    switch (this.state.kind) {
      case "loading":
        container.createEl("div", {
          text: "Indexing vault…",
          cls: "suggested-notes-status",
        });
        return;
      case "no-active":
        container.createEl("div", {
          text: "Open a note to see related notes.",
          cls: "suggested-notes-status",
        });
        return;
      case "empty":
        container.createEl("div", {
          text: "No related notes found.",
          cls: "suggested-notes-status",
        });
        return;
      case "ready":
        this.renderTags(
          container,
          this.state.activePath,
          this.state.suggestedTags,
        );
        this.renderList(container, this.state.activePath, this.state.results);
        return;
    }
  }

  private renderList(
    container: HTMLElement,
    activePath: string,
    results: ScoredCandidate[],
  ): void {
    const section = container.createEl("div", { cls: "suggested-notes-section" });
    section.createEl("div", {
      text: "Related notes",
      cls: "suggested-notes-section-header",
    });
    const list = section.createEl("div", { cls: "suggested-notes-list" });
    for (const c of results) this.renderRow(list, activePath, c);
  }

  private renderRow(
    list: HTMLElement,
    activePath: string,
    c: ScoredCandidate,
  ): void {
    const settings = this.plugin.settings;
    const item = list.createEl("div", { cls: "tree-item suggested-notes-item" });
    if (c.alreadyLinked) item.addClass("is-linked");

    const self = item.createEl("div", {
      cls: "tree-item-self is-clickable suggested-notes-self",
      attr: { "aria-label": c.path },
    });
    self.addEventListener("click", (e) => {
      this.openNote(c.path, e.ctrlKey || e.metaKey);
    });
    this.attachDelayedHover(self, activePath, c.path);

    if (settings.showScores) {
      self.createEl("span", {
        text: String(c.displayScore),
        cls: "suggested-notes-score",
      });
    }

    const inner = self.createEl("div", {
      cls: "tree-item-inner suggested-notes-inner",
    });
    inner.createEl("div", {
      text: displayName(c.path),
      cls: "suggested-notes-title",
    });
    if (settings.showSharedReasons) {
      const reasons = inner.createEl("div", {
        cls: "suggested-notes-reasons",
      });
      renderReasons(reasons, c);
      if (!reasons.textContent) reasons.remove();
    }

    this.attachCopyButton(self, activePath, c.path);
  }

  // Delay-based preview: only fire after the mouse rests on the row for
  // HOVER_DELAY_MS. Avoids "preview pops every time my mouse passes through"
  // while still working without a modifier key.
  private attachDelayedHover(
    self: HTMLElement,
    activePath: string,
    targetPath: string,
  ): void {
    let hoverTimer: number | undefined;
    let lastEvent: MouseEvent | undefined;
    self.addEventListener("mouseenter", (e) => {
      lastEvent = e;
      window.clearTimeout(hoverTimer);
      hoverTimer = window.setTimeout(() => {
        this.app.workspace.trigger("hover-link", {
          event: lastEvent,
          source: VIEW_TYPE_RELATED_NOTES,
          hoverParent: this,
          targetEl: self,
          linktext: targetPath,
          sourcePath: activePath,
        });
      }, HOVER_DELAY_MS);
    });
    self.addEventListener("mousemove", (e) => {
      lastEvent = e;
    });
    self.addEventListener("mouseleave", () => {
      window.clearTimeout(hoverTimer);
      hoverTimer = undefined;
    });
  }

  private attachCopyButton(
    self: HTMLElement,
    activePath: string,
    targetPath: string,
  ): void {
    const copyBtn = self.createEl("div", {
      cls: "clickable-icon suggested-notes-insert",
      attr: { "aria-label": "Copy link" },
    });
    setIcon(copyBtn, "copy");
    let copiedTimer: number | undefined;
    copyBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await this.plugin.copyLinkToClipboard(activePath, targetPath);
      window.clearTimeout(copiedTimer);
      copyBtn.empty();
      setIcon(copyBtn, "check");
      copyBtn.addClass("is-copied");
      copiedTimer = window.setTimeout(() => {
        copyBtn.empty();
        setIcon(copyBtn, "copy");
        copyBtn.removeClass("is-copied");
      }, 1200);
    });
  }

  private renderTags(
    container: HTMLElement,
    activePath: string,
    tags: SuggestedTag[],
  ): void {
    if (tags.length === 0) return;
    const section = container.createEl("div", {
      cls: "suggested-notes-tags-section",
    });
    section.createEl("div", {
      text: "Suggested tags",
      cls: "suggested-notes-section-header",
    });
    const list = section.createEl("div", { cls: "suggested-notes-tags" });
    for (const t of tags) {
      const chip = list.createEl("a", {
        cls: "tag suggested-notes-tag",
        text: `#${t.tag}`,
        attr: { "aria-label": `Add #${t.tag} (${t.fromCount} notes)` },
      });
      chip.addEventListener("click", (e) => {
        e.preventDefault();
        this.plugin.addTagToActive(activePath, t.tag);
      });
    }
  }

  private openNote(path: string, newPane: boolean): void {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      this.app.workspace.getLeaf(newPane).openFile(file);
    }
  }
}

function renderReasons(el: HTMLElement, c: ScoredCandidate): void {
  const parts: string[] = [];
  if (c.reasons.sharedTags.length) {
    parts.push(
      c.reasons.sharedTags
        .slice(0, 4)
        .map((t) => `#${t}`)
        .join(" "),
    );
  }
  if (c.reasons.sharedOutlinks.length) {
    parts.push(
      c.reasons.sharedOutlinks
        .slice(0, 3)
        .map((l) => `[[${displayName(l)}]]`)
        .join(" "),
    );
  }
  if (c.reasons.sharedBacklinks.length) {
    parts.push(`+${c.reasons.sharedBacklinks.length} shared backlink(s)`);
  }
  if (c.reasons.sharedBodyTokens.length) {
    parts.push(
      c.reasons.sharedBodyTokens
        .slice(0, 4)
        .map((t) => `“${t}”`)
        .join(" "),
    );
  }
  el.setText(parts.length ? parts.join(" · ") : "");
}
