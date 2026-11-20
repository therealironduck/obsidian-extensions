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
 * So declarations are keyed by their table's header instead. A key that never
 * matches simply falls back to the width heuristic, which is a harmless
 * outcome rather than a corrupted one, and no future table syntax can shift a
 * declaration onto its neighbour.
 */

import { TEXT_WIDTH } from './theme';

export interface WidthDeclaration {
	/** Normalised header text of the table this was written for. */
	key: string;
	/** Column widths in twips, already summing to the text width. */
	widths: number[];
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

/** Blockquote markers are stripped so a declaration inside a callout still counts. */
function clean(line: string): string {
	return line.trim().replace(/^(?:>\s*)+/, '');
}

export function collectTableWidths(source: string): WidthScan {
	const declarations: WidthDeclaration[] = [];
	const warnings: string[] = [];
	const lines = source.split('\n');

	let pending: number[] | null = null;
	let inCode = false;

	for (let index = 0; index < lines.length; index++) {
		const line = clean(lines[index] ?? '');

		if (/^(`{3,}|~{3,})/.test(line)) {
			inCode = !inCode;
			continue;
		}
		if (inCode) continue;

		const declared = WIDTHS_RE.exec(line);
		if (declared) {
			pending = parseWidths(declared[1] ?? '');
			if (pending === null) {
				warnings.push('A docx-widths declaration that was not all positive numbers');
			}
			continue;
		}

		// A header row, in either GFM form: `| a | b |` or a bare `a | b`.
		if (line.includes('|') && isDelimiterRow(clean(lines[index + 1] ?? ''))) {
			if (pending !== null) {
				declarations.push({ key: tableKey(splitCells(line)), widths: pending });
				pending = null;
			}
			continue;
		}

		// A blank line between a declaration and its table is fine; any other
		// content means the declaration was not about a table after all.
		if (line.length > 0) pending = null;
	}

	return { declarations, warnings };
}
