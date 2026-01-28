/**
 * @file Utilities for scrubbing Visage data from the game world.
 * Provides tools to revert tokens to their original states and remove module flags.
 * Used for debugging, uninstallation prep, or emergency resets.
 * @module visage
 * @version 3.2.0
 */

import { Visage } from "./visage.js";

/**
 * Generates the update data required to revert a token to its original state.
 * This function retrieves the "Clean Snapshot" stored in flags and maps it back to Token properties.
 * @param {TokenDocument} token - The token document to revert.
 * @returns {Promise<Object|null>} An update object compatible with updateEmbeddedDocuments, or null if no Visage data exists.
 */
async function getRevertData(token) {
    const ns = Visage.DATA_NAMESPACE;
    const flags = token.flags?.[ns];
    if (!flags) return null;

    // 1. Prepare the "Wipe" command to remove the entire Visage flag namespace
    const updates = {
        _id: token.id,
        [`flags.-=${ns}`]: null
    };

    // 2. Retrieve Original State Snapshot
    const original = flags.originalState;
    
    if (original) {
        if (original.texture?.src) updates["texture.src"] = original.texture.src;
        if (original.texture?.scaleX !== undefined) updates["texture.scaleX"] = original.texture.scaleX;
        if (original.texture?.scaleY !== undefined) updates["texture.scaleY"] = original.texture.scaleY;
        
        if (original.width) updates.width = original.width;
        if (original.height) updates.height = original.height;
        if (original.name) updates.name = original.name;
        if (original.disposition !== undefined) updates.disposition = original.disposition;
        if (original.alpha !== undefined) updates.alpha = original.alpha;
        if (original.lockRotation !== undefined) updates.lockRotation = original.lockRotation;
        if (original.ring) updates.ring = original.ring;
        
        // v3.2: Restore Light
        if (original.light) updates.light = original.light;
    }

    return updates;
}

/**
 * Cleanses all tokens in the current scene.
 * Reverts appearance to original state and removes all Visage flags.
 * Also reverts Actor Portrait images if they were modified by Visage.
 */
export async function cleanseSceneTokens() {
    if (!canvas.ready) return;
    const tokens = canvas.tokens.placeables.map(t => t.document);
    const scene = canvas.scene;
    
    const tokenUpdates = [];
    const actorUpdates = []; // For reverting Portraits
    let count = 0;

    for (const token of tokens) {
        // A. Token Cleanup
        if (token.flags?.[Visage.DATA_NAMESPACE]) {
             
             // 1. Check for Portrait Reversion (v3.2)
             const original = token.flags[Visage.DATA_NAMESPACE].originalState;
             if (original && original.portrait && token.actor) {
                 // Push to actor update promise list
                 // Note: We do this individually or via Actor.updateDocuments if many
                 actorUpdates.push(token.actor.update({ img: original.portrait }));
             }

             // 2. Prepare Token Revert
             const revertUpdate = await getRevertData(token);
             if (revertUpdate) {
                 tokenUpdates.push(revertUpdate);
                 count++;
             }
        }
    }
    
    // Execute updates
    if (actorUpdates.length > 0) await Promise.all(actorUpdates);
    if (tokenUpdates.length > 0) await scene.updateEmbeddedDocuments("Token", tokenUpdates);

    if (count > 0) ui.notifications.info(game.i18n.format("VISAGE.Notifications.CleanupScene", { count }));
    else ui.notifications.warn("VISAGE.Notifications.CleanupSceneEmpty", { localize: true });
}

/**
 * Cleanses ALL tokens in the entire world (every Scene).
 * WARNING: heavy operation.
 */
export async function cleanseAllTokens() {
    ui.notifications.info("VISAGE.Notifications.CleanupGlobalStart", { localize: true });
    
    let totalCount = 0;
    const actorUpdates = [];

    // 1. Iterate Scenes
    for (const scene of game.scenes) {
        const updates = [];
        for (const token of scene.tokens) {
            if (token.flags?.[Visage.DATA_NAMESPACE]) {
                
                // v3.2: Portrait Revert
                const original = token.flags[Visage.DATA_NAMESPACE].originalState;
                if (original && original.portrait && token.actor) {
                     actorUpdates.push(token.actor.update({ img: original.portrait }));
                }

                const revertUpdate = await getRevertData(token);
                if (revertUpdate) {
                    updates.push(revertUpdate);
                    totalCount++;
                }
            }
        }
        if (updates.length > 0) {
            await scene.updateEmbeddedDocuments("Token", updates);
        }
    }

    // 2. Clean Actors in the Sidebar (Handle Linked Actors and Flags)
    // This cleans the "Local Library" flags stored on actors.
    const sidebarActorUpdates = [];
    for (const actor of game.actors) {
        if (actor.flags?.[Visage.DATA_NAMESPACE]) {
            sidebarActorUpdates.push({ 
                _id: actor.id, 
                [`flags.-=${Visage.DATA_NAMESPACE}`]: null 
            });
        }
    }
    
    // Execute Actor Reverts (Portraits) & Flag Cleans
    if (actorUpdates.length > 0) await Promise.all(actorUpdates);
    if (sidebarActorUpdates.length > 0) await Actor.updateDocuments(sidebarActorUpdates);
    
    ui.notifications.info(game.i18n.format("VISAGE.Notifications.CleanupGlobalSuccess", { count: totalCount }));
}