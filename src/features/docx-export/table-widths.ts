/**
 * `%% docx-widths %%` declarations, read from the note source.
 *
 * Reading view renders `%%` comments away, so the widths cannot come from the
 * DOM and have to be scanned out of the markdown. The hard part is tying each
 * declaration to the table it was written for.
 *
 * Matching by document order was the obvious approach and it was wrong. It
 * required this scanner and the DOM walk to agree exactly on what counts as a
 * table, and they kept disagreeing — over tables inside callouts, tables
 * without outer pipes, tables indented inside a list item, tables in a footnote
 * body. Every disagreement silently shifted every later declaration onto the
 * wrong table.
 *
 * So declarations are keyed by their table's header instead, plus a count of
 * how many earlier tables shared that header. Repeated headers are not an edge
 * case — the document this theme came from has two different tables headed
 * "Topic | Rule" — so the key alone would hand the first one the second one's
 * widths.
 *
 * Counting per header rather than over all tables is what makes this hold: the
 * scanner and the walk only have to agree about tables sharing one header, not
 * about every table in the note. Where they cannot agree at all — footnote
 * bodies, which the walk visits before the content that precedes them in the
 * source — both sides ignore tables outright.
 *
 * A key that never matches falls back to the width heuristic, which is a
 * harmless outcome rather than a corrupted one.
 */

import { TEXT_WIDTH } from './theme';

export interface WidthDeclaration {
	/** Normalised header text of the table this was written for. */
	key: string;
	/** How many earlier tables shared that header, so repeats stay distinct. */
	occurrence: number;
	/** Column widths in twips, already summing to the text width. */
	widths: number[];
}

/**
 * The identity a declaration and its table are matched on. Separated by a
 * control character so a header ending in digits cannot collide with a later
 * occurrence of a shorter one.
 */
export function declarationKey(key: string, occurrence: number): string {
	return `${key}\u0001${String(occurrence)}`;
}

export interface WidthScan {
	declarations: WidthDeclaration[];
	/** Problems worth telling the user about after the export. */
	warnings: string[];
}

const WIDTHS_RE = /^%%\s*docx-widths:\s*([^%]+?)\s*%%$/;
const DELIMITER_CELL_RE = /^:?-+:?$/;

/** Strips the optional outer pipes, so both GFM table forms split alike. */
export function splitCells(line: string): string[] {
	return line
		.replace(/^\|/, '')
		.replace(/\|$/, '')
		.split('|')
		.map((cell) => cell.trim());
}

/**
 * Header text, reduced to something the source and the rendered DOM both
 * produce: the DOM has already resolved `**Bold**` to `Bold`, so the markers
 * have to go before the two can be compared.
 */
export function tableKey(cells: string[]): string {
	return cells
		.map((cell) =>
			cell
				.replace(/[*_`~=[\]]/g, '')
				.replace(/\s+/g, ' ')
				.trim()
				.toLowerCase(),
		)
		.join('\u0000');
}

/** A table's header is the line directly above its `---|---` delimiter row. */
function isDelimiterRow(line: string): boolean {
	if (!line.includes('|')) return false;
	const cells = splitCells(line);
	return cells.length > 0 && cells.every((cell) => DELIMITER_CELL_RE.test(cell));
}

/**
 * Null when any value is missing, non-numeric or not positive. Dropping the bad
 * value instead would leave a shorter list that can still match a narrower
 * table, so `5 0 35 60` would be accepted as a valid three-column declaration.
 */
function parseWidths(text: string): number[] | null {
	const values = text.trim().split(/\s+/).map(Number);
	if (values.length === 0) return null;
	if (values.some((value) => !Number.isFinite(value) || value <= 0)) return null;

	const sum = values.reduce((a, b) => a + b, 0);
	const widths = values.map((value) => Math.round((value / sum) * TEXT_WIDTH));

	// Rounding each column independently drifts by a twip or two, which would
	// make the table marginally wider than the text column it is supposed to
	// match. The drift goes back into the widest column.
	const drift = widths.reduce((a, b) => a + b, 0) - TEXT_WIDTH;
	if (drift !== 0) {
		const widest = widths.indexOf(Math.max(...widths));
		widths[widest] = (widths[widest] ?? 0) - drift;
	}
	return widths;
}

/**
 * Strips blockquote markers but keeps whatever indentation follows them, so a
 * declaration inside a callout still counts while an indented code block inside
 * one is still recognisable as code.
 */
function dequote(line: string): string {
	return line.replace(/^[ \t]*(?:>[ \t]?)+/, '');
}

function indentOf(line: string): number {
	return (/^[ \t]*/.exec(line)?.[0] ?? '').replace(/\t/g, '    ').length;
}

const LIST_MARKER_RE = /^(?:[-*+]|\d+[.)])\s+/;

const FOOTNOTE_DEF_RE = /^\[\^[^\]]+\]:/;

export function collectTableWidths(source: string): WidthScan {
	const declarations: WidthDeclaration[] = [];
	const warnings: string[] = [];
	const lines = source.split('\n');
	/** Tables seen so far per header, which is what makes a repeat addressable. */
	const seen = new Map<string, number>();

	let pending: number[] | null = null;
	let inCode = false;
	let inFootnote = false;
	/**
	 * Column at which content of the current list item begins. Indented code is
	 * four columns past the enclosing container's content, not four past the
	 * left margin, so a table indented inside a list is content while the same
	 * indentation at top level is code.
	 */
	let baseline = 0;

	for (let index = 0; index < lines.length; index++) {
		const raw = lines[index] ?? '';
		const body = dequote(raw);
		const indent = indentOf(body);
		const line = body.trim();

		if (/^(`{3,}|~{3,})/.test(line)) {
			inCode = !inCode;
			continue;
		}
		if (inCode) continue;

		// A footnote definition runs until the first line that is neither blank
		// nor indented. Everything in it is ignored, because the walk reaches
		// footnote bodies before the content above them and the two could never
		// count the same tables in the same order.
		if (FOOTNOTE_DEF_RE.test(raw)) {
			inFootnote = true;
			continue;
		}
		if (inFootnote) {
			if (line.length === 0 || /^\s/.test(raw)) continue;
			inFootnote = false;
		}

		if (line.length === 0) continue;

		// An indented code block renders as literal text, so its table-shaped
		// lines never become a table in the DOM and must not be counted here.
		if (indent >= baseline + 4) {
			pending = null;
			continue;
		}

		// A list item moves the baseline to where its content starts; returning
		// to the left margin leaves the list behind.
		const marker = LIST_MARKER_RE.exec(line);
		if (marker) baseline = indent + marker[0].length;
		else if (indent === 0) baseline = 0;

		const declared = WIDTHS_RE.exec(line);
		if (declared) {
			pending = parseWidths(declared[1] ?? '');
			if (pending === null) {
				warnings.push('A docx-widths declaration that was not all positive numbers');
			}
			continue;
		}

		// A header row, in either GFM form: `| a | b |` or a bare `a | b`.
		if (line.includes('|') && isDelimiterRow(dequote(lines[index + 1] ?? '').trim())) {
			const key = tableKey(splitCells(line));
			const occurrence = seen.get(key) ?? 0;
			seen.set(key, occurrence + 1);

			// Counted whether or not it is declared: an undeclared table still
			// occupies an occurrence, so the next one with the same header is
			// addressable.
			if (pending !== null) {
				declarations.push({ key, occurrence, widths: pending });
				pending = null;
			}
			continue;
		}

		// A blank line between a declaration and its table is fine and was
		// skipped above; reaching here means some other content intervened, so
		// the declaration was not about a table after all.
		pending = null;
	}

	return { declarations, warnings };
}
