/**
 * @file Utility functions for data cleanup. These functions provide GM tools to perform a "hard reset"
 * by removing all Visage-related flags from actors within specific scopes (scene or world).
 * @module visage
 */

import { Visage } from "./visage.js";

/**
 * Removes all Visage-related data from actors associated with tokens on the *currently active scene*.
 *
 * This function differentiates between linked and unlinked tokens to ensure all data is removed correctly.
 * - For **linked tokens**, it collects the unique parent actor IDs and performs a single bulk update.
 * - For **unlinked tokens**, it updates each synthetic actor instance individually.
 *
 * This is a destructive action and cannot be undone. It is intended to be triggered by a GM
 * via the module settings.
 *
 * @returns {Promise<void>} A promise that resolves when all update operations are complete.
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
    if (actor?.flags?.[Visage.DATA_NAMESPACE]) {
        const deleteKey = `flags.-=${Visage.DATA_NAMESPACE}`;
        const updateData = { _id: actor.id, [deleteKey]: null };
        
        if (token.actorLink) {
            // Linked: Add to bulk update map (deduplicated by Actor ID).
            if (!worldUpdates.has(actor.id)) {
                worldUpdates.set(actor.id, updateData);
                count++;
            }
        } else {
            // Unlinked: Must update the synthetic actor instance directly.
            unlinkedPromises.push(actor.update({ [deleteKey]: null }));
            count++;
        }
    }
  }

  if (count > 0) {
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
 * Removes all Visage-related data from *all* actors in *all* scenes throughout the world.
 *
 * This function iterates through every scene and every token within those scenes to ensure global
 * coverage. It correctly handles both linked and unlinked tokens by batching updates for linked actors
 * and updating unlinked (synthetic) token actors individually.
 *
 * This is a global, destructive action and cannot be undone. It is intended to be triggered by a GM
 * via the module settings.
 *
 * @returns {Promise<void>} A promise that resolves when all update operations are complete.
 */
export async function cleanseAllTokens() {
  const worldUpdates = new Map();
  const unlinkedPromises = [];
  let count = 0;

  for (const scene of game.scenes) {
    for (const token of scene.tokens) {
        const actor = token.actor;
        
        if (actor?.flags?.[Visage.DATA_NAMESPACE]) {
            const deleteKey = `flags.-=${Visage.DATA_NAMESPACE}`;
            const updateData = { _id: actor.id, [deleteKey]: null };

            if (token.actorLink) {
                // Linked: Add to bulk update map (deduplicated by Actor ID).
                if (!worldUpdates.has(actor.id)) {
                    worldUpdates.set(actor.id, updateData);
                    count++;
                }
            } else {
                // Unlinked: Must update the synthetic actor instance directly.
                unlinkedPromises.push(actor.update({ [deleteKey]: null }));
                count++;
            }
        }
    }
  }

  if (count > 0) {
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