import { Plugin } from 'obsidian';
import { registerPanels } from './features/panels';
import { registerSlackCopy } from './features/slack-copy';
import { registerUnlinkAtCursor } from './features/unlink-at-cursor';
import { registerKeepFoldersCollapsed } from './features/keep-folders-collapsed';
import { loadSettings, type ExtensionsSettings } from './settings';
import { ExtensionsSettingTab } from './ui/settings-tab';

/**
 * Every feature lives behind a `register` function that takes the plugin and
 * wires itself up through the `register*` helpers, so adding a feature means
 * one import and one line here and nothing else.
 */
export default class JordansExtensionsPlugin extends Plugin {
	settings!: ExtensionsSettings;

	async onload() {
		// Awaited before any feature registers, because a feature's register
		// call reads its own slice of the settings.
		this.settings = await loadSettings(this);

		registerPanels(this);
		registerSlackCopy(this);
		registerUnlinkAtCursor(this);
		registerKeepFoldersCollapsed(this);

		this.addSettingTab(new ExtensionsSettingTab(this.app, this));
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
