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
 *     → Layer 1: filter: invert(1) hue-rotate(180deg) on html root.
 *       Inverts the entire page. hue-rotate(180deg) cancels the color
 *       distortion from a raw invert, yielding a natural dark palette from
 *       any light-mode design. Green hues are approximately preserved by the
 *       transform (invert → complement, hue-rotate(180°) → back to ~original
 *       hue), so FFN's green navigation bar remains recognisably green.
 *
 *   preserveSelectors: ['img', 'canvas', 'video']
 *     → Layers 2-3: Media elements are re-inverted to cancel the html filter
 *       and restore their original pixel colors. Cover images (.cimage) are
 *       img elements and are therefore covered by this rule.
 *
 *     WHY #top is NOT in preserveSelectors
 *     ---------------------------------------
 *     filter on a CSS box applies to the entire rendered subtree — not just
 *     the element itself.  If #top were preserved (double-inverted), every
 *     descendant (nav dropdown menus, #zmenu, etc.) would also be restored to
 *     light-mode colors, defeating dark mode for all interactive nav chrome.
 *     The html-level inversion is sufficient: green hues survive the
 *     invert(1) hue-rotate(180deg) transform approximately intact, so the
 *     nav bar remains visually green without being explicitly excluded.
 *
 *   invertSelectors: [] (empty — dark themes already invert everything via html)
 *
 * The userCss field (Layer 4) contains targeted corrections for elements the
 * filter layers don't handle perfectly.
 */
export const DarkTheme: ITheme = {
    name: 'dark',

    isDarkTheme: true,

    // Dark themes already invert the entire page via the html filter (Layer 1).
    // invertSelectors is only meaningful for non-dark themes.
    invertSelectors: [],

    // Re-invert media to restore original pixel colors after the html inversion.
    // #top is intentionally excluded — see comment above.
    preserveSelectors: ['img', 'canvas', 'video'],

    // TinyMCE 4/5 (used on FFN for the review box and document/bio editors) creates
    // editor iframes following the pattern <textareaId>_ifr — e.g. 'review_review_ifr',
    // 'bio_ifr'.  CSS filter on the parent document does not penetrate into separate
    // browsing contexts (iframe documents), so dark mode CSS must be injected directly
    // into each matching iframe's contentDocument.
    iframeSelectors: ['iframe[id$="_ifr"]'],

    // Layer 4: targeted corrections for elements the filter layers don't
    // handle perfectly.
    userCss: ``,
};
