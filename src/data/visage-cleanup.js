/**
 * @file Utilities for scrubbing Visage data from the game world.
 * Provides tools to revert tokens to their original states and remove module flags.
 * Used for debugging, uninstallation prep, or emergency resets.
 * @module visage
 * @version 3.0.0
 */

import { DATA_NAMESPACE } from "../core/visage-constants.js";

/**
 * Maps the original state snapshot back to a Foundry update payload.
 * @private
 */
function _populateRevertData(updates, original) {
    if (!original) return;

    // 1. Map Nested Texture Properties
    const t = original.texture || {};
    if (t.src) updates["texture.src"] = t.src;
    if (t.scaleX !== undefined) updates["texture.scaleX"] = t.scaleX;
    if (t.scaleY !== undefined) updates["texture.scaleY"] = t.scaleY;

    // 2. Map Standard Root Properties
    const rootKeys = ["width", "height", "depth", "ring", "light", "name", "displayName", "disposition"];
    for (const key of rootKeys) {
        if (original[key] !== undefined) updates[key] = original[key];
    }
}

/**
 * Generates the update data required to revert a token to its original state.
 * @param {TokenDocument} token - The token document to revert.
 * @returns {Promise<Object|null>} An update object compatible with updateEmbeddedDocuments, or null if no Visage data exists.
 */
async function getRevertData(token) {
    const flags = token.flags?.[DATA_NAMESPACE];
    if (!flags) return null;

    const updates = {
        _id: token.id,
        [`flags.-=${DATA_NAMESPACE}`]: null,
    };

    _populateRevertData(updates, flags.originalState);

    return updates;
}

/**
 * Cleanses all tokens in the CURRENT SCENE.
 * Useful for fixing a specific map without affecting the rest of the world.
 * @returns {Promise<void>}
 */
export async function cleanseSceneTokens() {
    if (!canvas.scene) return;
    const tokenUpdates = [];
    let count = 0;

    // Batch updates to minimize database transactions
    for (const token of canvas.scene.tokens) {
        if (token.flags?.[DATA_NAMESPACE]) {
            const revertUpdate = await getRevertData(token);
            if (revertUpdate) {
                tokenUpdates.push(revertUpdate);
                count++;
            }
        }
    }

    if (tokenUpdates.length > 0) {
        await canvas.scene.updateEmbeddedDocuments("Token", tokenUpdates);
        ui.notifications.info(
            game.i18n.format("VISAGE.Notifications.CleanupScene", {
                count: count,
            }),
        );
    } else {
        ui.notifications.info(game.i18n.localize("VISAGE.Notifications.CleanupSceneEmpty"));
    }
}

/**
 * Cleanses all tokens and unlinked actors within a specific scene.
 * @private
 */
async function _cleanseSceneTokensAndUnlinked(scene) {
    let count = 0;
    const tokenUpdates = [];
    const unlinkedPromises = [];

    for (const token of scene.tokens) {
        // A. Unlinked Actor Cleanup (Synthetic Actors)
        if (!token.actorLink && token.actor?.flags?.[DATA_NAMESPACE]) {
            unlinkedPromises.push(token.actor.update({ [`flags.-=${DATA_NAMESPACE}`]: null }));
        }

        // B. Token Cleanup (Revert Appearance)
        if (token.flags?.[DATA_NAMESPACE]) {
            const revertUpdate = await getRevertData(token);
            if (revertUpdate) {
                tokenUpdates.push(revertUpdate);
                count++;
            }
        }
    }

    if (unlinkedPromises.length > 0) await Promise.all(unlinkedPromises);
    if (tokenUpdates.length > 0) await scene.updateEmbeddedDocuments("Token", tokenUpdates);

    return count;
}

/**
 * Cleanses all linked actors residing in the game's sidebar directory.
 * @private
 */
async function _cleanseSidebarActors() {
    const sidebarActorUpdates = [];
    for (const actor of game.actors) {
        if (actor.flags?.[DATA_NAMESPACE]) {
            sidebarActorUpdates.push({
                _id: actor.id,
                [`flags.-=${DATA_NAMESPACE}`]: null,
            });
        }
    }

    if (sidebarActorUpdates.length > 0) {
        await Actor.updateDocuments(sidebarActorUpdates);
    }

    return sidebarActorUpdates.length;
}

/**
 * Cleanses ALL tokens and actors in the WORLD.
 * This is a "Nuclear Option" for removing Visage data from entities.
 * @returns {Promise<void>}
 */
export async function cleanseAllTokens() {
    ui.notifications.info(game.i18n.localize("VISAGE.Notifications.CleanupGlobalStart"));
    let count = 0;

    // 1. Iterate over every Scene (Handle Tokens & Unlinked Actors)
    for (const scene of game.scenes) {
        count += await _cleanseSceneTokensAndUnlinked(scene);
    }

    // 2. Clean Actors in the Sidebar (Handle Linked Actors)
    count += await _cleanseSidebarActors();

    ui.notifications.info(game.i18n.format("VISAGE.Notifications.CleanupGlobalSuccess", { count }));
}
