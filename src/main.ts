import { Plugin } from 'obsidian';
import { registerPanels } from './features/panels';
import { registerSlackCopy } from './features/slack-copy';
import { registerUnlinkAtCursor } from './features/unlink-at-cursor';

/**
 * Every feature lives behind a `register` function that takes the plugin and
 * wires itself up through the `register*` helpers, so adding a feature means
 * one import and one line here and nothing else.
 */
export default class JordansExtensionsPlugin extends Plugin {
	onload() {
		registerPanels(this);
		registerSlackCopy(this);
		registerUnlinkAtCursor(this);
	}
}
