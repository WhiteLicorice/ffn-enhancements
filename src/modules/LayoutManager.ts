// modules/LayoutManager.ts

import { Elements } from '../enums/Elements';
import { LayoutManagerDelegate } from '../delegates/LayoutManagerDelegate';
import { FFNLogger } from './FFNLogger';
import { SettingsManager } from './SettingsManager';
import fluidStyles from '../styles/fluid-mode.css?raw';

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
     * Reads the persisted `fluidMode` preference from SettingsManager (which
     * must be registered before LayoutManager in EarlyBoot so its prime()
     * has already populated the cache by the time we reach this point).
     * Safe to call before the DOM is fully parsed.
     */
    prime(): void {
        _injectFluidStyles();
        // Restore persisted preference. SettingsManager.prime() runs first
        // (guaranteed by EarlyBoot registration order), so the stored value
        // is already in cache — no async required.
        _isFluid = SettingsManager.get('fluidMode');
        _applyFluidClass(_isFluid);
    },

    /**
     * ISitewideModule Phase 2 — DOMContentLoaded.
     * Starts the full layout adjustment sequence.
     * Typically called by EarlyBoot after the DOM is ready.
     */
    init(): void {
        _log('init', 'Starting init sequence...');

        // _isFluid was already set from storage in prime().
        // Call _setFluidMode to apply DOM mutations (width overrides, etc.)
        // now that the DOM is fully available.
        _setFluidMode(_isFluid);

        // FFN lacks a viewport meta tag, which breaks zooming/reflow on many devices.
        // We inject it permanently to modernize the page behavior.
        _injectViewportMeta();

        // Cross-tab sync: apply fluidMode changes made in any other tab immediately
        // (e.g., user toggles the setting in the settings page tab).
        // SettingsManager.subscribe() fires for both local set() calls AND remote
        // GM_addValueChangeListener events, but LayoutManager.toggleFluidMode()
        // already calls _setFluidMode + SettingsManager.set() for local changes,
        // so we guard with a value check to avoid redundant DOM work.
        SettingsManager.subscribe('fluidMode', (newVal) => {
            if (newVal !== _isFluid) {
                _isFluid = newVal;
                _setFluidMode(newVal);
                _log('init', `fluidMode synced from external tab: ${newVal}`);
            }
        });
    },

    /**
     * Toggles the Full Width / Fluid Layout mode.
     * Applies the change immediately AND persists it to SettingsManager.
     * @returns The new state of the layout (true = Fluid, false = Fixed).
     */
    toggleFluidMode(): boolean {
        _isFluid = !_isFluid;

        _log('toggleFluidMode', `Toggling Fluid Mode to ${_isFluid}`);

        _setFluidMode(_isFluid);
        SettingsManager.set('fluidMode', _isFluid);

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

    const style = document.createElement('style');
    style.id = STYLE_TAG_ID;
    style.textContent = fluidStyles.replace(/__FLUID_CLASS__/g, FLUID_CLASS);
    if (document.head) {
        document.head.appendChild(style);
    } else {
        document.documentElement.appendChild(style); // shouldn't happen
    }
    _log('injectFluidStyles', 'Fluid styles injected into head.');
}