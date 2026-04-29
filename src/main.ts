// main.ts

import { Core } from './modules/Core';
import { EarlyBoot } from './modules/EarlyBoot';
import { SettingsManager } from './modules/SettingsManager';
import { SettingsMenu } from './modules/SettingsMenu';
import { SettingsPage } from './modules/SettingsPage';
import { DocManager } from './modules/DocManager';
import { DocEditor } from './modules/DocEditor';
import { StoryReader } from './modules/StoryReader';
import { StoryDownloader } from './modules/StoryDownloader';
import { LayoutManager } from './modules/LayoutManager';

/**
 * The Entry Point / Router.
 * Responsibilities:
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
//
// CRITICAL ORDERING CONSTRAINTS:
// 1. SettingsManager MUST be first — all downstream modules (including LayoutManager)
//    read from its cache in their own prime() / init() calls.
// 2. SettingsMenu MUST come after SettingsManager so menu labels reflect stored values.
// 3. LayoutManager MUST come after SettingsManager so prime() can restore fluidMode
//    preference before first paint, preventing FOUC.
//
EarlyBoot.register(SettingsManager);
EarlyBoot.register(SettingsMenu);
EarlyBoot.register(LayoutManager);
EarlyBoot.prime();

const bootstrap = () => {
    /**
     * Bootstraps the Core system.
     * 1. Sets the Delegate based on the path (Core.setDelegate).
     * 2. Runs Phase 2 init() on all registered sitewide modules via EarlyBoot.
     */
    Core.startup(path);

    // Phase 2 — DOMContentLoaded.
    // Calls init() on every registered sitewide module now that the DOM is fully ready.
    EarlyBoot.init();

    // ── Settings page intercept ──────────────────────────────────────────────
    // The Tampermonkey menu command opens `fanfiction.net/?ffne_settings=1` in a
    // new tab via GM_openInTab. We detect that query parameter here and render the
    // settings UI in place of the normal page content.
    //
    // This MUST come before all other routing so page-specific modules
    // (DocManager, DocEditor, StoryReader, etc.) do not run on the settings page.
    //
    // LayoutManager.init() has already run above (desirable — we want fluid mode
    // applied to the settings page itself). No page-specific module is initialised.
    if (window.location.search.includes('ffne_settings=1')) {
        SettingsPage.render();
        return;
    }

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
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
    bootstrap();
}

