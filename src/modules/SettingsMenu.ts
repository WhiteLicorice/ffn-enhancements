// modules/SettingsMenu.ts

import { GM_registerMenuCommand, GM_unregisterMenuCommand } from '$';
import { SettingsManager } from './SettingsManager';
import { DocDownloadFormat } from '../enums/DocDownloadFormat';
import { LayoutManager } from './LayoutManager';
import { FFNLogger } from './FFNLogger';
import { ISitewideModule } from '../interfaces/ISiteWideModule';

// ─── Internal State ───────────────────────────────────────────────────────────

const MODULE_NAME = 'SettingsMenu';

/**
 * Tracks the registered Tampermonkey menu command IDs so we can unregister
 * and re-register them with updated labels when settings change.
 *
 * A value of `null` means the command has not been registered yet.
 */
// GM_registerMenuCommand returns `string | number` depending on the TM version.
let _formatCmdId: string | number | null = null;
let _fluidCmdId: string | number | null = null;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * SettingsMenu
 * Provides the Tampermonkey settings menu for all user-configurable preferences.
 *
 * Each setting is exposed as a `GM_registerMenuCommand` entry. Clicking a
 * menu item either toggles the setting immediately or presents a prompt.
 * After a change, the command is re-registered with an updated label so the
 * current value is always visible in the menu.
 *
 * **Execution model:**
 * - Phase 1 (`prime`): Registers all menu commands. This runs AFTER
 *   `SettingsManager.prime()` (guaranteed by EarlyBoot registration order),
 *   so menu labels already reflect the stored values, not just defaults.
 * - Phase 2 (`init`): No-op. Menu commands are already live.
 *
 * **To add a new setting to the menu:**
 *   1. Add the field to `FFNSettings` in SettingsManager.ts.
 *   2. Add a module-level `_xxxCmdId` tracker here.
 *   3. Write a `_registerXxx()` helper and call it from `_registerAll()`.
 *
 * **GOTCHA:** `GM_registerMenuCommand` labels are static once registered.
 * To show the current value (e.g., "Format: Markdown"), you must call
 * `GM_unregisterMenuCommand` first, then re-register with the new label.
 *
 * **GOTCHA:** `GM_unregisterMenuCommand` requires Tampermonkey ≥ 4.x.
 * On older runners the unregister call is a no-op (or throws); functionality
 * is unaffected but the label will not update until page reload.
 */
export const SettingsMenu: ISitewideModule = {

    /**
     * ISitewideModule Phase 1 — document-start.
     * Registers all menu commands. Settings are guaranteed to be loaded
     * (SettingsManager.prime() runs first per EarlyBoot registration order).
     */
    prime(): void {
        _registerAll();
    },

    /**
     * ISitewideModule Phase 2 — DOMContentLoaded. No-op.
     * Menu commands are already registered from prime().
     */
    init(): void { /* no-op */ },
};

// ─── Private Helpers ─────────────────────────────────────────────────────────

function _log(fn: string, msg: string): void {
    FFNLogger.log(MODULE_NAME, fn, msg);
}

/**
 * Master registration call. Add new `_registerXxx()` calls here when
 * new settings are introduced.
 */
function _registerAll(): void {
    _registerDocDownloadFormat();
    _registerFluidMode();
}

/**
 * Registers (or re-registers) the "Doc Download Format" toggle command.
 * Cycles between Markdown and HTML on each click.
 * The label always shows the current active format.
 */
function _registerDocDownloadFormat(): void {
    if (_formatCmdId !== null) {
        try {
            GM_unregisterMenuCommand(_formatCmdId);
        } catch {
            // Some older TM builds throw if the ID is stale — safe to ignore.
        }
        _formatCmdId = null;
    }

    const current = SettingsManager.get('docDownloadFormat');
    const humanLabel = current === DocDownloadFormat.MARKDOWN ? 'Markdown (.md)' : 'HTML (.html)';
    const label = `📄 Doc Download Format: ${humanLabel}`;

    _formatCmdId = GM_registerMenuCommand(label, () => {
        const next = current === DocDownloadFormat.MARKDOWN
            ? DocDownloadFormat.HTML
            : DocDownloadFormat.MARKDOWN;
        SettingsManager.set('docDownloadFormat', next);
        _log('docDownloadFormat', `Changed to: ${next}`);
        // Re-register so the menu label reflects the new value immediately.
        _registerDocDownloadFormat();
    });
}

/**
 * Registers (or re-registers) the "Fluid Mode" toggle command.
 * Applies the layout change immediately (no page reload needed).
 */
function _registerFluidMode(): void {
    if (_fluidCmdId !== null) {
        try {
            GM_unregisterMenuCommand(_fluidCmdId);
        } catch {
            // Safe to ignore on older TM builds.
        }
        _fluidCmdId = null;
    }

    const current = SettingsManager.get('fluidMode');
    const label = `📐 Fluid Layout: ${current ? 'On' : 'Off'}`;

    _fluidCmdId = GM_registerMenuCommand(label, () => {
        // LayoutManager.toggleFluidMode() both applies the change and persists it
        // via SettingsManager.set() — we do not need to call SettingsManager.set() here.
        const next = LayoutManager.toggleFluidMode();
        _log('fluidMode', `Toggled to: ${next}`);
        // Re-register with the updated label.
        _registerFluidMode();
    });
}
