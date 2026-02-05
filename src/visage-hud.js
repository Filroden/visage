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
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            
            // GAP LOGIC (Horizontal)
            // We want the HUD's Right Edge to be exactly 32px to the left of the button.
            // Formula: Distance from Screen Right = (Screen Width - Button Left) + Gap
            const gap = 32;
            const rightPos = (viewportWidth - buttonRect.left) + gap;

            // ANCHOR LOGIC (Vertical)
            // If space is tight (< 500px), anchor to BOTTOM (grow up).
            // Otherwise, anchor to TOP (grow down).
            let uiPosition = { right: rightPos };
            
            const minComfortableSpace = 500; 
            const spaceBelow = viewportHeight - buttonRect.top;

            if (spaceBelow < minComfortableSpace) {
                // [CASE A] Low on screen: Anchor BOTTOM (grow upwards)
                // Logic: Align the bottom of the UI with the bottom of the button.
                // CSS 'bottom' is the distance from the viewport bottom edge.
                // We use buttonRect.bottom to capture the exact bottom edge of the button (including its 35px height).
                uiPosition.bottom = viewportHeight - buttonRect.bottom;
            } else {
                // [CASE B] High on screen: Anchor TOP (grow downwards)
                // Logic: Align the top of the UI with the top of the button.
                uiPosition.top = buttonRect.top;
            }

            // Close existing if open
            if (Visage.apps[selectorId]) {
                Visage.apps[selectorId].close();
                return;
            }

            const selectorApp = new VisageSelector({
                actorId: actor.id, 
                tokenId: token.id, 
                sceneId: sceneId,
                id: selectorId, 
                uiPosition: uiPosition // Pass our safe custom object
            });
            
            selectorApp.render(true);
        });
    }
}