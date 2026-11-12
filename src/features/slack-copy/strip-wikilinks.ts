import { createWikilinkPattern } from '../../utils/wikilinks';

export function stripWikilinks(text: string): string {
	return text.replace(
		createWikilinkPattern(),
		(_match, target: string, alias?: string) => alias ?? target,
	);
}
