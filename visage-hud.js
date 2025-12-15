/**
 * @file Handles the integration with the Foundry VTT Token HUD, adding the Visage button and managing data capture.
 * @module visage
 */

import { Visage } from "./visage.js";
import { VisageSelector } from "./visage-selector.js";

/**
 * A hook function that runs when the Token HUD is rendered.
 * It is responsible for:
 * 1.  **Initial Data Capture**: When a token is selected for the first time, it captures its
 *     current appearance (name, image, scale, disposition, ring settings) and saves it as the "default"
 *     visage for that specific token instance. This ensures there's a baseline to revert to.
 *     It also handles migrating data from older module versions (e.g., adding missing ring data).
 * 2.  **Adding the HUD Button**: It injects the "Change Visage" button into the token's HUD controls.
 * 3.  **Event Handling**: It attaches a click listener to the button, which opens the `VisageSelector`
 *     application, positioning it relative to the HUD button.
 *
 * @param {TokenHUD} app - The TokenHUD application instance.
 * @param {jQuery} html - The jQuery object representing the HUD's HTML.
 * @param {object} data - The data provided to the HUD template.
 * @returns {Promise<void>}
 */
export async function handleTokenHUD(app, html, data) {
    if (html.querySelector('.visage-button')) return;

    const token = app.object; 
    if (!token?.actor?.isOwner) return; 

    const actor = token.actor;
    const ns = Visage.DATA_NAMESPACE;
    
    const sceneId = token.document.parent.id;
    if (!sceneId) return; 

    // --- Automatic Default Data Capture ---
    const tokenFlags = actor.flags?.[ns]?.[token.id];
    
    // Case 1: No defaults exist at all (e.g., a newly placed token).
    // Capture the token's current state as its default visage.
    if (!tokenFlags?.defaults) {
        const updates = {};
        const sourceData = token.document.toObject();
        
        updates[`flags.${ns}.${token.id}.defaults`] = {
            name: token.document.name,
            token: token.document.texture.src,
            scale: token.document.texture.scaleX ?? 1.0,
            disposition: token.document.disposition ?? 0,
            ring: sourceData.ring,
            width: token.document.width ?? 1,
            height: token.document.height ?? 1
        };
        updates[`flags.${ns}.${token.id}.currentFormKey`] = 'default';
        // Use a timeout to ensure the update doesn't conflict with other operations.
        setTimeout(() => actor.update(updates), 0);
    } 
    // Case 2: Defaults exist, but are missing ring data (from a pre-v1.3.0 token).
    // Update the defaults to include the current ring configuration.
    else if (tokenFlags.defaults.ring === undefined) {
        const updates = {};
        const sourceData = token.document.toObject();
        
        if (tokenFlags.defaults.ring === undefined) {
            updates[`flags.${ns}.${token.id}.defaults.ring`] = sourceData.ring;
        }

        if (tokenFlags.defaults.width === undefined) {
            updates[`flags.${ns}.${token.id}.defaults.width`] = token.document.width ?? 1;
            updates[`flags.${ns}.${token.id}.defaults.height`] = token.document.height ?? 1;
        }
        
        setTimeout(() => actor.update(updates), 0);
    }

    // --- Add the HUD Button ---
    const title = game.i18n.localize("VISAGE.HUD.ChangeVisage");

    const buttonHtml = `
        <div class="control-icon visage-button" title="${title}">
            <img src="modules/visage/icons/switch_account.svg" alt="${title}" class="visage-icon">
        </div>
    `;
    
    const colLeft = html.querySelector(".col.left");
    if (!colLeft) return;

    colLeft.insertAdjacentHTML('beforeend', buttonHtml);
    const button = colLeft.querySelector('.visage-button');

    if (button) {
        button.addEventListener("click", () => {
            const actorId = actor.id;
            const selectorId = `visage-selector-${actorId}-${token.id}`; 

            // If the selector for this token is already open, close it.
            if (Visage.apps[selectorId]) {
                Visage.apps[selectorId].close();
                return; 
            }

            const buttonRect = button.getBoundingClientRect();
            const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
            const selectorWidth = 14 * rootFontSize; 
            const gap = 16; 
            
            const top = buttonRect.top; 
            const left = buttonRect.left - selectorWidth - gap; 

            const selectorApp = new VisageSelector({
                actorId: actor.id, 
                tokenId: token.id, 
                sceneId: sceneId,
                id: selectorId, 
                position: { 
                    left: left,
                    top: top
                }
            });
            
            selectorApp.render(true);
        });
    }
}