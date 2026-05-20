import { Theme } from '../enums/Theme';

export const THEME_CLASS_PREFIX = 'ffne-theme-';
export const RESOLVED_THEMES = [Theme.LIGHT, Theme.DARK, Theme.SEPIA, Theme.HIGH_CONTRAST] as const;

export type ResolvedTheme = (typeof RESOLVED_THEMES)[number];

export function themeClass(theme: Theme | ResolvedTheme): string {
    return `${THEME_CLASS_PREFIX}${theme}`;
}
