export interface DocxExportSettings {
	/**
	 * Absolute path the DOCX is written to. Empty means the OS downloads
	 * folder, which is resolved at export time rather than stored, so the
	 * default keeps working if the vault moves between machines.
	 */
	outputFolder: string;
	/** Overridden per note by `docx-numbering`. */
	numberHeadings: boolean;
}

export const DEFAULT_DOCX_EXPORT_SETTINGS: DocxExportSettings = {
	outputFolder: '',
	numberHeadings: true,
};
