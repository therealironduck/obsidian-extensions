/**
 * Orchestration: a note in, a DOCX on disk out.
 *
 * The file is written outside the vault on purpose. This vault auto-commits,
 * so an export landing inside it would put a binary in a commit every time a
 * typo is fixed and re-exported.
 */

import { Notice, type App, type TFile } from 'obsidian';
import { zipSync } from 'fflate';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { buildBlocks } from './from-dom';
import {
	buildContentTypes,
	buildDocument,
	buildDocumentRels,
	buildFooter,
	buildFootnoteRels,
	buildRootRels,
	buildStyles,
} from './ooxml';
import { TEXT_WIDTH } from './theme';
import type { DocxExportSettings } from './settings';

export async function exportNote(
	app: App,
	file: TFile,
	settings: DocxExportSettings,
): Promise<void> {
	const notice = new Notice(`Exporting ${file.basename}…`, 0);

	try {
		const source = await app.vault.read(file);
		const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter ?? {};

		const title = readString(frontmatter['docx-title']) ?? file.basename;
		const variables = { title, file: file.basename };

		const body = stripFrontmatter(source);
		const { blocks, footnotes, skipped } = await buildBlocks(
			app,
			file,
			body,
			collectTableWidths(body),
		);

		const doc = {
			title,
			subtitle: readList(frontmatter['docx-subtitle']).map((line) =>
				applyVariables(line, variables),
			),
			footer: applyVariables(readString(frontmatter['docx-footer']) ?? title, variables),
			numbering: readBoolean(frontmatter['docx-numbering']) ?? settings.numberHeadings,
			blocks,
			footnotes,
		};

		const built = buildDocument(doc);
		const encode = (value: string): Uint8Array => new TextEncoder().encode(value);

		const media = [...built.media.entries(), ...built.footnoteMedia.entries()];

		const archive = zipSync(
			{
				'[Content_Types].xml': encode(buildContentTypes()),
				'_rels/.rels': encode(buildRootRels()),
				'word/document.xml': encode(built.document),
				'word/styles.xml': encode(buildStyles(doc.numbering)),
				'word/numbering.xml': encode(built.numbering),
				'word/footnotes.xml': encode(built.footnotes),
				'word/footer1.xml': encode(buildFooter(doc.footer)),
				'word/_rels/document.xml.rels': encode(buildDocumentRels(built.rels, built.media)),
				// Relationship ids resolve against the part that uses them, so
				// links and images inside a footnote need this part to exist.
				'word/_rels/footnotes.xml.rels': encode(
					buildFootnoteRels(built.footnoteRels, built.footnoteMedia),
				),
				...Object.fromEntries(
					media.map((entry) => [`word/media/${entry.name}`, entry.data]),
				),
			},
			{ level: 6 },
		);

		const target = await writeUnique(resolveFolder(settings), sanitize(title), archive);

		notice.hide();
		report(target, skipped);
	} catch (error) {
		notice.hide();
		console.error('DOCX export failed', error);
		new Notice(`Could not export ${file.basename}: ${describe(error)}`, 10000);
	}
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * The export is only honest if it says what it left behind, because the one
 * thing the author cannot notice is content that is missing from a document
 * they can still see in full inside Obsidian.
 */
function report(target: string, skipped: string[]): void {
	const name = target.split('/').pop() ?? target;
	const notice = new Notice(
		skipped.length > 0
			? `Exported ${name}\nSkipped: ${skipped.join(', ')}\nClick to reveal`
			: `Exported ${name}\nClick to reveal`,
		10000,
	);
	// `noticeEl` rather than `messageEl`: see the override for this file in
	// eslint.config.mts.
	notice.noticeEl.addEventListener('click', () => {
		reveal(target);
	});
}

interface ElectronShell {
	showItemInFolder(path: string): void;
}

function reveal(target: string): void {
	try {
		const required = (window as unknown as { require?: (id: string) => unknown }).require;
		const electron = required?.('electron') as { shell?: ElectronShell } | undefined;
		electron?.shell?.showItemInFolder(target);
	} catch {
		// Revealing is a convenience; the Notice already names the file.
	}
}

function resolveFolder(settings: DocxExportSettings): string {
	const configured = settings.outputFolder.trim();
	if (configured.length === 0) return join(homedir(), 'Downloads');
	return configured.startsWith('~') ? join(homedir(), configured.slice(1)) : configured;
}

/** Forbidden on at least one of the platforms Obsidian runs on. */
function sanitize(name: string): string {
	return (
		name
			.replace(/[\\/:*?"<>|]/g, '-')
			.replace(/\s+/g, ' ')
			.trim()
			.slice(0, 120) || 'Export'
	);
}

/**
 * Counts up rather than overwriting, so re-exporting while iterating never
 * destroys a file that was already handed to someone.
 *
 * The candidate is claimed by the write itself, with `wx`, rather than being
 * checked first and written later. Testing and then writing leaves a gap in
 * which a second export picks the same name and the later write silently
 * replaces the earlier file — which is exactly what this function promises not
 * to do.
 */
async function writeUnique(folder: string, name: string, data: Uint8Array): Promise<string> {
	for (let index = 0; index < 1000; index++) {
		const candidate = join(
			folder,
			index === 0 ? `${name}.docx` : `${name} (${String(index)}).docx`,
		);
		try {
			await writeFile(candidate, data, { flag: 'wx' });
			return candidate;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
		}
	}

	// A thousand collisions means something is very wrong, but a timestamp
	// alone still collides within the same millisecond, so add entropy.
	const suffix = `${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`;
	const fallback = join(folder, `${name} ${suffix}.docx`);
	await writeFile(fallback, data, { flag: 'wx' });
	return fallback;
}

function stripFrontmatter(source: string): string {
	if (!source.startsWith('---')) return source;
	const end = source.indexOf('\n---', 3);
	if (end === -1) return source;
	return source.slice(source.indexOf('\n', end + 1) + 1);
}

function readString(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
	return typeof value === 'boolean' ? value : undefined;
}

function readList(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value.filter((entry): entry is string => typeof entry === 'string');
	}
	const single = readString(value);
	return single === undefined ? [] : [single];
}

function applyVariables(text: string, context: { title: string; file: string }): string {
	const now = new Date();
	const date = [
		String(now.getDate()).padStart(2, '0'),
		String(now.getMonth() + 1).padStart(2, '0'),
		String(now.getFullYear()),
	].join('.');

	return text
		.replace(/\{\{date\}\}/g, date)
		.replace(/\{\{title\}\}/g, context.title)
		.replace(/\{\{file\}\}/g, context.file);
}

const WIDTHS_RE = /^%%\s*docx-widths:\s*([\d\s.]+?)\s*%%$/;

/**
 * Reading view renders `%%` comments away, so the widths cannot be recovered
 * from the DOM. They are read from the source instead and matched to tables by
 * document order, which the renderer preserves.
 *
 * Blockquote markers are stripped before matching, because a table inside a
 * callout reaches the DOM as a `<table>` like any other. Counting only
 * unquoted tables here would leave this list one entry short and hand every
 * later table the declaration meant for its predecessor.
 */
export function collectTableWidths(source: string): (number[] | null)[] {
	const out: (number[] | null)[] = [];
	let pending: number[] | null = null;
	let inCode = false;
	let inTable = false;

	for (const line of source.split('\n')) {
		const trimmed = line.trim().replace(/^(?:>\s*)+/, '');

		if (/^(`{3,}|~{3,})/.test(trimmed)) {
			inCode = !inCode;
			continue;
		}
		if (inCode) continue;

		const declared = WIDTHS_RE.exec(trimmed);
		if (declared) {
			const percents = (declared[1] ?? '')
				.split(/\s+/)
				.map(Number)
				.filter((n) => n > 0);
			const sum = percents.reduce((a, b) => a + b, 0);
			pending =
				sum > 0
					? percents.map((percent) => Math.round((percent / sum) * TEXT_WIDTH))
					: null;
			continue;
		}

		if (trimmed.startsWith('|')) {
			if (!inTable) {
				out.push(pending);
				pending = null;
				inTable = true;
			}
			continue;
		}

		inTable = false;
		// A blank line between the comment and its table is fine; anything else
		// means the comment was not about a table after all.
		if (trimmed.length > 0) pending = null;
	}

	return out;
}
