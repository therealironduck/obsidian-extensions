/**
 * Markdown -> document model, by way of Obsidian's own renderer.
 *
 * Nothing here parses markdown. `MarkdownRenderer.render` produces the same
 * DOM reading view shows, and this walks it. That is what makes an export
 * agree with what the note looks like on screen — including native callouts,
 * footnotes, and the rendered output of other plugins rather than their source
 * text.
 *
 * Panels are the exception. Obsidian hands a post processor one section at a
 * time, so a panel arrives as a run of sibling elements that CSS fakes into one
 * box, with no element spanning it. Rather than reassemble that from classes,
 * the source is split on panel boundaries using the same `parsePanels` scanner
 * the two on-screen renderers use, and each segment is rendered on its own. A
 * fourth consumer of that scanner cannot disagree with the first three.
 */

import { Component, MarkdownRenderer, type App, type TFile } from 'obsidian';
import { linesFromString, parsePanels } from '../panels/parse';
import { resolveVariant } from '../panels/variants';
import type { Block, Footnote, Inline, ListItem } from './model';
import { tableKey, type WidthDeclaration } from './table-widths';

export interface WalkResult {
	blocks: Block[];
	footnotes: Footnote[];
	/** Things deliberately left out, reported to the user afterwards. */
	skipped: string[];
}

interface Context {
	app: App;
	sourcePath: string;
	component: Component;
	host: HTMLElement;
	footnotes: Footnote[];
	skipped: Set<string>;
	/**
	 * Declared widths, keyed by table header rather than by position. Several
	 * tables can share a header, so each key holds a queue consumed in order.
	 */
	widths: Map<string, number[][]>;
	/** Counter handing each source list its own identity. */
	nextListId: number;
}

export async function buildBlocks(
	app: App,
	file: TFile,
	body: string,
	declarations: WidthDeclaration[],
): Promise<WalkResult> {
	const component = new Component();
	component.load();

	const widths = new Map<string, number[][]>();
	for (const declaration of declarations) {
		const queue = widths.get(declaration.key) ?? [];
		queue.push(declaration.widths);
		widths.set(declaration.key, queue);
	}

	// Attached rather than detached: some renderers measure layout and produce
	// nothing at all in an orphaned element.
	const host = activeDocument.body.createDiv({ cls: 'jx-docx-offscreen' });

	const ctx: Context = {
		app,
		sourcePath: file.path,
		component,
		host,
		footnotes: [],
		skipped: new Set(),
		widths,
		nextListId: 0,
	};

	try {
		const blocks = await blocksFromLines(body.split('\n'), ctx);
		return { blocks, footnotes: ctx.footnotes, skipped: [...ctx.skipped] };
	} finally {
		host.remove();
		component.unload();
	}
}

/** Splits a run of source lines on its outermost panels, recursing into each. */
async function blocksFromLines(lines: string[], ctx: Context): Promise<Block[]> {
	// A leading blank line keeps `parsePanels` from reading a slice that opens
	// with `---` as frontmatter; every line number it returns is then one high.
	const padded = ['', ...lines];
	const panels = parsePanels(linesFromString(padded.join('\n'))).filter(
		(panel) => panel.depth === 0,
	);

	const out: Block[] = [];
	let cursor = 0;

	for (const panel of panels) {
		const open = panel.openLine - 1;
		// `close` is the exclusive end of the body, which for a closed panel is
		// the index of its closing fence. An unclosed panel has no fence, so its
		// body runs to the end — using the last line as the bound would drop it.
		const close = panel.closeLine === null ? lines.length : panel.closeLine - 1;

		if (open > cursor) out.push(...(await renderChunk(lines.slice(cursor, open), ctx)));

		out.push({
			type: 'panel',
			variant: resolveVariant(panel.variant),
			title: panel.title,
			blocks: await blocksFromLines(lines.slice(open + 1, close), ctx),
		});
		cursor = close + 1;
	}

	if (cursor < lines.length) out.push(...(await renderChunk(lines.slice(cursor), ctx)));
	return out;
}

async function renderChunk(lines: string[], ctx: Context): Promise<Block[]> {
	const markdown = lines.join('\n').trim();
	if (markdown.length === 0) return [];

	const el = ctx.host.createDiv();
	await MarkdownRenderer.render(ctx.app, markdown, el, ctx.sourcePath, ctx.component);
	await waitForQuiet(el);

	// Footnote bodies are lifted out before the walk so the section does not
	// also render as ordinary content at the end of the document.
	const base = ctx.footnotes.length;
	await extractFootnotes(el, ctx);

	return blocksFromChildren(el, ctx, base);
}

/**
 * Other plugins render asynchronously, so a chunk can still be empty a tick
 * after `render` resolves. Polling until the markup stops changing is cruder
 * than a signal, but Obsidian exposes no signal and the alternative is an
 * export that silently drops a Dataview table.
 */
async function waitForQuiet(el: HTMLElement): Promise<void> {
	let previous = '';
	for (let attempt = 0; attempt < 20; attempt++) {
		const current = el.innerHTML;
		if (attempt > 0 && current === previous) return;
		previous = current;
		await sleep(25);
	}
}

async function extractFootnotes(el: HTMLElement, ctx: Context): Promise<void> {
	const section = el.querySelector('section.footnotes, div.footnotes');
	if (!section) return;

	for (const item of Array.from(section.querySelectorAll('ol > li'))) {
		// The back-reference arrow is navigation, not content.
		for (const back of Array.from(item.querySelectorAll('a.footnote-backref'))) {
			back.remove();
		}
		ctx.footnotes.push({ blocks: await blocksFromChildren(item as HTMLElement, ctx, 0) });
	}
	section.remove();
}

async function blocksFromChildren(
	root: HTMLElement,
	ctx: Context,
	footnoteBase: number,
): Promise<Block[]> {
	const out: Block[] = [];
	for (const child of Array.from(root.children)) {
		out.push(...(await blockFromNode(child as HTMLElement, ctx, footnoteBase)));
	}
	return out;
}

const HEADINGS: Record<string, 1 | 2 | 3 | 4> = {
	H1: 1,
	H2: 2,
	H3: 3,
	H4: 4,
	H5: 4,
	H6: 4,
};

async function blockFromNode(
	el: HTMLElement,
	ctx: Context,
	footnoteBase: number,
): Promise<Block[]> {
	const tag = el.tagName;

	// These three tests are deliberately narrow. Matching anywhere inside the
	// element would mean a list, callout or paragraph that merely *contains* an
	// image became that image, and one holding a diagram vanished along with
	// all its sibling text — silently, which is the one failure mode this
	// exporter is built to avoid.
	if (isStandalone(el, isMermaid)) {
		ctx.skipped.add('Mermaid diagrams');
		return [];
	}

	if (isStandalone(el, isNoteEmbed)) {
		ctx.skipped.add('Embedded notes');
		return [];
	}

	if (isStandalone(el, isImage)) {
		const image = await imageFromNode(el, ctx);
		return image ? [image] : [];
	}

	const heading = HEADINGS[tag];
	if (heading !== undefined) {
		return [{ type: 'heading', level: heading, inlines: inlinesFrom(el, ctx, footnoteBase) }];
	}

	// A paragraph can hold text *and* an image. The model has no inline image,
	// so the text becomes a paragraph and each image follows it as its own
	// block, rather than one of the two being dropped.
	if (tag === 'P') {
		const out: Block[] = [];
		const inlines = inlinesFrom(el, ctx, footnoteBase);
		if (hasText(inlines)) out.push({ type: 'para', inlines });

		for (const img of Array.from(el.querySelectorAll('img'))) {
			// An image belonging to a transcluded note goes with the note.
			if (img.closest('.markdown-embed')) continue;
			const image = await imageFromNode(img.closest('.internal-embed') ?? img, ctx);
			if (image) out.push(image);
		}
		return out;
	}

	// Lists and tables are walked by their own readers, which only collect
	// inline runs, so an image inside one has nowhere to go.
	if ((tag === 'UL' || tag === 'OL' || tag === 'TABLE') && el.querySelector('img')) {
		ctx.skipped.add('Images inside lists and tables');
	}

	if (tag === 'UL' || tag === 'OL') {
		return [{ type: 'list', items: listItems(el, 0, footnoteBase, ctx) }];
	}

	if (tag === 'TABLE') return [tableFrom(el, ctx, footnoteBase)];
	if (tag === 'PRE') return [{ type: 'code', text: el.textContent ?? '' }];
	if (tag === 'HR') return [{ type: 'hr' }];

	if (tag === 'BLOCKQUOTE') {
		return [{ type: 'quote', blocks: await blocksFromChildren(el, ctx, footnoteBase) }];
	}

	// Native callouts share the panel rendering; `data-callout` is the variant.
	if (el.hasClass('callout')) {
		const title = el.querySelector('.callout-title-inner')?.textContent ?? '';
		const content = el.querySelector('.callout-content');
		return [
			{
				type: 'panel',
				variant: resolveVariant((el.getAttribute('data-callout') ?? '').toLowerCase()),
				title: title.trim(),
				blocks: content
					? await blocksFromChildren(content as HTMLElement, ctx, footnoteBase)
					: [],
			},
		];
	}

	// Anything else that is a container (Obsidian wraps liberally) is descended
	// into rather than dropped.
	if (el.children.length > 0) return blocksFromChildren(el, ctx, footnoteBase);

	const inlines = inlinesFrom(el, ctx, footnoteBase);
	return hasText(inlines) ? [{ type: 'para', inlines }] : [];
}

function hasText(inlines: Inline[]): boolean {
	return inlines.some((run) => run.text.trim().length > 0 || run.footnote !== undefined);
}

const isMermaid = (el: HTMLElement): boolean => el.hasClass('mermaid');

const isNoteEmbed = (el: HTMLElement): boolean =>
	el.hasClass('internal-embed') &&
	!el.hasClass('image-embed') &&
	el.querySelector('.markdown-embed') !== null;

const isImage = (el: HTMLElement): boolean =>
	el.instanceOf(HTMLImageElement) ||
	(el.hasClass('internal-embed') && el.hasClass('image-embed'));

/**
 * True when the element either is the thing being matched, or is a paragraph
 * wrapping nothing but it. Obsidian puts a lone embed in its own `<p>`, so that
 * second case is the common one; anything richer is a container and has to be
 * descended into instead of replaced.
 */
function isStandalone(el: HTMLElement, match: (candidate: HTMLElement) => boolean): boolean {
	if (match(el)) return true;
	if (el.tagName !== 'P') return false;

	const meaningful = Array.from(el.childNodes).filter(
		(node) => node.nodeType !== Node.TEXT_NODE || (node.textContent ?? '').trim().length > 0,
	);
	const only = meaningful[0];

	return (
		meaningful.length === 1 &&
		only?.nodeType === Node.ELEMENT_NODE &&
		match(only as HTMLElement)
	);
}

async function imageFromNode(el: HTMLElement, ctx: Context): Promise<Block | null> {
	const img = el.instanceOf(HTMLImageElement) ? el : el.querySelector('img');
	if (!img) return null;

	// The wrapper carries the vault-relative link; the `<img>` only has an
	// `app://` URL, which is not a path we can read back.
	const wrapper = el.hasClass('internal-embed') ? el : el.querySelector('.internal-embed');
	const link = wrapper?.getAttribute('src') ?? img.getAttribute('alt') ?? '';
	const [target, size] = link.split('|');

	const file = ctx.app.metadataCache.getFirstLinkpathDest(target ?? '', ctx.sourcePath);
	if (!file) {
		ctx.skipped.add('Images that could not be resolved');
		return null;
	}

	const extension = file.extension.toLowerCase();
	if (extension !== 'png' && extension !== 'jpg' && extension !== 'jpeg') {
		ctx.skipped.add('Images that are not PNG or JPEG');
		return null;
	}

	const data = new Uint8Array(await ctx.app.vault.readBinary(file));
	const hint = size !== undefined && /^\d+$/.test(size) ? Number(size) : undefined;

	return {
		type: 'image',
		data,
		extension: extension === 'png' ? 'png' : 'jpeg',
		alt: file.basename,
		hint,
	};
}

function listItems(
	list: HTMLElement,
	level: number,
	footnoteBase: number,
	ctx: Context,
): ListItem[] {
	const items: ListItem[] = [];
	// Per source list, so items of one list share numbering while a sibling
	// list restarts — and so a nested list of the other kind keeps its own type.
	const listId = ctx.nextListId++;
	const ordered = list.tagName === 'OL';

	for (const li of Array.from(list.children)) {
		if (li.tagName !== 'LI') continue;

		const nested = Array.from(li.children).filter(
			(child) => child.tagName === 'UL' || child.tagName === 'OL',
		);

		// A checkbox is read off the input and then excluded from the text, so
		// the box the theme draws is the only one in the line.
		const checkbox = li.querySelector('input[type="checkbox"]');
		const task = checkbox
			? checkbox.hasAttribute('checked') || li.hasClass('is-checked')
				? ('done' as const)
				: ('todo' as const)
			: undefined;

		const inlines = inlinesFrom(
			li as HTMLElement,
			ctx,
			footnoteBase,
			(node) => node.tagName === 'UL' || node.tagName === 'OL' || node.tagName === 'INPUT',
		);

		if (hasText(inlines) || task) items.push({ inlines, level, task, ordered, listId });

		for (const child of nested) {
			items.push(...listItems(child as HTMLElement, level + 1, footnoteBase, ctx));
		}
	}

	return items;
}

function tableFrom(table: HTMLElement, ctx: Context, footnoteBase: number): Block {
	const rows = Array.from(table.querySelectorAll('tr'));
	const headRow = rows[0];
	const header = headRow
		? Array.from(headRow.children).map((cell) =>
				inlinesFrom(cell as HTMLElement, ctx, footnoteBase),
			)
		: [];

	const align = headRow
		? Array.from(headRow.children).map((cell) => {
				const value = (cell as HTMLElement).getAttribute('align') ?? '';
				return value === 'center' || value === 'right' ? value : 'left';
			})
		: [];

	const body = rows
		.slice(1)
		.map((row) =>
			Array.from(row.children).map((cell) =>
				inlinesFrom(cell as HTMLElement, ctx, footnoteBase),
			),
		);

	// Declared widths are found by header text, not by counting tables: see
	// table-widths.ts for why position proved impossible to keep in step.
	const key = headRow
		? tableKey(Array.from(headRow.children).map((cell) => cell.textContent ?? ''))
		: '';
	const candidate = ctx.widths.get(key)?.shift();

	// A declaration whose count does not match the table would leave a header
	// cell at zero width and give the body rows a different number of cells
	// than the header, so it is discarded in favour of the heuristic.
	const declared = candidate?.length === header.length ? candidate : undefined;
	if (candidate && !declared) ctx.skipped.add('Table widths with the wrong column count');

	return { type: 'table', header, rows: body, align, widths: declared };
}

/**
 * Obsidian has spelled footnote references more than one way across versions,
 * so all three markers it has used are accepted — but every one of them is a
 * positive signal, which a bare `<sup>` is not.
 */
function isFootnoteRef(el: HTMLElement): boolean {
	return (
		el.hasClass('footnote-ref') ||
		el.hasAttribute('data-footnote-id') ||
		(el.tagName === 'SUP' && el.querySelector('a[href^="#fn"]') !== null)
	);
}

function inlinesFrom(
	root: HTMLElement,
	ctx: Context,
	footnoteBase: number,
	exclude?: (el: HTMLElement) => boolean,
): Inline[] {
	const out: Inline[] = [];

	const visit = (node: Node, inherited: Partial<Inline>): void => {
		if (node.nodeType === Node.TEXT_NODE) {
			const text = node.textContent ?? '';
			if (text.length > 0) out.push({ ...inherited, text });
			return;
		}
		if (node.nodeType !== Node.ELEMENT_NODE) return;

		const el = node as HTMLElement;
		if (exclude?.(el)) return;

		// An embed sharing a line with text never reaches the block-level tests,
		// so it is caught here too. Descending into one would splice the whole
		// transcluded note into the sentence as bare text, which is neither what
		// the reader expects nor what the export promises.
		if (isNoteEmbed(el)) {
			ctx.skipped.add('Embedded notes');
			return;
		}
		if (isMermaid(el)) {
			ctx.skipped.add('Mermaid diagrams');
			return;
		}

		const tag = el.tagName;
		let next = inherited;

		// A footnote reference is a marker, not text: the number Obsidian has
		// already rendered is the index into the collected bodies.
		//
		// Matched structurally rather than by tag. Treating every `<sup>` as a
		// reference would turn raw HTML like `x<sup>2</sup>` into a reference to
		// footnote 2 — which usually does not exist, leaving a `w:id` with no
		// matching `w:footnote` and a file Word calls unreadable.
		if (isFootnoteRef(el)) {
			const index = Number.parseInt(el.textContent ?? '', 10);
			if (Number.isFinite(index)) {
				out.push({ text: '', footnote: footnoteBase + index });
				return;
			}
		}

		if (tag === 'STRONG' || tag === 'B') next = { ...next, bold: true };
		else if (tag === 'EM' || tag === 'I') next = { ...next, italic: true };
		else if (tag === 'DEL' || tag === 'S') next = { ...next, strike: true };
		else if (tag === 'MARK') next = { ...next, mark: true };
		else if (tag === 'CODE') next = { ...next, code: true };
		else if (tag === 'BR') {
			out.push({ ...inherited, text: ' ' });
			return;
		} else if (tag === 'A') {
			const href = el.getAttribute('href') ?? '';
			// Only an external target survives as a link; an internal one has
			// nothing to point at once the document leaves the vault.
			if (/^https?:\/\//.test(href)) next = { ...next, href };
		}

		for (const child of Array.from(el.childNodes)) visit(child, next);
	};

	for (const child of Array.from(root.childNodes)) visit(child, {});
	return out;
}
