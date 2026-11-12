import { type App } from 'obsidian';
import { getExplorerItems, type FileExplorerItem, type SetCollapsed } from './explorer';
import { normalizeFolders, type KeepFoldersCollapsedSettings } from './settings';

/**
 * Keeps configured folders collapsed in the file explorer.
 *
 * Obsidian reveals the active file by expanding its ancestors, and there is no
 * setting or event to opt out of that. So each watched folder's `setCollapsed`
 * is wrapped: an expansion the user did not ask for becomes a no-op, while a
 * click-initiated one passes through and is remembered.
 */
export class KeepFoldersCollapsed {
	/** Folder path -> should stay collapsed. False once the user expands it by hand. */
	private readonly desired = new Map<string, boolean>();

	/** Original `setCollapsed` per patched item, so unload can restore them. */
	private readonly originals = new WeakMap<FileExplorerItem, SetCollapsed>();

	/** Patched items are also tracked strongly, because a WeakMap is not iterable. */
	private readonly patched = new Set<FileExplorerItem>();

	/** True only for the moment around a click inside the explorer. */
	private userAction = false;

	constructor(
		private readonly app: App,
		private settings: KeepFoldersCollapsedSettings,
	) {
		this.resetDesired();
	}

	/** Call when the folder list changes: re-patch from a clean slate. */
	applySettings(settings: KeepFoldersCollapsedSettings): void {
		this.settings = settings;
		this.unpatchAll();
		this.resetDesired();
		this.sync();
	}

	/** Treat the next tick's collapse changes as user-initiated. */
	beginUserAction(): void {
		this.userAction = true;
	}

	endUserAction(): void {
		this.userAction = false;
	}

	resetDesired(): void {
		this.desired.clear();
		for (const path of normalizeFolders(this.settings.folders)) this.desired.set(path, true);
	}

	/**
	 * Patch the watched items, then collapse anything that expanded before the
	 * patch was in place. Safe to call repeatedly: the explorer rebuilds its
	 * tree and drops the patch, so this is how it gets reapplied.
	 */
	sync(): void {
		const items = getExplorerItems(this.app);
		if (!items) return;

		for (const [path, collapsed] of this.desired) {
			const item = items[path];
			if (!item || typeof item.setCollapsed !== 'function') continue;

			this.patch(item, path);
			if (collapsed && item.collapsed === false) {
				try {
					item.setCollapsed(true);
				} catch (error) {
					console.error('[keep-folders-collapsed] collapse failed', path, error);
				}
			}
		}
	}

	private patch(item: FileExplorerItem, path: string): void {
		if (this.originals.has(item)) return;

		const original = item.setCollapsed.bind(item);
		this.originals.set(item, original);
		this.patched.add(item);

		item.setCollapsed = (collapsed: boolean, ...rest: unknown[]): unknown => {
			if (!collapsed && this.desired.get(path) === true && !this.userAction) {
				return Promise.resolve();
			}
			if (this.userAction) this.desired.set(path, collapsed);
			return original(collapsed, ...rest);
		};
	}

	unpatchAll(): void {
		for (const item of this.patched) {
			const original = this.originals.get(item);
			if (original) {
				item.setCollapsed = original;
				this.originals.delete(item);
			}
		}
		this.patched.clear();
	}
}
