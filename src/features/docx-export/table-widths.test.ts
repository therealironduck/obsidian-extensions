/**
 * Checks for the width scanner, run by `bun run test`.
 *
 * A plain script rather than a test framework: the scanner is the one piece of
 * this feature that is pure and the one that review kept finding holes in, so
 * it earns executable checks — but a runner, its types and its config would be
 * a larger tooling decision than this file is worth. Add one the day a second
 * module needs covering.
 *
 * Deliberately not reachable from `main.ts`, so esbuild never bundles it.
 */

import {
	collectTableWidths,
	declarationKey,
	tableKey,
	type WidthDeclaration,
} from './table-widths';
import { TEXT_WIDTH } from './theme';

let failures = 0;

function check(name: string, actual: unknown, expected: unknown): void {
	const ok = JSON.stringify(actual) === JSON.stringify(expected);
	if (!ok) {
		failures++;
		console.error(`FAIL  ${name}`);
		console.error(`      got      ${JSON.stringify(actual)}`);
		console.error(`      expected ${JSON.stringify(expected)}`);
		return;
	}
	console.log(`PASS  ${name}`);
}

const occurrences = (declarations: WidthDeclaration[]): number[] =>
	declarations.map((declaration) => declaration.occurrence);

// --- declaration parsing ----------------------------------------------------

const zero = collectTableWidths('%% docx-widths: 5 0 35 60 %%\n| A | B | C |\n| - | - | - |');
check('a zero value rejects the whole declaration', zero.declarations.length, 0);
check('a zero value is reported', zero.warnings.length, 1);

check(
	'a negative value rejects',
	collectTableWidths('%% docx-widths: 10 -5 %%\n| A | B |\n| - | - |').declarations.length,
	0,
);
check(
	'a non-numeric value rejects',
	collectTableWidths('%% docx-widths: 10 abc %%\n| A | B |\n| - | - |').declarations.length,
	0,
);

const rounded = collectTableWidths('%% docx-widths: 25 75 %%\n| A | B |\n| - | - |');
check(
	'widths sum to exactly the text width',
	rounded.declarations[0]?.widths.reduce((a, b) => a + b, 0),
	TEXT_WIDTH,
);

// --- which table a declaration belongs to -----------------------------------

// Both GFM table forms are recognised, so a table without outer pipes cannot
// quietly consume the declaration written for the next one.
check(
	'a pipeless table does not steal the next declaration',
	collectTableWidths(
		'A | B\n-- | --\n1 | 2\n\n%% docx-widths: 30 70 %%\n| C | D |\n| - | - |',
	).declarations.map((declaration) => declaration.key),
	[tableKey(['C', 'D'])],
);

check(
	'a pipeless table can carry its own declaration',
	collectTableWidths('%% docx-widths: 30 70 %%\nA | B\n-- | --\n1 | 2').declarations.map(
		(declaration) => declaration.key,
	),
	[tableKey(['A', 'B'])],
);

check(
	'a quoted table keeps its declaration',
	collectTableWidths('> %% docx-widths: 40 60 %%\n> | Q | R |\n> | - | - |').declarations.map(
		(declaration) => declaration.key,
	),
	[tableKey(['Q', 'R'])],
);

check(
	'header markdown normalises to what the DOM renders',
	tableKey(['**Bold**', '`code`']),
	tableKey(['Bold', 'code']),
);

// --- repeated headers -------------------------------------------------------

check(
	'a declaration binds to the right one of two identical headers',
	occurrences(
		collectTableWidths(
			'A | B\n-- | --\n1 | 2\n\n%% docx-widths: 30 70 %%\nA | B\n-- | --\n3 | 4',
		).declarations,
	),
	[1],
);

// An invalid declaration on an earlier table must not drag the later, valid one
// onto it: the occurrence is counted from the table, not from the declaration.
const invalidFirst = collectTableWidths(
	'%% docx-widths: 5 0 95 %%\nA | B\n-- | --\n1 | 2\n\n%% docx-widths: 30 70 %%\nA | B\n-- | --\n3 | 4',
);
check(
	'an invalid declaration does not shift the valid one',
	occurrences(invalidFirst.declarations),
	[1],
);
check('the invalid declaration is still reported', invalidFirst.warnings.length, 1);

check(
	'a third repeat is addressable',
	occurrences(
		collectTableWidths(
			'A | B\n-- | --\n\nA | B\n-- | --\n\n%% docx-widths: 10 90 %%\nA | B\n-- | --',
		).declarations,
	),
	[2],
);

check(
	'headers ending in digits do not collide with later occurrences',
	declarationKey('a1', 1) === declarationKey('a', 11),
	false,
);

// --- footnote bodies --------------------------------------------------------

// The walk reaches footnote bodies before the content above them, so neither
// side counts tables inside one.
check(
	'a footnote table does not occupy an occurrence',
	occurrences(
		collectTableWidths(
			'%% docx-widths: 30 70 %%\nA | B\n-- | --\n1 | 2\n\n[^n]: note\n\n    A | B\n    -- | --\n    9 | 9',
		).declarations,
	),
	[0],
);

check(
	'scanning resumes after a footnote block ends',
	occurrences(
		collectTableWidths(
			'[^n]: note\n\n    X | Y\n    -- | --\n\n%% docx-widths: 40 60 %%\nA | B\n-- | --',
		).declarations,
	),
	[0],
);

// --- indented code blocks ---------------------------------------------------

// Four-space indentation at the left margin is an indented code block, so its
// table-shaped lines stay literal and never become a table in the DOM.
check(
	'an indented code block is not counted as a table',
	occurrences(
		collectTableWidths(
			'    A | B\n    -- | --\n    1 | 2\n\n%% docx-widths: 30 70 %%\nA | B\n-- | --\n3 | 4\n\nA | B\n-- | --\n5 | 6',
		).declarations,
	),
	[0],
);

// ...but the same indentation inside a list item is ordinary content, because
// indented code is four columns past the container, not past the margin.
check(
	'a table indented inside a list item still counts',
	occurrences(
		collectTableWidths('- item\n\n  %% docx-widths: 30 70 %%\n  A | B\n  -- | --\n  1 | 2')
			.declarations,
	),
	[0],
);

check(
	'a table in a four-space list item still counts',
	collectTableWidths('1.  item\n\n    %% docx-widths: 30 70 %%\n    A | B\n    -- | --')
		.declarations.length,
	1,
);

check(
	'a fenced code block is still not counted',
	collectTableWidths('```\nA | B\n-- | --\n```\n\n%% docx-widths: 30 70 %%\nA | B\n-- | --')
		.declarations[0]?.occurrence,
	0,
);

// --- the pairing the walk performs ------------------------------------------

// Mirrors `tableFrom`: count tables per header, look the declaration up by
// header plus count. Proves the two halves agree without needing a real DOM.
const paired = collectTableWidths(
	'A | B\n-- | --\n1 | 2\n\n%% docx-widths: 30 70 %%\nA | B\n-- | --\n3 | 4',
);
const lookup = new Map(
	paired.declarations.map((declaration) => [
		declarationKey(declaration.key, declaration.occurrence),
		declaration.widths,
	]),
);
const counts = new Map<string, number>();
const walked = [tableKey(['A', 'B']), tableKey(['A', 'B'])].map((key) => {
	const occurrence = counts.get(key) ?? 0;
	counts.set(key, occurrence + 1);
	return lookup.get(declarationKey(key, occurrence)) !== undefined;
});
check('the walk pairs the declaration with the second table', walked, [false, true]);

if (failures > 0) {
	console.error(`\n${String(failures)} check(s) failed`);
	process.exit(1);
}
console.log('\nall checks passed');
