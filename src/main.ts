// main.ts

import { Core } from './modules/Core';
import { DocManager } from './modules/DocManager';
import { DocEditor } from './modules/DocEditor';
import { StoryReader } from './modules/StoryReader';
import { StoryDownloader } from './modules/StoryDownloader';

/**
 * The Entry Point / Router.
 * * Responsibilities:
 * 1. Identifies the current page path to determine the execution context.
 * 2. Configures the Core Delegate Strategy (Abstract Factory for DOM elements).
 * 3. Initializes the specific Feature Module corresponding to the active page.
 */

/**
 * The current URL path (e.g., "/s/12345" or "/docs/docs.php").
 * Used to route the application logic.
 */
const path = window.location.pathname;

Core.log('router', 'main', `Here at https://www.fanfiction.net${path}`, path);

/**
 * Register the appropriate Delegate (Page Object) based on the path.
 * This ensures Core.getElement() uses the correct selectors for the current page.
 */
Core.setDelegate(path);

// NOTE: The path includes the "/" and omits "https://www.fanfiction.net".
// If in doubt, check your browser.

if (path === "/docs/docs.php") {
    /**
     * Route: Document Manager (List View)
     * Features: Bulk Download, Export Column
     */
    DocManager.init();
}
else if (path.includes("/docs/edit.php")) {
    /**
     * Route: Document Editor (TinyMCE)
     * Features: Single Document Download button in Toolbar
     */
    DocEditor.init();
}
else if (path.startsWith("/s/")) {
    /**
     * Route: Story Reading Page
     * Features:
     * - StoryReader: Copy/Select text unlocking, Hotkeys (WASD/Arrows).
     * - StoryDownloader: Fichub integration for EPUB/MOBI downloads.
     */
    // Matches /s/1234569420/1/Story-Title
    StoryReader.init();
    StoryDownloader.init();
}