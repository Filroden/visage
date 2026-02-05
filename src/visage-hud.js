/**
 * @file Handles the integration with the Foundry VTT Token HUD.
 * Responsible for injecting the Visage control button into the standard Token HUD
 * and managing the positioning/rendering of the transient Selector app.
 * @module visage
 */

import { Visage } from "./visage.js";
import { VisageSelector } from "./visage-selector.js";

/**
 * Hook handler for `renderTokenHUD`.
 * Injects the Visage control button into the left column of the HUD and binds the click listener.
 * @param {TokenHUD} app - The TokenHUD application instance.
 * @param {HTMLElement} html - The HTML element of the HUD.
 * @param {Object} data - The data context used to render the HUD.
 */
export async function handleTokenHUD(app, html, data) {
    // 1. Prevention & Permissions
    // Avoid duplicate buttons if the hook fires multiple times (which can happen during rapid updates).
    if (html.querySelector('.visage-button')) return;

    const token = app.object; 
    // Only allow owners to see the Visage controls to prevent players modifying tokens they don't own.
    if (!token?.actor?.isOwner) return; 

    const actor = token.actor;
    const sceneId = token.document.parent?.id;
    if (!sceneId) return; 

    // 2. Render Button
    const title = game.i18n.localize("VISAGE.Title");
    const buttonHtml = `
        <div class="control-icon visage-button" title="${title}">
            <img src="modules/visage/icons/domino_mask.svg" alt="${title}" class="visage-icon">
        </div>
    `;
    
    // Inject into the left column (standard location for combat/attribute controls)
    const colLeft = html.querySelector(".col.left");
    if (!colLeft) return;

    colLeft.insertAdjacentHTML('beforeend', buttonHtml);
    const button = colLeft.querySelector('.visage-button');

    // 3. Bind Event Listeners
    if (button) {
        button.addEventListener("click", () => {
            const selectorId = `visage-selector-${actor.id}-${token.id}`; 

            // Toggle Logic: Close if already open
            if (Visage.apps[selectorId]) {
                Visage.apps[selectorId].close();
                return; 
            }

            // --- Position Calculation ---
            const buttonRect = button.getBoundingClientRect();
            const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
            
            // Width Calculation
            const selectorWidth = 22 * rootFontSize; 
            const gap = 32; 
            const left = buttonRect.left - selectorWidth - gap; 

            // --- Height / Floor Collision Logic --- 
            let top = buttonRect.top; 
            
            // 1. Calculate the MAX height allowed by your CSS (50vh)
            //    We use 0.5 to match the '50vh' in your CSS
            const maxCssHeight = window.innerHeight * 0.5;

            // 2. Define the 'Collision Box' height
            //    It is the SMALLER of your content size (approx 550px) or the CSS limit.
            //    This ensures we don't reserve space we can't use.
            const hudMaxHeight = Math.min(550, maxCssHeight);

            const viewportHeight = window.innerHeight;
            const bottomPadding = 32;

            // 3. Check Collision: Does the HUD extend past the screen bottom?
            if (top + hudMaxHeight > viewportHeight) {
                // Shift Up: Align bottom of HUD with bottom of screen (minus padding)
                top = viewportHeight - hudMaxHeight - bottomPadding;
            }

            const selectorApp = new VisageSelector({
                actorId: actor.id, 
                tokenId: token.id, 
                sceneId: sceneId,
                id: selectorId, 
                position: { left, top }
            });
            
            selectorApp.render(true);
        });
    }
}