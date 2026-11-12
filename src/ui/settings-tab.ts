import { PluginSettingTab, Setting, type App } from 'obsidian';
import { type SettingsOwner } from '../settings';
import { renderKeepFoldersCollapsedSettings } from '../features/keep-folders-collapsed';

/**
 * One tab for the whole plugin, with a section per feature that has settings.
 * Each feature owns its own rendering, so adding one is a heading plus a call.
 */
export class ExtensionsSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly owner: SettingsOwner,
	) {
		super(app, owner);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName('Keep folders collapsed').setHeading();
		renderKeepFoldersCollapsedSettings(containerEl, this.owner);
	}
}
