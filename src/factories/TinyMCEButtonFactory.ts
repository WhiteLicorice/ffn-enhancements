// factories/TinyMCEButtonFactory.ts

/**
 * Factory responsible for creating buttons that exactly replicate the 
 * DOM structure, CSS metrics, and behavior of native TinyMCE 4 buttons.
 */
export const TinyMCEButtonFactory = {
    /**
     * Creates a fully styled TinyMCE button element with a native-style tooltip.
     * @param ariaLabel - Text for accessibility and tooltip.
     * @param htmlContent - The inner HTML (icon or text).
     * @param onClick - The click event handler.
     * @returns The constructed DOM Element ready for injection.
     */
    create: function (ariaLabel: string, htmlContent: string, onClick: (e: MouseEvent) => void): HTMLElement {
        // 1. Container: Replicates the wrapper div structure
        const container = document.createElement('div');
        container.className = 'mce-widget mce-btn';
        container.style.float = 'right';
        container.setAttribute('tabindex', '-1');
        container.setAttribute('role', 'button');
        container.setAttribute('aria-label', ariaLabel);
        container.setAttribute('aria-pressed', 'false');

        // We DO NOT set 'title' here. Setting 'title' forces the browser's 
        // default ugly tooltip. Instead, we manually render a custom tooltip 
        // on hover to match the dark TinyMCE style.
        this.attachCustomTooltip(container, ariaLabel);

        // Manually toggle the hover class to ensure the theme applies the correct gradient/border
        container.onmouseenter = (_e) => {
            container.classList.add('mce-hover');
            // Tooltip logic is handled in attachCustomTooltip
        };
        container.onmouseleave = (_e) => {
            container.classList.remove('mce-hover');
        };

        // 2. Inner Button: Presentation role only
        const button = document.createElement('button');
        button.setAttribute('role', 'presentation');
        button.type = 'button';
        button.setAttribute('tabindex', '-1');

        // CSS to match native TinyMCE button metrics EXACTLY.
        // TinyMCE 4 buttons rely on padding + line-height to define their size.
        // Standard is padding: 4px and line-height: 20px -> Total Height ~28px-30px.
        button.style.cssText = `
            background: transparent; border: 0; margin: 0; 
            padding: 4px 8px; /* Standard padding for touch targets */
            outline: none; cursor: pointer; display: block;
            line-height: 20px; /* Crucial: Defines the vertical size of the button */
        `;

        button.innerHTML = htmlContent;

        button.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            onClick(e);
        };

        container.appendChild(button);
        return container;
    },

    /**
     * Simulates the TinyMCE tooltip behavior by injecting the EXACT DOM structure
     * used by TinyMCE 4. This ensures the site's existing CSS styles the tooltip.
     */
    attachCustomTooltip: function (element: HTMLElement, text: string) {
        let tooltipEl: HTMLElement | null = null;

        element.addEventListener('mouseenter', () => {
            if (tooltipEl) return;

            // 1. Create the outer container with native classes
            // 'mce-tooltip-n' means the arrow points North (so the tooltip is below)
            tooltipEl = document.createElement('div');
            tooltipEl.className = 'mce-widget mce-tooltip mce-tooltip-n';
            tooltipEl.style.position = 'absolute';
            tooltipEl.style.zIndex = '100100'; // Higher than toolbar
            tooltipEl.style.display = 'block';

            // 2. Create the internal structure required by the theme CSS
            // <div class="mce-tooltip-arrow"></div>
            // <div class="mce-tooltip-inner">Text</div>
            tooltipEl.innerHTML = `
                <div class="mce-tooltip-arrow"></div>
                <div class="mce-tooltip-inner">${text}</div>
            `;

            document.body.appendChild(tooltipEl);

            // 3. Position Calculation
            const rect = element.getBoundingClientRect();
            const tooltipRect = tooltipEl.getBoundingClientRect();

            // Center horizontally relative to button
            const left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
            // Place below the button
            const top = rect.bottom;

            tooltipEl.style.left = `${left}px`;
            tooltipEl.style.top = `${top}px`;
        });

        const removeTooltip = () => {
            if (tooltipEl) {
                tooltipEl.remove();
                tooltipEl = null;
            }
        };

        element.addEventListener('mouseleave', removeTooltip);
        element.addEventListener('click', removeTooltip);
    }
};