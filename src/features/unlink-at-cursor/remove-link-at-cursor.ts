import { Editor, Notice } from 'obsidian';
import { findWikilinkAtCursor } from './find-wikilink-at-cursor';

export function removeLinkAtCursor(editor: Editor): void {
	const cursor = editor.getCursor();
	const line = editor.getLine(cursor.line);
	const match = findWikilinkAtCursor(line, cursor.ch);

	if (!match) {
		new Notice('No link at cursor');
		return;
	}

	editor.replaceRange(
		match.replacement,
		{ line: cursor.line, ch: match.from },
		{ line: cursor.line, ch: match.to },
	);
	editor.setCursor({ line: cursor.line, ch: match.from + match.replacement.length });
}
