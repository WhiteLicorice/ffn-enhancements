// interfaces/ISiteWideModule.ts

/**
 * ISitewideModule
 * * Contract for any module that requires sitewide, FOUC-safe two-phase bootstrapping.
 *
 * Phase 1 — prime()
 * Runs synchronously at document-start, before the browser has parsed any HTML.
 * Must be fast, synchronous, and self-contained.
 * Permitted operations: inject <style> tags onto document.documentElement,
 *                        read localStorage, arm MutationObservers.
 * Forbidden operations: reading document.body, document.head (not yet guaranteed),
 *                        any async calls, any cross-module DOM queries.
 *
 * Phase 2 — init()
 * Runs after DOMContentLoaded. Full initialization is permitted here:
 * read storage, reconcile with chrome.storage, wire up event handlers,
 * replace prime-phase fallback styles with the full precision theme, etc.
 */
export interface ISitewideModule {
    prime(): void;
    init(): void;
}