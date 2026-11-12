/**
 * Live preview rendering.
 *
 * The content lines of a panel are deliberately NOT replaced: they stay
 * ordinary `.cm-line` elements, so Obsidian's own live-preview rendering
 * (bold, links, embeds, nested code blocks) keeps working inside a panel for
 * free, and the text stays editable. All this module does is
 *
 *   1. add a line decoration to every line of the block, so CSS can fake one
 *      continuous box out of the stack of line divs, and
 *   2. replace the two `:::` fence lines with a rendered header / nothing,
 *      but only while the cursor is outside the block.
 *
 * Both decoration sets come from `StateField`s rather than a `ViewPlugin`:
 * the line decorations change line heights, and CodeMirror computes heights
 * before it runs view plugins, so a plugin that resizes lines invalidates the
 * viewport it was just handed and the measure loop thrashes. A state field
 * also sees the whole document, which matters because a panel can start above
 * the viewport and end below it.
 */

import {
	StateField,
	type EditorState,
	type Extension,
	type Range,
	type Text,
} from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import { editorLivePreviewField, setIcon } from 'obsidian';
import { parsePanels, type LineSource, type PanelBlock } from './parse';
import { CLS, depthClass, resolveVariant, variantClasses, variantIcon } from './variants';

function linesFromDoc(doc: Text): LineSource {
	return {
		lineCount: doc.lines,
		lineText: (index) => doc.line(index + 1).text,
	};
}

/** Structure only; depends on the document and nothing else. */
const panelBlocksField = StateField.define<PanelBlock[]>({
	create: (state) => parsePanels(linesFromDoc(state.doc)),
	update: (value, tr) => (tr.docChanged ? parsePanels(linesFromDoc(tr.state.doc)) : value),
});

/** Decorations; depend on the structure, the selection, and the view mode. */
const panelDecorationsField = StateField.define<DecorationSet>({
	create: (state) => buildDecorations(state),
	update(value, tr) {
		const modeChanged =
			tr.startState.field(editorLivePreviewField, false) !==
			tr.state.field(editorLivePreviewField, false);
		const selectionMoved = !tr.startState.selection.eq(tr.state.selection);
		if (!tr.docChanged && !selectionMoved && !modeChanged) return value;
		return buildDecorations(tr.state);
	},
	provide: (field) => EditorView.decorations.from(field),
});

/**
 * Order matters: `panelDecorationsField` reads `panelBlocksField` off the
 * state, so the structure field has to be registered first.
 */
export const panelLivePreviewExtension: Extension = [panelBlocksField, panelDecorationsField];

/** Inclusive on both ends, so a cursor resting on either fence reveals it. */
function selectionTouches(state: EditorState, from: number, to: number): boolean {
	return state.selection.ranges.some((range) => range.from <= to && range.to >= from);
}

function lineClasses(block: PanelBlock, line: number, editing: boolean): string {
	const variant = resolveVariant(block.variant);
	const classes = [CLS.box, depthClass(block.depth), ...variantClasses(variant)];

	if (line === block.openLine) classes.push(CLS.head);
	else if (block.closeLine !== null && line === block.closeLine) classes.push(CLS.foot);
	else classes.push(CLS.body);

	if (block.closeLine === null) classes.push(CLS.unclosed);
	if (editing) classes.push(CLS.editing);

	return classes.join(' ');
}

function buildDecorations(state: EditorState): DecorationSet {
	// Source mode asked for raw markdown, so give it raw markdown.
	if (!state.field(editorLivePreviewField, false)) return Decoration.none;

	const blocks = state.field(panelBlocksField, false);
	if (!blocks || blocks.length === 0) return Decoration.none;

	const { doc } = state;
	const ranges: Range<Decoration>[] = [];

	for (const block of blocks) {
		const openLine = doc.line(block.openLine + 1);
		const lastLine = doc.line(block.lastLine + 1);
		const editing = selectionTouches(state, openLine.from, lastLine.to);

		for (let line = block.openLine; line <= block.lastLine; line++) {
			const { from } = doc.line(line + 1);
			// Line decorations must be zero-length and sit at the line start.
			ranges.push(
				Decoration.line({ class: lineClasses(block, line, editing) }).range(from),
			);
		}

		if (editing) continue;

		// Replacing only the line's text never crosses the newline, which keeps
		// this a legal inline replacement.
		ranges.push(
			Decoration.replace({ widget: new PanelHeaderWidget(block) }).range(
				openLine.from,
				openLine.to,
			),
		);

		if (block.closeLine !== null) {
			const closeLine = doc.line(block.closeLine + 1);
			// An empty range would throw, so only hide a closer that has text.
			if (closeLine.to > closeLine.from) {
				ranges.push(Decoration.replace({}).range(closeLine.from, closeLine.to));
			}
		}
	}

	// Let CodeMirror sort: line and replace decorations at the same position
	// have to be added in a specific order otherwise.
	return Decoration.set(ranges, true);
}

class PanelHeaderWidget extends WidgetType {
	constructor(private readonly block: PanelBlock) {
		super();
	}

	/**
	 * Without this the widget's DOM would be rebuilt on every cursor move
	 * anywhere in the file.
	 */
	eq(other: PanelHeaderWidget): boolean {
		return (
			other.block.variant === this.block.variant &&
			other.block.title === this.block.title &&
			other.block.collapsible === this.block.collapsible &&
			other.block.startCollapsed === this.block.startCollapsed
		);
	}

	toDOM(): HTMLElement {
		const variant = resolveVariant(this.block.variant);
		const el = createSpan({ cls: CLS.header });

		const icon = variantIcon(variant);
		if (icon) setIcon(el.createSpan({ cls: CLS.headerIcon }), icon);

		// Rendered as plain text on purpose: a markdown render here would need
		// its own Component lifecycle, and the widget is torn down on every
		// reveal/conceal cycle. Reading view renders the title as markdown.
		el.createSpan({
			cls: CLS.headerTitle,
			text: this.block.title || variant || 'Panel',
		});

		if (this.block.collapsible) {
			setIcon(
				el.createSpan({ cls: CLS.fold }),
				this.block.startCollapsed ? 'chevron-right' : 'chevron-down',
			);
		}

		return el;
	}

	/**
	 * Returning false lets CodeMirror handle the click, which moves the cursor
	 * into the fence line and so reveals the raw `::: panel ...` for editing.
	 * That is the entire edit affordance for the header.
	 */
	ignoreEvent(): boolean {
		return false;
	}
}
