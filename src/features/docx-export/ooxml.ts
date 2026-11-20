/**
 * Document model -> OOXML.
 *
 * Hand-built rather than driven by a library, because the target is a spec
 * extracted from a real document down to the twip, and every abstraction layer
 * between here and the XML is somewhere that spec can drift.
 *
 * Element order inside `pPr`, `rPr`, `tcPr` and `tblPr` is fixed by the OOXML
 * schema. Word is forgiving about it; Google Docs is not, and the failure is a
 * silent drop of the offending property rather than an error. The emitters
 * below are written in schema order for that reason.
 */

import type { Align, Block, Doc, Inline, ListItem } from './model';
import { CELL_MARGIN, COLOR, FONT, PAGE, PANEL, SIZE, SPACE, TEXT_WIDTH } from './theme';

export function esc(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/** External hyperlink targets, collected while emitting and written to rels. */
export interface RelSink {
	add(target: string): string;
	entries(): { id: string; target: string }[];
}

export function createRelSink(): RelSink {
	const entries: { id: string; target: string }[] = [];
	return {
		add(target) {
			const id = `rIdLink${String(entries.length + 1)}`;
			entries.push({ id, target });
			return id;
		},
		entries: () => entries,
	};
}

interface RunOpts {
	font?: string;
	size?: number;
	color?: string;
	bold?: boolean;
	italic?: boolean;
}

/**
 * Only genuine deltas are emitted. A run that spells out its own size and
 * colour beats the paragraph style, so emitting defaults here would silently
 * flatten every heading to body text while the style-drawn list number kept
 * the heading's own formatting — which is exactly what it did.
 */
function runProps(inline: Inline, base: RunOpts): string {
	const parts: string[] = [];

	const font = inline.code ? FONT.mono : base.font;
	if (font) parts.push(`<w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}"/>`);

	if (inline.bold ?? base.bold) parts.push('<w:b/><w:bCs/>');
	if (inline.italic ?? base.italic) parts.push('<w:i/><w:iCs/>');
	if (inline.strike) parts.push('<w:strike/>');

	// A hyperlink wins over the base colour; otherwise the caller decides, and
	// an undefined colour means "inherit from the style".
	const color = inline.href ? '1155cc' : base.color;
	if (color) parts.push(`<w:color w:val="${color}"/>`);

	const size = inline.code ? SIZE.code : base.size;
	if (size !== undefined) {
		parts.push(`<w:sz w:val="${String(size)}"/><w:szCs w:val="${String(size)}"/>`);
	}

	if (inline.mark) parts.push('<w:highlight w:val="yellow"/>');
	if (inline.href) parts.push('<w:u w:val="single"/>');
	if (inline.code) parts.push(`<w:shd w:val="clear" w:fill="${COLOR.codeFill}"/>`);

	return parts.length > 0 ? `<w:rPr>${parts.join('')}</w:rPr>` : '';
}

function runs(inlines: Inline[], base: RunOpts, rels: RelSink): string {
	return inlines
		.map((inline) => {
			if (inline.footnote !== undefined) {
				return (
					'<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/><w:vertAlign w:val="superscript"/></w:rPr>' +
					`<w:footnoteReference w:id="${String(inline.footnote)}"/></w:r>`
				);
			}
			const run = `<w:r>${runProps(inline, base)}<w:t xml:space="preserve">${esc(inline.text)}</w:t></w:r>`;
			if (!inline.href) return run;
			const id = rels.add(inline.href);
			return `<w:hyperlink r:id="${id}">${run}</w:hyperlink>`;
		})
		.join('');
}

/** Intrinsic pixel size, read from the file header rather than guessed. */
export function imageSize(data: Uint8Array): { width: number; height: number } | null {
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

	// PNG: IHDR always sits at a fixed offset right after the 8-byte signature.
	if (data[0] === 0x89 && data[1] === 0x50) {
		return { width: view.getUint32(16), height: view.getUint32(20) };
	}

	// JPEG: walk the marker chain to the start-of-frame, which carries the size.
	if (data[0] === 0xff && data[1] === 0xd8) {
		let at = 2;
		while (at + 9 < data.length) {
			if (data[at] !== 0xff) {
				at++;
				continue;
			}
			const marker = data[at + 1] ?? 0;
			// SOF0-SOF15, excluding the non-frame markers in that range.
			if (
				marker >= 0xc0 &&
				marker <= 0xcf &&
				marker !== 0xc4 &&
				marker !== 0xc8 &&
				marker !== 0xcc
			) {
				return { width: view.getUint16(at + 7), height: view.getUint16(at + 5) };
			}
			at += 2 + view.getUint16(at + 2);
		}
	}
	return null;
}

/** Image parts, collected while emitting so the zip knows what to carry. */
export interface MediaSink {
	add(data: Uint8Array, extension: string): string;
	entries(): { id: string; name: string; data: Uint8Array }[];
}

export function createMediaSink(): MediaSink {
	const entries: { id: string; name: string; data: Uint8Array }[] = [];
	return {
		add(data, extension) {
			const index = entries.length + 1;
			const id = `rIdImage${String(index)}`;
			entries.push({ id, name: `image${String(index)}.${extension}`, data });
			return id;
		},
		entries: () => entries,
	};
}

const EMU_PER_TWIP = 635;

function emitImage(block: Extract<Block, { type: 'image' }>, ctx: Context): string {
	const id = ctx.media.add(block.data, block.extension);
	const size = imageSize(block.data) ?? { width: 600, height: 400 };

	// Obsidian's `|400` hint is in pixels at 96 dpi; absent that, the image
	// runs at its intrinsic size but never wider than the text column.
	const requested = block.hint ?? size.width;
	const widthTwips = Math.min(Math.round(requested * 15), TEXT_WIDTH);
	const cx = widthTwips * EMU_PER_TWIP;
	const cy = Math.round(cx * (size.height / size.width));
	const index = ctx.media.entries().length;

	return (
		'<w:p><w:pPr><w:spacing w:before="60" w:after="180" w:lineRule="auto"/></w:pPr>' +
		'<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
		`<wp:extent cx="${String(cx)}" cy="${String(cy)}"/>` +
		`<wp:docPr id="${String(index)}" name="${esc(block.alt || `Image ${String(index)}`)}"/>` +
		'<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
		'<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
		'<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
		`<pic:nvPicPr><pic:cNvPr id="${String(index)}" name="${esc(block.alt || 'Image')}"/><pic:cNvPicPr/></pic:nvPicPr>` +
		`<pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
		`<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${String(cx)}" cy="${String(cy)}"/></a:xfrm>` +
		'<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
		'</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>'
	);
}

interface ParaOpts {
	style?: string;
	spacing?: { before?: number; after?: number };
	indent?: { left?: number; hanging?: number };
	align?: Align;
	numId?: number;
	level?: number;
	shd?: string;
	keepNext?: boolean;
	bottomBorder?: string;
}

function paraProps(opts: ParaOpts): string {
	const parts: string[] = [];
	if (opts.style) parts.push(`<w:pStyle w:val="${opts.style}"/>`);
	if (opts.keepNext) parts.push('<w:keepNext/>');
	if (opts.numId !== undefined) {
		parts.push(
			`<w:numPr><w:ilvl w:val="${String(opts.level ?? 0)}"/><w:numId w:val="${String(opts.numId)}"/></w:numPr>`,
		);
	}
	if (opts.bottomBorder) {
		parts.push(
			`<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="${opts.bottomBorder}"/></w:pBdr>`,
		);
	}
	if (opts.shd) parts.push(`<w:shd w:val="clear" w:fill="${opts.shd}"/>`);
	if (opts.spacing) {
		const before = opts.spacing.before ?? 0;
		const after = opts.spacing.after ?? 0;
		parts.push(
			`<w:spacing w:before="${String(before)}" w:after="${String(after)}" w:lineRule="auto"/>`,
		);
	}
	if (opts.indent) {
		const left = opts.indent.left ?? 0;
		const hanging = opts.indent.hanging ?? 0;
		parts.push(`<w:ind w:left="${String(left)}" w:hanging="${String(hanging)}"/>`);
	}
	if (opts.align && opts.align !== 'left') parts.push(`<w:jc w:val="${opts.align}"/>`);
	return parts.length > 0 ? `<w:pPr>${parts.join('')}</w:pPr>` : '';
}

function para(inlines: Inline[], base: RunOpts, opts: ParaOpts, rels: RelSink): string {
	return `<w:p>${paraProps(opts)}${runs(inlines, base, rels)}</w:p>`;
}

/**
 * Column widths for a markdown table, which carries none.
 *
 * Raw content-length proportions are unusable: a table with a "#" column and a
 * prose column gives the prose column ~83% and leaves the index a sliver. A
 * square root damps that to roughly what a human picks by hand — measured
 * against the reference document, where the hand-tuned split was 5/37/57 and
 * this produces 5/29/66.
 */
export function computeWidths(
	header: Inline[][],
	rows: Inline[][][],
	total = TEXT_WIDTH,
): number[] {
	const flat = (cell: Inline[]): number => cell.reduce((sum, run) => sum + run.text.length, 0);

	const weights = header.map((head, column) => {
		const lengths = rows.map((row) => flat(row[column] ?? [])).sort((a, b) => a - b);
		// 75th percentile rather than the max, so one outlier cell cannot
		// dictate the whole column.
		const p75 = lengths.length > 0 ? (lengths[Math.floor(lengths.length * 0.75)] ?? 0) : 0;
		return Math.sqrt(Math.max(flat(head), p75, 1));
	});

	const sum = weights.reduce((a, b) => a + b, 0);
	const minimum = 500;
	const raw = weights.map((weight) => Math.max(minimum, Math.round((weight / sum) * total)));

	// Clamping can push the total over the text width; give the excess back to
	// the widest column so the row still sums exactly.
	const overflow = raw.reduce((a, b) => a + b, 0) - total;
	if (overflow !== 0) {
		const widest = raw.indexOf(Math.max(...raw));
		raw[widest] = (raw[widest] ?? 0) - overflow;
	}
	return raw;
}

function cell(
	content: string,
	width: number,
	opts: { fill?: string; borders?: boolean; leftAccent?: string } = {},
): string {
	const parts = [`<w:tcW w:w="${String(width)}" w:type="dxa"/>`];

	if (opts.leftAccent) {
		parts.push(
			'<w:tcBorders>' +
				`<w:top w:val="single" w:sz="4" w:color="${COLOR.tableBorder}"/>` +
				`<w:left w:val="single" w:sz="24" w:color="${opts.leftAccent}"/>` +
				`<w:bottom w:val="single" w:sz="4" w:color="${COLOR.tableBorder}"/>` +
				`<w:right w:val="single" w:sz="4" w:color="${COLOR.tableBorder}"/>` +
				'</w:tcBorders>',
		);
	} else if (opts.borders !== false) {
		const edge = `w:val="single" w:sz="4" w:color="${COLOR.tableBorder}"`;
		parts.push(
			`<w:tcBorders><w:top ${edge}/><w:left ${edge}/><w:bottom ${edge}/><w:right ${edge}/></w:tcBorders>`,
		);
	}

	if (opts.fill) parts.push(`<w:shd w:val="clear" w:fill="${opts.fill}"/>`);
	parts.push(
		`<w:tcMar><w:top w:w="${String(CELL_MARGIN.v)}" w:type="dxa"/>` +
			`<w:left w:w="${String(CELL_MARGIN.h)}" w:type="dxa"/>` +
			`<w:bottom w:w="${String(CELL_MARGIN.v)}" w:type="dxa"/>` +
			`<w:right w:w="${String(CELL_MARGIN.h)}" w:type="dxa"/></w:tcMar>`,
	);

	return `<w:tc><w:tcPr>${parts.join('')}</w:tcPr>${content}</w:tc>`;
}

function tableShell(widths: number[], rows: string): string {
	const edge = `w:val="single" w:sz="4" w:color="${COLOR.tableBorder}"`;
	return (
		'<w:tbl><w:tblPr>' +
		`<w:tblW w:w="${String(widths.reduce((a, b) => a + b, 0))}" w:type="dxa"/>` +
		'<w:jc w:val="left"/>' +
		`<w:tblBorders><w:top ${edge}/><w:left ${edge}/><w:bottom ${edge}/>` +
		`<w:right ${edge}/><w:insideH ${edge}/><w:insideV ${edge}/></w:tblBorders>` +
		'<w:tblLayout w:type="fixed"/>' +
		'<w:tblLook w:val="0000"/>' +
		'</w:tblPr><w:tblGrid>' +
		widths.map((w) => `<w:gridCol w:w="${String(w)}"/>`).join('') +
		'</w:tblGrid>' +
		rows +
		'</w:tbl>'
	);
}

/** State that has to thread through block emission: list numbering instances. */
interface Context {
	rels: RelSink;
	media: MediaSink;
	/** Ordered lists each get their own numId so every list restarts at 1. */
	orderedIds: number[];
	nextNumId: number;
}

function emitTable(block: Extract<Block, { type: 'table' }>, ctx: Context): string {
	const widths = block.widths ?? computeWidths(block.header, block.rows);

	const headRow =
		'<w:tr><w:trPr><w:tblHeader/></w:trPr>' +
		block.header
			.map((content, column) =>
				cell(
					para(
						content,
						{
							size: SIZE.table,
							color: COLOR.tableHeadText,
							bold: true,
						},
						{ align: block.align[column], spacing: { after: 0 } },
						ctx.rels,
					),
					widths[column] ?? 0,
					{ fill: COLOR.tableHeadFill },
				),
			)
			.join('') +
		'</w:tr>';

	const bodyRows = block.rows
		.map(
			(row) =>
				'<w:tr><w:trPr><w:cantSplit/></w:trPr>' +
				widths
					.map((width, column) =>
						cell(
							para(
								row[column] ?? [],
								{ size: SIZE.table },
								{ align: block.align[column], spacing: { after: 0 } },
								ctx.rels,
							),
							width,
						),
					)
					.join('') +
				'</w:tr>',
		)
		.join('');

	// A table must not be the last thing in the body, and two adjacent tables
	// merge into one unless something separates them.
	return tableShell(widths, headRow + bodyRows) + spacer();
}

function spacer(): string {
	return `<w:p><w:pPr><w:spacing w:before="0" w:after="${String(SPACE.paraAfter)}" w:lineRule="auto"/><w:rPr><w:sz w:val="4"/></w:rPr></w:pPr></w:p>`;
}

function emitList(block: Extract<Block, { type: 'list' }>, ctx: Context): string {
	const numId = block.ordered ? allocateOrdered(ctx) : 2;

	return block.items
		.map((item: ListItem) => {
			const after = item.level > 0 ? SPACE.listNestedAfter : SPACE.listAfter;

			// A task renders its own box rather than taking a bullet, so the
			// line reads "to tick" instead of "bulleted, and also a box".
			if (item.task) {
				const glyph: Inline = { text: item.task === 'done' ? '☒  ' : '☐  ' };
				return para(
					[glyph, ...item.inlines],
					{},
					{
						spacing: { after },
						indent: {
							left: SPACE.indent * (item.level + 1),
							hanging: SPACE.indent,
						},
					},
					ctx.rels,
				);
			}

			return para(
				item.inlines,
				{},
				{ spacing: { after }, numId, level: Math.min(item.level, 2) },
				ctx.rels,
			);
		})
		.join('');
}

function allocateOrdered(ctx: Context): number {
	const id = ctx.nextNumId++;
	ctx.orderedIds.push(id);
	return id;
}

function emitPanel(block: Extract<Block, { type: 'panel' }>, ctx: Context): string {
	const palette = PANEL[block.variant] ?? PANEL[''];
	const accent = palette?.accent ?? 'bfbfbf';
	const fill = palette?.fill ?? 'f7f7f7';

	const title =
		block.title.length > 0
			? para(
					[{ text: block.title, bold: true }],
					{ color: accent },
					{ spacing: { after: 60 }, keepNext: true },
					ctx.rels,
				)
			: '';

	const body = block.blocks.map((inner) => emitBlock(inner, ctx)).join('');
	// Every table cell must end in a paragraph; a panel ending with a table or
	// a list that emitted nothing would otherwise produce invalid XML.
	const content = title + body || '<w:p/>';

	return (
		tableShell(
			[TEXT_WIDTH],
			`<w:tr><w:trPr><w:cantSplit/></w:trPr>${cell(content, TEXT_WIDTH, { fill, leftAccent: accent })}</w:tr>`,
		) + spacer()
	);
}

function emitBlock(block: Block, ctx: Context): string {
	switch (block.type) {
		case 'heading': {
			const styles = ['Heading1', 'Heading2', 'Heading3', 'Heading4'];
			return para(
				block.inlines,
				{},
				{ style: styles[block.level - 1] ?? 'Heading4' },
				ctx.rels,
			);
		}

		case 'para':
			return para(block.inlines, {}, { spacing: { after: SPACE.paraAfter } }, ctx.rels);

		case 'list':
			return emitList(block, ctx) + spacer();

		case 'table':
			return emitTable(block, ctx);

		case 'panel':
			return emitPanel(block, ctx);

		case 'image':
			return emitImage(block, ctx);

		case 'quote':
			// Indent and colour rather than a left border: Google Docs drops
			// per-paragraph borders on import, which would leave a grey blob.
			return block.blocks
				.map((inner) =>
					inner.type === 'para'
						? para(
								inner.inlines,
								{ italic: true, color: COLOR.quote },
								{
									spacing: { after: SPACE.paraAfter },
									indent: { left: SPACE.indent },
								},
								ctx.rels,
							)
						: emitBlock(inner, ctx),
				)
				.join('');

		case 'code':
			// One shaded paragraph per line with no spacing between them reads
			// as a single continuous block.
			return (
				block.text
					.split('\n')
					.map((line) =>
						para(
							[{ text: line || ' ', code: true }],
							{},
							{ shd: COLOR.codeFill, spacing: { after: 0 }, indent: { left: 113 } },
							ctx.rels,
						),
					)
					.join('') + spacer()
			);

		case 'hr':
			return `<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="${COLOR.rule}"/></w:pBdr><w:spacing w:before="120" w:after="240" w:lineRule="auto"/></w:pPr></w:p>`;
	}
}

export interface BuiltDocument {
	document: string;
	numbering: string;
	footnotes: string;
	rels: RelSink;
	media: MediaSink;
}

export function buildDocument(doc: Doc): BuiltDocument {
	const rels = createRelSink();
	const media = createMediaSink();
	const ctx: Context = { rels, media, orderedIds: [], nextNumId: 10 };

	const title = para([{ text: doc.title }], {}, { style: 'Title' }, rels);

	const subtitle = doc.subtitle
		.map((line, index) =>
			para(
				[{ text: line }],
				{ color: COLOR.subtitle },
				{
					spacing: {
						after:
							index === doc.subtitle.length - 1
								? SPACE.h1Before
								: SPACE.subtitleAfter,
					},
				},
				rels,
			),
		)
		.join('');

	const body = doc.blocks.map((block) => emitBlock(block, ctx)).join('');

	const sectPr =
		'<w:sectPr>' +
		'<w:footerReference w:type="default" r:id="rIdFooter"/>' +
		`<w:pgSz w:w="${String(PAGE.width)}" w:h="${String(PAGE.height)}" w:orient="portrait"/>` +
		`<w:pgMar w:top="${String(PAGE.margin)}" w:right="${String(PAGE.margin)}" ` +
		`w:bottom="${String(PAGE.margin)}" w:left="${String(PAGE.margin)}" ` +
		`w:header="${String(PAGE.footer)}" w:footer="${String(PAGE.footer)}" w:gutter="0"/>` +
		'<w:pgNumType w:start="1"/>' +
		'</w:sectPr>';

	const document =
		'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
		`<w:document ${WORD_NAMESPACES}>` +
		`<w:body>${title}${subtitle}${body}${sectPr}</w:body></w:document>`;

	return {
		document,
		numbering: buildNumbering(ctx.orderedIds),
		footnotes: buildFootnotes(doc, ctx),
		rels,
		media,
	};
}

const WORD_NAMESPACES =
	'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
	'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
	'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
	'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
	'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';

/**
 * Real Word footnotes rather than an "endnotes" section at the bottom of the
 * body: Google Docs imports these as its own footnotes, so they stay anchored
 * to the page and renumber when a colleague edits the document.
 */
function buildFootnotes(doc: Doc, ctx: Context): string {
	const fixed =
		'<w:footnote w:type="separator" w:id="-1"><w:p><w:pPr><w:spacing w:after="0"/></w:pPr><w:r><w:separator/></w:r></w:p></w:footnote>' +
		'<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:pPr><w:spacing w:after="0"/></w:pPr><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>';

	const notes = doc.footnotes
		.map((note, index) => {
			const inner = note.blocks
				.map((block) =>
					block.type === 'para'
						? para(
								block.inlines,
								{ size: SIZE.code },
								{ spacing: { after: 0 } },
								ctx.rels,
							)
						: emitBlock(block, ctx),
				)
				.join('');

			// The marker run has to be the first thing in the footnote body,
			// or Word renders the note without its number.
			const marker =
				'<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteRef/></w:r>';
			const withMarker = inner.replace(
				/^<w:p>(<w:pPr>.*?<\/w:pPr>)?/,
				(match) => match + marker + '<w:r><w:t xml:space="preserve"> </w:t></w:r>',
			);

			return `<w:footnote w:id="${String(index + 1)}">${withMarker || `<w:p>${marker}</w:p>`}</w:footnote>`;
		})
		.join('');

	return (
		'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
		`<w:footnotes ${WORD_NAMESPACES}>${fixed}${notes}</w:footnotes>`
	);
}

function headingLevels(): string {
	return [0, 1, 2, 3]
		.map((level) => {
			const stem = Array.from({ length: level + 1 }, (_, i) => `%${String(i + 1)}`).join('.');
			// "1." at the top level, but "1.1" rather than "1.1." below it —
			// the trailing dot only reads as punctuation on a single number.
			const text = level === 0 ? `${stem}.` : stem;
			return (
				`<w:lvl w:ilvl="${String(level)}">` +
				'<w:start w:val="1"/><w:numFmt w:val="decimal"/>' +
				// A space rather than the default tab, so "1." sits directly
				// against the heading text instead of jumping to a tab stop.
				'<w:suff w:val="space"/>' +
				`<w:lvlText w:val="${text}"/>` +
				'<w:lvlJc w:val="left"/>' +
				'<w:pPr><w:ind w:left="0" w:firstLine="0"/></w:pPr>' +
				'</w:lvl>'
			);
		})
		.join('');
}

function bulletLevels(): string {
	const glyphs = ['•', '◦', '▪'];
	return glyphs
		.map(
			(glyph, level) =>
				`<w:lvl w:ilvl="${String(level)}">` +
				'<w:start w:val="1"/><w:numFmt w:val="bullet"/>' +
				`<w:lvlText w:val="${glyph}"/><w:lvlJc w:val="left"/>` +
				`<w:pPr><w:ind w:left="${String(SPACE.indent * (level + 1))}" w:hanging="${String(SPACE.indent)}"/></w:pPr>` +
				`<w:rPr><w:rFonts w:ascii="${FONT.body}" w:hAnsi="${FONT.body}" w:cs="${FONT.body}"/></w:rPr>` +
				'</w:lvl>',
		)
		.join('');
}

function orderedLevels(): string {
	const formats = ['decimal', 'lowerLetter', 'lowerRoman'];
	return formats
		.map(
			(format, level) =>
				`<w:lvl w:ilvl="${String(level)}">` +
				`<w:start w:val="1"/><w:numFmt w:val="${format}"/>` +
				`<w:lvlText w:val="%${String(level + 1)}."/><w:lvlJc w:val="left"/>` +
				`<w:pPr><w:ind w:left="${String(SPACE.indent * (level + 1))}" w:hanging="${String(SPACE.indent)}"/></w:pPr>` +
				'</w:lvl>',
		)
		.join('');
}

function buildNumbering(orderedIds: number[]): string {
	// Each ordered list gets its own num pointing at the shared abstract
	// definition, with every level overridden back to 1 so lists restart.
	const overrides = [0, 1, 2]
		.map(
			(level) =>
				`<w:lvlOverride w:ilvl="${String(level)}"><w:startOverride w:val="1"/></w:lvlOverride>`,
		)
		.join('');

	return (
		'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
		'<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
		`<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="multilevel"/>${headingLevels()}</w:abstractNum>` +
		`<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${bulletLevels()}</w:abstractNum>` +
		`<w:abstractNum w:abstractNumId="2"><w:multiLevelType w:val="hybridMultilevel"/>${orderedLevels()}</w:abstractNum>` +
		'<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' +
		'<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>' +
		orderedIds
			.map(
				(id) =>
					`<w:num w:numId="${String(id)}"><w:abstractNumId w:val="2"/>${overrides}</w:num>`,
			)
			.join('') +
		'</w:numbering>'
	);
}

function style(
	id: string,
	name: string,
	pPr: string,
	rPr: string,
	opts: { next?: string } = {},
): string {
	return (
		`<w:style w:type="paragraph" w:styleId="${id}">` +
		`<w:name w:val="${name}"/><w:basedOn w:val="Normal"/>` +
		`<w:next w:val="${opts.next ?? 'Normal'}"/><w:qFormat/>` +
		`<w:pPr>${pPr}</w:pPr><w:rPr>${rPr}</w:rPr></w:style>`
	);
}

function headingRun(size: number, color: string, bold: boolean, italic = false): string {
	return (
		`<w:rFonts w:ascii="${FONT.body}" w:hAnsi="${FONT.body}" w:cs="${FONT.body}"/>` +
		(bold ? '<w:b/><w:bCs/>' : '') +
		(italic ? '<w:i/><w:iCs/>' : '') +
		`<w:color w:val="${color}"/>` +
		`<w:sz w:val="${String(size)}"/><w:szCs w:val="${String(size)}"/>`
	);
}

export function buildStyles(numbered: boolean): string {
	const numPr = (level: number): string =>
		numbered ? `<w:numPr><w:ilvl w:val="${String(level)}"/><w:numId w:val="1"/></w:numPr>` : '';

	const spacing = (before: number, after: number): string =>
		`<w:spacing w:before="${String(before)}" w:after="${String(after)}" w:lineRule="auto"/>`;

	return (
		'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
		'<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
		'<w:docDefaults><w:rPrDefault><w:rPr>' +
		`<w:rFonts w:ascii="${FONT.body}" w:hAnsi="${FONT.body}" w:cs="${FONT.body}" w:eastAsia="${FONT.body}"/>` +
		`<w:sz w:val="${String(SIZE.body)}"/><w:szCs w:val="${String(SIZE.body)}"/>` +
		'</w:rPr></w:rPrDefault>' +
		'<w:pPrDefault><w:pPr><w:spacing w:after="0" w:lineRule="auto"/></w:pPr></w:pPrDefault>' +
		'</w:docDefaults>' +
		'<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
		style(
			'Title',
			'Title',
			'<w:keepNext/>' + spacing(0, SPACE.titleAfter),
			headingRun(SIZE.title, COLOR.title, true),
		) +
		style(
			'Heading1',
			'heading 1',
			'<w:keepNext/>' + numPr(0) + spacing(SPACE.h1Before, SPACE.h1After),
			headingRun(SIZE.h1, COLOR.h1, true),
		) +
		style(
			'Heading2',
			'heading 2',
			'<w:keepNext/>' + numPr(1) + spacing(SPACE.h2Before, SPACE.h2After),
			headingRun(SIZE.h2, COLOR.h2, true),
		) +
		style(
			'Heading3',
			'heading 3',
			'<w:keepNext/>' + numPr(2) + spacing(SPACE.h3Before, SPACE.h3After),
			headingRun(SIZE.h3, COLOR.h3, false),
		) +
		style(
			'Heading4',
			'heading 4',
			'<w:keepNext/>' + numPr(3) + spacing(SPACE.h3Before, SPACE.h3After),
			headingRun(SIZE.h4, COLOR.h4, false, true),
		) +
		'<w:style w:type="character" w:styleId="FootnoteReference">' +
		'<w:name w:val="footnote reference"/>' +
		'<w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>' +
		'</w:styles>'
	);
}

export function buildFooter(text: string): string {
	const rPr =
		`<w:rPr><w:rFonts w:ascii="${FONT.body}" w:hAnsi="${FONT.body}" w:cs="${FONT.body}"/>` +
		`<w:color w:val="${COLOR.footer}"/><w:sz w:val="${String(SIZE.footer)}"/>` +
		`<w:szCs w:val="${String(SIZE.footer)}"/></w:rPr>`;

	return (
		'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
		'<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
		'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
		'<w:p><w:pPr><w:jc w:val="center"/></w:pPr>' +
		`<w:r>${rPr}<w:t xml:space="preserve">${esc(text)} – Page </w:t></w:r>` +
		`<w:r>${rPr}<w:fldChar w:fldCharType="begin"/></w:r>` +
		`<w:r>${rPr}<w:instrText xml:space="preserve">PAGE</w:instrText></w:r>` +
		`<w:r>${rPr}<w:fldChar w:fldCharType="separate"/></w:r>` +
		`<w:r>${rPr}<w:t>1</w:t></w:r>` +
		`<w:r>${rPr}<w:fldChar w:fldCharType="end"/></w:r>` +
		'</w:p></w:ftr>'
	);
}

export function buildContentTypes(): string {
	return (
		'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
		'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
		'<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
		'<Default Extension="xml" ContentType="application/xml"/>' +
		'<Default Extension="png" ContentType="image/png"/>' +
		'<Default Extension="jpeg" ContentType="image/jpeg"/>' +
		'<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
		'<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
		'<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
		'<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' +
		'<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' +
		'</Types>'
	);
}

export function buildRootRels(): string {
	return (
		'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
		'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
		'<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
		'</Relationships>'
	);
}

export function buildDocumentRels(rels: RelSink, media: MediaSink): string {
	const base = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
	return (
		'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
		'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
		`<Relationship Id="rIdStyles" Type="${base}/styles" Target="styles.xml"/>` +
		`<Relationship Id="rIdNumbering" Type="${base}/numbering" Target="numbering.xml"/>` +
		`<Relationship Id="rIdFooter" Type="${base}/footer" Target="footer1.xml"/>` +
		`<Relationship Id="rIdFootnotes" Type="${base}/footnotes" Target="footnotes.xml"/>` +
		rels
			.entries()
			.map(
				(entry) =>
					`<Relationship Id="${entry.id}" Type="${base}/hyperlink" Target="${esc(entry.target)}" TargetMode="External"/>`,
			)
			.join('') +
		media
			.entries()
			.map(
				(entry) =>
					`<Relationship Id="${entry.id}" Type="${base}/image" Target="media/${entry.name}"/>`,
			)
			.join('') +
		'</Relationships>'
	);
}
