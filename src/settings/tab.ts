import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import { t } from "../i18n";
import type RelatedNotesPlugin from "../main";
import { parseListInput } from "../util/list";

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

    new Setting(containerEl).setName(t("settingMaxResults")).addText((c) =>
      c.setValue(String(this.plugin.settings.maxResults)).onChange(async (v) => {
        const n = parseInt(v, 10);
        if (!isNaN(n) && n > 0) {
          this.plugin.settings.maxResults = n;
          await save();
        }
      }),
    );

    containerEl.createEl("h3", { text: t("settingWeightsHeading") });
    containerEl.createEl("p", {
      text: t("settingWeightsDesc"),
      cls: "setting-item-description",
    });

    const weightSetting = (
      name: string,
      key:
        | "outlinkWeight"
        | "tagWeight"
        | "backlinkWeight"
        | "directLinkWeight"
        | "folderWeight",
    ) => {
      new Setting(containerEl).setName(name).addText((c) =>
        c.setValue(String(this.plugin.settings[key])).onChange(async (v) => {
          const n = parseFloat(v);
          if (!isNaN(n) && n >= 0) {
            this.plugin.settings[key] = n;
            await save();
          }
        }),
      );
    };
    weightSetting(t("weightOutlinks"), "outlinkWeight");
    weightSetting(t("weightTags"), "tagWeight");
    weightSetting(t("weightBacklinks"), "backlinkWeight");
    weightSetting(t("weightDirectLink"), "directLinkWeight");
    weightSetting(t("weightFolder"), "folderWeight");

    containerEl.createEl("h3", { text: t("settingBodyTokenHeading") });
    containerEl.createEl("p", {
      text: t("settingBodyTokenDesc"),
      cls: "setting-item-description",
    });

    new Setting(containerEl)
      .setName(t("settingBodyTokenEnable"))
      .addToggle((c) =>
        c.setValue(this.plugin.settings.bodyTokenEnabled).onChange(async (v) => {
          this.plugin.settings.bodyTokenEnabled = v;
          await this.plugin.saveSettings();
          await this.plugin.rebuildBodyIndex();
        }),
      );

    new Setting(containerEl)
      .setName(t("settingSegmenterName"))
      .setDesc(t("settingSegmenterDesc"))
      .addToggle((c) =>
        c
          .setValue(this.plugin.settings.bodyTokenSegmenterEnabled)
          .onChange(async (v) => {
            this.plugin.settings.bodyTokenSegmenterEnabled = v;
            await this.plugin.saveSettings();
            if (this.plugin.settings.bodyTokenEnabled) {
              await this.plugin.rebuildBodyIndex();
            }
          }),
      );

    new Setting(containerEl).setName(t("settingBodyTokenWeight")).addText((c) =>
      c
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
      .setName(t("settingTopN"))
      .setDesc(t("descRebuildsIndex"))
      .addText((c) =>
        c
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
      .setName(t("settingRebuildNow"))
      .setDesc(t("descRebuildNow"))
      .addButton((b) =>
        b.setButtonText(t("buttonRebuild")).onClick(async () => {
          if (!this.plugin.settings.bodyTokenEnabled) {
            new Notice(t("noticeBodyTokenDisabled"));
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

    containerEl.createEl("h3", { text: t("settingDisplayHeading") });
    containerEl.createEl("p", {
      text: t("descDisplayScores"),
      cls: "setting-item-description",
    });

    new Setting(containerEl).setName(t("settingShowScores")).addToggle((c) =>
      c.setValue(this.plugin.settings.showScores).onChange(async (v) => {
        this.plugin.settings.showScores = v;
        await save();
      }),
    );

    new Setting(containerEl).setName(t("settingShowSharedReasons")).addToggle((c) =>
      c
        .setValue(this.plugin.settings.showSharedReasons)
        .onChange(async (v) => {
          this.plugin.settings.showSharedReasons = v;
          await save();
        }),
    );

    new Setting(containerEl).setName(t("settingHideAlreadyLinked")).addToggle((c) =>
      c
        .setValue(this.plugin.settings.hideAlreadyLinked)
        .onChange(async (v) => {
          this.plugin.settings.hideAlreadyLinked = v;
          await save();
        }),
    );

    containerEl.createEl("h3", { text: t("settingExclusionsHeading") });
    containerEl.createEl("p", {
      text: t("descExclusions"),
      cls: "setting-item-description",
    });

    // splitCommas only where a comma can never be part of a valid entry —
    // folder paths and note basenames may legally contain commas.
    const listSetting = (
      name: string,
      desc: string,
      key:
        | "excludedFolders"
        | "excludedTags"
        | "excludedLinks"
        | "excludedBodyTokens",
      splitCommas: boolean,
    ) => {
      new Setting(containerEl)
        .setName(name)
        .setDesc(desc)
        .addTextArea((c) =>
          c
            .setValue(this.plugin.settings[key].join("\n"))
            .onChange(async (v) => {
              this.plugin.settings[key] = parseListInput(v, splitCommas);
              await save();
            }),
        );
    };
    listSetting(
      t("settingExcludedFolders"),
      t("descExcludedFolders"),
      "excludedFolders",
      false,
    );
    listSetting(
      t("settingExcludedTags"),
      t("descExcludedTags"),
      "excludedTags",
      true,
    );
    listSetting(
      t("settingExcludedLinks"),
      t("descExcludedLinks"),
      "excludedLinks",
      false,
    );
    listSetting(
      t("settingExcludedBodyTokens"),
      t("descExcludedBodyTokens"),
      "excludedBodyTokens",
      true,
    );
  }
}
