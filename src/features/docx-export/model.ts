/**
 * The document model the theme engine renders.
 *
 * Deliberately small and renderer-agnostic: `from-dom.ts` fills it by walking
 * what Obsidian's own renderer produced, and `ooxml.ts` turns it into a DOCX.
 * Nothing in here knows about markdown or about OOXML, which is what keeps the
 * theme renderable without an Obsidian instance.
 */

export interface Inline {
	text: string;
	bold?: boolean;
	italic?: boolean;
	code?: boolean;
	strike?: boolean;
	mark?: boolean;
	/** External URL only; internal links arrive here as plain text. */
	href?: string;
	/** 1-based index into `Doc.footnotes`; the run's own text is ignored. */
	footnote?: number;
}

export type Align = 'left' | 'center' | 'right';

export interface ListItem {
	inlines: Inline[];
	/** 0-based nesting depth. */
	level: number;
	task?: 'todo' | 'done';
}

export type Block =
	| { type: 'heading'; level: 1 | 2 | 3 | 4; inlines: Inline[] }
	| { type: 'para'; inlines: Inline[] }
	| { type: 'list'; ordered: boolean; items: ListItem[] }
	| { type: 'table'; header: Inline[][]; rows: Inline[][][]; align: Align[]; widths?: number[] }
	| { type: 'code'; text: string }
	| { type: 'quote'; blocks: Block[] }
	| { type: 'panel'; variant: string; title: string; blocks: Block[] }
	| { type: 'image'; data: Uint8Array; extension: 'png' | 'jpeg'; alt: string; hint?: number }
	| { type: 'hr' };

/** A footnote's body, referenced from the text by its 1-based index. */
export interface Footnote {
	blocks: Block[];
}

export interface Doc {
	title: string;
	subtitle: string[];
	footer: string;
	numbering: boolean;
	blocks: Block[];
	footnotes: Footnote[];
}
