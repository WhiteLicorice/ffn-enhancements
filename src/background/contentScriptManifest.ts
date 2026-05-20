export const REQUESTED_HOST_PATTERNS: readonly string[] = [
    '*://www.fanfiction.net/*',
    '*://fanfiction.net/*',
    '*://archiveofourown.org/*',
    '*://fichub.net/*',
];

export const CONTENT_SCRIPT_TAB_PATTERNS: readonly string[] = [
    '*://www.fanfiction.net/*',
    '*://fanfiction.net/*',
    '*://archiveofourown.org/*',
];

export const CONTENT_SCRIPT_CSS_FILES: readonly string[] = [
    'styles/theme-tokens-light.css',
    'styles/theme-tokens-dark.css',
    'styles/theme-tokens-sepia.css',
    'styles/theme-tokens-hc.css',
    'styles/critical-theme.css',
    'styles/fluid-mode.css',
];

export const CONTENT_SCRIPT_JS_FILES: readonly string[] = [
    'content/prelude.js',
    'content/main.js',
];
