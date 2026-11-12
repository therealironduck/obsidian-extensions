import { type App, type View } from 'obsidian';

/**
 * The file explorer's internals are not part of the public API, so they are
 * described here rather than cast to `any` at each use. If a future Obsidian
 * release renames any of this, the feature degrades to doing nothing (every
 * access is guarded) instead of throwing.
 */
export interface FileExplorerItem {
	collapsed: boolean;
	setCollapsed(collapsed: boolean, ...rest: unknown[]): unknown;
}

interface FileExplorerView extends View {
	fileItems?: Record<string, FileExplorerItem | undefined>;
}

export type SetCollapsed = FileExplorerItem['setCollapsed'];

export function getExplorerItems(app: App): Record<string, FileExplorerItem | undefined> | null {
	const leaf = app.workspace.getLeavesOfType('file-explorer')[0];
	if (!leaf) return null;

	const view = leaf.view as FileExplorerView;
	return view.fileItems ?? null;
}
