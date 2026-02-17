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

        // In the future, we will check StorageManager here to restore preference.
        // For now, we default to true (Fluid/AO3-style Layout).
        this.setFluidMode(this.isFluid);
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

        // Ensure styles exist before we try to use them
        this.injectFluidStyles();

        // Remove the manual width control element if it exists
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

            /* 1. Override the main wrapper width.
               FFN usually sets this to 1000px-1250px via inline style.
               Added min-width: 0 and box-sizing to prevent overflow at high zoom levels (>200%).
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
               FIX: Added min-width: 0 to ensure text wraps correctly at high zoom.
            */
            body.${this.FLUID_CLASS} .storytext,
            body.${this.FLUID_CLASS} #storytext, 
            body.${this.FLUID_CLASS} #storytextp {
                width: 100% !important;
                max-width: 100% !important;
                min-width: 0 !important;
                box-sizing: border-box !important;
                padding: 0 !important;
                margin: 0 !important;
            }

            /*
               4. Ensure Top Navigation expands.
            */
            body.${this.FLUID_CLASS} .z-top-container {
                max-width: 100% !important;
                width: 100% !important;
                min-width: 0 !important;
            }
        `;

        const style = document.createElement('style');
        style.id = this.STYLE_TAG_ID;
        style.textContent = css;
        document.head.appendChild(style);

        console.log('LayoutManager: Fluid styles injected into head.');
    }
}