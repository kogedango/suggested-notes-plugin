import { ItemView, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import type RelatedNotesPlugin from "../main";
import type { ScoredCandidate, SuggestedTag } from "../types";
import { displayName } from "../util/path";

export const VIEW_TYPE_RELATED_NOTES = "suggested-notes-view";

const REASONS_TIP_DELAY_MS = 350;

export class RelatedNotesView extends ItemView {
  private reasonsTipEl: HTMLElement | null = null;
  private reasonsTipTimer: number | undefined;
  private lastModifier = false;

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

  async onClose(): Promise<void> {
    this.hideReasonsTip();
  }

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
    // Rows (and their hover handlers) are about to be discarded; drop any
    // breakdown tooltip we appended to document.body so it doesn't orphan.
    this.hideReasonsTip();
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
    });
    self.addEventListener("click", (e) => {
      this.openNote(c.path, e.ctrlKey || e.metaKey);
    });
    this.attachHoverPreview(self, activePath, c.path);
    // One plain-hover tooltip per row: note title/path + the full score
    // breakdown. Replaces the native aria-label title tooltip (which doubled up
    // with the breakdown popover) so plain hover shows a single, complete card.
    this.attachInfoTooltip(self, c);

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

  // Standard link-hover wiring: emit "hover-link" with the mouse event and let
  // Obsidian's Page Preview own the rest. With defaultMod:true on our hover-link
  // source, it only previews while Cmd/Ctrl is held (and applies its own delay).
  private attachHoverPreview(
    self: HTMLElement,
    activePath: string,
    targetPath: string,
  ): void {
    self.addEventListener("mouseover", (event) => {
      this.app.workspace.trigger("hover-link", {
        event,
        source: VIEW_TYPE_RELATED_NOTES,
        hoverParent: this,
        targetEl: self,
        linktext: targetPath,
        sourcePath: activePath,
      });
    });
  }

  // Hover a row to get the note's title/path plus the full score breakdown,
  // grouped by signal (tags / links / backlinks / body tokens). Suppressed
  // while Cmd/Ctrl is held so it doesn't fight the modifier body preview.
  private attachInfoTooltip(el: HTMLElement, c: ScoredCandidate): void {
    el.addEventListener("mousemove", (e) => {
      this.lastModifier = e.metaKey || e.ctrlKey;
    });
    el.addEventListener("mouseenter", (e) => {
      this.lastModifier = e.metaKey || e.ctrlKey;
      window.clearTimeout(this.reasonsTipTimer);
      this.reasonsTipTimer = window.setTimeout(() => {
        if (this.lastModifier) return;
        this.showInfoTip(el, c);
      }, REASONS_TIP_DELAY_MS);
    });
    el.addEventListener("mouseleave", () => {
      this.hideReasonsTip();
    });
  }

  private showInfoTip(anchor: HTMLElement, c: ScoredCandidate): void {
    this.hideReasonsTip();
    const tip = buildInfoTip(c, this.plugin.settings.showSharedReasons);
    document.body.appendChild(tip);
    this.reasonsTipEl = tip;

    // Prefer below-left of the line; clamp into the viewport, flip above when
    // there isn't room beneath.
    const r = anchor.getBoundingClientRect();
    tip.style.left = `${r.left}px`;
    tip.style.top = `${r.bottom + 4}px`;
    const t = tip.getBoundingClientRect();
    if (t.right > window.innerWidth - 8) {
      tip.style.left = `${Math.max(8, window.innerWidth - 8 - t.width)}px`;
    }
    if (t.bottom > window.innerHeight - 8) {
      tip.style.top = `${Math.max(8, r.top - t.height - 4)}px`;
    }
  }

  private hideReasonsTip(): void {
    window.clearTimeout(this.reasonsTipTimer);
    this.reasonsTipTimer = undefined;
    this.reasonsTipEl?.remove();
    this.reasonsTipEl = null;
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

// The full hover card: note title (+ folder) followed by the untruncated score
// breakdown — every shared signal, grouped by type.
function buildInfoTip(
  c: ScoredCandidate,
  showReasons: boolean,
): HTMLElement {
  const tip = createDiv({ cls: "suggested-notes-reasons-tip" });

  const header = tip.createDiv({ cls: "suggested-notes-reasons-tip-header" });
  header.createDiv({
    cls: "suggested-notes-reasons-tip-name",
    text: displayName(c.path),
  });
  const slash = c.path.lastIndexOf("/");
  if (slash > 0) {
    header.createDiv({
      cls: "suggested-notes-reasons-tip-path",
      text: c.path.slice(0, slash),
    });
  }

  // Signal labels are icons, reusing Obsidian's own outgoing-/back-link glyphs
  // so they read the same as its core panels. aria-label keeps meaning clear.
  const sections: { icon: string; label: string; values: string[] }[] = [];
  if (showReasons && c.reasons.sharedTags.length) {
    sections.push({
      icon: "tag",
      label: "Shared tags",
      values: c.reasons.sharedTags.map((t) => `#${t}`),
    });
  }
  if (showReasons && c.reasons.sharedOutlinks.length) {
    sections.push({
      icon: "links-going-out",
      label: "Shared links",
      values: c.reasons.sharedOutlinks.map((l) => `[[${displayName(l)}]]`),
    });
  }
  if (showReasons && c.reasons.sharedBacklinks.length) {
    sections.push({
      icon: "links-coming-in",
      label: "Shared backlinks",
      values: c.reasons.sharedBacklinks.map((l) => `[[${displayName(l)}]]`),
    });
  }
  if (showReasons && c.reasons.sharedBodyTokens.length) {
    sections.push({
      icon: "text",
      label: "Shared body words",
      values: c.reasons.sharedBodyTokens.map((t) => `“${t}”`),
    });
  }
  if (sections.length) {
    // One shared 2-column grid so every section's values start at the same x,
    // regardless of the (now icon-sized) label column.
    const grid = tip.createDiv({ cls: "suggested-notes-reasons-tip-grid" });
    for (const s of sections) {
      const label = grid.createSpan({
        cls: "suggested-notes-reasons-tip-label",
        attr: { "aria-label": s.label },
      });
      setIcon(label, s.icon);
      const vals = grid.createSpan({
        cls: "suggested-notes-reasons-tip-values",
      });
      for (const v of s.values) {
        vals.createSpan({ cls: "suggested-notes-reasons-tip-value", text: v });
      }
    }
  }
  return tip;
}
