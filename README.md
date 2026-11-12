# Jordans Extensions

**One Obsidian plugin that bundles every extension I wrote for my own vault.**

This repository is deliberately *not* one repo per plugin. Everything I build for my
vault ships as a single plugin with a single id (`jordans-extensions`), a single
`manifest.json` and a single `main.js`. What used to be three separate plugins —
`panels`, `slack-copy` and `unlink-at-cursor` — are now three **features** inside this
one plugin.

Why one plugin instead of three:

- **One install, one update.** Enabling my tweaks in a vault means enabling one plugin,
  not hunting down three folders and three releases.
- **One build.** One `npm install`, one `npm run build`, one set of configs to keep
  current instead of three that drift apart.
- **Shared code actually gets shared.** `slack-copy` and `unlink-at-cursor` each carried
  their own copy of the wikilink regex. Now there is one
  [`src/utils/wikilinks.ts`](src/utils/wikilinks.ts) and both features use it.
- **It is all for the same vault anyway.** None of this is meant for the community
  catalog, so the per-plugin ceremony bought nothing.

The flip side, stated plainly: features cannot be enabled individually, and a bug in
one feature's `onload` can take the others down with it. That is an accepted trade for a
personal plugin.

## Disclaimer: this is vibe-coded

This plugin is vibe-coded. It was built by prompting an AI agent, and the code has not
been reviewed line by line by a human. There are no automated tests. It is tested the way
a personal tool gets tested: it works in my vault, in my workflow, on my machine.

That is a deliberate choice rather than an apology — I am comfortable with it for a tool
I built for myself. But it should set your expectations if you install it: edge cases I
never hit are quite possibly broken. If something misbehaves, please open an issue
instead of assuming it is your setup.

## Features

### Panels

Renders `::: panel` fenced blocks as titled, optionally collapsible boxes, in **both**
live preview and reading view.

````markdown
::: panel A plain panel
Content goes here.
:::

::: panel.info Heads up
Variants add a colour and an icon.
:::

::: panel.warning+ Collapsible, starts open
`+` makes it collapsible.
:::

::: panel.tip- Collapsible, starts collapsed
`-` makes it collapsible and collapsed on load.
:::
````

Syntax rules:

- The opening fence is `:::` (or more colons) followed by `panel`, an optional
  `.variant`, an optional `+`/`-` collapse marker, and an optional title.
- The closing fence is `:::` with **at least as many colons** as the opener. That is what
  makes nesting work — use `::::` for an outer panel wrapping a `:::` inner one.
- **Fences must start at column 0.** This is intentional: it keeps panels out of list
  items and blockquotes, where Obsidian's own indent padding would fight the panel
  border and produce a visibly broken box.
- Fenced code blocks are skipped, so `:::` inside a code block stays literal text — which
  is what lets a panel contain a code block.
- Without a collapse marker, a panel is not collapsible at all.

Built-in variants, each with a [Lucide](https://lucide.dev) icon: `info`, `tip`,
`success`, `warning`, `danger`, `note`, `quote`. Aliases: `warn`/`caution` → `warning`,
`error` → `danger`, `done`/`check` → `success`, `hint`/`idea` → `tip`.

An **unknown** variant is not an error — it keeps its name as a `panel-v-<name>` CSS
class and simply gets no icon, so a custom variant can be styled from a vault CSS
snippet without touching the plugin.

Two deliberate behaviours worth knowing:

- **Collapse state lives in memory, never in the note.** My vault auto-commits, so
  folding a panel must not dirty the file. The state is keyed by path and opening line,
  so it survives Obsidian unloading and re-rendering off-screen sections while you
  scroll — but not an app restart.
- **The title renders as plain text in live preview and as markdown in reading view.**
  The live-preview header is a CodeMirror widget that gets torn down on every
  reveal/conceal cycle; a markdown render there would need its own component lifecycle
  for no real gain.

While the cursor is inside a panel, the fences are revealed so you can edit them. An
unclosed panel is still drawn (and flagged with `panel-unclosed`) in live preview so you
can see the box while typing; reading view ignores unclosed panels rather than
restructuring the rest of the note.

### Slack copy

Command: **Copy selection for Slack**

Copies the current selection to the clipboard with `[[wikilinks]]` flattened to plain
text — `[[Some Note]]` becomes `Some Note`, and `[[Some Note|the alias]]` becomes
`the alias`. Saves manually cleaning up brackets after every paste into Slack.

### Unlink at cursor

Command: **Remove link at cursor**

Removes the `[[` `]]` around the wikilink under the cursor, keeping the alias when one is
set. The cursor ends up after the unwrapped text. Works anywhere inside the link,
including on either bracket pair.

## Install

Not in the community catalog — this is a personal plugin, installed manually:

1. Build it (see below), or grab `main.js`, `manifest.json` and `styles.css` from a
   release.
2. Copy those three files to `<Vault>/.obsidian/plugins/jordans-extensions/`.
3. Reload Obsidian and enable **Jordans Extensions** under
   **Settings → Community plugins**.

`isDesktopOnly` is `true`. Nothing in here is genuinely desktop-bound, but two of the
three original plugins declared it, so the combined plugin keeps the conservative
value rather than silently claiming mobile support that was never tested.

## Development

```bash
npm install
npm run dev    # esbuild in watch mode
npm run build  # typecheck, then a minified production bundle
npm run lint
```

`npm run dev` writes `main.js` to the project root. To test against a real vault, point
the build at the vault's plugin folder or symlink
`<Vault>/.obsidian/plugins/jordans-extensions/` at this directory.

`main.js` is gitignored on purpose — it is a build artifact and belongs on a GitHub
release, not in the tree.

## Layout

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

### Adding a feature

Every feature is a folder under `src/features/` whose `index.ts` exports a single
`register<Feature>(plugin: Plugin)` function. It wires itself up through the
`plugin.register*` / `plugin.addCommand` helpers so it unloads cleanly.

Adding one is two lines in [`src/main.ts`](src/main.ts) — an import and a call — and
nothing else. Keep `main.ts` free of feature logic.

Feature-specific code stays in the feature folder; only genuinely shared helpers move to
`src/utils/`.

## License

0BSD
