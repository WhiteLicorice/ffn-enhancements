import { Theme } from '../enums/Theme';
import { ISitewideModule } from '../interfaces/ISiteWideModule';
import { IThemeDefinition } from '../interfaces/IThemeDefinition';
import { CssScanner } from '../services/CssScanner';
import componentsStyles from '../styles/components.css?raw';
import nativeOverrideStyles from '../styles/native-overrides.css?raw';
import { buildTokenCss } from '../styles/ThemeTokens';
import { getThemeDefinition } from '../themes';
import { FFNLogger } from './FFNLogger';
import { SettingsManager } from './SettingsManager';

const MODULE_NAME = 'ThemeManager';
const TOKEN_STYLE_ID = 'ffne-theme-tokens';
const COMPONENT_STYLE_ID = 'ffne-component-styles';
const FFN_OVERRIDES_STYLE_ID = 'ffne-theme-ffn-overrides';
const IFRAME_OVERRIDE_STYLE_ID = 'ffne-theme-iframe-overrides';
const THEME_CLASS_PREFIX = 'ffne-theme-';
const SYSTEM_QUERY = '(prefers-color-scheme: dark)';
const FFN_HOSTS = new Set(['www.fanfiction.net', 'fanfiction.net']);

let _mediaQuery: MediaQueryList | null = null;
let _unsubscribeTheme: (() => void) | null = null;
let _iframeObserver: MutationObserver | null = null;

export const ThemeManager: ISitewideModule & {
    setTheme(theme: Theme): void;
    getResolvedTheme(): Theme;
} = {
    prime(): void {
        const definition = getThemeDefinition(this.getResolvedTheme());
        _injectTokenStyles(definition);
        _injectComponentStyles();
        _applyThemeClass(this.getResolvedTheme());
        _applyColorScheme(definition);
        FFNLogger.log(MODULE_NAME, 'prime', `Theme primed: ${SettingsManager.get('theme')} -> ${this.getResolvedTheme()}`);
    },

    init(): void {
        _applyTheme(getThemeDefinition(this.getResolvedTheme()), true);
        _subscribeToSettingChanges();
        _watchSystemPreference();
        _watchTinyMceIframes();
    },

    setTheme(theme: Theme): void {
        if (!Object.values(Theme).includes(theme)) return;

        if (SettingsManager.get('theme') !== theme) {
            SettingsManager.set('theme', theme);
            return;
        }

        _applyTheme(getThemeDefinition(this.getResolvedTheme()), true);
    },

    getResolvedTheme(): Theme {
        const selected = SettingsManager.get('theme');
        if (selected !== Theme.SYSTEM) return selected;
        return _prefersDark() ? Theme.DARK : Theme.LIGHT;
    },
};

function _applyTheme(definition: IThemeDefinition, scanNativeCss: boolean): void {
    _injectTokenStyles(definition);
    _injectComponentStyles();
    _applyThemeClass(definition.name);
    _applyColorScheme(definition);

    if (scanNativeCss && _isFfnHost()) {
        _injectFfnOverrides(definition, document, FFN_OVERRIDES_STYLE_ID);
    } else {
        document.getElementById(FFN_OVERRIDES_STYLE_ID)?.remove();
    }

    _themeTinyMceIframes(definition);
}

function _injectTokenStyles(definition: IThemeDefinition, rootDocument: Document = document, styleId: string = TOKEN_STYLE_ID): void {
    const style = _upsertStyle(rootDocument, styleId);
    style.textContent = [
        buildTokenCss(definition.tokens as Record<string, string>),
        _buildBootstrapCss(definition),
    ].join('\n\n');
}

function _injectComponentStyles(rootDocument: Document = document): void {
    const style = _upsertStyle(rootDocument, COMPONENT_STYLE_ID);
    style.textContent = componentsStyles;
}

function _injectFfnOverrides(definition: IThemeDefinition, rootDocument: Document, styleId: string): void {
    const style = _upsertStyle(rootDocument, styleId);
    const scannerCss = CssScanner.scanAndOverride(
        definition.colorMap as Record<string, string>,
        _themeClass(definition.name),
        rootDocument,
    );
    const elementCss = definition.name !== Theme.LIGHT
        ? _buildScopedNativeOverrides(definition)
        : '';
    style.textContent = [scannerCss, elementCss].filter(Boolean).join('\n\n');
}

function _upsertStyle(rootDocument: Document, id: string): HTMLStyleElement {
    let style = rootDocument.getElementById(id) as HTMLStyleElement | null;
    if (!style) {
        style = rootDocument.createElement('style');
        style.id = id;
        const target = rootDocument.head || rootDocument.documentElement;
        target.appendChild(style);
    }
    return style;
}

function _buildBootstrapCss(definition: IThemeDefinition): string {
    const s = `html.${_themeClass(definition.name)}`;
    return `
${s} {
    background: var(--ffne-ui-page-bg) !important;
    color: var(--ffne-ui-text-body) !important;
}
${s} body {
    background-color: var(--ffne-ui-page-bg) !important;
    color: var(--ffne-ui-text-body) !important;
}
${s} #content_wrapper,
${s} #content_wrapper_inner {
    background-color: var(--ffne-ui-page-bg) !important;
    color: var(--ffne-ui-text-body) !important;
}
`;
}

function _buildScopedNativeOverrides(definition: IThemeDefinition): string {
    const themeClass = _themeClass(definition.name);
    return nativeOverrideStyles.replace(/__THEME_CLASS__/g, themeClass);
}

function _applyThemeClass(theme: Theme): void {
    const root = document.documentElement;
    Object.values(Theme).forEach(value => root.classList.remove(_themeClass(value)));
    root.classList.add(_themeClass(theme));
}

function _applyColorScheme(definition: IThemeDefinition): void {
    document.documentElement.style.colorScheme = definition.isDark ? 'dark' : 'light';
}

function _themeClass(theme: Theme): string {
    return `${THEME_CLASS_PREFIX}${theme}`;
}

function _subscribeToSettingChanges(): void {
    if (_unsubscribeTheme) return;

    _unsubscribeTheme = SettingsManager.subscribe('theme', () => {
        _applyTheme(getThemeDefinition(ThemeManager.getResolvedTheme()), true);
    });
}

function _watchSystemPreference(): void {
    if (_mediaQuery || typeof window.matchMedia !== 'function') return;

    _mediaQuery = window.matchMedia(SYSTEM_QUERY);
    const onSystemThemeChange = () => {
        if (SettingsManager.get('theme') === Theme.SYSTEM) {
            _applyTheme(getThemeDefinition(ThemeManager.getResolvedTheme()), true);
        }
    };

    if (typeof _mediaQuery.addEventListener === 'function') {
        _mediaQuery.addEventListener('change', onSystemThemeChange);
    } else {
        _mediaQuery.addListener(onSystemThemeChange);
    }
}

function _watchTinyMceIframes(): void {
    if (_iframeObserver) return;

    _themeTinyMceIframes(getThemeDefinition(ThemeManager.getResolvedTheme()));
    _iframeObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of Array.from(mutation.addedNodes)) {
                if (!(node instanceof HTMLElement)) continue;
                const frames = node instanceof HTMLIFrameElement
                    ? [node]
                    : Array.from(node.querySelectorAll<HTMLIFrameElement>('iframe[id$="_ifr"]'));
                frames.forEach(frame => _themeIframe(frame, getThemeDefinition(ThemeManager.getResolvedTheme())));
            }
        }
    });

    _iframeObserver.observe(document.documentElement, { childList: true, subtree: true });
}

function _themeTinyMceIframes(definition: IThemeDefinition): void {
    document.querySelectorAll<HTMLIFrameElement>('iframe[id$="_ifr"]').forEach(frame => _themeIframe(frame, definition));
}

function _themeIframe(frame: HTMLIFrameElement, definition: IThemeDefinition): void {
    const apply = () => {
        try {
            const frameDocument = frame.contentDocument;
            if (!frameDocument) return;

            _injectTokenStyles(definition, frameDocument, TOKEN_STYLE_ID);
            _applyFrameThemeClass(frameDocument, definition.name);
            _injectFfnOverrides(definition, frameDocument, IFRAME_OVERRIDE_STYLE_ID);
        } catch (e) {
            FFNLogger.log(MODULE_NAME, '_themeIframe', 'Could not theme TinyMCE iframe:', e as object);
        }
    };

    if (frame.contentDocument?.readyState === 'complete') {
        apply();
        return;
    }

    frame.addEventListener('load', apply, { once: true });
}

function _applyFrameThemeClass(rootDocument: Document, theme: Theme): void {
    const root = rootDocument.documentElement;
    Object.values(Theme).forEach(value => root.classList.remove(_themeClass(value)));
    root.classList.add(_themeClass(theme));
    root.style.colorScheme = getThemeDefinition(theme).isDark ? 'dark' : 'light';
}

function _prefersDark(): boolean {
    return typeof window.matchMedia === 'function' && window.matchMedia(SYSTEM_QUERY).matches;
}

function _isFfnHost(): boolean {
    return FFN_HOSTS.has(window.location.hostname);
}
