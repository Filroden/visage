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
 * Injects the Visage control button into the left column of the HUD.
 * @param {TokenHUD} app - The TokenHUD application instance.
 * @param {HTMLElement} html - The HTML element of the HUD.
 * @param {Object} data - The data context used to render the HUD.
 */
export async function handleTokenHUD(app, html, data) {
    // 1. Prevention & Permissions
    // Avoid duplicate buttons if the hook fires multiple times.
    if (html.querySelector('.visage-button')) return;

    const token = app.object; 
    // Only allow owners to see the Visage controls.
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
    
    // Inject into the left column (usually contains combat/attribute controls)
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
            // The HUD needs to appear floating next to the button.
            // We calculate coordinates based on the button's screen position
            // and the document's root font size to ensure it respects UI scaling.
            const buttonRect = button.getBoundingClientRect();
            const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
            
            // Hardcoded width matches CSS (14rem) to ensure alignment before rendering
            const selectorWidth = 14 * rootFontSize; 
            const gap = 16; 
            
            const top = buttonRect.top; 
            // Position to the left of the HUD
            const left = buttonRect.left - selectorWidth - gap; 

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