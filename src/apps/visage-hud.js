/**
 * @file Handles the integration with the Foundry VTT Token HUD.
 * Responsible for injecting the Visage control button into the standard Token HUD
 * and managing the positioning/rendering of the transient Selector app.
 * @module visage
 */

import { Visage } from "../core/visage.js";
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
    if (html.querySelector(".visage-button")) return;

    const token = app.object;
    // Basic permission check: only show to those who can manage the token
    if (!token?.document?.canUserModify(game.user, "update")) return;

    // 2. Render Button
    const isOrphan = !token.actor;
    const title = isOrphan ? game.i18n.localize("VISAGE.Warnings.OrphanedToken") : game.i18n.localize("VISAGE.Title");

    const buttonHtml = `
        <div class="control-icon visage-button" title="${title}">
            <img src="modules/visage/icons/domino_mask.svg" alt="${title}" class="visage-icon">
        </div>
    `;

    // Inject into the left column (standard location for combat/attribute controls)
    const colLeft = html.querySelector(".col.left");
    if (!colLeft) return;

    colLeft.insertAdjacentHTML("beforeend", buttonHtml);
    const button = colLeft.querySelector(".visage-button");

    // 3. Bind Event Listeners
    if (button) {
        button.addEventListener("click", () => {
            if (isOrphan) {
                // Proactive warning for the GM
                return ui.notifications.warn(game.i18n.localize("VISAGE.Warnings.OrphanedToken"));
            }

            const actor = token.actor;
            const sceneId = token.document.parent?.id;
            const selectorId = `visage-selector-${actor.id}-${token.id}`;

            // Toggle Logic: Close if already open
            if (Visage.apps[selectorId]) {
                Visage.apps[selectorId].close();
                return;
            }

            // --- Position Calculation (Smart Flip) ---
            const buttonRect = button.getBoundingClientRect();
            const hudElement = document.getElementById("token-hud");

            // Look for the specific right-hand column. If it's missing, fall back to the main wrapper.
            const rightCol = hudElement.querySelector(".col.right");
            const trueRightEdge = rightCol ? rightCol.getBoundingClientRect().right : hudElement.getBoundingClientRect().right;

            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;

            // We can return to a single, unified gap because we are now measuring from the true, scaled edges.
            const gap = 32;
            const estimatedHudWidth = 550;
            let uiPosition = {};

            // 1. HORIZONTAL LOGIC (Smart Flip)
            if (buttonRect.left > estimatedHudWidth + gap) {
                // [CASE A] Normal: Spawn on the Left of the button
                uiPosition.right = viewportWidth - buttonRect.left + gap;
            } else {
                // [CASE B] Pinched: Spawn on the Right of the true right edge
                uiPosition.left = trueRightEdge + gap;
            }

            // 2. VERTICAL LOGIC (Grow Up/Down)
            const minComfortableSpace = 500;
            const spaceBelow = viewportHeight - buttonRect.top;

            if (spaceBelow < minComfortableSpace) {
                uiPosition.bottom = viewportHeight - buttonRect.bottom;
            } else {
                uiPosition.top = buttonRect.top;
            }

            const selectorApp = new VisageSelector({
                actorId: actor.id,
                tokenId: token.id,
                sceneId: sceneId,
                id: selectorId,
                uiPosition: uiPosition, // Pass our safely calculated object
            });

            selectorApp.render(true);
        });
    }
}
