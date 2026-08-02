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
    const scheduleSave = () => {
      this.plugin.scheduleSettingsSave();
      this.plugin.invalidateAll();
    };
    // Obsidian owns the heading markup so it stays consistent with core
    // settings and with whatever a theme does to them. Building an <h3> and a
    // description paragraph by hand pins both to this plugin instead.
    const heading = (name: string, desc: string) => {
      new Setting(containerEl).setName(name).setDesc(desc).setHeading();
    };

    new Setting(containerEl).setName(t("settingMaxResults")).addText((c) =>
      c.setValue(String(this.plugin.settings.maxResults)).onChange((v) => {
        const n = parseInt(v, 10);
        if (!isNaN(n) && n > 0) {
          this.plugin.settings.maxResults = n;
          scheduleSave();
        }
      }),
    );

    new Setting(containerEl)
      .setName(t("settingSameRootFolderOnly"))
      .setDesc(t("descSameRootFolderOnly"))
      .addToggle((c) =>
        c
          .setValue(this.plugin.settings.sameRootFolderOnly)
          .onChange(async (v) => {
            this.plugin.settings.sameRootFolderOnly = v;
            await save();
          }),
      );

    heading(t("settingWeightsHeading"), t("settingWeightsDesc"));

    const weightSetting = (
      name: string,
      key:
        | "outlinkWeight"
        | "tagWeight"
        | "backlinkWeight"
        | "directLinkWeight"
        | "unlinkedMentionWeight"
        | "folderWeight"
        | "contentWeight",
    ) => {
      new Setting(containerEl).setName(name).addText((c) =>
        c.setValue(String(this.plugin.settings[key])).onChange((v) => {
          const n = parseFloat(v);
          if (!isNaN(n) && n >= 0) {
            this.plugin.settings[key] = n;
            scheduleSave();
          }
        }),
      );
    };
    weightSetting(t("weightOutlinks"), "outlinkWeight");
    weightSetting(t("weightTags"), "tagWeight");
    weightSetting(t("weightBacklinks"), "backlinkWeight");
    weightSetting(t("weightDirectLink"), "directLinkWeight");
    weightSetting(t("weightUnlinkedMention"), "unlinkedMentionWeight");
    weightSetting(t("weightFolder"), "folderWeight");
    weightSetting(t("weightContent"), "contentWeight");

    heading(t("settingBodyTokenHeading"), t("settingBodyTokenDesc"));

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
      .setName(t("settingCustomVocabularyName"))
      .setDesc(t("settingCustomVocabularyDesc"))
      .addTextArea((c) =>
        c
          .setValue(this.plugin.settings.customVocabulary.join("\n"))
          .onChange((value) => {
            this.plugin.settings.customVocabulary = parseListInput(
              value,
              false,
            );
            this.plugin.scheduleSettingsSave();
            this.plugin.scheduleVocabularyApply();
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
              this.plugin.scheduleSettingsSave();
              if (this.plugin.settings.bodyTokenEnabled) {
                await this.plugin.rerankBodyIndex();
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

    heading(t("settingDisplayHeading"), t("descDisplayScores"));

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

    heading(t("settingExclusionsHeading"), t("descExclusions"));

    // splitCommas only where a comma can never be part of a valid entry —
    // folder paths and note basenames may legally contain commas.
    const listSetting = (
      name: string,
      desc: string,
      key:
        | "excludedFolders"
        | "excludedTags"
        | "excludedLinks"
        | "excludedContentTokens",
      splitCommas: boolean,
    ) => {
      new Setting(containerEl)
        .setName(name)
        .setDesc(desc)
        .addTextArea((c) =>
          c
            .setValue(this.plugin.settings[key].join("\n"))
            .onChange((v) => {
              this.plugin.settings[key] = parseListInput(v, splitCommas);
              scheduleSave();
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
      t("settingExcludedContentTokens"),
      t("descExcludedContentTokens"),
      "excludedContentTokens",
      true,
    );
  }
}
