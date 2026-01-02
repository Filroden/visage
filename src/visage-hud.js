/**
 * @file Handles the integration with the Foundry VTT Token HUD.
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
    const sceneId = token.document.parent?.id;
    if (!sceneId) return; 

    // --- DEFAULT DATA CAPTURE ---
    // Since migration now handles cleanup/backfilling, we only need to handle
    // the "First Time Click" for brand new tokens.
    
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

        // Defer update to prevent render conflicts
        setTimeout(() => actor.update(updates), 0);
    } 

    // --- RENDER BUTTON ---
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
            const selectorId = `visage-selector-${actor.id}-${token.id}`; 

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
                position: { left, top }
            });
            
            selectorApp.render(true);
        });
    }
}