import { Theme } from '../enums/Theme';
import { ISitewideModule } from '../interfaces/ISiteWideModule';
import { IThemeDefinition } from '../interfaces/IThemeDefinition';
import { CssScanner } from '../services/CssScanner';
import componentsStyles from '../styles/components.css?raw';
import nativeOverrideStyles from '../styles/native-overrides.css?raw';
import { buildTokenCss } from '../styles/ThemeTokens';
import { getThemeDefinition } from '../themes';
import { FFNE_UI_EXCLUDE_SELECTOR } from '../utils/ffneUi';
import { injectStyleOnce } from '../utils/injectStyleOnce';
import { scopeCssText } from '../utils/scopeCssText';
import { themeClass } from '../utils/themeClass';
import { FFNLogger } from './FFNLogger';
import { SettingsManager } from './SettingsManager';

const MODULE_NAME = 'ThemeManager';
const TOKEN_STYLE_ID = 'ffne-theme-tokens';
const STATIC_NATIVE_STYLE_ID = 'ffne-theme-native-overrides';
const COMPONENT_STYLE_ID = 'ffne-component-styles';
const SCANNED_FFN_OVERRIDES_STYLE_ID = 'ffne-theme-scanned-ffn-overrides';
const IFRAME_OVERRIDE_STYLE_ID = 'ffne-theme-iframe-overrides';
const IFRAME_STATIC_OVERRIDE_STYLE_ID = 'ffne-theme-iframe-native-overrides';
const SYSTEM_QUERY = '(prefers-color-scheme: dark)';
const FFN_HOSTS = new Set(['www.fanfiction.net', 'fanfiction.net']);

let _mediaQuery: MediaQueryList | null = null;
let _unsubscribeTheme: (() => void) | null = null;
let _iframeObserver: MutationObserver | null = null;

export const ThemeManager: ISitewideModule & {
    setTheme(theme: Theme): void;
    getResolvedTheme(): Theme;
    ensureComponentStyles(): void;
} = {
    prime(): void {
        const definition = getThemeDefinition(this.getResolvedTheme());
        _reconcileThemeChrome(definition);
        FFNLogger.log(MODULE_NAME, 'prime', `Theme primed: ${SettingsManager.get('theme')} -> ${this.getResolvedTheme()}`);
    },

    init(): void {
        _applyTheme(getThemeDefinition(this.getResolvedTheme()), true);
        _subscribeToSettingChanges();
        _watchSystemPreference();
        if (_isFfnHost()) {
            _watchTinyMceIframes();
        } else {
            _stopTinyMceIframeWatcher();
            _clearTinyMceIframes();
        }
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

    /**
     * Ensures FFNE component styles are present before custom UI is inserted.
     * Safe to call repeatedly; injection is idempotent.
     */
    ensureComponentStyles(): void {
        _injectComponentStyles();
    },
};

function _applyTheme(definition: IThemeDefinition, scanNativeCss: boolean): void {
    _reconcileThemeChrome(definition);
    _injectTokenStyles(definition);
    ThemeManager.ensureComponentStyles();

    if (!_isFfnHost()) {
        document.getElementById(STATIC_NATIVE_STYLE_ID)?.remove();
        document.getElementById(SCANNED_FFN_OVERRIDES_STYLE_ID)?.remove();
        _clearTinyMceIframes();
        return;
    }

    _injectStaticNativeOverrides(definition);

    if (scanNativeCss) {
        _injectScannedFfnOverrides(definition, document, SCANNED_FFN_OVERRIDES_STYLE_ID);
    } else {
        document.getElementById(SCANNED_FFN_OVERRIDES_STYLE_ID)?.remove();
    }

    _themeTinyMceIframes(definition);
}

function _reconcileThemeChrome(definition: IThemeDefinition): void {
    _applyThemeClass(definition.name);
    _applyColorScheme(definition);
}

function _injectTokenStyles(definition: IThemeDefinition, rootDocument: Document = document, styleId: string = TOKEN_STYLE_ID): void {
    injectStyleOnce(styleId, [
        buildTokenCss(definition.tokens as Record<string, string>),
        _buildBootstrapCss(definition),
    ].join('\n\n'), rootDocument, [
        STATIC_NATIVE_STYLE_ID,
        COMPONENT_STYLE_ID,
        'ffn-enhancements-layout-styles',
        SCANNED_FFN_OVERRIDES_STYLE_ID,
    ]);
}

function _injectComponentStyles(rootDocument: Document = document): void {
    injectStyleOnce(COMPONENT_STYLE_ID, componentsStyles, rootDocument, [
        'ffn-enhancements-layout-styles',
        SCANNED_FFN_OVERRIDES_STYLE_ID,
    ]);
}

function _injectStaticNativeOverrides(
    definition: IThemeDefinition,
    rootDocument: Document = document,
    styleId: string = STATIC_NATIVE_STYLE_ID,
): void {
    if (definition.name === Theme.LIGHT || !_isFfnHost()) {
        rootDocument.getElementById(styleId)?.remove();
        return;
    }

    injectStyleOnce(styleId, _buildScopedNativeOverrides(definition), rootDocument, [
        COMPONENT_STYLE_ID,
        'ffn-enhancements-layout-styles',
        SCANNED_FFN_OVERRIDES_STYLE_ID,
    ]);
}

function _injectScannedFfnOverrides(definition: IThemeDefinition, rootDocument: Document, styleId: string): void {
    const scannerCss = CssScanner.scanAndOverride(
        definition.colorMap as Record<string, string>,
        _themeClass(definition.name),
        rootDocument,
        { excludeSelector: FFNE_UI_EXCLUDE_SELECTOR },
    );
    if (!scannerCss) {
        rootDocument.getElementById(styleId)?.remove();
        return;
    }

    injectStyleOnce(styleId, scannerCss, rootDocument);
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
    return scopeCssText(
        nativeOverrideStyles.replace(/__THEME_CLASS__/g, _themeClass(definition.name)),
        '',
        { excludeSelector: FFNE_UI_EXCLUDE_SELECTOR },
    );
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
    return themeClass(theme);
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
    if (!_isFfnHost()) {
        _stopTinyMceIframeWatcher();
        _clearTinyMceIframes();
        return;
    }

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
    if (!_isFfnHost()) {
        _clearTinyMceIframes();
        return;
    }

    document.querySelectorAll<HTMLIFrameElement>('iframe[id$="_ifr"]').forEach(frame => _themeIframe(frame, definition));
}

function _themeIframe(frame: HTMLIFrameElement, definition: IThemeDefinition): void {
    if (!_isFfnHost()) {
        _clearIframeTheme(frame);
        return;
    }

    const apply = () => {
        try {
            const frameDocument = frame.contentDocument;
            if (!frameDocument) return;

            _injectTokenStyles(definition, frameDocument, TOKEN_STYLE_ID);
            _applyFrameThemeClass(frameDocument, definition.name);
            _injectStaticNativeOverrides(definition, frameDocument, IFRAME_STATIC_OVERRIDE_STYLE_ID);
            _injectScannedFfnOverrides(definition, frameDocument, IFRAME_OVERRIDE_STYLE_ID);
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

function _clearPageThemeChrome(rootDocument: Document): void {
    const root = rootDocument.documentElement;
    Object.values(Theme).forEach(value => root.classList.remove(_themeClass(value)));
    root.style.colorScheme = '';
}

function _clearTinyMceIframes(): void {
    document.querySelectorAll<HTMLIFrameElement>('iframe[id$="_ifr"]').forEach(frame => _clearIframeTheme(frame));
}

function _clearIframeTheme(frame: HTMLIFrameElement): void {
    const clear = () => {
        try {
            const frameDocument = frame.contentDocument;
            if (!frameDocument) return;

            _clearPageThemeChrome(frameDocument);
            frameDocument.getElementById(TOKEN_STYLE_ID)?.remove();
            frameDocument.getElementById(IFRAME_STATIC_OVERRIDE_STYLE_ID)?.remove();
            frameDocument.getElementById(IFRAME_OVERRIDE_STYLE_ID)?.remove();
        } catch (e) {
            FFNLogger.log(MODULE_NAME, '_clearIframeTheme', 'Could not clear TinyMCE iframe theme:', e as object);
        }
    };

    if (frame.contentDocument?.readyState === 'complete') {
        clear();
        return;
    }

    frame.addEventListener('load', clear, { once: true });
}

function _stopTinyMceIframeWatcher(): void {
    if (!_iframeObserver) return;
    _iframeObserver.disconnect();
    _iframeObserver = null;
}

function _prefersDark(): boolean {
    return typeof window.matchMedia === 'function' && window.matchMedia(SYSTEM_QUERY).matches;
}

function _isFfnHost(): boolean {
    return FFN_HOSTS.has(window.location.hostname);
}
