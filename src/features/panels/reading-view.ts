/**
 * Reading view rendering.
 *
 * Obsidian hands a markdown post processor one top-level block ("section") at
 * a time, so a panel's opening fence, its body, and its closing fence usually
 * arrive in separate calls and cannot be wrapped in a single element. Rather
 * than fight that, this renderer tags every section of a panel with role
 * classes and lets CSS fake one continuous box out of the stack of sections —
 * exactly the same trick, and the same CSS, as live preview.
 *
 * Only the sections that actually contain a `:::` fence line are re-rendered
 * from source, which is what removes the fence text without any DOM surgery.
 * Interior sections are left completely untouched, so embeds, Dataview, math
 * and code blocks inside a panel keep rendering natively.
 */

import {
	MarkdownRenderChild,
	MarkdownRenderer,
	setIcon,
	type App,
	type MarkdownPostProcessorContext,
} from 'obsidian';
import { linesFromString, overlaps, parsePanels, type PanelBlock } from './parse';
import { CLS, depthClass, resolveVariant, variantClasses, variantIcon } from './variants';

/**
 * Collapsed state is kept in memory rather than written back to the note: this
 * vault auto-commits, so folding a panel must not dirty the file. Keying it by
 * path and opening line means the state survives Obsidian unloading and
 * re-rendering off-screen sections as the user scrolls.
 */
export class CollapseState {
	private readonly collapsed = new Map<string, boolean>();

	key(sourcePath: string, block: PanelBlock): string {
		return `${sourcePath}:${String(block.openLine)}`;
	}

	isCollapsed(key: string, fallback: boolean): boolean {
		return this.collapsed.get(key) ?? fallback;
	}

	set(key: string, value: boolean): void {
		this.collapsed.set(key, value);
	}
}

interface RenderPlan {
	block: PanelBlock;
	containsOpen: boolean;
	containsClose: boolean;
}

export function createPanelPostProcessor(app: App, state: CollapseState) {
	return (
		el: HTMLElement,
		ctx: MarkdownPostProcessorContext,
	): Promise<void> | void => {
		// `MarkdownRenderer.render` re-runs every post processor on its output,
		// so without this guard a panel would recurse into itself.
		if (el.closest(`.${CLS.content}`) !== null) return;
		if (el.dataset.panelProcessed === 'true') return;

		const info = ctx.getSectionInfo(el);
		// Null in PDF export and plugin-driven renders; nothing safe to do.
		if (!info) return;

		// `info.text` is documented as the section's text but is in fact the
		// whole note, with absolute line numbers. Bail if that ever changes
		// rather than slicing the wrong range.
		const source = info.text;
		if (source.split('\n').length <= info.lineEnd) return;

		const blocks = parsePanels(linesFromString(source)).filter(
			(block) => block.closeLine !== null,
		);
		const plan = planFor(blocks, info.lineStart, info.lineEnd);
		if (!plan) return;

		el.dataset.panelProcessed = 'true';

		if (plan.containsOpen || plan.containsClose) {
			// Returned so Obsidian awaits it rather than showing a
			// half-rendered section.
			return renderFenceSection(app, state, el, ctx, info, plan, source);
		}

		decorateInteriorSection(state, el, ctx, plan.block);
	};
}

/**
 * Picks the innermost closed panel this section belongs to. Unclosed panels
 * were filtered out already: claiming one would hide the rest of the note.
 */
function planFor(
	blocks: PanelBlock[],
	lineStart: number,
	lineEnd: number,
): RenderPlan | null {
	let best: PanelBlock | null = null;
	for (const block of blocks) {
		if (!overlaps(block, lineStart, lineEnd)) continue;
		if (best === null || block.depth > best.depth) best = block;
	}
	if (best === null) return null;

	return {
		block: best,
		containsOpen: best.openLine >= lineStart && best.openLine <= lineEnd,
		containsClose:
			best.closeLine !== null &&
			best.closeLine >= lineStart &&
			best.closeLine <= lineEnd,
	};
}

/** An interior section keeps its native rendering and only gains classes. */
function decorateInteriorSection(
	state: CollapseState,
	el: HTMLElement,
	ctx: MarkdownPostProcessorContext,
	block: PanelBlock,
): void {
	const key = state.key(ctx.sourcePath, block);
	el.addClass(CLS.section);
	applyBoxClasses(el, block, { head: false, foot: false });
	el.dataset.panelKey = key;
	el.dataset.panelRole = 'body';
	if (state.isCollapsed(key, block.startCollapsed)) el.addClass(CLS.hidden);
}

async function renderFenceSection(
	app: App,
	state: CollapseState,
	el: HTMLElement,
	ctx: MarkdownPostProcessorContext,
	info: { lineStart: number; lineEnd: number },
	plan: RenderPlan,
	source: string,
): Promise<void> {
	const { block, containsOpen, containsClose } = plan;
	const lines = source.split('\n');
	const slice = (from: number, to: number): string =>
		from > to ? '' : lines.slice(from, to + 1).join('\n');

	// A fence can be glued to the paragraph before or after it by CommonMark,
	// in which case part of this section lies outside the panel.
	const before = containsOpen ? slice(info.lineStart, block.openLine - 1) : '';
	const contentFrom = containsOpen ? block.openLine + 1 : info.lineStart;
	const contentTo =
		containsClose && block.closeLine !== null ? block.closeLine - 1 : info.lineEnd;
	const content = slice(contentFrom, contentTo);
	const after =
		containsClose && block.closeLine !== null
			? slice(block.closeLine + 1, info.lineEnd)
			: '';

	el.empty();
	el.addClass(CLS.section);

	if (before) await renderInto(app, ctx, el.createDiv(), before);

	const box = el.createDiv();
	applyBoxClasses(box, block, { head: containsOpen, foot: containsClose });

	const key = state.key(ctx.sourcePath, block);
	box.dataset.panelKey = key;
	box.dataset.panelRole = containsOpen ? 'head' : 'body';

	if (containsOpen) await renderHeader(app, state, box, ctx, block, key);

	const contentEl = box.createDiv({ cls: CLS.content });
	if (content) await renderInto(app, ctx, contentEl, content);

	if (state.isCollapsed(key, block.startCollapsed)) {
		box.addClass(containsOpen ? CLS.collapsed : CLS.hidden);
	}

	if (after) await renderInto(app, ctx, el.createDiv(), after);
}

async function renderHeader(
	app: App,
	state: CollapseState,
	box: HTMLElement,
	ctx: MarkdownPostProcessorContext,
	block: PanelBlock,
	key: string,
): Promise<void> {
	const variant = resolveVariant(block.variant);
	const header = box.createDiv({ cls: CLS.header });

	const icon = variantIcon(variant);
	if (icon) setIcon(header.createSpan({ cls: CLS.headerIcon }), icon);

	const titleEl = header.createSpan({ cls: CLS.headerTitle });
	if (block.title) {
		await renderInto(app, ctx, titleEl, block.title);
		// Unwrap the paragraph the renderer wraps a single line in, so the
		// title sits inline next to its icon.
		const first = titleEl.firstElementChild;
		if (first instanceof HTMLParagraphElement) {
			titleEl.setChildrenInPlace(Array.from(first.childNodes));
		}
	} else {
		titleEl.setText(variant || 'Panel');
	}

	if (!block.collapsible) return;

	const fold = header.createSpan({ cls: CLS.fold });
	setIcon(fold, 'chevron-down');
	header.addClass('is-collapsible');
	header.addEventListener('click', (event) => {
		event.preventDefault();
		const collapsed = !state.isCollapsed(key, block.startCollapsed);
		state.set(key, collapsed);
		applyCollapse(box, key, collapsed);
	});
}

/**
 * Collapsing has to reach every rendered section of the block, not just the
 * one that was clicked, because the body lives in sibling sections.
 */
function applyCollapse(origin: HTMLElement, key: string, collapsed: boolean): void {
	const root =
		origin.closest('.markdown-preview-sizer') ??
		origin.closest('.markdown-preview-view') ??
		origin.ownerDocument.body;

	const boxes = root.querySelectorAll<HTMLElement>(
		`[data-panel-key="${CSS.escape(key)}"]`,
	);
	for (const box of Array.from(boxes)) {
		if (box.dataset.panelRole === 'head') box.toggleClass(CLS.collapsed, collapsed);
		else box.toggleClass(CLS.hidden, collapsed);
	}
}

function applyBoxClasses(
	el: HTMLElement,
	block: PanelBlock,
	role: { head: boolean; foot: boolean },
): void {
	const variant = resolveVariant(block.variant);
	el.addClasses([CLS.box, depthClass(block.depth), ...variantClasses(variant)]);
	if (role.head) el.addClass(CLS.head);
	if (role.foot) el.addClass(CLS.foot);
	if (!role.head && !role.foot) el.addClass(CLS.body);
}

async function renderInto(
	app: App,
	ctx: MarkdownPostProcessorContext,
	container: HTMLElement,
	markdown: string,
): Promise<void> {
	// The render child ties embeds, Dataview and the like to the note's
	// lifecycle, so they unload when the note closes.
	const child = new MarkdownRenderChild(container);
	ctx.addChild(child);
	await MarkdownRenderer.render(app, markdown, container, ctx.sourcePath, child);
}
