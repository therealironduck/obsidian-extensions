import { Setting, TFile } from 'obsidian';
import { type SettingsOwner } from '../../settings';
import { exportNote } from './export-note';

export function registerDocxExport(plugin: SettingsOwner): void {
	const run = (file: TFile): void => {
		void exportNote(plugin.app, file, plugin.settings.docxExport);
	};

	const exportable = (file: TFile | null): file is TFile =>
		file !== null && file.extension === 'md';

	plugin.addCommand({
		id: 'export-note-to-docx',
		name: 'Export note to DOCX',
		checkCallback: (checking) => {
			const file = plugin.app.workspace.getActiveFile();
			if (!exportable(file)) return false;
			if (!checking) run(file);
			return true;
		},
	});

	// Right-clicking a note in the file explorer, which is how an export of
	// something other than the open note happens.
	plugin.registerEvent(
		plugin.app.workspace.on('file-menu', (menu, file) => {
			if (!(file instanceof TFile) || !exportable(file)) return;
			menu.addItem((item) => {
				item.setTitle('Export to DOCX')
					.setIcon('file-text')
					.onClick(() => {
						run(file);
					});
			});
		}),
	);

	plugin.registerEvent(
		plugin.app.workspace.on('editor-menu', (menu, _editor, view) => {
			const file = view.file;
			if (!exportable(file)) return;
			menu.addItem((item) => {
				item.setTitle('Export to DOCX')
					.setIcon('file-text')
					.onClick(() => {
						run(file);
					});
			});
		}),
	);
}

export function renderDocxExportSettings(containerEl: HTMLElement, plugin: SettingsOwner): void {
	new Setting(containerEl)
		.setName('Output folder')
		.setDesc(
			'Absolute path the DOCX is written to. Leave empty for your Downloads folder. Exports are written outside the vault on purpose, so they are never committed with your notes.',
		)
		.addText((text) => {
			text.setPlaceholder('~/Downloads')
				.setValue(plugin.settings.docxExport.outputFolder)
				.onChange(async (value) => {
					plugin.settings.docxExport.outputFolder = value;
					await plugin.saveSettings();
				});
		});

	new Setting(containerEl)
		.setName('Number headings')
		.setDesc(
			'Numbers headings as 1, 1.1, 1.1.1. Override for a single note with the docx-numbering property.',
		)
		.addToggle((toggle) => {
			toggle.setValue(plugin.settings.docxExport.numberHeadings).onChange(async (value) => {
				plugin.settings.docxExport.numberHeadings = value;
				await plugin.saveSettings();
			});
		});
}
