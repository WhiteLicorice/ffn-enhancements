// modules/LayoutManager.ts

import { Elements } from '../enums/Elements';
import { LayoutManagerDelegate } from '../delegates/LayoutManagerDelegate';
import { Core } from './Core';

/**
 * LayoutManager
 * * Orchestrates the layout adjustments for the application.
 * * ANTI-FOUC STRATEGY (v3):
 * 1. Immediate Execution: We do not wait for DOMContentLoaded.
 * 2. Headless Injection: We inject styles into document.documentElement (<html>) 
 * because document.head likely doesn't exist yet at document-start.
 * 3. The "Curtain": We use CSS to hide the content immediately if it doesn't match
 * our fluid state, ensuring the user never sees the "snap".
 */
export class LayoutManager {

    private readonly STYLE_TAG_ID = 'fichub-layout-styles';
    private readonly FLUID_CLASS = 'fichub-fluid-mode';
    private delegate = LayoutManagerDelegate;
    private isFluid: boolean = true;

    constructor() {
        // OPTIONAL: You can even trigger init here if your Core doesn't instantiate 
        // LayoutManager until it's actually needed. 
        // this.init(); 
    }

    /**
     * Initializes the Layout Manager.
     * MUST BE CALLED IMMEDIATELY (Synchronously) in your main entry point.
     * Do NOT wrap this in onDomReady.
     */
    public init(): void {
        console.log('LayoutManager: Init (Synchronous Phase)');

        // 1. Inject CSS immediately into <HTML> (Safety fallback if Head is missing)
        this.injectFluidStyles();

        // 2. Apply the Class immediately to <HTML>
        // This ensures the CSS selector matches before the <body> is parsed.
        this.setFluidMode(this.isFluid);

        // 3. Inject Meta (Optional, less critical for FOUC)
        this.injectViewportMeta();

        // 4. Set up cleanup (removes the button from DOM later)
        this.initCleanup();
    }

    /**
     * Toggles the Full Width / Fluid Layout mode.
     */
    public toggleFluidMode(): boolean {
        this.isFluid = !this.isFluid;
        this.setFluidMode(this.isFluid);
        return this.isFluid;
    }

    /**
     * Applies the class to document.documentElement.
     */
    private setFluidMode(enable: boolean): void {
        const root = document.documentElement;
        if (enable) {
            root.classList.add(this.FLUID_CLASS);
        } else {
            root.classList.remove(this.FLUID_CLASS);
        }
    }

    /**
     * Injects the necessary CSS.
     * CRITICAL CHANGE: Appends to documentElement if head is missing.
     */
    private injectFluidStyles(): void {
        if (document.getElementById(this.STYLE_TAG_ID)) return;

        const css = `
            /* --- Fichub Fluid Mode Overrides --- */

            /* 1. THE "CURTAIN" (Anti-FOUC)
               Hide the width control immediately.
               We use display:none !important to ensure it never renders 
               even for a single frame.
            */
            html.${this.FLUID_CLASS} .icon-align-justify,
            html.${this.FLUID_CLASS} [onclick*="set_width"],
            html.${this.FLUID_CLASS} .story-width-control-target { 
                display: none !important; 
                opacity: 0 !important;
                visibility: hidden !important;
            }

            /* 2. ROOT & WRAPPER Overrides */
            html.${this.FLUID_CLASS} body {
                min-width: 0 !important;
                width: 100% !important;
                overflow-x: hidden !important;
            }

            /* Force the wrapper to be 100% immediately. 
               The browser paints this BEFORE calculating the inner content.
            */
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

            /* 3. STORY TEXT Overrides */
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

            /* 4. NAVIGATION Overrides */
            html.${this.FLUID_CLASS} body .menulink,
            html.${this.FLUID_CLASS} body #zmenu,
            html.${this.FLUID_CLASS} body #zmenu table {
                width: 100% !important;
                max-width: 100% !important;
                box-sizing: border-box !important;
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

        // CRITICAL: If Head doesn't exist (document-start), inject into HTML (root).
        // This guarantees the CSS is present before Body is parsed.
        (document.head || document.documentElement).appendChild(style);

        console.log('LayoutManager: Fluid styles injected (Headless Mode safe).');
    }

    /**
     * Uses onDomReady just to clean up the DOM tree.
     * Visuals are already handled by CSS.
     */
    private initCleanup(): void {
        Core.onDomReady(() => {
            // Remove the element cleanly once DOM is settled
            const widthControl = this.delegate.getElement(Elements.STORY_WIDTH_CONTROL);
            if (widthControl) widthControl.remove();
        });
    }

    private injectViewportMeta(): void {
        Core.onDomReady(() => {
            if (!document.querySelector('meta[name="viewport"]')) {
                const meta = document.createElement('meta');
                meta.name = 'viewport';
                meta.content = 'width=device-width, initial-scale=1.0';
                document.head.appendChild(meta);
            }
        });
    }
}