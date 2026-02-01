/**
 * @file Utilities for scrubbing Visage data from the game world.
 * Provides tools to revert tokens to their original states and remove module flags.
 * Used for debugging, uninstallation prep, or emergency resets.
 * @module visage
 * @version 3.0.0
 */

import { DATA_NAMESPACE } from "./visage-constants.js";

/**
 * Generates the update data required to revert a token to its original state.
 * This function retrieves the "Clean Snapshot" stored in flags and maps it back to Token properties.
 * @param {TokenDocument} token - The token document to revert.
 * @returns {Promise<Object|null>} An update object compatible with updateEmbeddedDocuments, or null if no Visage data exists.
 */
async function getRevertData(token) {
    const flags = token.flags?.[DATA_NAMESPACE];
    if (!flags) return null;

    // 1. Prepare the "Wipe" command to remove the entire Visage flag namespace
    // This ensures no residual data remains on the token after cleanup.
    const updates = {
        _id: token.id,
        [`flags.-=${DATA_NAMESPACE}`]: null
    };

    // 2. Retrieve Original State Snapshot
    // If a snapshot exists, we map its properties back to the root token data
    // to visually revert the token to its pre-Visage appearance.
    const original = flags.originalState;
    
    if (original) {
        if (original.texture?.src) {
            updates["texture.src"] = original.texture.src;
        }
        
        // Restore dimensions and scaling
        if (original.width !== undefined) updates["width"] = original.width;
        if (original.height !== undefined) updates["height"] = original.height;
        if (original.texture?.scaleX !== undefined) updates["texture.scaleX"] = original.texture.scaleX;
        if (original.texture?.scaleY !== undefined) updates["texture.scaleY"] = original.texture.scaleY;
        
        // Restore Ring Data
        if (original.ring) updates["ring"] = original.ring;
        
        // Restore Light Source
        if (original.light) updates["light"] = original.light;

        // Restore other properties
        if (original.name) updates["name"] = original.name;
        if (original.displayName !== undefined) updates["displayName"] = original.displayName;
        if (original.disposition !== undefined) updates["disposition"] = original.disposition;
    }

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
        ui.notifications.info(game.i18n.format("VISAGE.Notifications.CleanupScene", { count: count }));
    } else {
        ui.notifications.info(game.i18n.localize("VISAGE.Notifications.CleanupSceneEmpty"));
    }
}

/**
 * Cleanses ALL tokens and actors in the WORLD.
 * This is a "Nuclear Option" for removing Visage data from entities.
 * * **Scope:**
 * 1. Iterates every Scene to clean placed Tokens and unlinked (synthetic) Actors.
 * 2. Iterates the Actor Directory to clean linked (sidebar) Actors.
 * * NOTE: This does NOT delete the Global Mask Library (World Settings), only the active effects/flags on entities.
 * @returns {Promise<void>}
 */
export async function cleanseAllTokens() {
  let count = 0;
  
  ui.notifications.info(game.i18n.localize("VISAGE.Notifications.CleanupGlobalStart"));

  // 1. Iterate over every Scene (Handle Tokens & Unlinked Actors)
  // We must handle unlinked actors inside the scene loop because they do not exist in game.actors.
  for (const scene of game.scenes) {
    const tokenUpdates = []; 
    const unlinkedPromises = [];

    for (const token of scene.tokens) {
        // A. Unlinked Actor Cleanup (Synthetic Actors)
        // We ONLY touch the actor here if it is unlinked. 
        // Linked actors are effectively pointers to the Sidebar, so we handle them in Step 2 
        // to avoid updating the same document multiple times.
        if (!token.actorLink && token.actor) {
            if (token.actor.flags?.[DATA_NAMESPACE]) {
                const deleteKey = `flags.-=${DATA_NAMESPACE}`;
                unlinkedPromises.push(token.actor.update({ [deleteKey]: null }));
            }
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
    
    // Execute per-scene bulk updates to prevent database locks
    if (unlinkedPromises.length > 0) await Promise.all(unlinkedPromises);
    if (tokenUpdates.length > 0) await scene.updateEmbeddedDocuments("Token", tokenUpdates);
  }

  // 2. Clean Actors in the Sidebar (Handle Linked Actors)
  // This covers every "real" character in the game, regardless of what scene they are on.
  const sidebarActorUpdates = [];
  for (const actor of game.actors) {
      if (actor.flags?.[DATA_NAMESPACE]) {
          sidebarActorUpdates.push({ 
              _id: actor.id, 
              [`flags.-=${DATA_NAMESPACE}`]: null 
          });
      }
  }
  
  if (sidebarActorUpdates.length > 0) {
      // Uses Actor.updateDocuments for efficient bulk update
      await Actor.updateDocuments(sidebarActorUpdates);
      count += sidebarActorUpdates.length;
  }

  ui.notifications.info(game.i18n.format("VISAGE.Notifications.CleanupGlobalSuccess", { count: count }));
}