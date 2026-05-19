// main.ts

import { Core } from './modules/Core';
import { EarlyBoot } from './modules/EarlyBoot';
import { SettingsManager } from './modules/SettingsManager';
import { SettingsMenu } from './modules/SettingsMenu';
import { DocManager } from './modules/DocManager';
import { DocEditor } from './modules/DocEditor';
import { StoryReader } from './modules/StoryReader';
import { StoryDownloader } from './modules/StoryDownloader';
import { LayoutManager } from './modules/LayoutManager';
import { StoryEditContent } from './modules/StoryEditContent';
import { Ao3Bridge } from './modules/Ao3Bridge';
import { ThemeManager } from './modules/ThemeManager';

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
const hostname = window.location.hostname;
const isFfnHost = hostname === 'www.fanfiction.net' || hostname === 'fanfiction.net';
const isAo3Host = hostname === 'archiveofourown.org';

// Register all sitewide modules with EarlyBoot.
// Order of registration determines execution order and CSS cascade layering.
//
// CRITICAL ORDERING CONSTRAINTS:
// 1. SettingsManager MUST be first — all downstream modules (including LayoutManager)
//    read from its cache in their own prime() / init() calls.
// 2. SettingsMenu MUST come after SettingsManager so menu labels reflect stored values.
// 3. ThemeManager MUST come after SettingsManager so it can read the stored theme
//    and inject token CSS before any feature modules render UI.
// 4. LayoutManager MUST come after ThemeManager so its structural CSS layers after
//    the base theme tokens while still priming before first paint.
// 5. LayoutManager MUST come after SettingsManager so prime() can restore fluidMode
//    preference before first paint, preventing FOUC.
//
if (isFfnHost) {
    EarlyBoot.register(SettingsManager);
    EarlyBoot.register(SettingsMenu);
    EarlyBoot.register(ThemeManager);
    EarlyBoot.register(LayoutManager);
} else if (isAo3Host) {
    EarlyBoot.register(SettingsManager);
    EarlyBoot.register(ThemeManager);
}

if (isFfnHost || isAo3Host) {
    EarlyBoot.prime();
}

// Global error boundary — logs unhandled exceptions without breaking script
window.addEventListener('error', (e) => {
    Core.log('main', 'globalError', 'Unhandled runtime error:', e.error || e.message);
});

const safeInit = (name: string, fn: () => void) => {
    try {
        fn();
    } catch (e) {
        Core.log('main', 'safeInit', `Error initializing ${name}:`, e);
    }
};

const bootstrap = () => {
    /**
     * Bootstraps the Core system.
     * 1. Sets the Delegate based on the path (Core.setDelegate).
     * 2. Runs Phase 2 init() on all registered sitewide modules via EarlyBoot.
     */
    Core.log('Router', 'main', `Here at ${window.location.origin}${path}`, path);
    Core.startup(window.location);

    if (isAo3Host) {
        EarlyBoot.init();
        safeInit('Ao3Bridge', () => Ao3Bridge.init());
        return;
    }

    if (!isFfnHost) return;

    // Phase 2 — DOMContentLoaded.
    // Calls init() on every registered sitewide module now that the DOM is fully ready.
    EarlyBoot.init();

    // NOTE: The path includes the "/" and omits "https://www.fanfiction.net".
    // If in doubt, check your browser.

    if (path === "/docs/docs.php") {
        /**
         * Route: Document Manager (List View)
         * Features: Bulk Download, Export Column
         */
        safeInit('DocManager', () => DocManager.init());
    }
    else if (path.includes("/docs/edit.php")) {
        /**
         * Route: Document Editor (TinyMCE)
         * Features: Single Document Download button in Toolbar
         */
        safeInit('DocEditor', () => DocEditor.init());
    }
    else if (path.includes('/story/story_edit_content.php')) {
        /**
         * Route: Story Edit Content
         * Features: Bulk Replace
         */
        safeInit('StoryEditContent', () => StoryEditContent.init());
    }
    else if (path.startsWith("/s/")) {
        /**
         * Route: Story Reading Page
         * Features:
         * - StoryReader: Copy/Select text unlocking, Hotkeys (WASD/Arrows).
         * - StoryDownloader: Fichub integration for EPUB/MOBI downloads.
         */
        // Matches /s/1234569420/1/Story-Title
        safeInit('StoryReader', () => StoryReader.init());
        safeInit('StoryDownloader', () => StoryDownloader.init());
    }
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
    bootstrap();
}
