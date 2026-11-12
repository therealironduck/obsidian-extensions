import { Plugin } from 'obsidian';
import {
	DEFAULT_KEEP_FOLDERS_COLLAPSED_SETTINGS,
	type KeepFoldersCollapsedSettings,
} from './features/keep-folders-collapsed/settings';

/**
 * Settings are namespaced per feature so two features can never collide over a
 * key, and so a feature's settings shape stays defined inside its own folder.
 */
export interface ExtensionsSettings {
	keepFoldersCollapsed: KeepFoldersCollapsedSettings;
}

export const DEFAULT_SETTINGS: ExtensionsSettings = {
	keepFoldersCollapsed: DEFAULT_KEEP_FOLDERS_COLLAPSED_SETTINGS,
};

/**
 * What a settings-aware feature needs from the plugin.
 *
 * Declared as an interface rather than importing the plugin class: a feature
 * importing `main.ts` while `main.ts` imports the feature would be a cycle.
 */
export interface SettingsOwner extends Plugin {
	settings: ExtensionsSettings;
	saveSettings(): Promise<void>;
}

/**
 * Merged one level deep. `Object.assign` alone would let a stored object
 * replace a whole feature's section, so a newly added key inside an existing
 * feature would come back undefined rather than falling back to its default.
 */
export async function loadSettings(plugin: Plugin): Promise<ExtensionsSettings> {
	const stored = ((await plugin.loadData()) ?? {}) as Partial<ExtensionsSettings>;

	return {
		keepFoldersCollapsed: {
			...DEFAULT_SETTINGS.keepFoldersCollapsed,
			...stored.keepFoldersCollapsed,
		},
	};
}
