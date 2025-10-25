/**
 * This file contains the logic for interacting with Foundry's Token HUD.
 * Its primary responsibility is to add the "Change Visage" button to the HUD
 * and handle what happens when that button is clicked.
 */

import { Visage } from "./visage.js";
import { VisageSelector } from "./visage-selector.js";

/**
 * The hook handler for 'renderTokenHUD'.
 * This function is called every time the Token HUD is rendered.
 *
 * @param {TokenHUD} app - The TokenHUD application instance.
 * @param {jQuery} html - The jQuery-wrapped HTML of the HUD.
 * @param {object} data - The data object for the token.
 */
export async function handleTokenHUD(app, html, data) {
    // If our button already exists, don't do anything.
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

    const buttonHtml = `
        <div class="control-icon visage-button" title="Change Visage">
            <img src="modules/visage/icons/switch_account.svg" alt="Change Visage" class="visage-icon">
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

            // Check if an app with this ID is already open (using our tracker)
            if (Visage.apps[selectorId]) {
                // If it is, close it instead of opening a new one.
                Visage.apps[selectorId].close();
                return; 
            }

            // --- Positioning Logic ---
            // Calculate where to place the new VisageSelector window.
            const buttonRect = button.getBoundingClientRect();
            const selectorWidth = 200; // Expected width of the selector app
            const gap = 16; // Space between the HUD and the app
            
            // Position it aligned with the top of the button...
            const top = buttonRect.top; 
            // ...and to the left of the button, accounting for app width and gap.
            const left = buttonRect.left - selectorWidth - gap; 

            // Create a new instance of the VisageSelector application
            const selectorApp = new VisageSelector(actor.id, token.id, sceneId, {
                id: selectorId, // Assign our unique ID
                left: left,
                top: top
            });
            
            // Render the new application window.
            selectorApp.render(true);
        });
    }
}