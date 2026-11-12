# Obsidian community plugin

## Project overview

- Target: Obsidian Community Plugin (TypeScript → bundled JavaScript).
- Entry point: `src/main.ts` compiled to `main.js` and loaded by Obsidian.
- Required release artifacts: `main.js`, `manifest.json`, and optional `styles.css`.
- **This is a deliberately combined plugin.** It bundles every extension Jordan wrote for his own vault — currently `panels`, `slack-copy` and `unlink-at-cursor` — under one plugin id, one manifest and one bundle. These were once three separate plugins; do not split them back out. See `README.md` for the rationale.
- Not published to the community catalog. Distributed via BRAT from GitHub releases, or installed manually.

## Environment & tooling

- **Package manager: bun.** Use `bun install`, `bun run <script>`, `bun pm version`. Do **not** use npm here — `package-lock.json` is gone and `bun.lock` is the committed lockfile. CI runs `bun install --frozen-lockfile`.
- The bun version is pinned once in `package.json`'s `packageManager` field; both workflows read it via setup-bun's `bun-version-file`. Bump it there, not in the workflows.
- **Bundler: esbuild**, driven by `esbuild.config.mjs`. Everything must be bundled into `main.js` with no unbundled runtime deps. Note esbuild's platform binary arrives as an optional dependency under bun, so no postinstall trust is needed.
- Scripts still run under Node (`tsc`, `node esbuild.config.mjs`); bun is the package manager and task runner, not the runtime for the build.
- Types: `obsidian` type definitions.

### Install

```bash
bun install
```

### Dev (watch)

```bash
bun run dev
```

### Production build

```bash
bun run build
```

## Linting

- ESLint is preconfigured with `eslint-plugin-obsidianmd` for Obsidian-specific rules.
- Run `bun run lint` to lint the project.
- `obsidianmd/ui/sentence-case` currently reports two warnings on the "Remove link at cursor" / "No link at cursor" strings, wanting `Cursor` capitalised. That is the rule being wrong about sentence case — leave the strings alone.
- Those warnings do not fail CI (ESLint exits 0 on warnings). **Do not add `--max-warnings 0`** without first disabling that rule for those two lines, or the pipeline goes permanently red.
- oxlint is deliberately _not_ used: it cannot load `eslint-plugin-obsidianmd`, which is the whole reason ESLint is here.

## Formatting

- **oxfmt** is the formatter: `bun run format` to write, `bun run format:check` to verify (CI runs the latter).
- It formats TypeScript, JSON, Markdown **and YAML**. Lockfiles (`bun.lock`) are excluded by its own ignore rules.
- **`.editorconfig` is the real config.** oxfmt reads it and maps `indent_style`→`useTabs`, `indent_size`→`tabWidth`, `end_of_line`→`endOfLine`, `insert_final_newline`→`insertFinalNewline`. Only what EditorConfig cannot express lives in `.oxfmtrc.json` (`singleQuote`, `printWidth`). Do not duplicate indentation settings across the two files.
- Source is tab-indented at width 4; `*.yml`/`*.yaml` get a 2-space override, because YAML forbids tab indentation and 2 spaces is the convention for workflow files.
- `version-bump.mjs` appends a trailing newline when writing `manifest.json` and `versions.json`. That is load-bearing: without it every release would leave `main` failing `format:check`, because `insert_final_newline` is enforced.

## Contributing workflow

- `main` is protected by a repository ruleset: pull request required, the `ci` status check required, no force pushes, no deletion.
- **Conventional Commits are enforced on the PR title**, not on individual commits, because merges are squash-merges and the repo is configured with `squash_merge_commit_title=PR_TITLE`. The PR title therefore becomes the commit subject on `main`, which is what the release workflow parses to derive the next version.
- Breaking changes go in the PR title as `type!:` or in the PR body as a `BREAKING CHANGE:` footer.
- Commit types `chore`, `docs`, `ci`, `refactor`, `style`, `test` and `build` are _hidden_: they are valid, but they do not trigger a version bump. A release containing only those will refuse to run.
- The release workflow pushes a version-bump commit to the protected branch. It cannot do that with `GITHUB_TOKEN`: the built-in GitHub Actions app is first-party and cannot be installed as an org integration, so it is **not** an eligible ruleset bypass actor (the API rejects it with "Actor GitHub Actions integration must be part of the ruleset source or owner organization"). Instead a dedicated org-owned GitHub App holds the bypass, and the workflow mints a token for it via `actions/create-github-app-token`.
- That App needs `contents: write` on this repo, and the repo needs two secrets: `RELEASE_APP_CLIENT_ID` and `RELEASE_APP_PRIVATE_KEY`. Remove the App from the ruleset bypass list, or let the private key expire, and releases fail at the push step.

## File & folder conventions

- **Organize code into multiple files**: Split functionality across separate modules rather than putting everything in `main.ts`.
- Source lives in `src/`. Keep `main.ts` small and focused on plugin lifecycle (loading, unloading, registering commands).
- **One folder per feature under `src/features/`.** Each feature's `index.ts` exports a single `register<Feature>(plugin: Plugin)` that wires the feature up via `plugin.register*` / `plugin.addCommand`. Adding a feature is one import plus one call in `main.ts` and nothing else.
- Feature-specific code stays inside its feature folder. Only genuinely shared helpers move to `src/utils/` — `src/utils/wikilinks.ts` exists because two features needed the same wikilink pattern.
- **Actual file structure**:
    ```
    src/
      main.ts                      # lifecycle only: calls each feature's register()
      features/
        panels/
          index.ts                 # registerPanels()
          parse.ts                 # shared ::: scanner for both renderers
          live-preview.ts          # CodeMirror state fields + header widget
          reading-view.ts          # markdown post processor + collapse state
          variants.ts              # variant names, icons, CSS class vocabulary
        slack-copy/
          index.ts                 # registerSlackCopy()
          copy-selection.ts
          strip-wikilinks.ts
        unlink-at-cursor/
          index.ts                 # registerUnlinkAtCursor()
          remove-link-at-cursor.ts
          find-wikilink-at-cursor.ts
      utils/
        wikilinks.ts               # shared across features
    styles.css                     # all feature styles, currently panels only
    ```
- **Do not commit build artifacts**: Never commit `node_modules/`, `main.js`, or other generated files to version control.
- Keep the plugin small. Avoid large dependencies. Prefer browser-compatible packages.
- Generated output should be placed at the plugin root or `dist/` depending on your build setup. Release artifacts must end up at the top level of the plugin folder in the vault (`main.js`, `manifest.json`, `styles.css`).

## Manifest rules (`manifest.json`)

- Must include (non-exhaustive):
    - `id` (plugin ID; for local dev it should match the folder name)
    - `name`
    - `version` (Semantic Versioning `x.y.z`)
    - `minAppVersion`
    - `description`
    - `isDesktopOnly` (boolean)
    - Optional: `author`, `authorUrl`, `fundingUrl` (string or map)
- Never change `id` after release. Treat it as stable API.
- Keep `minAppVersion` accurate when using newer APIs.
- Canonical requirements are coded here: https://github.com/obsidianmd/obsidian-releases/blob/master/.github/workflows/validate-plugin-entry.yml

## Testing

- Manual install for testing: copy `main.js`, `manifest.json`, `styles.css` (if any) to:
    ```
    <Vault>/.obsidian/plugins/<plugin-id>/
    ```
- Reload Obsidian and enable the plugin in **Settings → Community plugins**.

## Commands & settings

- Any user-facing commands should be added via `this.addCommand(...)`.
- If the plugin has configuration, provide a settings tab and sensible defaults.
- Persist settings using `this.loadData()` / `this.saveData()`.
- Use stable command IDs; avoid renaming once released.

## Versioning & releases

**Releases are automated — do not bump versions by hand.** Run the `Release` workflow
(`gh workflow run release.yml -f release_type=auto`). It derives the next version from the
Conventional Commit subjects since the last tag, bumps `package.json` (whose `version` lifecycle
script syncs `manifest.json` and `versions.json` via `version-bump.mjs`), builds, commits, tags and
publishes.

Rules the automation encodes, which still apply to anything done manually:

- The tag is the **bare version with no `v` prefix** (e.g. `1.0.0`) and must exactly match
  `manifest.json`'s `version`. Obsidian's community catalog requires this, and BRAT resolves
  releases the same way.
- `main.js`, `manifest.json` and `styles.css` are attached as three **individual** assets. A release
  missing one installs as a broken plugin, so the workflow asserts all three exist and sets
  `fail_on_unmatched_files`.
- `versions.json` maps plugin version → `minAppVersion`. The bump script only ever _adds_ keys, never
  removes them.
- The bump commit must land on `main`: the catalog reads `manifest.json` from branch HEAD, while BRAT
  reads it from the release assets. Tagging without the commit means BRAT users update and catalog
  users never see the release.
- `main.js` is gitignored and exists only as a release asset. Never commit it.
- Never change `id` after a release. Treat it as stable API.

Distribution today is **BRAT** (`therealironduck/obsidian-extensions`), which installs from release
assets and auto-updates. The community catalog is a separate, deliberate decision — see `README.md`
on why the combined design makes this a weak catalog candidate.

## Security, privacy, and compliance

Follow Obsidian's **Developer Policies** and **Plugin Guidelines**. In particular:

- Default to local/offline operation. Only make network requests when essential to the feature.
- No hidden telemetry. If you collect optional analytics or call third-party services, require explicit opt-in and document clearly in `README.md` and in settings.
- Never execute remote code, fetch and eval scripts, or auto-update plugin code outside of normal releases.
- Minimize scope: read/write only what's necessary inside the vault. Do not access files outside the vault.
- Clearly disclose any external services used, data sent, and risks.
- Respect user privacy. Do not collect vault contents, filenames, or personal information unless absolutely necessary and explicitly consented.
- Avoid deceptive patterns, ads, or spammy notifications.
- Register and clean up all DOM, app, and interval listeners using the provided `register*` helpers so the plugin unloads safely.

## UX & copy guidelines (for UI text, commands, settings)

- Prefer sentence case for headings, buttons, and titles.
- Use clear, action-oriented imperatives in step-by-step copy.
- Use **bold** to indicate literal UI labels. Prefer "select" for interactions.
- Use arrow notation for navigation: **Settings → Community plugins**.
- Keep in-app strings short, consistent, and free of jargon.

## Performance

- Keep startup light. Defer heavy work until needed.
- Avoid long-running tasks during `onload`; use lazy initialization.
- Batch disk access and avoid excessive vault scans.
- Debounce/throttle expensive operations in response to file system events.

## Coding conventions

- TypeScript with `"strict": true` preferred.
- **Keep `main.ts` minimal**: It should contain nothing but `onload` calling each feature's `register<Feature>(this)`. All feature logic, including `addCommand` calls, belongs in the feature folder.
- **Split large files**: If any file exceeds ~200-300 lines, consider breaking it into smaller, focused modules.
- **Use clear module boundaries**: Each file should have a single, well-defined responsibility.
- Bundle everything into `main.js` (no unbundled runtime deps).
- Avoid Node/Electron APIs if you want mobile compatibility; set `isDesktopOnly` accordingly.
- Prefer `async/await` over promise chains; handle errors gracefully.

## Mobile

- Where feasible, test on iOS and Android.
- Don't assume desktop-only behavior unless `isDesktopOnly` is `true`.
- Avoid large in-memory structures; be mindful of memory and storage constraints.

## Agent do/don't

**Do**

- Add commands with stable IDs (don't rename once released).
- Provide defaults and validation in settings.
- Write idempotent code paths so reload/unload doesn't leak listeners or intervals.
- Use `this.register*` helpers for everything that needs cleanup.

**Don't**

- Introduce network calls without an obvious user-facing reason and documentation.
- Ship features that require cloud services without clear disclosure and explicit opt-in.
- Store or transmit vault contents unless essential and consented.

## Common tasks

### Organize code across multiple files

**main.ts** (minimal, lifecycle only):

```ts
import { Plugin } from 'obsidian';
import { MySettings, DEFAULT_SETTINGS } from './settings';
import { registerCommands } from './commands';

export default class MyPlugin extends Plugin {
	settings!: MySettings;

	async onload() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<MySettings>,
		);
		registerCommands(this);
	}
}
```

**settings.ts**:

```ts
export interface MySettings {
	enabled: boolean;
	apiKey: string;
}

export const DEFAULT_SETTINGS: MySettings = {
	enabled: true,
	apiKey: '',
};
```

**commands/index.ts**:

```ts
import { Plugin } from 'obsidian';
import { doSomething } from './my-command';

export function registerCommands(plugin: Plugin) {
	plugin.addCommand({
		id: 'do-something',
		name: 'Do something',
		callback: () => doSomething(plugin),
	});
}
```

### Add a command

```ts
this.addCommand({
	id: 'your-command-id',
	name: 'Do the thing',
	callback: () => this.doTheThing(),
});
```

### Persist settings

```ts
interface MySettings { enabled: boolean }
const DEFAULT_SETTINGS: MySettings = { enabled: true };

async onload() {
  this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<MySettings>);
  await this.saveData(this.settings);
}
```

### Register listeners safely

```ts
this.registerEvent(
	this.app.workspace.on('file-open', (f) => {
		/* ... */
	}),
);
this.registerDomEvent(activeWindow, 'resize', () => {
	/* ... */
});
this.registerInterval(
	window.setInterval(() => {
		/* ... */
	}, 1000),
);
```

## Troubleshooting

- Plugin doesn't load after build: ensure `main.js` and `manifest.json` are at the top level of the plugin folder under `<Vault>/.obsidian/plugins/<plugin-id>/`.
- Build issues: if `main.js` is missing, run `bun run build` or `bun run dev` to compile your TypeScript source code.
- Commands not appearing: verify `addCommand` runs after `onload` and IDs are unique.
- Settings not persisting: ensure `loadData`/`saveData` are awaited and you re-render the UI after changes.
- Mobile-only issues: confirm you're not using desktop-only APIs; check `isDesktopOnly` and adjust.

## References

- Obsidian sample plugin: https://github.com/obsidianmd/obsidian-sample-plugin
- API documentation: https://docs.obsidian.md
- Developer policies: https://docs.obsidian.md/Developer+policies
- Plugin guidelines: https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines
- Style guide: https://help.obsidian.md/style-guide
