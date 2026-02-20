// themes/DarkTheme.ts

import type { ITheme } from '../interfaces/ITheme';

/**
 * DarkTheme
 * * The default dark mode theme for FFN Enhancements.
 *
 * Dark mode is achieved via a hybrid filter architecture controlled by the
 * ITheme fields (Layers 1–3) rather than hand-authored per-selector CSS:
 *
 *   isDarkTheme: true
 *     → Layer 1: filter: invert(1) hue-rotate(180deg) on body.
 *       Inverts the entire page. hue-rotate(180deg) cancels the color
 *       distortion from a raw invert, yielding a natural dark palette.
 *
 *   preserveSelectors: ['img', 'canvas', 'video', '#top']
 *     → Layers 2-3: These elements are re-inverted to cancel the body
 *       inversion and restore their original colors:
 *       - img, canvas, video: media must always display in original colors.
 *       - #top: FFN's green branded navigation bar — never color-shifted.
 *
 *   invertSelectors: [] (empty — dark themes already invert everything via body)
 *
 * The userCss field (Layer 4) contains targeted corrections for elements the
 * filter layers don't handle perfectly.
 */
export const DarkTheme: ITheme = {
    name: 'dark',

    isDarkTheme: true,

    // Dark themes already invert the entire page via the body filter (Layer 1).
    // invertSelectors is only meaningful for non-dark themes.
    invertSelectors: [],

    // Re-invert these elements to restore their original colors against the
    // inverted-dark background.
    preserveSelectors: ['img', 'canvas', 'video', '#top'],

    // Layer 4: targeted corrections for elements the filter layers don't
    // handle perfectly. Populated in subsequent commits as issues are audited.
    userCss: '',
};
