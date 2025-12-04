/**
 * @file visage-hud.js
 * @description Handles the integration with the Foundry VTT Token HUD.
 * @module visage
 */

import { Visage } from "./visage.js";
import { VisageSelector } from "./visage-selector.js";

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
    
    // Case 1: No defaults at all (New Token)
    if (!tokenFlags?.defaults) {
        const updates = {};
        // FIX: Use token.document.toObject().ring to ensure we get the plain data object safely
        const sourceData = token.document.toObject();
        
        updates[`flags.${ns}.${token.id}.defaults`] = {
            name: token.document.name,
            token: token.document.texture.src,
            scale: token.document.texture.scaleX ?? 1.0,
            disposition: token.document.disposition ?? 0,
            // Capture Ring Data safely
            ring: sourceData.ring 
        };
        updates[`flags.${ns}.${token.id}.currentFormKey`] = 'default';
        setTimeout(() => actor.update(updates), 0);
    } 
    // Case 2: Defaults exist, but missing Ring data (Existing Token from v1.2.0)
    else if (tokenFlags.defaults.ring === undefined) {
        const updates = {};
        // FIX: Use token.document.toObject().ring here as well
        const sourceData = token.document.toObject();
        
        updates[`flags.${ns}.${token.id}.defaults.ring`] = sourceData.ring;
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