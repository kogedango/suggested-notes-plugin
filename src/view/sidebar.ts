import {
  ItemView,
  Platform,
  TFile,
  WorkspaceLeaf,
  setIcon,
} from "obsidian";
import { t } from "../i18n";
import type RelatedNotesPlugin from "../main";
import type { ScoredCandidate, SuggestedTag } from "../types";
import { displayName } from "../util/path";

export const VIEW_TYPE_RELATED_NOTES = "suggested-notes-view";

const REASONS_TIP_DELAY_MS = 350;

export class RelatedNotesView extends ItemView {
  private reasonsTipEl: HTMLElement | null = null;
  private reasonsTipAnchorEl: HTMLElement | null = null;
  private reasonsTipTriggerEl: HTMLElement | null = null;
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
    return t("viewName");
  }

  getIcon(): string {
    return "waypoints";
  }

  async onOpen(): Promise<void> {
    // Modifier state can change without the mouse moving; track it globally
    // so the info tooltip yields to the modifier-gated page preview the
    // moment Cmd/Ctrl goes down (mouse listeners alone would miss it).
    this.registerDomEvent(document, "keydown", (e: KeyboardEvent) => {
      if (e.key === "Meta" || e.key === "Control") {
        this.lastModifier = true;
        this.hideReasonsTip();
      }
    });
    this.registerDomEvent(document, "keyup", (e: KeyboardEvent) => {
      if (e.key === "Meta" || e.key === "Control") this.lastModifier = false;
    });
    // The tooltip is position:fixed and doesn't follow its row when the
    // list scrolls — drop it instead of letting it float detached.
    this.registerDomEvent(
      this.containerEl,
      "scroll",
      () => this.hideReasonsTip(),
      true,
    );
    this.registerDomEvent(
      document,
      "pointerdown",
      (event: PointerEvent) => {
        const target = event.target;
        if (!(target instanceof Node)) return;
        if (this.reasonsTipEl?.contains(target)) return;
        if (this.reasonsTipAnchorEl?.contains(target)) return;
        this.hideReasonsTip();
      },
      true,
    );
    this.render();
    // onOpen runs exactly once, when this view instance is created (e.g. the
    // sidebar is (re)opened) — never on a plain focus change — so this can't
    // reintroduce the copy-button double-click bug that active-leaf-change's
    // own-focus guard exists to avoid (see main.ts). Without this, reopening
    // the sidebar on the *same* active note as before would never refresh:
    // active-leaf-change dedupes on lastRefreshedPath, which a fresh view
    // instance hasn't earned yet. requestRefresh() re-runs the (idempotent)
    // refresh unconditionally; refresh()'s own "not ready yet" guard keeps
    // the loading placeholder up if the plugin hasn't finished indexing.
    this.plugin.requestRefresh();
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
    // Only truly empty (no related notes AND no tag suggestions) collapses
    // to the "empty" state. `hideAlreadyLinked` can legitimately drain
    // `results` while `suggestedTags` still has content — the scoring layer
    // deliberately keeps already-linked notes in the tag pool (see
    // ScoreResult) — so that case must still render the tags section.
    this.state =
      results.length === 0 && suggestedTags.length === 0
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
          text: t("statusIndexing"),
          cls: "suggested-notes-status",
        });
        return;
      case "no-active":
        container.createEl("div", {
          text: t("statusNoActive"),
          cls: "suggested-notes-status",
        });
        return;
      case "empty":
        container.createEl("div", {
          text: t("statusEmpty"),
          cls: "suggested-notes-status",
        });
        return;
      case "ready":
        this.renderTags(
          container,
          this.state.activePath,
          this.state.suggestedTags,
        );
        if (this.state.results.length === 0) {
          // Same status copy as the "empty" state — only the tags section
          // above differs, since suggestedTags is what kept us out of
          // "empty" in the first place.
          container.createEl("div", {
            text: t("statusEmpty"),
            cls: "suggested-notes-status",
          });
        } else {
          this.renderList(
            container,
            this.state.activePath,
            this.state.results,
          );
        }
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
      text: t("sectionRelatedNotes"),
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
      const score = self.createEl("span", {
        text: String(c.displayScore),
        cls: "suggested-notes-score",
        attr: {
          role: "button",
          tabindex: "0",
          "aria-expanded": "false",
        },
      });
      const toggleScoreDetails = () => {
        if (this.reasonsTipEl && this.reasonsTipAnchorEl === self) {
          this.hideReasonsTip();
          return;
        }
        this.showInfoTip(self, c, score, true);
      };
      score.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleScoreDetails();
      });
      score.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        event.stopPropagation();
        toggleScoreDetails();
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
  // grouped by signal (tags / links / backlinks / content words). Suppressed
  // while Cmd/Ctrl is held so it doesn't fight the modifier body preview.
  private attachInfoTooltip(el: HTMLElement, c: ScoredCandidate): void {
    // Touch browsers can synthesize mouseenter/mouseleave around a tap. Those
    // synthetic events would immediately close the score card opened by the
    // score button, so install hover behaviour only on hover-capable devices.
    if (!window.matchMedia("(hover: hover)").matches) return;
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

  private showInfoTip(
    anchor: HTMLElement,
    c: ScoredCandidate,
    trigger: HTMLElement | null = null,
    showReasons = this.plugin.settings.showSharedReasons,
  ): void {
    this.hideReasonsTip();
    const tip = buildInfoTip(c, showReasons);
    document.body.appendChild(tip);
    this.reasonsTipEl = tip;
    this.reasonsTipAnchorEl = anchor;
    this.reasonsTipTriggerEl = trigger;
    trigger?.setAttribute("aria-expanded", "true");

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
    this.reasonsTipTriggerEl?.setAttribute("aria-expanded", "false");
    this.reasonsTipEl?.remove();
    this.reasonsTipEl = null;
    this.reasonsTipAnchorEl = null;
    this.reasonsTipTriggerEl = null;
  }

  private attachCopyButton(
    self: HTMLElement,
    activePath: string,
    targetPath: string,
  ): void {
    if (Platform.isMobileApp) self.addClass("has-mobile-copy");
    const copyBtn = self.createEl("div", {
      cls: "clickable-icon suggested-notes-copy",
      attr: { "aria-label": t("ariaCopyLink") },
    });
    setIcon(copyBtn, "copy");
    let copiedTimer: number | undefined;
    copyBtn.addEventListener("click", async (event) => {
      event.stopPropagation();
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
      text: t("sectionSuggestedTags"),
      cls: "suggested-notes-section-header",
    });
    const list = section.createEl("div", { cls: "suggested-notes-tags" });
    for (const tag of tags) {
      const chip = list.createEl("a", {
        cls: "tag suggested-notes-tag",
        text: `#${tag.tag}`,
        attr: {
          "aria-label": t("suggestAddTag", {
            tag: tag.tag,
            count: tag.fromCount,
          }),
        },
      });
      chip.addEventListener("click", (e) => {
        e.preventDefault();
        this.plugin.addTagToActive(activePath, tag.tag);
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
        .map((tag) => `#${tag}`)
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
  if (c.reasons.linksToActive) {
    parts.push(t("reasonLinksToThisNote"));
  }
  if (c.reasons.mentionsCandidateTitle) {
    parts.push(t("reasonUnlinkedTitleMention"));
  }
  if (c.reasons.sharedBacklinks.length) {
    parts.push(
      t("reasonSharedBacklinks", { count: c.reasons.sharedBacklinks.length }),
    );
  }
  if (c.reasons.sharedContentTokens.length) {
    parts.push(
      c.reasons.sharedContentTokens
        .slice(0, 4)
        .map((tok) => `“${tok}”`)
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
  header.createDiv({
    cls: "suggested-notes-reasons-tip-score",
    text: t("tipScore", { score: c.displayScore }),
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
      label: t("tipLabelSharedTags"),
      values: c.reasons.sharedTags.map((tag) => `#${tag}`),
    });
  }
  if (showReasons && c.reasons.sharedOutlinks.length) {
    sections.push({
      icon: "links-going-out",
      label: t("tipLabelSharedLinks"),
      values: c.reasons.sharedOutlinks.map((l) => `[[${displayName(l)}]]`),
    });
  }
  if (showReasons && c.reasons.linksToActive) {
    sections.push({
      icon: "link",
      label: t("tipLabelLinksToThisNote"),
      values: [t("tipLinksHereNotBack")],
    });
  }
  if (showReasons && c.reasons.mentionsCandidateTitle) {
    sections.push({
      icon: "text-search",
      label: t("tipLabelUnlinkedTitleMention"),
      values: [t("tipTitleAppearsAsPlainText")],
    });
  }
  if (showReasons && c.reasons.sharedBacklinks.length) {
    sections.push({
      icon: "links-coming-in",
      label: t("tipLabelSharedBacklinks"),
      values: c.reasons.sharedBacklinks.map((l) => `[[${displayName(l)}]]`),
    });
  }
  if (showReasons && c.reasons.sharedContentTokens.length) {
    sections.push({
      icon: "text",
      label: t("tipLabelSharedContentWords"),
      values: c.reasons.sharedContentTokens.map((tok) => `“${tok}”`),
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
