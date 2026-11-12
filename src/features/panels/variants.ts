/**
 * The built-in panel variants and the CSS class vocabulary shared by both
 * renderers. Keeping the class names in one place is what allows live preview
 * and reading view to be styled by a single block of CSS in `styles.css`.
 */

const ALIASES: Record<string, string> = {
	warn: 'warning',
	caution: 'warning',
	error: 'danger',
	done: 'success',
	check: 'success',
	hint: 'tip',
	idea: 'tip',
};

/** Canonical variant name -> Lucide icon id. */
const ICONS: Record<string, string> = {
	info: 'info',
	tip: 'lightbulb',
	success: 'circle-check',
	warning: 'triangle-alert',
	danger: 'zap',
	note: 'pencil',
	quote: 'quote',
};

export function resolveVariant(raw: string): string {
	if (!raw) return '';
	return ALIASES[raw] ?? raw;
}

/**
 * Unknown variants keep their name as a CSS class but get no icon, so a custom
 * variant can be styled from a vault CSS snippet without touching the plugin.
 */
export function variantIcon(variant: string): string | null {
	return ICONS[variant] ?? null;
}

export const CLS = {
	/** On the wrapper that owns the box styling. */
	box: 'panel-line',
	head: 'panel-head',
	body: 'panel-body',
	foot: 'panel-foot',
	/** On a reading-view section wrapper, to collapse the gaps between sections. */
	section: 'panel-section',
	content: 'panel-content',
	header: 'panel-header',
	headerIcon: 'panel-header-icon',
	headerTitle: 'panel-header-title',
	fold: 'panel-fold',
	collapsed: 'is-collapsed',
	hidden: 'panel-hidden',
	editing: 'panel-editing',
	unclosed: 'panel-unclosed',
} as const;

export function variantClasses(variant: string): string[] {
	return variant ? [`panel-v-${variant}`] : [];
}

export function depthClass(depth: number): string {
	return `panel-depth-${String(Math.min(depth, 3))}`;
}
