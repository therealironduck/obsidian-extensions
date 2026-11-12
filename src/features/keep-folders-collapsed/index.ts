import { Setting } from 'obsidian';
import { type SettingsOwner } from '../../settings';
import { KeepFoldersCollapsed } from './controller';

const EXPLORER_SELECTOR = '.workspace-leaf-content[data-type="file-explorer"]';

/**
 * The settings tab needs the same controller instance the register call
 * created. Keeping it in a registry here, rather than returning it and storing
 * it on the plugin, is what lets every feature keep an identical public
 * surface: `registerX(plugin)` plus `renderXSettings(containerEl, plugin)`.
 */
const controllers = new WeakMap<SettingsOwner, KeepFoldersCollapsed>();

export function registerKeepFoldersCollapsed(plugin: SettingsOwner): void {
	const controller = new KeepFoldersCollapsed(plugin.app, plugin.settings.keepFoldersCollapsed);
	controllers.set(plugin, controller);

	// Obsidian has no register helper for timeouts, so they are tracked and
	// cleared here; otherwise a pending sync could fire after unload.
	const timeouts = new Set<number>();
	const later = (fn: () => void, delay: number): void => {
		const id = window.setTimeout(() => {
			timeouts.delete(id);
			fn();
		}, delay);
		timeouts.add(id);
	};

	plugin.register(() => {
		for (const id of timeouts) window.clearTimeout(id);
		timeouts.clear();
		controller.unpatchAll();
	});

	// Capture phase, so this runs before the explorer's own click handler and a
	// setCollapsed() caused by the click is still seen as user-initiated.
	//
	// Bound to `document`, not `activeDocument`: see the rule override for this
	// file in eslint.config.mts. The explorer only lives in the main window's
	// sidebar, and binding elsewhere stopped this listener from firing at all.
	//
	// The target is narrowed by feature-detecting `closest` rather than by any
	// kind of instanceof. That avoids class identity altogether, so it cannot
	// break across windows the way `instanceof Element` does, and it degrades
	// safely when the target is a text node or the document itself.
	plugin.registerDomEvent(
		document,
		'click',
		(event) => {
			const target = event.target as Element | null;
			if (target?.closest?.(EXPLORER_SELECTOR)) {
				controller.beginUserAction();
				later(() => controller.endUserAction(), 0);
			}
		},
		true,
	);

	// The explorer reveals the active file asynchronously and rebuilds its tree,
	// which drops the patch, so re-check a few times rather than once.
	const scheduleSync = (): void => {
		later(() => controller.sync(), 0);
		later(() => controller.sync(), 100);
		later(() => controller.sync(), 400);
	};

	plugin.app.workspace.onLayoutReady(() => controller.sync());
	plugin.registerEvent(plugin.app.workspace.on('file-open', scheduleSync));
	plugin.registerEvent(plugin.app.workspace.on('active-leaf-change', scheduleSync));
	plugin.registerEvent(plugin.app.workspace.on('layout-change', scheduleSync));

	plugin.addCommand({
		id: 'collapse-watched-folders',
		name: 'Collapse watched folders now',
		callback: () => {
			controller.resetDesired();
			controller.sync();
		},
	});
}

export function renderKeepFoldersCollapsedSettings(
	containerEl: HTMLElement,
	plugin: SettingsOwner,
): void {
	new Setting(containerEl)
		.setName('Folders to keep collapsed')
		.setDesc(
			'One vault-relative folder path per line. These folders will not auto-expand when a note inside them is opened. Expanding them by clicking still works until you collapse them again.',
		)
		.addTextArea((text) => {
			text.inputEl.rows = 6;
			// A class rather than an inline style, per the styling convention.
			text.inputEl.addClass('jx-settings-textarea');
			text.setPlaceholder('00 Dailies')
				.setValue(plugin.settings.keepFoldersCollapsed.folders.join('\n'))
				.onChange(async (value) => {
					plugin.settings.keepFoldersCollapsed.folders = value
						.split('\n')
						.map((line) => line.trim())
						.filter((line) => line.length > 0);
					await plugin.saveSettings();
					controllers.get(plugin)?.applySettings(plugin.settings.keepFoldersCollapsed);
				});
		});
}
