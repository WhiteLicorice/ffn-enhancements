// modules/LayoutManager.ts

import { Elements } from '../enums/Elements';
import { LayoutManagerDelegate } from '../delegates/LayoutManagerDelegate';

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
    private readonly STYLE_TAG_ID = 'ffn-enhancements-layout-styles';

    /**
     * The class name applied to the body when Fluid Mode is active.
     */
    private readonly FLUID_CLASS = 'ffn-enhancements-fluid-mode';

    /**
     * The class name applied to the HTML root during the initialization phase
     * to prevent FOUC (Flash of Unstyled Content).
     */
    private readonly CLOAK_CLASS = 'ffn-enhancements-cloak-active';

    /**
     * The Delegate used for DOM retrieval.
     */
    private delegate = LayoutManagerDelegate;

    private isFluid: boolean = true;

    constructor() {
        console.log('LayoutManager: Initialized.');
    }

    /**
     * Initializes the Layout Manager.
     * This should be called immediately at script startup.
     * CRITICAL: Ensure your UserScript header has @run-at document-start
     */
    public init(): void {
        console.log('LayoutManager: Starting init sequence...');

        // 1. Deploy the Cloak (Hide the UI immediately)
        this.injectCloakStyles();

        // 2. Perform Layout Operations (While hidden)
        this.injectViewportMeta();
        this.injectFluidStyles();

        // Apply the fluid state (adds class to body)
        this.setFluidMode(this.isFluid);

        // 3. Lift the Cloak (Reveal the UI)
        // We wait 500ms explicitly to ensure the browser has finished 
        // "painting" the new fluid layout behind the invisible curtain.
        setTimeout(() => {
            this.liftCloak();
        }, 500);
    }

    /**
     * Injects the temporary styles used to hide the page during initialization.
     */
    private injectCloakStyles(): void {
        const css = `
            /* State 1: Hidden
               We use opacity: 0 to hide, and pointer-events: none to prevent clicking.
               NOTE: We DO NOT use visibility: hidden, as it breaks CSS transitions.
            */
            html.${this.CLOAK_CLASS} {
                opacity: 0 !important;
                pointer-events: none !important;
            }

            /* State 2: Visible (Default)
               When the class is removed, the browser transitions to these values.
            */
            html {
                opacity: 1;
                /* Transition lasts 2 seconds for a slow, smooth fade-in */
                transition: opacity 2.0s ease-in-out !important;
            }
        `;

        const style = document.createElement('style');
        style.id = 'ffn-enhancements-cloak-styles';
        style.textContent = css;

        // Append to head if available, otherwise root (safety for document-start)
        (document.head || document.documentElement).appendChild(style);

        // Apply class immediately to root
        document.documentElement.classList.add(this.CLOAK_CLASS);

        // Safety Valve: Force reveal after 3.0s in case of execution hang
        setTimeout(() => this.liftCloak(), 3000);
    }

    /**
     * Removes the cloak class, allowing the page to fade in.
     */
    private liftCloak(): void {
        const root = document.documentElement;

        if (root.classList.contains(this.CLOAK_CLASS)) {

            // MAGIC TRICK: Force a browser Reflow/Repaint.
            // By reading the offsetHeight, we force the browser to calculate 
            // the page structure *before* we start the transition. 
            // This prevents the "snap" effect.
            void document.body?.offsetHeight;

            root.classList.remove(this.CLOAK_CLASS);
            console.log('LayoutManager: Cloak lifted. Fading in...');
        }
    }

    /**
     * Toggles the Full Width / Fluid Layout mode.
     * @returns The new state of the layout (true = Fluid, false = Fixed).
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
     * @param enable - True to enable fluid mode, False to revert to default.
     */
    private setFluidMode(enable: boolean): void {
        const body = document.body;

        // Ensure styles exist before we try to use them
        this.injectFluidStyles();

        // Remove the manual width control element if it exists
        this.removeWidthControl();

        if (body) {
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

            // Use prepend to ensure it applies as early as possible
            if (document.head) {
                document.head.prepend(meta);
            } else {
                const head = document.getElementsByTagName('head')[0];
                if (head) head.prepend(meta);
            }
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
            /* --- ffn-enhancements Fluid Mode Overrides --- */

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

        // Critical: Append to documentElement if Head is not yet available
        // to ensure styles are registered before Body parsing begins.
        (document.head || document.documentElement).appendChild(style);

        console.log('LayoutManager: Fluid styles injected into head.');
    }
}