// main.ts

import { Core } from './modules/Core';
import { DocManager } from './modules/DocManager';
import { DocEditor } from './modules/DocEditor';
import { StoryReader } from './modules/StoryReader';
import { StoryDownloader } from './modules/StoryDownloader';

/**
 * The Entry Point / Router.
 * 1. Identifies the current page path.
 * 2. Configures the Core Delegate Strategy.
 * 3. Initializes the specific Feature Module.
 */

const path = window.location.pathname;
Core.log('router', 'main', `Here at https://www.fanfiction.net${path}`, path);
Core.setDelegate(path);

// NOTE: The path includes the "/" and omits "https://www.fanfiction.net".
// If in doubt, check your browser.
if (path === "/docs/docs.php") {
    DocManager.init();
}
else if (path.includes("/docs/edit.php")) {
    DocEditor.init();
}
else if (path.startsWith("/s/")) {
    // Matches /s/1234569420/1/Story-Title
    StoryReader.init();
    StoryDownloader.init();
}