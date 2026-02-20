// themes/DarkTheme.ts

import type { ITheme } from '../interfaces/ITheme';

/**
 * DarkTheme
 * * The default dark mode theme for FFN Enhancements.
 *
 * Dark mode is achieved via a hybrid filter architecture (Layers 1–3 in
 * ThemeManager.STRUCTURAL_CSS) rather than hand-authored per-selector CSS:
 *
 *   Layer 1: filter: invert(1) hue-rotate(180deg) on body.
 *            Inverts the entire page. hue-rotate(180deg) cancels the color
 *            distortion from a raw invert, yielding a natural dark palette.
 *   Layer 2: Re-invert img, canvas, video — restores media to original colors.
 *   Layer 3: Re-invert #top — preserves the green branded navigation bar exactly.
 *
 * The userCss field (Layer 4) starts empty.  Any elements the filter layers
 * don't handle perfectly can be corrected here without touching the structural
 * rules or adding new selectors to ThemeManager.
 */
export const DarkTheme: ITheme = {
    name: 'dark',

    // No Layer 4 overrides yet — the filter layers handle everything.
    userCss: '',
};
