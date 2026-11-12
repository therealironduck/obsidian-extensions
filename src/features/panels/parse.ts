/**
 * Scanner for `::: panel` blocks.
 *
 * Both renderers (live preview and reading view) share this so the two views
 * can never disagree about where a panel starts and ends. It works over an
 * abstract line source because live preview reads lines from a CodeMirror
 * `Text` while reading view reads them from a plain source string.
 *
 * All line numbers are 0-based.
 */

export interface LineSource {
	readonly lineCount: number;
	lineText(index: number): string;
}

export function linesFromString(text: string): LineSource {
	const lines = text.split('\n');
	return {
		lineCount: lines.length,
		lineText: (index) => lines[index] ?? '',
	};
}

export interface PanelBlock {
	/** Canonical variant name, or `''` for a neutral panel. */
	variant: string;
	/** Raw title text (still markdown; the renderer decides what to do with it). */
	title: string;
	collapsible: boolean;
	startCollapsed: boolean;
	/** Number of colons in the opening fence; a closer needs at least as many. */
	fenceLength: number;
	/** Nesting level, 0 for an outermost panel. */
	depth: number;
	openLine: number;
	/** `null` when the block is never closed. */
	closeLine: number | null;
	/** `closeLine`, or the last line of the document for an unclosed block. */
	lastLine: number;
}

/**
 * Fences must start at column 0. That is deliberate: it keeps panels out of
 * list items and blockquotes, where Obsidian's own indent padding would fight
 * the panel's border and produce a visibly broken box.
 */
const OPEN_RE = /^(:{3,})[ \t]*panel\b(\S*)[ \t]*(.*)$/;
const CLOSE_RE = /^(:{3,})[ \t]*$/;
const CODE_FENCE_RE = /^[ \t]{0,3}(`{3,}|~{3,})/;

/**
 * Validates the bit directly after `panel`, e.g. `.info-`, `+`, or nothing.
 *
 * The variant is matched lazily so that a trailing `-` is read as the collapse
 * marker rather than as part of the variant, while a genuinely hyphenated
 * variant still parses: `.my-type` yields `my-type` with no marker, and
 * `.my-type-` yields `my-type` collapsed.
 */
const SPEC_RE = /^(?:\.([A-Za-z][\w-]*?))?([+-])?$/;

type OpenPanel = Omit<PanelBlock, 'closeLine' | 'lastLine'>;

export function parsePanels(source: LineSource): PanelBlock[] {
	const blocks: PanelBlock[] = [];
	const stack: OpenPanel[] = [];
	let codeFence: { char: string; length: number } | null = null;
	let inFrontmatter = false;

	for (let index = 0; index < source.lineCount; index++) {
		const text = source.lineText(index);

		// Frontmatter only counts at the very top of the document.
		if (index === 0 && text.trim() === '---') {
			inFrontmatter = true;
			continue;
		}
		if (inFrontmatter) {
			if (text.trim() === '---') inFrontmatter = false;
			continue;
		}

		// A fenced code block swallows everything, so `:::` inside one stays
		// literal text. This is what lets a panel contain a code block.
		const codeFenceMatch = CODE_FENCE_RE.exec(text);
		if (codeFenceMatch) {
			const marker = codeFenceMatch[1] ?? '';
			const char = marker.charAt(0);
			if (codeFence === null) {
				codeFence = { char, length: marker.length };
			} else if (char === codeFence.char && marker.length >= codeFence.length) {
				codeFence = null;
			}
			continue;
		}
		if (codeFence !== null) continue;

		const closeMatch = CLOSE_RE.exec(text);
		const open = stack[stack.length - 1];
		if (closeMatch && open && (closeMatch[1] ?? '').length >= open.fenceLength) {
			stack.pop();
			blocks.push({ ...open, closeLine: index, lastLine: index });
			continue;
		}

		const openMatch = OPEN_RE.exec(text);
		if (!openMatch) continue;
		const spec = SPEC_RE.exec(openMatch[2] ?? '');
		if (!spec) continue;

		const marker = spec[2];
		stack.push({
			variant: (spec[1] ?? '').toLowerCase(),
			title: (openMatch[3] ?? '').trim(),
			collapsible: marker !== undefined,
			startCollapsed: marker === '-',
			fenceLength: (openMatch[1] ?? '').length,
			depth: stack.length,
			openLine: index,
		});
	}

	// Unclosed panels still get reported, running to the end of the document, so
	// that live preview can draw the box (and flag it) while it is being typed.
	// Reading view filters these out instead of restructuring the whole note.
	while (stack.length > 0) {
		const open = stack.pop();
		if (!open) break;
		blocks.push({
			...open,
			closeLine: null,
			lastLine: Math.max(source.lineCount - 1, open.openLine),
		});
	}

	blocks.sort((a, b) => a.openLine - b.openLine || a.depth - b.depth);
	return blocks;
}

/** True when the section spanning these lines overlaps the block at all. */
export function overlaps(block: PanelBlock, fromLine: number, toLine: number): boolean {
	return fromLine <= block.lastLine && toLine >= block.openLine;
}
