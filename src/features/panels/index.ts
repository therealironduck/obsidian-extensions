import { Plugin } from 'obsidian';
import { panelLivePreviewExtension } from './live-preview';
import { CollapseState, createPanelPostProcessor } from './reading-view';

export function registerPanels(plugin: Plugin) {
	const collapseState = new CollapseState();

	plugin.registerEditorExtension(panelLivePreviewExtension);
	// Runs after the core processors so callouts, embeds and math are
	// already in place.
	plugin.registerMarkdownPostProcessor(
		createPanelPostProcessor(plugin.app, collapseState),
		100,
	);
}
