import { Plugin } from 'obsidian';
import { removeLinkAtCursor } from './remove-link-at-cursor';

export function registerUnlinkAtCursor(plugin: Plugin) {
	plugin.addCommand({
		id: 'remove-link-at-cursor',
		name: 'Remove link at cursor',
		editorCallback: (editor) => removeLinkAtCursor(editor),
	});
}
