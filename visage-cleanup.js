/**
 * @file visage-cleanup.js
 * @description Utility functions for data cleanup.
 * These functions allow GMs to perform a "hard reset" by removing all
 * Visage-related flags from actors within specific scopes (Scene or World).
 * @module visage
 */

import { Visage } from "./visage.js";

/**
 * Removes all Visage-related data from actors associated with tokens
 * on the *currently active scene*.
 *
 * This is a destructive action and cannot be undone.
 * It is triggered by a setting in the module configuration.
 *
 * @returns {Promise<void>} A promise that resolves when the update operation is complete.
 */
export async function cleanseSceneTokens() {
  if (!canvas.scene) {
    ui.notifications.warn("Visage | No active scene found.");
    return;
  }

  const worldUpdates = new Map();
  const unlinkedPromises = [];
  let count = 0;
  
  for (const token of canvas.scene.tokens) {
    const actor = token.actor;
    // Check for Visage data using the strict namespace constant
    if (actor?.flags?.[Visage.DATA_NAMESPACE]) {
        // Construct the deletion key dynamically
        const deleteKey = `flags.-=${Visage.DATA_NAMESPACE}`;
        const updateData = { _id: actor.id, [deleteKey]: null };
        
        if (token.actorLink) {
            // Linked: Add to bulk update list (deduplicated by Actor ID)
            if (!worldUpdates.has(actor.id)) {
                worldUpdates.set(actor.id, updateData);
                count++;
            }
        } else {
            // Unlinked: Must update the synthetic actor instance directly
            unlinkedPromises.push(actor.update({ [deleteKey]: null }));
            count++;
        }
    }
  }

  if (count > 0) {
    // Execute updates
    if (worldUpdates.size > 0) {
        await Actor.updateDocuments(Array.from(worldUpdates.values()));
    }
    if (unlinkedPromises.length > 0) {
        await Promise.all(unlinkedPromises);
    }
    
    ui.notifications.info(`Visage | Cleansed data from ${count} actor(s)/token(s) on scene "${canvas.scene.name}".`);
  } else {
    ui.notifications.info("Visage | No data found on tokens in the current scene.");
  }
}

/**
 * Removes all Visage-related data from *all* actors in *all* scenes.
 *
 * This is a global, destructive action and cannot be undone.
 * It is triggered by a setting in the module configuration.
 *
 * @returns {Promise<void>} A promise that resolves when the update operation is complete.
 */
export async function cleanseAllTokens() {
  const worldUpdates = new Map();
  const unlinkedPromises = [];
  let count = 0;

  // Iterate over every scene in the game
  for (const scene of game.scenes) {
    // Iterate over every token in that scene
    for (const token of scene.tokens) {
        const actor = token.actor;
        
        if (actor?.flags?.[Visage.DATA_NAMESPACE]) {
            const deleteKey = `flags.-=${Visage.DATA_NAMESPACE}`;
            const updateData = { _id: actor.id, [deleteKey]: null };

            if (token.actorLink) {
                // Linked: Add to bulk list (deduplicated)
                if (!worldUpdates.has(actor.id)) {
                    worldUpdates.set(actor.id, updateData);
                    count++;
                }
            } else {
                // Unlinked: Update direct instance
                unlinkedPromises.push(actor.update({ [deleteKey]: null }));
                count++;
            }
        }
    }
  }

  if (count > 0) {
    // Execute updates
    if (worldUpdates.size > 0) {
        await Actor.updateDocuments(Array.from(worldUpdates.values()));
    }
    if (unlinkedPromises.length > 0) {
        await Promise.all(unlinkedPromises);
    }

    ui.notifications.info(`Visage | Cleansed data from ${count} actor(s)/token(s) across all scenes.`);
  } else {
    ui.notifications.info("Visage | No data found on tokens in any scene.");
  }
}