// modules/SettingsPage.ts

import { SettingsManager, FFNSettings } from './SettingsManager';
import { DocDownloadFormat } from '../enums/DocDownloadFormat';
import { FFNLogger } from './FFNLogger';
import modalStyles from '../styles/settings-modal.css?raw';

// ─── Constants ────────────────────────────────────────────────────────────────

const MODULE_NAME = 'SettingsPage';
const MODAL_ID = 'ffne-settings-modal';
const STYLES_ID = 'ffne-settings-styles';

/**
 * Boolean setting keys — used for the bulk checkbox wiring and subscription
 * registration. Must stay in sync with the boolean fields in `FFNSettings`.
 */
const BOOL_KEYS: (keyof FFNSettings)[] = [
    'fluidMode',
    'pasteConvertMarkdown',
    'pasteConvertHtml',
    'pasteForceIntercept',
    'ao3HtmlCompatibility',
    'appendSeparator',
];

/**
 * Numeric setting keys — used for the bulk number-input wiring and subscription
 * registration. Must stay in sync with the numeric fields in `FFNSettings`.
 */
const NUMERIC_KEYS: (keyof FFNSettings)[] = [
    'scrollStep',
    'fetchMaxRetries',
    'fetchRetryBaseMs',
    'iframeLoadTimeoutMs',
    'iframeSaveTimeoutMs',
    'bulkExportDelayMs',
    'bulkCooldownMs',
    'bulkRetryDelayMs',
];

// ─── Module state ─────────────────────────────────────────────────────────────

let _unsubscribers: (() => void)[] = [];

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * SettingsPage
 * Renders the settings UI as a modal overlay on the current page.
 * Opened by SettingsMenu when the user clicks the Tampermonkey menu command.
 *
 * Because the modal runs in the same script context as all other modules,
 * it has direct access to GM storage via SettingsManager — no cross-tab
 * communication or URL interception needed.
 *
 * **Settings are saved immediately on change** (no "Save" button). The flash
 * indicator ("✓") provides visual feedback per row.
 *
 * **Cross-tab sync:** `SettingsManager.subscribe()` fires via
 * `GM_addValueChangeListener` when another open FFN tab changes a value. The
 * UI controls update reactively. Subscriptions are cleaned up on `closeModal()`
 * to prevent accumulation across multiple open/close cycles.
 *
 * **Dismiss:** click the backdrop, press ESC, or click the × button.
 *
 * **Sections:**
 * - Appearance: fluidMode
 * - Document Export: docDownloadFormat
 * - Convert Pasted Text: pasteConvertMarkdown, pasteConvertHtml
 * - Reader: scrollStep
 * - Advanced (collapsible): fetch timeouts, retries, bulk delays
 *
 * **To add a new setting to this page:**
 * 1. Add the field/default/loader to `SettingsManager.ts` (see checklist there).
 * 2. If numeric, add the key to `NUMERIC_KEYS` above.
 * 3. Add a `_buildXxxRow(...)` call in `_buildModalHTML()` under the appropriate section.
 * 4. Add a `SettingsManager.subscribe(key, ...)` push in `_registerSubscriptions()`.
 *    For numeric keys this happens automatically via `NUMERIC_KEYS`.
 */
export const SettingsPage = {

    /**
     * Injects the settings modal into `document.body`.
     * No-ops if the modal is already open.
     * Safe to call at any point after DOMContentLoaded.
     */
    openModal(): void {
        if (document.getElementById(MODAL_ID)) return;

        const log = (fn: string, msg: string) => FFNLogger.log(MODULE_NAME, fn, msg);
        log('openModal', 'Opening settings modal.');

        _injectStyles();

        const backdrop = document.createElement('div');
        backdrop.id = MODAL_ID;
        backdrop.innerHTML = _buildModalHTML();
        document.body.appendChild(backdrop);

        _wireHandlers(backdrop, log);
        _unsubscribers = _registerSubscriptions(backdrop);

        // Close on backdrop click (outside the panel).
        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) SettingsPage.closeModal();
        });

        // ESC to close.
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') SettingsPage.closeModal();
        };
        document.addEventListener('keydown', onKeyDown);
        _unsubscribers.push(() => document.removeEventListener('keydown', onKeyDown));

        backdrop.querySelector<HTMLButtonElement>('#ffne-modal-close')
            ?.addEventListener('click', () => SettingsPage.closeModal());

        log('openModal', 'Settings modal opened.');
    },

    /**
     * Removes the settings modal and cleans up all subscriptions and listeners.
     */
    closeModal(): void {
        document.getElementById(MODAL_ID)?.remove();
        _unsubscribers.forEach(fn => fn());
        _unsubscribers = [];
    },
};

// ─── CSS Injection ────────────────────────────────────────────────────────────

function _injectStyles(): void {
    if (document.getElementById(STYLES_ID)) return;

    const style = document.createElement('style');
    style.id = STYLES_ID;
    style.textContent = modalStyles.replace(/__MODAL_ID__/g, MODAL_ID);
    document.head.appendChild(style);
}

// ─── HTML Builder ─────────────────────────────────────────────────────────────

function _buildModalHTML(): string {
    const s = SettingsManager;
    return `
        <div class="ffne-modal-panel" role="dialog" aria-modal="true" aria-labelledby="ffne-modal-title">
            <div class="ffne-modal-header">
                <h2 id="ffne-modal-title">FFN Enhancements</h2>
                <button id="ffne-modal-close" class="ffne-modal-close-btn" aria-label="Close settings">×</button>
            </div>
            <div class="ffne-modal-body">
                <p class="ffne-modal-subtitle">Changes saved automatically. Syncs to all open FanFiction.net tabs.</p>

                ${_buildSection('Appearance', [
                    _buildToggleRow(
                        'fluidMode',
                        'Fluid Layout',
                        'Removes FFN\'s fixed-width content column for a full-width reading experience, similar to AO3.',
                        s.get('fluidMode')
                    ),
                ])}

                ${_buildSection('Document Export', [
                    _buildSelectRow(
                        'docDownloadFormat',
                        'Download Format',
                        'File format for exports from Doc Manager and Doc Editor. Does not affect story-page downloads (those always use FicHub).',
                        [
                            { value: DocDownloadFormat.MARKDOWN, label: 'Markdown (.md)' },
                            { value: DocDownloadFormat.HTML,     label: 'HTML (.html)'   },
                            { value: DocDownloadFormat.DOCX,     label: 'DOCX (.docx)'   },
                        ],
                        s.get('docDownloadFormat'),
                        'Markdown does not preserve HTML-exclusive formatting such as text alignment and custom styles.'
                    ),
                    _buildToggleRow(
                        'ao3HtmlCompatibility',
                        'AO3 HTML Compatibility',
                        'Converts inline style="text-align:*" to align="*" in HTML exports. AO3\'s editor only accepts the align attribute.',
                        s.get('ao3HtmlCompatibility')
                    ),
                    _buildToggleRow(
                        'appendSeparator',
                        'Append End Separator',
                        'Adds a separator at end of each exported document (--- for Markdown, <hr> for HTML/DOCX).',
                        s.get('appendSeparator')
                    ),
                ])}

                ${_buildSection('Convert Pasted Text', [
                    _buildToggleRow(
                        'pasteConvertMarkdown',
                        'Convert Markdown',
                        'Automatically renders Markdown syntax as formatted text when pasted into the Doc Editor.',
                        s.get('pasteConvertMarkdown')
                    ),
                    _buildToggleRow(
                        'pasteConvertHtml',
                        'Convert HTML',
                        'Automatically renders HTML source code as formatted text when pasted into the Doc Editor.',
                        s.get('pasteConvertHtml')
                    ),
                    _buildToggleRow(
                        'pasteForceIntercept',
                        'Always Convert Pasted Text',
                        'By default, pastes from rich-text sources (Word, Google Docs, browser selections) are skipped so the editor can handle them natively. Enable this to force Markdown and HTML detection for all pastes regardless of source.',
                        s.get('pasteForceIntercept')
                    ),
                ], 'Paste Markdown or HTML source into the Doc Editor and have it automatically rendered as formatted rich text.')}

                ${_buildSection('Reader', [
                    _buildNumberRow(
                        'scrollStep',
                        'Keyboard Scroll Distance',
                        'Pixels scrolled per keypress when using W / S / ↑ / ↓ on story pages.',
                        s.get('scrollStep'),
                        { min: 50, max: 1000, step: 50, unit: 'px' }
                    ),
                ])}

                ${_buildAdvancedSection([
                    _buildNumberRow(
                        'fetchMaxRetries',
                        'Fetch Retry Limit',
                        'Maximum retry attempts when a document fetch fails (e.g. network error or HTTP 429).',
                        s.get('fetchMaxRetries'),
                        { min: 1, max: 10, step: 1 }
                    ),
                    _buildNumberRow(
                        'fetchRetryBaseMs',
                        'Fetch Retry Backoff Base',
                        'Base delay between retries. Actual delay = attempt × this value (e.g. 2 s, 4 s, 6 s at 2000 ms).',
                        s.get('fetchRetryBaseMs'),
                        { min: 500, max: 10000, step: 500, unit: 'ms' }
                    ),
                    _buildNumberRow(
                        'iframeLoadTimeoutMs',
                        'Iframe Load Timeout',
                        'How long to wait for the hidden iframe to reach readyState="complete" during doc refresh before giving up.',
                        s.get('iframeLoadTimeoutMs'),
                        { min: 5000, max: 120000, step: 5000, unit: 'ms' }
                    ),
                    _buildNumberRow(
                        'iframeSaveTimeoutMs',
                        'Save Confirmation Timeout',
                        'How long to wait for the save-success panel to appear after clicking Save in the hidden iframe.',
                        s.get('iframeSaveTimeoutMs'),
                        { min: 1000, max: 60000, step: 1000, unit: 'ms' }
                    ),
                    _buildNumberRow(
                        'bulkExportDelayMs',
                        'Bulk Export Delay (Pass 1)',
                        'Pause between each document request in the first pass of a bulk export or refresh. Increase if FFN rate-limits you.',
                        s.get('bulkExportDelayMs'),
                        { min: 200, max: 15000, step: 200, unit: 'ms' }
                    ),
                    _buildNumberRow(
                        'bulkCooldownMs',
                        'Bulk Export Cool-Down',
                        'Waiting period between Pass 1 and the Pass 2 retry loop during bulk operations.',
                        s.get('bulkCooldownMs'),
                        { min: 1000, max: 30000, step: 1000, unit: 'ms' }
                    ),
                    _buildNumberRow(
                        'bulkRetryDelayMs',
                        'Bulk Export Delay (Pass 2)',
                        'Pause between each document request in the retry pass of a bulk export or refresh.',
                        s.get('bulkRetryDelayMs'),
                        { min: 200, max: 15000, step: 200, unit: 'ms' }
                    ),
                ])}
            </div>
        </div>
    `;
}

// ─── Row Builders ─────────────────────────────────────────────────────────────

function _buildSection(title: string, rows: string[], subtitle?: string): string {
    return `
        <div class="ffne-settings-section">
            <div class="ffne-settings-section-header">${title}</div>
            ${subtitle ? `<p class="ffne-section-subtitle">${subtitle}</p>` : ''}
            ${rows.join('')}
        </div>
    `;
}

function _buildAdvancedSection(rows: string[]): string {
    return `
        <details class="ffne-settings-section">
            <summary class="ffne-settings-section-header">
                <span class="ffne-adv-arrow">▶</span>
                <span class="ffne-adv-arrow-open">▼</span>
                Advanced Settings
                <span style="font-weight:normal; font-size:11px; color:#888; margin-left:8px;">
                    Only adjust these if you know what you are doing.
                </span>
            </summary>
            ${rows.join('')}
        </details>
    `;
}

function _buildToggleRow(key: string, label: string, description: string, value: boolean): string {
    return `
        <div class="ffne-settings-row">
            <div class="ffne-settings-row-label">
                <strong>${label}</strong>
                <small>${description}</small>
            </div>
            <div class="ffne-settings-row-control">
                <label class="ffne-toggle" title="${label}">
                    <input type="checkbox" data-setting="${key}" ${value ? 'checked' : ''}>
                    <span class="ffne-toggle-slider"></span>
                </label>
                <span class="ffne-saved" data-saved-for="${key}">✓</span>
            </div>
        </div>
    `;
}

interface SelectOption { value: string; label: string; }

function _buildSelectRow(
    key: string,
    label: string,
    description: string,
    options: SelectOption[],
    current: string,
    warning?: string
): string {
    const optHTML = options.map(o =>
        `<option value="${o.value}"${o.value === current ? ' selected' : ''}>${o.label}</option>`
    ).join('');
    return `
        <div class="ffne-settings-row">
            <div class="ffne-settings-row-label">
                <strong>${label}</strong>
                <small>${description}</small>
                ${warning ? `<small class="ffne-warning">${warning}</small>` : ''}
            </div>
            <div class="ffne-settings-row-control">
                <select class="ffne-select" data-setting="${key}">${optHTML}</select>
                <span class="ffne-saved" data-saved-for="${key}">✓</span>
            </div>
        </div>
    `;
}

interface NumberRowOptions { min: number; max: number; step: number; unit?: string; }

function _buildNumberRow(
    key: string,
    label: string,
    description: string,
    value: number,
    opts: NumberRowOptions
): string {
    return `
        <div class="ffne-settings-row">
            <div class="ffne-settings-row-label">
                <strong>${label}</strong>
                <small>${description}</small>
            </div>
            <div class="ffne-settings-row-control">
                <input
                    type="number"
                    class="ffne-number-input"
                    data-setting="${key}"
                    value="${value}"
                    min="${opts.min}"
                    max="${opts.max}"
                    step="${opts.step}"
                >
                ${opts.unit ? `<span class="ffne-unit">${opts.unit}</span>` : ''}
                <span class="ffne-saved" data-saved-for="${key}">✓</span>
            </div>
        </div>
    `;
}

// ─── Event Handlers ───────────────────────────────────────────────────────────

function _wireHandlers(
    container: HTMLElement,
    log: (fn: string, msg: string) => void
): void {

    // ── Boolean toggles (generic — all BOOL_KEYS handled uniformly) ──
    container.querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-setting]').forEach(el => {
        el.addEventListener('change', () => {
            const key = el.dataset.setting as keyof FFNSettings;
            if (!BOOL_KEYS.includes(key)) return;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            SettingsManager.set(key, el.checked as any);
            log('wireHandlers', `${String(key)} = ${el.checked}`);
            _flashSaved(container, String(key));
        });
    });

    // ── Enum selects ──
    container.querySelectorAll<HTMLSelectElement>('select[data-setting]').forEach(el => {
        el.addEventListener('change', () => {
            const key = el.dataset.setting!;
            if (key === 'docDownloadFormat') {
                const known = Object.values(DocDownloadFormat) as string[];
                if (known.includes(el.value)) {
                    SettingsManager.set('docDownloadFormat', el.value as DocDownloadFormat);
                    log('wireHandlers', `docDownloadFormat = ${el.value}`);
                    _flashSaved(container, key);
                } else {
                    // Revert to stored value if an unknown option is somehow selected.
                    el.value = SettingsManager.get('docDownloadFormat');
                }
            }
        });
    });

    // ── Numeric inputs ──
    container.querySelectorAll<HTMLInputElement>('input[type="number"][data-setting]').forEach(el => {
        el.addEventListener('change', () => {
            const key = el.dataset.setting!;
            if (!NUMERIC_KEYS.includes(key as keyof FFNSettings)) return;

            const value = Number(el.value);
            const min = Number(el.min);
            const max = Number(el.max);

            if (!Number.isFinite(value) || value < min || value > max) {
                // Revert to the current cached value on invalid input.
                el.value = String(SettingsManager.get(key as keyof FFNSettings));
                return;
            }

            // Cast is safe: we only reach this branch for known numeric keys.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            SettingsManager.set(key as keyof FFNSettings, value as any);
            log('wireHandlers', `${key} = ${value}`);
            _flashSaved(container, key);
        });
    });
}

/**
 * Briefly shows the "✓" flash indicator next to the control for `key`.
 */
function _flashSaved(container: HTMLElement, key: string): void {
    const el = container.querySelector<HTMLElement>(`[data-saved-for="${key}"]`);
    if (!el) return;
    el.classList.add('visible');
    setTimeout(() => el.classList.remove('visible'), 1500);
}

// ─── Cross-Tab Subscriptions ──────────────────────────────────────────────────

/**
 * Registers `SettingsManager.subscribe()` callbacks for every setting so the UI
 * stays in sync when another tab changes a value.
 *
 * Returns an array of unsubscribe functions. Call them all in `closeModal()` to
 * prevent subscription accumulation across multiple open/close cycles.
 */
function _registerSubscriptions(container: HTMLElement): (() => void)[] {
    const unsubscribers: (() => void)[] = [];

    // ── Boolean (generic — all BOOL_KEYS handled uniformly) ──
    BOOL_KEYS.forEach(key => {
        unsubscribers.push(SettingsManager.subscribe(key, newVal => {
            const el = container.querySelector<HTMLInputElement>(`[data-setting="${String(key)}"]`);
            if (el) el.checked = Boolean(newVal);
            _flashSaved(container, String(key));
        }));
    });

    // ── Enum ──
    unsubscribers.push(SettingsManager.subscribe('docDownloadFormat', newVal => {
        const el = container.querySelector<HTMLSelectElement>('[data-setting="docDownloadFormat"]');
        if (el) el.value = newVal;
        _flashSaved(container, 'docDownloadFormat');
    }));

    // ── Numeric (all handled uniformly) ──
    NUMERIC_KEYS.forEach(key => {
        unsubscribers.push(SettingsManager.subscribe(key, newVal => {
            const el = container.querySelector<HTMLInputElement>(`[data-setting="${String(key)}"]`);
            if (el) el.value = String(newVal);
            _flashSaved(container, String(key));
        }));
    });

    return unsubscribers;
}
