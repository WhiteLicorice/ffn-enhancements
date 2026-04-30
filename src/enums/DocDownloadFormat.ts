// enums/DocDownloadFormat.ts

/**
 * Formats available for downloading author-owned documents from the
 * Document Manager (`/docs/docs.php`) and Document Editor (`/docs/edit.php`).
 *
 * NOTE: Intentionally separate from `SupportedFormats`, which covers
 * reader-facing downloads via FicHub/Native (EPUB, MOBI, PDF, HTML).
 * Doc-download operates on raw FFN textarea content and only a small
 * subset of output formats is meaningful for that use case.
 *
 * @see SettingsManager — stored under the key `docDownloadFormat`
 * @see SupportedFormats — for reader/story-page download formats
 */
export enum DocDownloadFormat {
    /** HTML content converted to Markdown via Turndown. Default. */
    MARKDOWN = 'md',
    /** Raw HTML content, as-is from the FFN editor textarea. */
    HTML = 'html',
    /** HTML content converted to OOXML and packaged as a .docx archive. */
    DOCX = 'docx',
}
