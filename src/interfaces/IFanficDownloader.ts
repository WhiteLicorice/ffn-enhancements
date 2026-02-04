// interfaces/IFanficDownloader.ts

/**
 * Interface defining the contract for story download strategies.
 * Implementations (FicHub, Native, etc.) must expose explicit methods
 * for each supported format to ensure type safety and clarity.
 */
export interface IFanficDownloader {
    /**
     * Downloads the story as an EPUB (E-book) file.
     * @param storyIdOrUrl - The ID or full URL of the story.
     */
    downloadAsEPUB(storyIdOrUrl: string): Promise<void>;

    /**
     * Downloads the story as a MOBI (Kindle) file.
     * @param storyIdOrUrl - The ID or full URL of the story.
     */
    downloadAsMOBI(storyIdOrUrl: string): Promise<void>;

    /**
     * Downloads the story as a PDF document.
     * @param storyIdOrUrl - The ID or full URL of the story.
     */
    downloadAsPDF(storyIdOrUrl: string): Promise<void>;

    /**
     * Downloads the story as a single HTML file.
     * @param storyIdOrUrl - The ID or full URL of the story.
     */
    downloadAsHTML(storyIdOrUrl: string): Promise<void>;
}