import { Core } from './modules/Core';
import { DocManager } from './modules/DocManager';
import { DocEditor } from './modules/DocEditor';
import { StoryReader } from './modules/StoryReader';
import { StoryDownloader } from './modules/StoryDownloader';

const path = window.location.pathname;
Core.log('router', 'main', `Here at https://www.fanfiction.net${path}`, path);

if (path === "/docs/docs.php") {
    DocManager.init();
} else if (path.includes("/docs/edit.php")) {
    DocEditor.init();
} else if (path.startsWith("/s/")) {
    StoryReader.init();
    StoryDownloader.init();
}