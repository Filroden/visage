import { Visage } from "./visage.js";
import { VisageSelector } from "./visage-selector.js";

export function handleTokenHUD(app, html, data) {
    const jQueryHtml = $(html);
    if (jQueryHtml.find('.visage-button').length) return; // Prevent duplicate buttons

    const actor = game.actors.get(data.actorId);
    if (!actor || !actor.isOwner) return;

    // Show button if there are any alternate forms OR if a default has been changed.
    const moduleData = actor.flags?.[Visage.DATA_NAMESPACE] || {};
    const hasAlternates = moduleData.alternateImages && Object.keys(moduleData.alternateImages).length > 0;
    const isNotDefault = moduleData.currentFormKey && moduleData.currentFormKey !== 'default';

    if (!hasAlternates && !isNotDefault) return;

    const token = app.object; // Get the token document from the HUD
    if (!token) return;

    const button = $(
        `<div class="control-icon visage-button" title="Change Visage">
            <img src="modules/visage/icons/switch_account.svg" alt="Change Visage" class="visage-icon">
        </div>`
    );

    button.on("click", () => {
        const actorId = actor.id;
        const selectorId = `visage-selector-${actorId}`; 

        // *** GUARD CHECK: If selector is already open for this actor, close it or return. ***
        if (Visage.apps[selectorId]) {
            Visage.apps[selectorId].close();
            return; 
        }

        // Get button position and window size BEFORE rendering
        const buttonRect = button[0].getBoundingClientRect();
        const selectorWidth = 250; 
        const gap = 16;
        
        // Calculate the desired position (to the left, aligned top)
        const top = buttonRect.top; 
        const left = buttonRect.left - selectorWidth - gap; 

        // Create the application with the consistent ID and calculated position
        const selectorApp = new VisageSelector(actor.id, token.id, {
            id: selectorId, // Pass the consistent ID here
            left: left,
            top: top
        });
        
        // Render it
        selectorApp.render(true);
    });

    jQueryHtml.find(".col.left").append(button);
}