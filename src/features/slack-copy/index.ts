import { Plugin } from 'obsidian';
import { copySelectionToClipboard } from './copy-selection';

export function registerSlackCopy(plugin: Plugin) {
	plugin.addCommand({
		id: 'copy-selection-for-slack',
		name: 'Copy selection for Slack',
		editorCallback: (editor) => copySelectionToClipboard(editor),
	});
}
