import { Editor, Notice } from 'obsidian';
import { stripWikilinks } from './strip-wikilinks';

export async function copySelectionToClipboard(editor: Editor): Promise<void> {
	const selection = editor.getSelection();

	if (!selection) {
		new Notice('No text selected');
		return;
	}

	const text = stripWikilinks(selection);

	await navigator.clipboard.writeText(text);
	new Notice('Copied to clipboard');
}
