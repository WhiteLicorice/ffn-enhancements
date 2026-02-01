// factories/TinyMCEButtonFactory.ts

/**
 * Factory responsible for creating buttons that exactly replicate the
 * DOM structure, CSS metrics, and behavior of native TinyMCE 4 buttons.
 */

export const TinyMCEButtonFactory = {
    /**
     * Creates a fully styled TinyMCE button element.
     * @param ariaLabel - Text for accessibility and tooltip.
     * @param htmlContent - The inner HTML (icon or text).
     * @param onClick - The click event handler.
     * @returns The constructed DOM Element ready for injection.
     */
    create: function (ariaLabel: string, htmlContent: string, onClick: (e: MouseEvent) => void): HTMLElement {
        // 1. Container: Replicates the wrapper div structure
        // <div class="mce-widget mce-btn" tabindex="-1" role="button" aria-label="...">
        const container = document.createElement('div');
        container.className = 'mce-widget mce-btn';
        container.style.float = 'right'; // Keep positioning consistent
        container.setAttribute('tabindex', '-1');
        container.setAttribute('role', 'button');
        container.setAttribute('aria-label', ariaLabel);
        container.title = ariaLabel; // Native tooltip fallback


        // Manually toggle the hover class to ensure the theme applies the correct gradient/border
        container.onmouseenter = () => container.classList.add('mce-hover');
        container.onmouseleave = () => container.classList.remove('mce-hover');

        // 2. Inner Button: Presentation role only, just like native
        // <button role="presentation" type="button" tabindex="-1">
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
    }
};
