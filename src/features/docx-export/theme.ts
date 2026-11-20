/**
 * The house style, extracted from "Bug-Bounty Program Schedule.docx".
 *
 * Every measurement is in twips (1/20 pt) and every font size in half-points,
 * because that is what OOXML wants and converting at the point of use is how
 * rounding errors creep in. This file is the single place a design change
 * happens; nothing downstream hard-codes a colour or a size.
 */

export const PAGE = {
	width: 11906, // A4 portrait
	height: 16838,
	margin: 1134, // 2 cm on all four sides
	footer: 708,
} as const;

/** Usable width between the margins; every full-width table matches this. */
export const TEXT_WIDTH = PAGE.width - PAGE.margin * 2; // 9638

export const FONT = {
	body: 'Arial',
	mono: 'Courier New',
} as const;

export const SIZE = {
	title: 44, // 22 pt
	h1: 30, // 15 pt
	h2: 24, // 12 pt
	h3: 24, // 12 pt
	h4: 21, // 10.5 pt
	body: 21, // 10.5 pt
	table: 19, // 9.5 pt
	code: 18, // 9 pt
	footer: 16, // 8 pt
} as const;

export const COLOR = {
	title: '1f3a5f',
	h1: '1f3a5f',
	h2: '2e5a8a',
	h3: '1f4d78',
	h4: '2e74b5',
	body: '000000',
	subtitle: '666666',
	footer: '808080',
	tableHeadFill: '1f3a5f',
	tableHeadText: 'ffffff',
	tableBorder: 'bfbfbf',
	codeFill: 'f4f4f4',
	rule: 'bfbfbf',
	quote: '555555',
	markFill: 'fff3a3',
} as const;

/**
 * Muted, print-tuned panel colours. Deliberately not Obsidian's screen palette:
 * next to the navy on white paper, `--color-red` (#e93147) reads as a warning
 * sticker rather than as part of the document.
 */
export const PANEL: Record<string, { accent: string; fill: string }> = {
	info: { accent: '2e5a8a', fill: 'eef3f8' },
	tip: { accent: '1a6e7a', fill: 'ecf5f6' },
	success: { accent: '1a7a5e', fill: 'edf6f2' },
	warning: { accent: 'b06a00', fill: 'fdf4e7' },
	danger: { accent: 'a32638', fill: 'fbeef0' },
	note: { accent: '5b4a9e', fill: 'f2f0f9' },
	quote: { accent: '888888', fill: 'f5f5f5' },
	'': { accent: 'bfbfbf', fill: 'f7f7f7' },
};

export const SPACE = {
	titleAfter: 120,
	subtitleAfter: 60,
	h1Before: 360,
	h1After: 140,
	h2Before: 240,
	h2After: 100,
	h3Before: 200,
	h3After: 80,
	paraAfter: 120,
	listAfter: 60,
	listNestedAfter: 40,
	/** One nesting step for lists, ~0.63 cm. */
	indent: 360,
} as const;

/** Cell padding inside table cells, carried over from the reference. */
export const CELL_MARGIN = { v: 70, h: 100 } as const;
