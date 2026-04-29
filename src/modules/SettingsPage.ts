// modules/SettingsPage.ts

import { SettingsManager, FFNSettings } from './SettingsManager';
import { DocDownloadFormat } from '../enums/DocDownloadFormat';
import { FFNLogger } from './FFNLogger';

// ─── Constants ────────────────────────────────────────────────────────────────

const MODULE_NAME = 'SettingsPage';
const PAGE_ID = 'ffne-settings-page';
const STYLES_ID = 'ffne-settings-styles';

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

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * SettingsPage
 * Renders the full-page settings UI when the script detects `?ffne_settings=1`
 * in the current URL. The settings page is opened by SettingsMenu via
 * `GM_openInTab('https://www.fanfiction.net/?ffne_settings=1')`.
 *
 * Because the page is hosted on `fanfiction.net`, it inherits FFN's layout
 * shell (header, navigation, footer) for a fully native appearance. Only
 * `#content_wrapper_inner` is replaced with our settings UI.
 *
 * **Settings are saved immediately on change** (no "Save" button). The flash
 * indicator ("✓") provides visual feedback per row.
 *
 * **Cross-tab sync:** `SettingsManager.subscribe()` fires via
 * `GM_addValueChangeListener` when another open FFN tab changes a value. The
 * UI controls update reactively without requiring a page reload.
 *
 * **Sections:**
 * - Appearance: fluidMode
 * - Document Export: docDownloadFormat
 * - Reader: scrollStep
 * - Advanced (collapsible): fetch timeouts, retries, bulk delays
 *
 * **To add a new setting to this page:**
 * 1. Add the field/default/loader to `SettingsManager.ts` (see checklist there).
 * 2. If numeric, add the key to `NUMERIC_KEYS` above.
 * 3. Add a `_buildXxxRow(...)` call in `_buildHTML()` under the appropriate section.
 * 4. Add a `SettingsManager.subscribe(key, ...)` call in `_registerSubscriptions()`.
 *    For numeric keys this happens automatically via `NUMERIC_KEYS`.
 *
 * **GOTCHA:** SettingsPage.render() must be called AFTER `DOMContentLoaded` because
 * it accesses `#content_wrapper_inner`. The routing guard in `main.ts` handles this
 * by calling `render()` inside the `bootstrap()` function.
 *
 * **GOTCHA:** LayoutManager.init() runs before SettingsPage.render() (via EarlyBoot),
 * which is intentional — we want fluid mode applied to the settings page itself.
 *
 * **GOTCHA:** Do NOT call page-specific modules (DocManager, DocEditor, StoryReader,
 * StoryDownloader) when on the settings page. The routing guard in main.ts returns
 * early after calling render() to prevent this.
 */
export const SettingsPage = {

    /**
     * Renders the settings UI into `#content_wrapper_inner`.
     * Must be called after DOMContentLoaded (i.e., inside `bootstrap()` in main.ts).
     */
    render(): void {
        const log = (fn: string, msg: string) => FFNLogger.log(MODULE_NAME, fn, msg);

        const container = document.getElementById('content_wrapper_inner');
        if (!container) {
            log('render', '#content_wrapper_inner not found — aborting settings page render.');
            return;
        }

        log('render', 'Rendering settings page.');

        _injectStyles();
        container.innerHTML = _buildHTML();
        _wireHandlers(container, log);
        _registerSubscriptions(container);

        document.title = 'FFN Enhancements — Settings';
        log('render', 'Settings page rendered successfully.');
    },
};

// ─── CSS Injection ────────────────────────────────────────────────────────────

function _injectStyles(): void {
    if (document.getElementById(STYLES_ID)) return;

    const style = document.createElement('style');
    style.id = STYLES_ID;
    style.textContent = `
        /* ─── FFN Enhancements: Settings Page ─── */

        #${PAGE_ID} {
            font-family: Verdana, Arial, sans-serif;
            font-size: 13px;
            color: #333;
            padding: 16px 0 32px;
        }

        /* ── Page header ── */
        .ffne-settings-header {
            border-bottom: 2px solid #336699;
            padding-bottom: 12px;
            margin-bottom: 20px;
        }
        .ffne-settings-header h1 {
            font-size: 18px;
            font-weight: bold;
            color: #336699;
            margin: 0 0 4px 0;
        }
        .ffne-settings-header p {
            color: #666;
            font-size: 11px;
            margin: 0;
        }

        /* ── Section card ── */
        .ffne-settings-section {
            background: #fff;
            border: 1px solid #ccc;
            border-radius: 4px;
            margin-bottom: 14px;
            overflow: hidden;
        }
        .ffne-settings-section-header {
            background: #f0f4f8;
            border-bottom: 1px solid #ccc;
            padding: 8px 14px;
            font-weight: bold;
            font-size: 13px;
            color: #336699;
        }
        /* Advanced section summary acts as section header */
        details.ffne-settings-section > summary.ffne-settings-section-header {
            cursor: pointer;
            list-style: none;
            user-select: none;
        }
        details.ffne-settings-section > summary.ffne-settings-section-header::-webkit-details-marker {
            display: none;
        }
        details.ffne-settings-section[open] > summary .ffne-adv-arrow { display: none; }
        details.ffne-settings-section:not([open]) > summary .ffne-adv-arrow-open { display: none; }

        /* ── Setting row ── */
        .ffne-settings-row {
            display: flex;
            align-items: center;
            padding: 10px 14px;
            border-bottom: 1px solid #f0f0f0;
            gap: 12px;
        }
        .ffne-settings-row:last-child { border-bottom: none; }

        .ffne-settings-row-label { flex: 1; min-width: 0; }
        .ffne-settings-row-label strong {
            display: block;
            font-size: 13px;
            margin-bottom: 2px;
        }
        .ffne-settings-row-label small {
            display: block;
            color: #777;
            font-size: 11px;
            line-height: 1.4;
        }

        .ffne-settings-row-control {
            flex-shrink: 0;
            display: flex;
            align-items: center;
            gap: 6px;
        }

        /* ── Toggle switch ── */
        .ffne-toggle {
            position: relative;
            display: inline-block;
            width: 44px;
            height: 24px;
            flex-shrink: 0;
        }
        .ffne-toggle input {
            opacity: 0;
            width: 0;
            height: 0;
            position: absolute;
        }
        .ffne-toggle-slider {
            position: absolute;
            inset: 0;
            background: #bbb;
            border-radius: 24px;
            cursor: pointer;
            transition: background 0.2s;
        }
        .ffne-toggle-slider::before {
            content: "";
            position: absolute;
            height: 18px;
            width: 18px;
            left: 3px;
            bottom: 3px;
            background: #fff;
            border-radius: 50%;
            box-shadow: 0 1px 3px rgba(0,0,0,.25);
            transition: transform 0.2s;
        }
        .ffne-toggle input:checked + .ffne-toggle-slider { background: #336699; }
        .ffne-toggle input:checked + .ffne-toggle-slider::before { transform: translateX(20px); }
        .ffne-toggle input:focus-visible + .ffne-toggle-slider {
            outline: 2px solid #336699;
            outline-offset: 2px;
        }

        /* ── Select ── */
        .ffne-select {
            padding: 4px 8px;
            border: 1px solid #ccc;
            border-radius: 3px;
            font-family: Verdana, Arial, sans-serif;
            font-size: 13px;
            background: #fff;
            cursor: pointer;
        }
        .ffne-select:focus { outline: none; border-color: #336699; box-shadow: 0 0 0 2px rgba(51,102,153,.2); }

        /* ── Number input ── */
        .ffne-number-input {
            width: 76px;
            padding: 4px 6px;
            border: 1px solid #ccc;
            border-radius: 3px;
            font-family: Verdana, Arial, sans-serif;
            font-size: 13px;
            text-align: right;
        }
        .ffne-number-input:focus { outline: none; border-color: #336699; box-shadow: 0 0 0 2px rgba(51,102,153,.2); }
        .ffne-number-input:invalid { border-color: #c00; }

        /* ── Unit label ── */
        .ffne-unit { color: #999; font-size: 11px; }

        /* ── Save flash indicator ── */
        .ffne-saved {
            color: #2a7;
            font-size: 11px;
            opacity: 0;
            transition: opacity 0.25s;
            min-width: 14px;
        }
        .ffne-saved.visible { opacity: 1; }

        /* ── Footer ── */
        .ffne-settings-footer {
            text-align: center;
            color: #888;
            font-size: 11px;
            margin-top: 20px;
            line-height: 1.8;
        }
        .ffne-settings-footer a { color: #336699; }
    `;
    document.head.appendChild(style);
}

// ─── HTML Builder ─────────────────────────────────────────────────────────────

function _buildHTML(): string {
    const s = SettingsManager;
    return `
        <div id="${PAGE_ID}">

            <div class="ffne-settings-header">
                <h1>⚙️ FFN Enhancements — Settings</h1>
                <p>Changes are saved automatically and sync to all open FanFiction.net tabs.</p>
            </div>

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
                    ],
                    s.get('docDownloadFormat')
                ),
            ])}

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

            <div class="ffne-settings-footer">
                Settings are saved automatically to Tampermonkey storage and persist across sessions.
                <br>
                <a href="https://www.fanfiction.net/">← Back to FanFiction.net</a>
            </div>

        </div>
    `;
}

// ─── Row Builders ─────────────────────────────────────────────────────────────

function _buildSection(title: string, rows: string[]): string {
    return `
        <div class="ffne-settings-section">
            <div class="ffne-settings-section-header">${title}</div>
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
    current: string
): string {
    const optHTML = options.map(o =>
        `<option value="${o.value}"${o.value === current ? ' selected' : ''}>${o.label}</option>`
    ).join('');
    return `
        <div class="ffne-settings-row">
            <div class="ffne-settings-row-label">
                <strong>${label}</strong>
                <small>${description}</small>
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

    // ── Boolean toggles ──
    container.querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-setting]').forEach(el => {
        el.addEventListener('change', () => {
            const key = el.dataset.setting!;
            if (key === 'fluidMode') {
                SettingsManager.set('fluidMode', el.checked);
                log('wireHandlers', `fluidMode = ${el.checked}`);
                _flashSaved(container, key);
            }
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
 * stays in sync when another tab changes a value via the settings page.
 *
 * Note: Subscriptions registered here are tied to this tab's page lifecycle.
 * There is no need to unsubscribe because the settings page is a full navigation.
 */
function _registerSubscriptions(container: HTMLElement): void {

    // ── Boolean ──
    SettingsManager.subscribe('fluidMode', newVal => {
        const el = container.querySelector<HTMLInputElement>('[data-setting="fluidMode"]');
        if (el) el.checked = newVal;
        _flashSaved(container, 'fluidMode');
    });

    // ── Enum ──
    SettingsManager.subscribe('docDownloadFormat', newVal => {
        const el = container.querySelector<HTMLSelectElement>('[data-setting="docDownloadFormat"]');
        if (el) el.value = newVal;
        _flashSaved(container, 'docDownloadFormat');
    });

    // ── Numeric (all handled uniformly) ──
    NUMERIC_KEYS.forEach(key => {
        SettingsManager.subscribe(key, newVal => {
            const el = container.querySelector<HTMLInputElement>(`[data-setting="${String(key)}"]`);
            if (el) el.value = String(newVal);
            _flashSaved(container, String(key));
        });
    });
}
