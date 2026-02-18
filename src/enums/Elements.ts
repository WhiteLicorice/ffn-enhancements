// enums/Elements.ts

/**
 * specific UI components on FanFiction.net.
 * * These keys are used by the Delegate system to fetch the actual DOM elements.
 * This abstraction allows us to update CSS selectors in one place (the Delegate)
 * without breaking the business logic in the Modules.
 */
export enum Elements {
    // =============================
    // GLOBAL (Header, Footer, Auth)
    // =============================

    /** The main profile header containing the user's name, avatar, and navigation tabs. */
    PROFILE_HEADER = 'PROFILE_HEADER',

    /** The "Follow/Fav" button or container often found in headers. */
    FOLLOW_BUTTON_CONTAINER = 'FOLLOW_BUTTON_CONTAINER',

    /** * The outer content wrapper that often contains fixed width styles (e.g., width: 1250px). 
     * Targeted to remove letterboxing/borders.
     */
    PAGE_CONTENT_WRAPPER = 'PAGE_CONTENT_WRAPPER',

    /** The main content wrapper for the page (often #content_wrapper_inner). */
    MAIN_CONTENT_WRAPPER = 'MAIN_CONTENT_WRAPPER',

    // =============================
    // STORY READER (/s/*)
    // =============================

    /** The container holding the actual story content text. */
    STORY_TEXT = 'STORY_TEXT',

    /** The button/icon that toggles text justification/margins (to be removed in Fluid Mode). */
    STORY_WIDTH_CONTROL = 'STORY_WIDTH_CONTROL',

    /** The container usually found at top/bottom allowing chapter selection. */
    CHAPTER_NAV_CONTAINER = 'CHAPTER_NAV_CONTAINER',

    /** The dropdown select input for navigating chapters. */
    CHAPTER_DROPDOWN = 'CHAPTER_DROPDOWN',

    /** The specific button to go to the next chapter. */
    NEXT_CHAPTER_BTN = 'NEXT_CHAPTER_BTN',

    /** The specific button to go to the previous chapter. */
    PREV_CHAPTER_BTN = 'PREV_CHAPTER_BTN',

    /** The "Review" text area or input box. */
    REVIEW_BOX = 'REVIEW_BOX',

    /** The title element in the header. */
    STORY_TITLE = 'STORY_TITLE',

    /** The author link in the header. */
    STORY_AUTHOR = 'STORY_AUTHOR',

    /** The summary text block in the header. */
    STORY_SUMMARY = 'STORY_SUMMARY',

    /** The cover image element in the header. */
    STORY_COVER = 'STORY_COVER',

    /** The container holding the story stats (Rated, Words, Status, etc). */
    STORY_META_BLOCK = 'STORY_META_BLOCK',

    // =============================
    // DOC MANAGER (/docs/docs.php)
    // =============================

    /** The main table containing the list of documents. */
    DOC_TABLE = 'DOC_TABLE',

    /** The header row of the document table (for injecting columns). */
    DOC_TABLE_HEAD_ROW = 'DOC_TABLE_HEAD_ROW',

    /** All body rows within the document table (returns a NodeList or Array). */
    DOC_TABLE_BODY_ROWS = 'DOC_TABLE_BODY_ROWS',

    /** The "Document Manager" label or title node, often used as an injection anchor. */
    DOC_MANAGER_LABEL = 'DOC_MANAGER_LABEL',

    /** The "Submit" button used for saving docs (appears as Save on the page) */
    SAVE_BUTTON = 'SAVE_BUTTON',

    // =============================
    // DOC EDITOR (/docs/edit.php)
    // =============================

    /** The TinyMCE toolbar container. */
    EDITOR_TOOLBAR = 'EDITOR_TOOLBAR',

    /** The header text showing "Edit Document: [Title]". */
    EDITOR_HEADER_LABEL = 'EDITOR_HEADER_LABEL',

    /** The input field for the document title (fallback if header parsing fails). */
    EDITOR_TITLE_INPUT = 'EDITOR_TITLE_INPUT',

    /** The raw text area from private author-only editors. */
    EDITOR_TEXT_AREA = 'EDITOR_TEXT_AREA',

    /** The editor i-frame that EDITOR_TEXT_AREA uses. */
    EDITOR_TEXT_AREA_IFRAME = 'EDITOR_TEXT_AREA_IFRAME',
}