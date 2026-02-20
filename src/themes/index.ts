// themes/index.ts

import { DarkTheme } from './DarkTheme';
import type { ITheme } from '../interfaces/ITheme';

/**
 * THEMES
 * * Central registry mapping theme name strings to ITheme data objects.
 *
 * Adding a new theme requires exactly one step: add an entry here.
 * ThemeManager reads this registry for validation and style generation;
 * no structural changes to ThemeManager are needed.
 *
 * Example (future):
 *   import { SepiaTheme } from './sepia';
 *   sepia: SepiaTheme,
 */
export const THEMES: Readonly<Record<string, ITheme>> = {
    dark: DarkTheme,
};
