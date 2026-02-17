// modules/LayoutManager.ts

import { Elements } from '../enums/Elements';
import { LayoutManagerDelegate } from '../delegates/LayoutManagerDelegate';
import { Core } from './Core';

/**
 * LayoutManager
 * Orchestrates the layout adjustments for the application.
 * * ANTI-FOUC STRATEGY:
 * 1. We inject styles immediately into the <head>.
 * 2. We apply the state class to <html> (document.documentElement), NOT <body>.
 * The <html> element is available instantly at document-start, whereas <body>
 * is not. This ensures the first paint already includes our overrides.
 * 3. We hide the native width control via CSS immediately, then remove it via
 * JS later for DOM cleanliness.
 */
export class LayoutManager {

    private readonly STYLE_TAG_ID = 'fichub-layout-styles';

    // We apply this to the HTML tag, not the BODY tag
    private readonly FLUID_CLASS = 'fichub-fluid-mode';

    private delegate = LayoutManagerDelegate;
    private isFluid: boolean = true;

    constructor() {
        console.log('LayoutManager: Initialized.');
    }

    public init(): void {
        console.log('LayoutManager: Starting init sequence...');

        // 1. Inject CSS immediately (Synchronous)
        this.injectFluidStyles();
        this.injectViewportMeta();

        // 2. Apply Class to HTML tag immediately (Synchronous)
        // This is the key to fixing FOUC. documentElement exists 
        // even if body hasn't parsed yet.
        this.setFluidMode(this.isFluid);

        // 3. Start Cleanup Observer
        // This removes the specific element from the DOM tree entirely
        // after it loads, but our CSS handles the visual hiding.
        this.initCleanupObserver();
    }

    /**
     * Toggles the Full Width / Fluid Layout mode.
     */
    public toggleFluidMode(): boolean {
        this.isFluid = !this.isFluid;
        console.log(`LayoutManager: Toggling Fluid Mode to ${this.isFluid}`);
        this.setFluidMode(this.isFluid);
        return this.isFluid;
    }

    /**
     * Applies the class to document.documentElement (<html>).
     */
    private setFluidMode(enable: boolean): void {
        const root = document.documentElement;

        if (enable) {
            if (!root.classList.contains(this.FLUID_CLASS)) {
                root.classList.add(this.FLUID_CLASS);
                console.log('LayoutManager: Fluid mode enabled (Class added to HTML).');
            }
        } else {
            if (root.classList.contains(this.FLUID_CLASS)) {
                root.classList.remove(this.FLUID_CLASS);
                console.log('LayoutManager: Fluid mode disabled (Class removed from HTML).');
            }
        }
    }

    /**
     * Observer to remove the native width control element from the DOM.
     * Note: Visuals are handled by CSS display:none, this is just for DOM hygiene.
     */
    private initCleanupObserver(): void {
        const observer = new MutationObserver((_mutations, _obs) => {
            const widthControl = this.delegate.getElement(Elements.STORY_WIDTH_CONTROL);
            if (widthControl) {
                widthControl.remove();
                // We don't disconnect immediately because FFN sometimes moves things 
                // around during load, but we can debounce or verify.
                // For safety, we'll let it run until DomReady.
            }
        });

        observer.observe(document.documentElement, { childList: true, subtree: true });

        // Stop observing once the page is definitely settled
        Core.onDomReady(() => {
            // Final check
            const widthControl = this.delegate.getElement(Elements.STORY_WIDTH_CONTROL);
            if (widthControl) widthControl.remove();

            setTimeout(() => observer.disconnect(), 2000);
        });
    }

    private injectViewportMeta(): void {
        // Only inject if not present
        if (!document.querySelector('meta[name="viewport"]')) {
            const meta = document.createElement('meta');
            meta.name = 'viewport';
            meta.content = 'width=device-width, initial-scale=1.0';
            // Use prepend to ensure it's processed early
            if (document.head) document.head.prepend(meta);
        }
    }

    private injectFluidStyles(): void {
        if (document.getElementById(this.STYLE_TAG_ID)) return;

        // Note the selectors: html.class body ...
        const css = `
            /* --- Fichub Fluid Mode Overrides --- */

            /* 1. HIDE THE NATIVE CONTROL IMMEDIATELY 
               Replace 'span.icon-align-justify' with the actual selector 
               from Elements.STORY_WIDTH_CONTROL if possible, or a known CSS selector.
               This prevents the button from flashing on screen.
            */
            html.${this.FLUID_CLASS} span.icon-align-justify,
            html.${this.FLUID_CLASS} .story-width-control-target { 
                display: none !important; 
            }

            /* 2. ROOT & WRAPPER overrides */
            html.${this.FLUID_CLASS} body {
                min-width: 0 !important;
                width: 100% !important;
                overflow-x: hidden !important;
            }

            html.${this.FLUID_CLASS} body #content_wrapper {
                width: 100% !important;
                max-width: 100% !important;
                border: none !important;
                margin: 0 !important;
                padding: 0 !important;
            }

            html.${this.FLUID_CLASS} body #content_wrapper_inner {
                padding: 0 15px !important;
            }

            /* 3. STORY TEXT overrides */
            html.${this.FLUID_CLASS} body .storytext,
            html.${this.FLUID_CLASS} body #storytext, 
            html.${this.FLUID_CLASS} body #storytextp {
                width: auto !important;
                max-width: 100% !important;
                float: none !important;
                display: block !important;
                text-align: left !important;
                padding: 0 !important;
                margin: 0 !important;
            }

            /* 4. MENUS & NAVIGATION */
            html.${this.FLUID_CLASS} body .menulink,
            html.${this.FLUID_CLASS} body #zmenu {
                width: 100% !important;
                max-width: 100% !important;
                padding-left: 15px !important;
                padding-right: 15px !important;
                box-sizing: border-box !important;
            }
            
            html.${this.FLUID_CLASS} body #zmenu table {
                width: 100% !important;
                max-width: 100% !important;
            }

            html.${this.FLUID_CLASS} body .z-top-container,
            html.${this.FLUID_CLASS} body .maxwidth {
                max-width: 100% !important;
                width: 100% !important;
            }

            /* 5. REVIEW SECTION FIXES */
            html.${this.FLUID_CLASS} body #review table td[width="336"],
            html.${this.FLUID_CLASS} body #review table td[width="10"] {
                display: none !important;
            }

            html.${this.FLUID_CLASS} body #review table td {
                display: block !important;
                width: 100% !important;
                text-align: center !important;
            }

            html.${this.FLUID_CLASS} body #review table td > div {
                margin: 0 auto !important;
                text-align: left !important;
            }
        `;

        const style = document.createElement('style');
        style.id = this.STYLE_TAG_ID;
        style.textContent = css;

        // Append to head if exists, otherwise docElement (extremely early exec case)
        (document.head || document.documentElement).appendChild(style);

        console.log('LayoutManager: Fluid styles injected.');
    }
}