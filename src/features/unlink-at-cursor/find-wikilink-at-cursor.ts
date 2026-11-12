import { createWikilinkPattern } from '../../utils/wikilinks';

export interface WikilinkMatch {
	from: number;
	to: number;
	replacement: string;
}

export function findWikilinkAtCursor(line: string, cursorCh: number): WikilinkMatch | null {
	const pattern = createWikilinkPattern();
	let match: RegExpExecArray | null;

	while ((match = pattern.exec(line)) !== null) {
		const from = match.index;
		const to = from + match[0].length;

		if (cursorCh >= from && cursorCh <= to) {
			const [, target, alias] = match;
			return { from, to, replacement: alias ?? target ?? '' };
		}
	}

	return null;
}
