// themes/dark.ts

import type { ITheme } from '../interfaces/ITheme';

/**
 * DarkTheme
 * * The default dark palette for FFN Enhancements.
 *
 * Remaps FFN's light palette to a comfortable dark reading environment.
 * Only color token values live here — no CSS selectors, no !important.
 * The structural CSS rules that consume these values are owned entirely
 * by ThemeManager.STRUCTURAL_CSS via CSS custom properties.
 *
 * Preserved (intentionally not remapped):
 *   - The green branded navigation bar (#top).
 *   - FFN's teal/green link accent colors.
 *   - The site logo.
 *   - All <img> and <canvas> elements.
 */
export const DarkTheme: ITheme = {
    name: 'dark',

    // Backgrounds
    bgPrimary:    '#1a1a1a',   // page background, wrappers, nav rows
    bgSecondary:  '#242424',   // cards, profile header, story text, panels
    bgInput:      '#2a2a2a',   // form controls, buttons
    bgNav:        '#2d2d2d',   // .menulink, #zmenu, .z-top-container

    // Text
    textPrimary:   '#e0e0e0',  // xcontrast_txt — primary content text
    textSecondary: '#a0a0a0',  // xgray — muted metadata, timestamps, stats
    textInput:     '#e0e0e0',  // text inside form controls

    // Borders
    borderPrimary: '#3a3a3a',  // card edges, panel dividers, form control borders
};
