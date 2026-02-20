// modules/EarlyBoot.ts

import { ISitewideModule } from "../interfaces/ISiteWideModule";

/**
 * EarlyBoot
 * * Central registry and sequencer for sitewide modules that must prime before first paint.
 *
 * Owns the two-phase execution contract so that main.ts never has to manage
 * the ordering or calling convention of individual modules manually.
 * Adding a new sitewide module is exactly two lines in main.ts:
 *   1. EarlyBoot.register(MyModule);
 *   2. (nothing — prime() and init() are called automatically in sequence)
 *
 * Registration order determines execution order, which also determines CSS layering.
 * Structural modules (e.g., LayoutManager) should be registered before
 * color/theme modules (e.g., DarkModeManager) to ensure correct cascade order.
 *
 * Usage:
 *   // At the top of main.ts, before any DOM interaction:
 *   EarlyBoot.register(LayoutManager);
 *   EarlyBoot.register(DarkModeManager);  // future
 *
 *   EarlyBoot.prime();   // call immediately at document-start (synchronous)
 *   EarlyBoot.init();    // call inside DOMContentLoaded callback
 */
export const EarlyBoot = {

    /**
     * Internal list of registered sitewide modules.
     * Maintained in insertion order to preserve intentional sequencing.
     */
    _modules: [] as ISitewideModule[],

    /**
     * Registers a sitewide module for two-phase bootstrapping.
     * Must be called before EarlyBoot.prime() to take effect.
     * @param module - Any object conforming to the ISitewideModule interface.
     */
    register: function (module: ISitewideModule): void {
        this._modules.push(module);
    },

    /**
     * Phase 1 — document-start.
     * Calls prime() on all registered modules in registration order.
     * Must be invoked synchronously at the top of main.ts,
     * before the DOMContentLoaded listener is registered.
     */
    prime: function (): void {
        for (const module of this._modules) {
            module.prime();
        }
    },

    /**
     * Phase 2 — DOMContentLoaded.
     * Calls init() on all registered modules in registration order.
     * Must be invoked inside the DOMContentLoaded callback (or equivalent).
     */
    init: function (): void {
        for (const module of this._modules) {
            module.init();
        }
    },

};