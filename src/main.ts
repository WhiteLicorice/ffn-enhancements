// main.ts

import { Core } from './modules/Core';
import { EarlyBoot } from './modules/EarlyBoot';
import { DocManager } from './modules/DocManager';
import { DocEditor } from './modules/DocEditor';
import { StoryReader } from './modules/StoryReader';
import { StoryDownloader } from './modules/StoryDownloader';
import { LayoutManager } from './modules/LayoutManager';

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

Core.log('Router', 'main', `Here at https://www.fanfiction.net${path}`, path);

// Register all sitewide modules with EarlyBoot.
// Order of registration determines execution order and CSS cascade layering.
// Structural modules (layout, spacing) must be registered before theme modules (colors).
//
// Modules are registered directly with EarlyBoot. LayoutManager is registered first
// so that structural layout and spacing are established before any theme-level styles.
// This keeps layout concerns decoupled from higher-level visual customization.
//
EarlyBoot.register(LayoutManager);
EarlyBoot.prime();

const bootstrap = () => {
    /**
     * Bootstraps the Core system.
     * 1. Sets the Delegate based on the path (Core.setDelegate).
     * 2. Runs Phase 2 init() on all registered sitewide modules via EarlyBoot.
     */
    Core.startup(path);

    // NOTE: The path includes the "/" and omits "https://www.fanfiction.net".
    // If in doubt, check your browser.

    // Phase 2 — DOMContentLoaded.
    // Calls init() on every registered sitewide module now that the DOM is fully ready.
    EarlyBoot.init();

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
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
    bootstrap();
}
