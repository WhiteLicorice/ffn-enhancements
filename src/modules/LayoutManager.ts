// modules/LayoutManager.ts

import { Elements } from '../enums/Elements';
import { LayoutManagerDelegate } from '../delegates/LayoutManagerDelegate';
import { FFNLogger } from './FFNLogger';

// ─── Module-level Constants ────────────────────────────────────────────────────

/**
 * Module name used for logging.
 */
const MODULE_NAME = 'LayoutManager';

/**
 * The ID used for the injected style tag to prevent duplicates.
 */
const STYLE_TAG_ID = 'ffn-enhancements-layout-styles';

/**
 * The class name applied to the body when Fluid Mode is active.
 */
const FLUID_CLASS = 'ffn-enhancements-fluid-mode';

// ─── Module-level State ────────────────────────────────────────────────────────

/**
 * Internal state tracking for Fluid Mode.
 * Defaults to true (Enabled).
 */
let _isFluid = true;

/**
 * Observer used to apply Fluid Mode class as soon as <body> becomes available
 * when running at document-start.
 */
let _bodyObserver: MutationObserver | null = null;

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * LayoutManager
 * * Orchestrates the layout adjustments for the application.
 * Controls the "Fluid Mode" (Full Width) feature which removes
 * the fixed-width borders on FFN stories to emulate an AO3-style reading experience.
 */
export const LayoutManager = {

    /**
     * ISitewideModule Phase 1 — document-start.
     * Primes Fluid Mode styles before the first paint to prevent FOUC.
     * Injects the stylesheet and arms the body class observer.
     * Safe to call before the DOM is fully parsed.
     */
    prime(): void {
        _injectFluidStyles();
        _applyFluidClass(_isFluid);
    },

    /**
     * ISitewideModule Phase 2 — DOMContentLoaded.
     * Starts the full layout adjustment sequence.
     * Typically called by EarlyBoot after the DOM is ready.
     */
    init(): void {
        _log('init', 'Starting init sequence...');

        // In the future, we will check StorageManager here to restore preference.
        // For now, we default to true (Fluid/AO3-style Layout).
        _setFluidMode(_isFluid);

        // FFN lacks a viewport meta tag, which breaks zooming/reflow on many devices.
        // We inject it permanently to modernize the page behavior.
        _injectViewportMeta();
    },

    /**
     * Toggles the Full Width / Fluid Layout mode.
     * @returns The new state of the layout (true = Fluid, false = Fixed).
     */
    toggleFluidMode(): boolean {
        _isFluid = !_isFluid;

        _log('toggleFluidMode', `Toggling Fluid Mode to ${_isFluid}`);

        _setFluidMode(_isFluid);

        // TODO: Save this preference to StorageManager

        return _isFluid;
    },

    /**
     * Explicitly enables Fluid Mode.
     * Does nothing if already enabled.
     */
    enableFluidMode(): void {
        if (!_isFluid) {
            _isFluid = true;
            _setFluidMode(true);
        }
    },

    /**
     * Explicitly disables Fluid Mode (reverts to default FFN).
     * Does nothing if already disabled.
     */
    disableFluidMode(): void {
        if (_isFluid) {
            _isFluid = false;
            _setFluidMode(false);
        }
    },

    /**
     * Returns the current Fluid Mode state.
     * @remarks Call as `isFluid()`, not `isFluid`. The internal `_isFluid` flag
     * should never be accessed or set as a property.
     */
    isFluid(): boolean {
        return _isFluid;
    }

}

// ─── Internal Helpers ──────────────────────────────────────────────────────────

/**
 * Internal helper to format logs consistently via the shared Logger.
 * @param funcName - The name of the function calling the log.
 * @param msg - The message to log.
 */
function _log(funcName: string, msg: string): void {
    FFNLogger.log(MODULE_NAME, funcName, msg);
}

/**
 * Toggles the fluid mode class on the document body and ensures styles are injected.
 * @param enable - True to enable fluid mode, False to revert to default.
 */
function _setFluidMode(enable: boolean): void {
    // Ensure CSS styles exist before we try to use them
    _injectFluidStyles();
    _applyFluidClass(enable);

    // Remove the manual width control element if it exists (conflicts with our CSS)
    _removeWidthControl();
}

/**
 * Applies or removes the Fluid Mode class on body, with a body observer fallback
 * for early document-start execution.
 * @param enable - True to add class, False to remove class.
 */
function _applyFluidClass(enable: boolean): void {
    const body = document.body;

    if (_bodyObserver) {
        _bodyObserver.disconnect();
        _bodyObserver = null;
    }

    if (body) {
        if (enable) {
            if (!body.classList.contains(FLUID_CLASS)) {
                body.classList.add(FLUID_CLASS);
                _log('applyFluidClass', 'Fluid mode enabled (Class added).');
            }
        } else if (body.classList.contains(FLUID_CLASS)) {
            body.classList.remove(FLUID_CLASS);
            _log('applyFluidClass', 'Fluid mode disabled (Class removed).');
        }
        return;
    }

    if (enable) {
        _bodyObserver = new MutationObserver((mutations) => {
            let bodyAdded = false;
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node === document.body) {
                        bodyAdded = true;
                        break;
                    }
                }

                if (bodyAdded) {
                    break;
                }
            }

            if (!bodyAdded) {
                return;
            }

            const currentBody = document.body;
            if (!currentBody) {
                return;
            }

            if (!currentBody.classList.contains(FLUID_CLASS)) {
                currentBody.classList.add(FLUID_CLASS);
                _log('applyFluidClass', 'Fluid mode enabled on body creation.');
            }

            if (_bodyObserver) {
                _bodyObserver.disconnect();
                _bodyObserver = null;
            }
        });

        _bodyObserver.observe(document.documentElement, { childList: true });
    }
}

/**
 * Removes the native FFN width toggle button/icon from the DOM.
 * We remove this because Fluid Mode supersedes manual margin controls.
 */
function _removeWidthControl(): void {
    const widthControl = LayoutManagerDelegate.getElement(Elements.STORY_WIDTH_CONTROL);
    if (widthControl) {
        widthControl.remove();
        _log('removeWidthControl', 'Native width control element removed.');
    }
}

/**
 * Injects a standard Viewport Meta tag.
 * FFN is missing this, which causes browsers to assume a fixed desktop width
 * (usually ~980px) regardless of zoom level or device width.
 */
function _injectViewportMeta(): void {
    if (!document.querySelector('meta[name="viewport"]')) {
        const meta = document.createElement('meta');
        meta.name = 'viewport';
        meta.content = 'width=device-width, initial-scale=1.0';
        if (document.head) {
            document.head.appendChild(meta);
        } else {
            document.documentElement.appendChild(meta); // shouldn't happen
        }
        _log('injectViewportMeta', 'Injected missing Viewport Meta tag.');
    }
}

/**
 * Injects the necessary CSS to override FFN's fixed width settings.
 * This needs to be aggressive (!important) because FFN uses inline styles
 * and document.write() scripts to set widths.
 */
function _injectFluidStyles(): void {
    if (document.getElementById(STYLE_TAG_ID)) {
        return; // Styles already injected
    }

    const css = `
        /* --- FFN Enhancements: Fluid Mode Overrides --- */
        /* 0. ROOT LEVEL FIXES
           FFN puts a min-width on body (approx 1000px). 
           This kills text wrapping when zooming in (as viewport shrinks below 1000px).
        */
        body.${FLUID_CLASS} {
            min-width: 0 !important;
            width: 100% !important;
            overflow-x: hidden !important; /* Prevent horizontal scroll triggers */
        }

        /* 1. Override the main wrapper width.
           FFN usually sets this to 1000px-1250px via inline style.
        */
        body.${FLUID_CLASS} #content_wrapper {
            width: 100% !important;
            max-width: 100% !important;
            min-width: 0 !important;
            box-sizing: border-box !important;
            border: none !important;
            margin: 0 !important;
            padding: 0 !important;
        }

        /* 2. Override the inner wrapper padding.
           Gives the text a little breathing room from the edge of the screen.
        */
        body.${FLUID_CLASS} #content_wrapper_inner {
            padding: 0 15px !important;
            box-sizing: border-box !important;
            min-width: 0 !important;
        }

        /* 3. Override the Story Text container.
           FFN injects ".storytext { width: 75% ... }" via JS.
           We force this to fill the available space.
           1. Changed width from 100% to auto to prevent overflow at high zoom.
           2. Reset text-align to override 'align=center' attribute on parent.
           3. Added float: none to prevent side-stacking issues.
        */
        body.${FLUID_CLASS} .storytext,
        body.${FLUID_CLASS} #storytext, 
        body.${FLUID_CLASS} #storytextp {
            width: auto !important;
            max-width: 100% !important;
            min-width: 0 !important;
            
            float: none !important;
            display: block !important;
            text-align: left !important;
            
            box-sizing: border-box !important;
            padding: 0 !important;
            margin: 0 !important;
        }

        /* 4. Fix Top Navigation and Menu Bars.
           FFN uses .maxwidth and inline styles (width: 975px) on #top .menulink and #zmenu.
           We need to force them to 100% width and add padding so content touches the edges comfortably.
        */
        body.${FLUID_CLASS} .menulink {
            width: 100% !important;
            max-width: 100% !important;
            padding-left: 15px !important;
            padding-right: 15px !important;
            box-sizing: border-box !important;
        }

        body.${FLUID_CLASS} #zmenu {
            width: 100% !important;
            max-width: 100% !important;
            padding-left: 15px !important;
            padding-right: 15px !important;
            box-sizing: border-box !important;
        }

        /* The internal table for the menu also needs to expand */
        body.${FLUID_CLASS} #zmenu table {
            width: 100% !important;
            max-width: 100% !important;
        }

        /* 5. Generic .maxwidth override.
           FFN uses this helper class to center content. We disable it for fluid mode.
        */
        body.${FLUID_CLASS} .maxwidth {
            width: 100% !important;
            max-width: 100% !important;
        }

        /*
           6. Ensure Top Navigation Container expands.
        */
        body.${FLUID_CLASS} .z-top-container {
            max-width: 100% !important;
            width: 100% !important;
            min-width: 0 !important;
        }

        /* 7. Fix Review Section centering.
           FFN uses a table layout with a huge left spacer (width=336) to position the review box.
           We remove this spacer and center the actual review container.
        */
        /* Hide the spacer cells */
        body.${FLUID_CLASS} #review table td[width="336"],
        body.${FLUID_CLASS} #review table td[width="10"] {
            display: none !important;
        }

        /* Make the content cell behave like a block and full width */
        body.${FLUID_CLASS} #review table td {
            display: block !important;
            width: 100% !important;
            text-align: center !important; /* Helps center inline-block children */
        }

        /* Target the inner div that holds the inputs. It has a max-width inline style. */
        body.${FLUID_CLASS} #review table td > div {
            margin: 0 auto !important; /* Centers the block element */
            text-align: left !important; /* Reset text alignment for the form content */
        }
    `;

    const style = document.createElement('style');
    style.id = STYLE_TAG_ID;
    style.textContent = css;
    if (document.head) {
        document.head.appendChild(style);
    } else {
        document.documentElement.appendChild(style); // shouldn't happen
    }
    _log('injectFluidStyles', 'Fluid styles injected into head.');
}