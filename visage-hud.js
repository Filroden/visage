import { Visage } from "./visage.js";
import { VisageSelector } from "./visage-selector.js";

export async function handleTokenHUD(app, html, data) {
    if (html.querySelector('.visage-button')) return; // Prevent duplicate buttons

    const token = app.object; // Get the token document from the HUD
    if (!token?.actor?.isOwner) return; // Still the correct guard

    const actor = token.actor;
    const ns = Visage.DATA_NAMESPACE;
    
    const sceneId = token.document.parent.id;
    if (!sceneId) return; 

    // --- Default Capture Logic ---
    const tokenFlags = actor.flags?.[ns]?.[token.id];
    if (!tokenFlags?.defaults) {
        // If defaults for this specific token don't exist, create them.
        const updates = {};
        updates[`flags.${ns}.${token.id}.defaults`] = {
            name: token.document.name,
            token: token.document.texture.src,
            scale: token.document.texture.scaleX ?? 1.0 
        };
        updates[`flags.${ns}.${token.id}.currentFormKey`] = 'default';
        
        setTimeout(() => actor.update(updates), 0);
    }

    // --- HUD Display Logic ---
    
    // *** FIX: The lines below that checked for alternates have been REMOVED. ***
    // const moduleData = actor.flags?.[ns] || {};
    // const hasAlternates = moduleData.alternateImages && Object.keys(moduleData.alternateImages).length > 0;
    // const currentTokenKey = moduleData[token.id]?.currentFormKey ?? 'default';
    // const isNotDefault = currentTokenKey !== 'default';
    // if (!hasAlternates && !isNotDefault) return; // <-- THIS IS GONE.

    const buttonHtml = `
        <div class="control-icon visage-button" title="Change Visage">
            <img src="modules/visage/icons/switch_account.svg" alt="Change Visage" class="visage-icon">
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
            const selectorWidth = 200; 
            const gap = 16;
            
            const top = buttonRect.top; 
            const left = buttonRect.left - selectorWidth - gap; 

            const selectorApp = new VisageSelector(actor.id, token.id, sceneId, {
                id: selectorId,
                left: left,
                top: top
            });
            
            selectorApp.render(true);
        });
    }
}