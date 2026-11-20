import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { globalIgnores, defineConfig } from 'eslint/config';

export default defineConfig(
	globalIgnores([
		'node_modules',
		'dist',
		'esbuild.config.mjs',
		'version-bump.mjs',
		'versions.json',
		'main.js',
		'package.json',
		'package-lock.json',
		'tsconfig.json',
	]),
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: ['eslint.config.mts', 'manifest.json'],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json'],
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		// After the recommended config, so this override actually takes effect.
		files: ['src/features/keep-folders-collapsed/index.ts'],
		rules: {
			// This capture-phase click listener must bind to `document`. With
			// `activeDocument` it never fired, so no expansion was recognised as
			// user-initiated and the watched folders could not be opened at all.
			// The file explorer only ever lives in the main window's sidebar, so
			// there is no popout case to cover. Do not re-enable without
			// clicking a watched folder in a real vault afterwards.
			'obsidianmd/prefer-active-doc': 'off',
		},
	},
	{
		files: ['src/features/docx-export/export-note.ts'],
		rules: {
			// The export Notice is click-to-reveal, which needs the notice's
			// element. `messageEl` supersedes `noticeEl`, but only from 1.8.7,
			// and `minAppVersion` is 1.4.0 — so on the versions this plugin
			// claims to support, `noticeEl` is the only API that exists.
			// Raising the floor is a user-facing compatibility decision, not a
			// lint fix. Drop this override and switch to `messageEl` whenever
			// minAppVersion moves past 1.8.7.
			'@typescript-eslint/no-deprecated': 'off',
		},
	},
);
