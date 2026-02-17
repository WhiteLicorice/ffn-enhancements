// modules/LayoutManager.ts

import { Elements } from '../enums/Elements';
import { LayoutManagerDelegate } from '../delegates/LayoutManagerDelegate';
import { Core } from './Core';

/**
 * LayoutManager
 * * Orchestrates the layout adjustments for the application.
 * Controls the "Fluid Mode" (Full Width) feature which removes
 * the fixed-width borders on FFN stories.
 */
export class LayoutManager {

    /**
     * The ID used for the injected style tag to prevent duplicates.
     */
    private readonly STYLE_TAG_ID = 'fichub-layout-styles';

    /**
     * The class name applied to the body when Fluid Mode is active.
     */
    private readonly FLUID_CLASS = 'fichub-fluid-mode';

    /**
     * The Delegate used for DOM retrieval (if specific elements are needed).
     */
    private delegate = LayoutManagerDelegate;

    private isFluid: boolean = true;

    constructor() {
        console.log('LayoutManager: Initialized.');
    }

    /**
     * Initializes the Layout Manager.
     * Typically called by the Core on page load.
     */
    public init(): void {
        console.log('LayoutManager: Starting init sequence...');

        // 1. Inject CSS & Meta immediately.
        // We do this BEFORE DomReady to ensure styles are parsed as the body renders.
        this.injectFluidStyles();
        this.injectViewportMeta();

        // 2. Wait for DOM to handle Body classes and Element manipulation
        Core.onDomReady(() => {
            // Apply the class to the body now that it exists
            this.setFluidMode(this.isFluid);

            // 3. Handle the Removal of the Width Control Button (Anti-FOUC)
            // We use the same Observer pattern as DocEditor to catch it instantly.
            this.initWidthControlObserver();
        });
    }

    /**
     * Sets up a MutationObserver to catch the FFN width control button
     * as soon as it is injected into the DOM, preventing layout jumps.
     */
    private initWidthControlObserver(): void {
        const log = Core.getLogger('LayoutManager', 'initWidthControlObserver');

        // 1. Fast Path: Check if it's already there
        const existingControl = this.delegate.getElement(Elements.STORY_WIDTH_CONTROL);
        if (existingControl) {
            log('Width Control found immediately. Removing.');
            existingControl.remove();
            return;
        }

        // 2. Observer Strategy: Wait for injection
        log('Setting up MutationObserver for Width Control...');
        const observer = new MutationObserver((_mutations, obs) => {
            const widthControl = this.delegate.getElement(Elements.STORY_WIDTH_CONTROL);
            if (widthControl) {
                log('Width Control detected via Observer. Removing.');
                widthControl.remove();
                obs.disconnect(); // Stop observing once job is done
            }
        });

        // Observe the body subtree
        observer.observe(document.body, { childList: true, subtree: true });

        // 3. Safety Timeout: Stop observing after 10s if it never loads
        setTimeout(() => {
            observer.disconnect();
        }, 10000);
    }

    /**
     * Toggles the Full Width / Fluid Layout mode.
     * * @returns The new state of the layout (true = Fluid, false = Fixed).
     */
    public toggleFluidMode(): boolean {
        this.isFluid = !this.isFluid;

        console.log(`LayoutManager: Toggling Fluid Mode to ${this.isFluid}`);

        this.setFluidMode(this.isFluid);

        // TODO: Save this preference to StorageManager

        return this.isFluid;
    }

    /**
     * Explicitly enables Fluid Mode.
     */
    public enableFluidMode(): void {
        if (!this.isFluid) {
            this.isFluid = true;
            this.setFluidMode(true);
        }
    }

    /**
     * Explicitly disables Fluid Mode (reverts to default FFN).
     */
    public disableFluidMode(): void {
        if (this.isFluid) {
            this.isFluid = false;
            this.setFluidMode(false);
        }
    }

    /**
     * Toggles the fluid mode class on the document body.
     * * @param enable - True to enable fluid mode, False to revert to default.
     */
    private setFluidMode(enable: boolean): void {
        const body = document.body;

        // Ensure styles exist before we try to use them (Just in case called outside init)
        this.injectFluidStyles();

        // Attempt to remove control if it exists right now
        this.removeWidthControl();

        if (enable) {
            if (!body.classList.contains(this.FLUID_CLASS)) {
                body.classList.add(this.FLUID_CLASS);
                console.log('LayoutManager: Fluid mode enabled (Classes added).');
            }
        } else {
            if (body.classList.contains(this.FLUID_CLASS)) {
                body.classList.remove(this.FLUID_CLASS);
                console.log('LayoutManager: Fluid mode disabled (Classes removed).');
            }
        }
    }

    /**
     * Removes the native FFN width toggle button/icon from the DOM.
     * We remove this because Fluid Mode supercedes manual margin controls.
     */
    private removeWidthControl(): void {
        const widthControl = this.delegate.getElement(Elements.STORY_WIDTH_CONTROL);
        if (widthControl) {
            widthControl.remove();
            console.log('LayoutManager: Native width control element removed.');
        }
    }

    /**
     * Injects a standard Viewport Meta tag.
     * FFN is missing this, which causes browsers to assume a fixed desktop width
     * (usually ~980px) regardless of zoom level or device width.
     */
    private injectViewportMeta(): void {
        if (!document.querySelector('meta[name="viewport"]')) {
            const meta = document.createElement('meta');
            meta.name = 'viewport';
            meta.content = 'width=device-width, initial-scale=1.0';
            document.head.appendChild(meta);
            console.log('LayoutManager: Injected missing Viewport Meta tag.');
        }
    }

    /**
     * Injects the necessary CSS to override FFN's fixed width settings.
     * This needs to be aggressive (!important) because FFN uses inline styles
     * and document.write() scripts to set widths.
     */
    private injectFluidStyles(): void {
        if (document.getElementById(this.STYLE_TAG_ID)) {
            return; // Styles already injected
        }

        const css = `
            /* --- Fichub Fluid Mode Overrides --- */

            /* 0. ROOT LEVEL FIXES
               FFN puts a min-width on body (approx 1000px). 
               This kills text wrapping when zooming in (as viewport shrinks below 1000px).
            */
            body.${this.FLUID_CLASS} {
                min-width: 0 !important;
                width: 100% !important;
                overflow-x: hidden !important; /* Prevent horizontal scroll triggers */
            }

            /* 1. Override the main wrapper width.
               FFN usually sets this to 1000px-1250px via inline style.
            */
            body.${this.FLUID_CLASS} #content_wrapper {
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
            body.${this.FLUID_CLASS} #content_wrapper_inner {
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
            body.${this.FLUID_CLASS} .storytext,
            body.${this.FLUID_CLASS} #storytext, 
            body.${this.FLUID_CLASS} #storytextp {
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
            body.${this.FLUID_CLASS} .menulink {
                width: 100% !important;
                max-width: 100% !important;
                padding-left: 15px !important;
                padding-right: 15px !important;
                box-sizing: border-box !important;
            }

            body.${this.FLUID_CLASS} #zmenu {
                width: 100% !important;
                max-width: 100% !important;
                padding-left: 15px !important;
                padding-right: 15px !important;
                box-sizing: border-box !important;
            }

            /* The internal table for the menu also needs to expand */
            body.${this.FLUID_CLASS} #zmenu table {
                width: 100% !important;
                max-width: 100% !important;
            }

            /* 5. Generic .maxwidth override.
               FFN uses this helper class to center content. We disable it for fluid mode.
            */
            body.${this.FLUID_CLASS} .maxwidth {
                width: 100% !important;
                max-width: 100% !important;
            }

            /*
               6. Ensure Top Navigation Container expands.
            */
            body.${this.FLUID_CLASS} .z-top-container {
                max-width: 100% !important;
                width: 100% !important;
                min-width: 0 !important;
            }

            /* 7. Fix Review Section centering.
               FFN uses a table layout with a huge left spacer (width=336) to position the review box.
               We remove this spacer and center the actual review container.
            */
            /* Hide the spacer cells */
            body.${this.FLUID_CLASS} #review table td[width="336"],
            body.${this.FLUID_CLASS} #review table td[width="10"] {
                display: none !important;
            }

            /* Make the content cell behave like a block and full width */
            body.${this.FLUID_CLASS} #review table td {
                display: block !important;
                width: 100% !important;
                text-align: center !important; /* Helps center inline-block children */
            }

            /* Target the inner div that holds the inputs. It has a max-width inline style. */
            body.${this.FLUID_CLASS} #review table td > div {
                margin: 0 auto !important; /* Centers the block element */
                text-align: left !important; /* Reset text alignment for the form content */
            }
        `;

        const style = document.createElement('style');
        style.id = this.STYLE_TAG_ID;
        style.textContent = css;
        document.head.appendChild(style);

        console.log('LayoutManager: Fluid styles injected into head.');
    }
}