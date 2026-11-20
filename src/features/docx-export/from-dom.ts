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
	/** Explicit `%% docx-widths %%` values, consumed in table order. */
	widths: (number[] | null)[];
	tableIndex: number;
}

export async function buildBlocks(
	app: App,
	file: TFile,
	body: string,
	widths: (number[] | null)[],
): Promise<WalkResult> {
	const component = new Component();
	component.load();

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
		tableIndex: 0,
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
		const close = (panel.closeLine ?? padded.length - 1) - 1;

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

	// Mermaid has no clean path into OOXML without rasterising an SVG, so it is
	// dropped loudly rather than rendered as its own source text.
	if (el.hasClass('mermaid') || el.querySelector('.mermaid')) {
		ctx.skipped.add('Mermaid diagrams');
		return [];
	}

	// A note transclusion is dropped per the export's rules; an image embed is
	// not, so they are told apart before either is skipped.
	const embed = el.hasClass('internal-embed') ? el : el.querySelector('.internal-embed');
	if (embed && !embed.hasClass('image-embed') && embed.querySelector('.markdown-embed')) {
		ctx.skipped.add('Embedded notes');
		return [];
	}

	const image = await imageFromNode(el, ctx);
	if (image) return [image];

	const heading = HEADINGS[tag];
	if (heading !== undefined) {
		return [{ type: 'heading', level: heading, inlines: inlinesFrom(el, {}, footnoteBase) }];
	}

	if (tag === 'P') {
		const inlines = inlinesFrom(el, {}, footnoteBase);
		return hasText(inlines) ? [{ type: 'para', inlines }] : [];
	}

	if (tag === 'UL' || tag === 'OL') {
		return [{ type: 'list', ordered: tag === 'OL', items: listItems(el, 0, footnoteBase) }];
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

	const inlines = inlinesFrom(el, {}, footnoteBase);
	return hasText(inlines) ? [{ type: 'para', inlines }] : [];
}

function hasText(inlines: Inline[]): boolean {
	return inlines.some((run) => run.text.trim().length > 0 || run.footnote !== undefined);
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

function listItems(list: HTMLElement, level: number, footnoteBase: number): ListItem[] {
	const items: ListItem[] = [];

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
			{},
			footnoteBase,
			(node) => node.tagName === 'UL' || node.tagName === 'OL' || node.tagName === 'INPUT',
		);

		if (hasText(inlines) || task) items.push({ inlines, level, task });

		for (const child of nested) {
			items.push(...listItems(child as HTMLElement, level + 1, footnoteBase));
		}
	}

	return items;
}

function tableFrom(table: HTMLElement, ctx: Context, footnoteBase: number): Block {
	const rows = Array.from(table.querySelectorAll('tr'));
	const headRow = rows[0];
	const header = headRow
		? Array.from(headRow.children).map((cell) =>
				inlinesFrom(cell as HTMLElement, {}, footnoteBase),
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
				inlinesFrom(cell as HTMLElement, {}, footnoteBase),
			),
		);

	// Widths come from the source comment, which reading view renders away, so
	// they are matched to tables by document order rather than read from here.
	const declared = ctx.widths[ctx.tableIndex++] ?? undefined;

	return { type: 'table', header, rows: body, align, widths: declared ?? undefined };
}

function inlinesFrom(
	root: HTMLElement,
	style: Partial<Inline>,
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

		const tag = el.tagName;
		let next = inherited;

		// A footnote reference is a marker, not text: the number Obsidian has
		// already rendered is the index into the collected bodies.
		if (el.hasClass('footnote-ref') || tag === 'SUP') {
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

	for (const child of Array.from(root.childNodes)) visit(child, style);
	return out;
}
