import { Visage } from "./visage.js";
import { VisageSelector } from "./visage-selector.js";

export async function handleTokenHUD(app, html, data) {
    const jQueryHtml = $(html);
    if (jQueryHtml.find('.visage-button').length) return; // Prevent duplicate buttons

    const token = app.object; // Get the token document from the HUD
    if (!token?.actor?.isOwner) return;

    const actor = token.actor;
    const ns = Visage.DATA_NAMESPACE;

    // --- Default Capture Logic ---
    const tokenFlags = actor.flags?.[ns]?.[token.id];
    if (!tokenFlags?.defaults) {
        // If defaults for this specific token don't exist, create them.
        const updates = {};
        updates[`flags.${ns}.${token.id}.defaults`] = {
            name: token.document.name,
            token: token.document.texture.src
        };
        // Also initialize the current form key.
        updates[`flags.${ns}.${token.id}.currentFormKey`] = 'default';
        
        // Defer the update to avoid race conditions with other modules' hooks.
        setTimeout(() => actor.update(updates), 0);
    }

    // --- HUD Display Logic ---
    const moduleData = actor.flags?.[ns] || {};
    const hasAlternates = moduleData.alternateImages && Object.keys(moduleData.alternateImages).length > 0;
    const currentTokenKey = moduleData[token.id]?.currentFormKey ?? 'default';
    const isNotDefault = currentTokenKey !== 'default';

    // Show button if there are any alternate forms OR if this token is not in its default state.
    if (!hasAlternates && !isNotDefault) return;

    const button = $(`
        <div class="control-icon visage-button" title="Change Visage">
            <img src="modules/visage/icons/switch_account.svg" alt="Change Visage" class="visage-icon">
        </div>
    `);

    button.on("click", () => {
        const actorId = actor.id;
        const selectorId = `visage-selector-${actorId}-${token.id}`; // Make ID unique per token

        if (Visage.apps[selectorId]) {
            Visage.apps[selectorId].close();
            return; 
        }

        const buttonRect = button[0].getBoundingClientRect();
        const selectorWidth = 200; 
        const gap = 16;
        
        const top = buttonRect.top; 
        const left = buttonRect.left - selectorWidth - gap; 

        const selectorApp = new VisageSelector(actor.id, token.id, {
            id: selectorId,
            left: left,
            top: top
        });
        
        selectorApp.render(true);
    });

    jQueryHtml.find(".col.left").append(button);
}
