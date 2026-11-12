/**
 * `[[target]]` and `[[target|alias]]`, with the alias captured separately.
 *
 * Handed out by a factory rather than shared as one constant: the pattern is
 * global, so a single instance would carry `lastIndex` between the callers
 * that scan with `exec` and those that rewrite with `replace`.
 */
export function createWikilinkPattern(): RegExp {
	return /\[\[([^[\]|]+)(?:\|([^[\]]+))?\]\]/g;
}
