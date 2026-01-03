/**
 * @file Utility functions for data cleanup and state reversion.
 * Handles the removal of Visage data from actors and tokens, restoring them to their original state.
 * @module visage
 */

import { Visage } from "./visage.js";

/**
 * Generates the update data required to revert a token to its original state.
 * This function retrieves the "Clean Snapshot" stored in flags and maps it back to Token properties.
 * * @param {TokenDocument} token - The token document to revert.
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
    // If we simply delete the flags, the token retains its currently applied "Mask" appearance.
    // We must explicitly restore the pixel data (texture, scale, etc.) to what it was before Visage touched it.
    const original = flags.originalState;
    
    if (original) {
        // Restore texture path (handling v10/v11+ data structure differences)
        if (original.texture?.src) updates["texture.src"] = original.texture.src;
        else if (original.img) updates["texture.src"] = original.img; // Legacy compatibility

        // Restore Scales / Flips
        if (original.texture?.scaleX !== undefined) updates["texture.scaleX"] = original.texture.scaleX;
        else if (original.scaleX !== undefined) updates["texture.scaleX"] = original.scaleX;

        if (original.texture?.scaleY !== undefined) updates["texture.scaleY"] = original.texture.scaleY;
        else if (original.scaleY !== undefined) updates["texture.scaleY"] = original.scaleY;

        // Restore Dimensions
        if (original.width) updates["width"] = original.width;
        if (original.height) updates["height"] = original.height;

        // Restore Dynamic Ring
        if (original.ring) updates["ring"] = original.ring;

        // Restore Name (if it was overridden by the Visage)
        if (original.name) updates["name"] = original.name;
    } 
    
    return updates;
}

/**
 * Removes Visage data from all tokens and actors in the CURRENT SCENE.
 * Useful for fixing visual glitches or resetting a specific encounter.
 */
export async function cleanseSceneTokens() {
  if (!canvas.scene) return;

  const actorUpdates = new Map();
  const unlinkedActorPromises = [];
  const tokenUpdates = [];
  let count = 0;
  
  for (const token of canvas.scene.tokens) {
    // A. Cleanse Actor Flags (Local Visages)
    // We must handle Linked actors carefully to avoid redundant updates.
    const actor = token.actor;
    if (actor?.flags?.[Visage.DATA_NAMESPACE]) {
        const deleteKey = `flags.-=${Visage.DATA_NAMESPACE}`;
        const updateData = { _id: actor.id, [deleteKey]: null };
        
        if (token.actorLink) {
            // For Linked Actors, use a Map to ensure we only update the base Actor once
            if (!actorUpdates.has(actor.id)) {
                actorUpdates.set(actor.id, updateData);
                count++;
            }
        } else {
            // For Unlinked Actors (Synthetics), update the synthetic actor directly
            unlinkedActorPromises.push(actor.update({ [deleteKey]: null }));
            count++;
        }
    }

    // B. Cleanse Token Data (Global Masks + Active State)
    // This reverts the visual appearance of the token on the canvas.
    if (token.flags?.[Visage.DATA_NAMESPACE]) {
        const revertUpdate = await getRevertData(token);
        if (revertUpdate) {
            tokenUpdates.push(revertUpdate);
            count++;
        }
    }
  }

  // Execute Bulk Updates
  if (count > 0) {
    if (actorUpdates.size > 0) await Actor.updateDocuments(Array.from(actorUpdates.values()));
    if (unlinkedActorPromises.length > 0) await Promise.all(unlinkedActorPromises);
    if (tokenUpdates.length > 0) await canvas.scene.updateEmbeddedDocuments("Token", tokenUpdates);
    
    ui.notifications.info(`Visage | Cleansed and reverted ${count} entities on scene "${canvas.scene.name}".`);
  } else {
    ui.notifications.info("Visage | No active Visage data found on this scene.");
  }
}

/**
 * Removes Visage data from EVERY SCENE in the world.
 * This is a "Nuclear Option" for uninstalling or fixing corrupted data.
 */
export async function cleanseAllTokens() {
  let count = 0;

  for (const scene of game.scenes) {
    const tokenUpdates = []; 
    const actorUpdates = new Map();
    const unlinkedPromises = [];

    for (const token of scene.tokens) {
        // A. Actor Cleanup
        const actor = token.actor;
        if (actor?.flags?.[Visage.DATA_NAMESPACE]) {
            const deleteKey = `flags.-=${Visage.DATA_NAMESPACE}`;
            const updateData = { _id: actor.id, [deleteKey]: null };
            
            if (token.actorLink) {
                 if (!actorUpdates.has(actor.id)) actorUpdates.set(actor.id, updateData);
            } else {
                unlinkedPromises.push(actor.update({ [deleteKey]: null }));
            }
            count++;
        }

        // B. Token Cleanup & Revert
        if (token.flags?.[Visage.DATA_NAMESPACE]) {
             const revertUpdate = await getRevertData(token);
             if (revertUpdate) tokenUpdates.push(revertUpdate);
             count++;
        }
    }
    
    // Execute per-scene bulk updates to prevent database locks
    if (actorUpdates.size > 0) await Actor.updateDocuments(Array.from(actorUpdates.values()));
    if (unlinkedPromises.length > 0) await Promise.all(unlinkedPromises);
    if (tokenUpdates.length > 0) await scene.updateEmbeddedDocuments("Token", tokenUpdates);
  }

  ui.notifications.info(`Visage | World Cleanse complete. Processed ${count} entities.`);
}