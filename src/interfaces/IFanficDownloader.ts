// interfaces/IFanficDownloader.ts

/**
 * Interface defining the contract for story download strategies.
 * Implementations (FicHub, Native, etc.) must expose explicit methods
 * for each supported format to ensure type safety and clarity.
 */
export interface IFanficDownloader {
    /**
     * Module name used for logging.
     */
    MODULE_NAME: string;

    /**
     * Downloads the story as an EPUB (E-book) file.
     * @param storyIdOrUrl - The ID or full URL of the story.
     * @param onProgress - Optional generic callback for status updates.
     */
    downloadAsEPUB(storyIdOrUrl: string, onProgress?: CallableFunction): Promise<void>;

    /**
     * Downloads the story as a MOBI (Kindle) file.
     * @param storyIdOrUrl - The ID or full URL of the story.
     * @param onProgress - Optional generic callback for status updates.
     */
    downloadAsMOBI(storyIdOrUrl: string, onProgress?: CallableFunction): Promise<void>;

    /**
     * Downloads the story as a PDF document.
     * @param storyIdOrUrl - The ID or full URL of the story.
     * @param onProgress - Optional generic callback for status updates.
     */
    downloadAsPDF(storyIdOrUrl: string, onProgress?: CallableFunction): Promise<void>;

    /**
     * Downloads the story as a single HTML file.
     * @param storyIdOrUrl - The ID or full URL of the story.
     * @param onProgress - Optional generic callback for status updates.
     */
    downloadAsHTML(storyIdOrUrl: string, onProgress?: CallableFunction): Promise<void>;
}