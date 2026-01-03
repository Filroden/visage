/**
 * @file Handles the integration with the Foundry VTT Token HUD.
 * Injects the Visage button and manages the opening of the transient Selector app.
 * @module visage
 */

import { Visage } from "./visage.js";
import { VisageSelector } from "./visage-selector.js";

/**
 * Hook handler for `renderTokenHUD`.
 * Injects the Visage control button and captures default token state if missing.
 * * @param {TokenHUD} app - The TokenHUD application instance.
 * @param {HTMLElement} html - The HTML element of the HUD.
 * @param {Object} data - The data context used to render the HUD.
 */
export async function handleTokenHUD(app, html, data) {
    // Prevent duplicate button injection
    if (html.querySelector('.visage-button')) return;

    const token = app.object; 
    if (!token?.actor?.isOwner) return; 

    const actor = token.actor;
    const ns = Visage.DATA_NAMESPACE;
    const sceneId = token.document.parent?.id;
    if (!sceneId) return; 

    // --- DEFAULT DATA CAPTURE ---
    // If this is the first time a token is interacted with via Visage, we must capture
    // its "Clean" state (Default appearance) so we can revert to it later.
    // This is primarily for new tokens; migration handles existing ones.
    
    const tokenFlags = actor.flags?.[ns]?.[token.id];
    
    if (!tokenFlags?.defaults) {
        const sourceData = token.document.toObject();
        
        // Capture Snapshot (Unified Model v2.0)
        const defaults = {
            name: token.document.name,
            token: token.document.texture.src,
            scale: token.document.texture.scaleX ?? 1.0,
            disposition: token.document.disposition ?? 0,
            ring: sourceData.ring,
            width: token.document.width ?? 1,
            height: token.document.height ?? 1
        };

        const updates = {
            [`flags.${ns}.${token.id}.defaults`]: defaults,
            [`flags.${ns}.${token.id}.currentFormKey`]: 'default'
        };

        // Defer update to the end of the event loop to prevent render conflicts 
        // with the HUD that is currently drawing.
        setTimeout(() => actor.update(updates), 0);
    } 

    // --- RENDER BUTTON ---
    const title = game.i18n.localize("VISAGE.HUD.ChangeVisage");
    const buttonHtml = `
        <div class="control-icon visage-button" title="${title}">
            <img src="modules/visage/icons/switch_account.svg" alt="${title}" class="visage-icon">
        </div>
    `;
    
    // Inject into the left column of the HUD
    const colLeft = html.querySelector(".col.left");
    if (!colLeft) return;

    colLeft.insertAdjacentHTML('beforeend', buttonHtml);
    const button = colLeft.querySelector('.visage-button');

    if (button) {
        button.addEventListener("click", () => {
            const selectorId = `visage-selector-${actor.id}-${token.id}`; 

            // Toggle Logic: Close if already open
            if (Visage.apps[selectorId]) {
                Visage.apps[selectorId].close();
                return; 
            }

            // --- Position Calculation ---
            // Place the Selector HUD to the left of the Token HUD button.
            // We calculate based on root font size to respect UI scaling.
            const buttonRect = button.getBoundingClientRect();
            const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
            const selectorWidth = 14 * rootFontSize; // Matches CSS width: 14rem
            const gap = 16; 
            
            const top = buttonRect.top; 
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