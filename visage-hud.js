/**
 * @file visage-hud.js
 * @description Handles the integration with the Foundry VTT Token HUD.
 * This module injects a button into the HUD to allow users to open the Visage Selector.
 * It also handles the automatic capture of default token data when the HUD is first opened.
 * @module visage
 */

import { Visage } from "./visage.js";
import { VisageSelector } from "./visage-selector.js";

/**
 * Hook handler for 'renderTokenHUD'.
 * This function is called every time the Token HUD is rendered.
 * It injects the "Change Visage" button and sets up the default data capture logic.
 *
 * @param {TokenHUD} app - The TokenHUD application instance.
 * @param {HTMLElement} html - The HTML content of the HUD (DOM Element).
 * @param {object} data - The data object associated with the token.
 * @returns {Promise<void>}
 */
export async function handleTokenHUD(app, html, data) {
    // If button already exists, don't do anything.
    // This prevents duplicating the button on re-renders.
    if (html.querySelector('.visage-button')) return;

    // Get the Token object from the HUD
    const token = app.object; 
    // Only show the button if the current user owns the token's actor.
    if (!token?.actor?.isOwner) return; 

    const actor = token.actor;
    const ns = Visage.DATA_NAMESPACE;
    
    // Get the scene ID from the token's document.
    const sceneId = token.document.parent.id;
    if (!sceneId) return; 

    // --- Automatic Default Data Capture ---
    // This logic runs every time the HUD is opened. It ensures that
    // the token's "default" state is saved before the user can change it.
    
    // Check if flags for this *specific token ID* already exist.
    const tokenFlags = actor.flags?.[ns]?.[token.id];
    
    // If no 'defaults' are saved for this token, create them now.
    if (!tokenFlags?.defaults) {
        const updates = {};
        
        // Save the token's current name, texture, scale, and disposition as its "default" visage.
        updates[`flags.${ns}.${token.id}.defaults`] = {
            name: token.document.name,
            token: token.document.texture.src,
            scale: token.document.texture.scaleX ?? 1.0,
            disposition: token.document.disposition ?? 0 // Default to 0/Neutral if not set
        };
        // Also set its starting form to 'default'.
        updates[`flags.${ns}.${token.id}.currentFormKey`] = 'default';
        
        // Use a 0ms timeout to perform the update *after* the current
        // execution stack clears, preventing potential race conditions or locks.
        setTimeout(() => actor.update(updates), 0);
    }

    // --- Add the HUD Button ---
    // The button is *always* added, regardless of whether alternate
    // visages are configured. This allows the user to open the config
    // from the button even for a new token.

    const title = game.i18n.localize("VISAGE.HUD.ChangeVisage");

    const buttonHtml = `
        <div class="control-icon visage-button" title="${title}">
            <img src="modules/visage/icons/switch_account.svg" alt="${title}" class="visage-icon">
        </div>
    `;
    
    // Find the left column of the HUD to inject the button into.
    const colLeft = html.querySelector(".col.left");
    if (!colLeft) return;

    // Add the button HTML to the end of the left column.
    colLeft.insertAdjacentHTML('beforeend', buttonHtml);
    const button = colLeft.querySelector('.visage-button');

    // --- Button Click Handler ---
    if (button) {
        button.addEventListener("click", () => {
            const actorId = actor.id;
            // Create a unique ID for the selector app based on actor and token
            // to allow multiple selectors to be open for different tokens.
            const selectorId = `visage-selector-${actorId}-${token.id}`; 

            // Check if an app with this ID is already open.
            if (Visage.apps[selectorId]) {
                // If it is, close it instead of opening a new one.
                Visage.apps[selectorId].close();
                return; 
            }

            // --- Positioning Logic ---
            // Calculate where to place the new VisageSelector window.
            const buttonRect = button.getBoundingClientRect();

            // Dynamic Width Calculation:
            // Get the current root font size in pixels (e.g., 16px, 18px, etc.)
            const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
            // Calculate width based on the CSS variable/setting (13rem)
            const selectorWidth = 13 * rootFontSize; 
            
            const gap = 16; // Space between the HUD and the app
            
            // Position it aligned with the top of the button...
            const top = buttonRect.top; 
            // ...and to the left of the button, accounting for dynamic app width and gap.
            const left = buttonRect.left - selectorWidth - gap; 

            // Create a new instance of the VisageSelector application
            // V2 uses a single options object for constructor parameters
            const selectorApp = new VisageSelector({
                actorId: actor.id, 
                tokenId: token.id, 
                sceneId: sceneId,
                id: selectorId, // Assign our unique ID
                position: { // V2 position object
                    left: left,
                    top: top
                }
            });
            
            // Render the new application window.
            selectorApp.render(true);
        });
    }
}