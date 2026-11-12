export interface KeepFoldersCollapsedSettings {
	/** Vault-relative folder paths that must not auto-expand. */
	folders: string[];
}

export const DEFAULT_KEEP_FOLDERS_COLLAPSED_SETTINGS: KeepFoldersCollapsedSettings = {
	folders: ['00 Dailies'],
};

/** Trims, drops trailing slashes and discards empties, so stored input is forgiving. */
export function normalizeFolders(folders: string[]): string[] {
	return folders
		.map((folder) => folder.trim().replace(/\/+$/, ''))
		.filter((folder) => folder.length > 0);
}
