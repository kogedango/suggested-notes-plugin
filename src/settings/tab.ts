import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type RelatedNotesPlugin from "../main";

export class RelatedNotesSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: RelatedNotesPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    const save = async () => {
      await this.plugin.saveSettings();
      this.plugin.invalidateAll();
    };

    new Setting(containerEl).setName("Max results").addText((t) =>
      t.setValue(String(this.plugin.settings.maxResults)).onChange(async (v) => {
        const n = parseInt(v, 10);
        if (!isNaN(n) && n > 0) {
          this.plugin.settings.maxResults = n;
          await save();
        }
      }),
    );

    containerEl.createEl("h3", { text: "Weights" });
    containerEl.createEl("p", {
      text:
        "Each shared signal contributes weight × IDF to the score. " +
        "The total is then divided by log(1 + outlinkCount) of the candidate to suppress MOC / index notes. " +
        "Same folder defaults to 0 — folder co-location often means 'filed together', not 'topically related'.",
      cls: "setting-item-description",
    });

    const weightSetting = (
      name: string,
      key: "outlinkWeight" | "tagWeight" | "backlinkWeight" | "folderWeight",
    ) => {
      new Setting(containerEl).setName(name).addText((t) =>
        t.setValue(String(this.plugin.settings[key])).onChange(async (v) => {
          const n = parseFloat(v);
          if (!isNaN(n) && n >= 0) {
            this.plugin.settings[key] = n;
            await save();
          }
        }),
      );
    };
    weightSetting("Shared outlinks", "outlinkWeight");
    weightSetting("Shared tags", "tagWeight");
    weightSetting("Shared backlinks", "backlinkWeight");
    weightSetting("Same folder", "folderWeight");

    containerEl.createEl("h3", { text: "Body-token matching" });
    containerEl.createEl("p", {
      text:
        "Optional. Picks up notes that share rare vocabulary even without explicit tags or links. " +
        "Off by default: enabling reads every .md file once (async, ~10–20s for 5,000 notes) to build the index. " +
        "The active note is always re-read live, and an edited note's index entry updates as soon as the edit settles (~2s). " +
        "Whole-vault statistics rebuild lazily (~1 min after edits settle), " +
        "or immediately via the Rebuild button below / 'Rebuild body-token index' command.",
      cls: "setting-item-description",
    });

    new Setting(containerEl)
      .setName("Enable body-token matching")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.bodyTokenEnabled).onChange(async (v) => {
          this.plugin.settings.bodyTokenEnabled = v;
          await this.plugin.saveSettings();
          await this.plugin.rebuildBodyIndex();
        }),
      );

    new Setting(containerEl)
      .setName("Japanese word segmentation (experimental)")
      .setDesc(
        "Splits Japanese text into words with TinySegmenter (offline, no dictionary) " +
          "so okurigana-mixed words like 打ち合わせ and hiragana words like ひらめき " +
          "also count as shared vocabulary. Changing this rebuilds the index.",
      )
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.bodyTokenSegmenterEnabled)
          .onChange(async (v) => {
            this.plugin.settings.bodyTokenSegmenterEnabled = v;
            await this.plugin.saveSettings();
            if (this.plugin.settings.bodyTokenEnabled) {
              await this.plugin.rebuildBodyIndex();
            }
          }),
      );

    new Setting(containerEl).setName("Body-token weight").addText((t) =>
      t
        .setValue(String(this.plugin.settings.bodyTokenWeight))
        .onChange(async (v) => {
          const n = parseFloat(v);
          if (!isNaN(n) && n >= 0) {
            this.plugin.settings.bodyTokenWeight = n;
            await save();
          }
        }),
    );

    new Setting(containerEl)
      .setName("Salient tokens per note")
      .setDesc("Changing this rebuilds the index.")
      .addText((t) =>
        t
          .setValue(String(this.plugin.settings.bodyTokenTopN))
          .onChange(async (v) => {
            const n = parseInt(v, 10);
            if (!isNaN(n) && n > 0) {
              this.plugin.settings.bodyTokenTopN = n;
              await this.plugin.saveSettings();
              if (this.plugin.settings.bodyTokenEnabled) {
                await this.plugin.rebuildBodyIndex();
              }
            }
          }),
      );

    new Setting(containerEl)
      .setName("Rebuild index now")
      .setDesc(
        "Re-reads every note and rebuilds the whole-vault statistics. " +
          "Rarely needed: edited notes update on save, and statistics refresh " +
          "automatically ~1 min after edits settle.",
      )
      .addButton((b) =>
        b.setButtonText("Rebuild").onClick(async () => {
          if (!this.plugin.settings.bodyTokenEnabled) {
            new Notice("Body-token matching is disabled.");
            return;
          }
          b.setDisabled(true);
          try {
            await this.plugin.rebuildBodyIndex(true);
          } finally {
            b.setDisabled(false);
          }
        }),
      );

    containerEl.createEl("h3", { text: "Display" });
    containerEl.createEl("p", {
      text:
        "Scores are per-query normalized (top match = 100) and not comparable across different active notes.",
      cls: "setting-item-description",
    });

    new Setting(containerEl).setName("Show scores").addToggle((t) =>
      t.setValue(this.plugin.settings.showScores).onChange(async (v) => {
        this.plugin.settings.showScores = v;
        await save();
      }),
    );

    new Setting(containerEl).setName("Show shared reasons").addToggle((t) =>
      t
        .setValue(this.plugin.settings.showSharedReasons)
        .onChange(async (v) => {
          this.plugin.settings.showSharedReasons = v;
          await save();
        }),
    );

    new Setting(containerEl).setName("Hide already-linked").addToggle((t) =>
      t
        .setValue(this.plugin.settings.hideAlreadyLinked)
        .onChange(async (v) => {
          this.plugin.settings.hideAlreadyLinked = v;
          await save();
        }),
    );

    containerEl.createEl("h3", { text: "Exclusions" });
    containerEl.createEl("p", {
      text:
        "Excluded folders and excluded tags/links behave differently. " +
        "Folders: notes inside are removed from results entirely. " +
        "Tags / links: only that signal is ignored during scoring — a note carrying an excluded tag can still appear if it matches via other signals. " +
        "This lets you down-weight noisy tags without losing genuinely related notes that happen to use them. " +
        "To fully hide a group of notes, put them in a folder and exclude that folder.",
      cls: "setting-item-description",
    });

    const listSetting = (
      name: string,
      desc: string,
      key: "excludedFolders" | "excludedTags" | "excludedLinks",
    ) => {
      new Setting(containerEl)
        .setName(name)
        .setDesc(desc)
        .addTextArea((t) =>
          t
            .setValue(this.plugin.settings[key].join("\n"))
            .onChange(async (v) => {
              this.plugin.settings[key] = v
                .split("\n")
                .map((s) => s.trim())
                .filter(Boolean);
              await save();
            }),
        );
    };
    listSetting(
      "Excluded folders",
      "One folder path per line. Both 'Daily/' and '/Daily' are accepted.",
      "excludedFolders",
    );
    listSetting(
      "Excluded tags",
      "One tag per line, without the leading #.",
      "excludedTags",
    );
    listSetting(
      "Excluded links",
      "One note basename per line (e.g. 'Linux', not '[[Linux]]').",
      "excludedLinks",
    );
  }
}
