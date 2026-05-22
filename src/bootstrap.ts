import { Core } from './modules/Core';
import { EarlyBoot } from './modules/EarlyBoot';
import { SettingsManager } from './modules/SettingsManager';
import { SettingsIconHijacker } from './modules/SettingsIconHijacker';
import { DocManager } from './modules/DocManager';
import { DocEditor } from './modules/DocEditor';
import { StoryReader } from './modules/StoryReader';
import { StoryDownloader } from './modules/StoryDownloader';
import { LayoutManager } from './modules/LayoutManager';
import { StoryEditContent } from './modules/StoryEditContent';
import { Ao3Bridge } from './modules/Ao3Bridge';
import { ThemeManager } from './modules/ThemeManager';

const FFN_HOSTS = new Set(['www.fanfiction.net', 'fanfiction.net']);
const AO3_HOST = 'archiveofourown.org';

export function registerSitewideModules(hostname: string = window.location.hostname): void {
    if (isFfnHost(hostname)) {
        EarlyBoot.register(SettingsManager);
        EarlyBoot.register(SettingsIconHijacker);
        EarlyBoot.register(ThemeManager);
        EarlyBoot.register(LayoutManager);
        return;
    }

    // AO3 intentionally registers no sitewide modules. Only Ao3Bridge runs
    // (initialized directly in bootstrap()) — theming, layout, and settings
    // sync are FFN-only concerns. Theme/layout CSS shipped via manifest is
    // gated by `html.ffne-theme-*` / `.ffn-enhancements-fluid-mode` classes
    // which are never applied on AO3, so the stylesheets stay dormant.
}

export function primeSitewideModules(hostname: string = window.location.hostname): void {
    if (isFfnHost(hostname)) {
        EarlyBoot.prime();
    }
}

export function bootstrap(locationLike: Pick<Location, 'pathname' | 'hostname' | 'origin'> = window.location): void {
    const { pathname: path, hostname } = locationLike;

    Core.log('Router', 'main', `Here at ${locationLike.origin}${path}`, path);
    Core.startup(locationLike);

    if (isAo3Host(hostname)) {
        safeInit('Ao3Bridge', () => Ao3Bridge.init());
        return;
    }

    if (!isFfnHost(hostname)) return;

    EarlyBoot.init();
    initActiveRoute(path);
}

export function installBootstrap(
    locationLike: Pick<Location, 'pathname' | 'hostname' | 'origin'> = window.location,
    rootDocument: Document = document,
): void {
    registerSitewideModules(locationLike.hostname);
    primeSitewideModules(locationLike.hostname);

    if (rootDocument.readyState === 'loading') {
        rootDocument.addEventListener('DOMContentLoaded', () => bootstrap(locationLike), { once: true });
    } else {
        bootstrap(locationLike);
    }
}

function initActiveRoute(path: string): void {
    if (path === '/docs/docs.php') {
        safeInit('DocManager', () => DocManager.init());
        return;
    }

    if (path.includes('/docs/edit.php')) {
        safeInit('DocEditor', () => DocEditor.init());
        return;
    }

    if (path.includes('/story/story_edit_content.php')) {
        safeInit('StoryEditContent', () => StoryEditContent.init());
        return;
    }

    if (path.startsWith('/s/')) {
        safeInit('StoryReader', () => StoryReader.init());
        safeInit('StoryDownloader', () => StoryDownloader.init());
    }
}

function safeInit(name: string, fn: () => void): void {
    try {
        fn();
    } catch (e) {
        Core.log('main', 'safeInit', `Error initializing ${name}:`, e);
    }
}

function isFfnHost(hostname: string): boolean {
    return FFN_HOSTS.has(hostname);
}

function isAo3Host(hostname: string): boolean {
    return hostname === AO3_HOST;
}
