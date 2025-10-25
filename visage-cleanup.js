/**
 * This file contains utility functions for data cleanup.
 * These functions are triggered from the module settings menu and allow
 * a GM to remove all data stored by Visage from actor flags.
 * This is intended as a "hard reset" or uninstallation tool.
 */

/**
 * Removes all Visage-related data from actors associated with tokens
 * on the *currently active scene*.
 *
 * This is a destructive action and cannot be undone.
 * It's triggered by a setting in the module configuration.
 *
 * @returns {Promise<void>}
 */
export async function cleanseSceneTokens() {
  if (!canvas.scene) {
    ui.notifications.warn("Visage | No active scene found.");
    return;
  }

  // Use a Map to store the actors that need updating.
  // This ensures we only update each actor once, even if they have
  // multiple tokens on the scene.
  const actorsToUpdate = new Map();
  
  for (const token of canvas.scene.tokens) {
    const actor = token.actor;

    // Check if the actor has any Visage data (using 'alternateImages' as a proxy)
    // and if we haven't already added this actor to our update list.
    if (actor?.getFlag("visage", "alternateImages") && !actorsToUpdate.has(actor.id)) {
      // Add the actor to the map with the update payload.
      // `flags.-=visage` is Foundry syntax to remove the entire 'visage' object
      // from the actor's flags.
      actorsToUpdate.set(actor.id, { _id: actor.id, "flags.-=visage": null });
    }
  }

  if (actorsToUpdate.size > 0) {
    // Perform a single bulk update on all collected actors for efficiency.
    const updates = Array.from(actorsToUpdate.values());
    await Actor.updateDocuments(updates);
    ui.notifications.info(`Visage | Cleansed data from ${updates.length} actor(s) on scene "${canvas.scene.name}".`);
  } else {
    ui.notifications.info("Visage | No data found on tokens in the current scene.");
  }
}

/**
 * Removes all Visage-related data from *all* actors in *all* scenes.
 *
 * This is a global, destructive action and cannot be undone.
 * It's triggered by a setting in the module configuration.
 *
 * @returns {Promise<void>}
 */
export async function cleanseAllTokens() {
  // Use a Map to collect unique actors from all scenes.
  const actorsToUpdate = new Map();

  // Iterate over every scene in the game
  for (const scene of game.scenes) {
    // Iterate over every token in that scene
    for (const token of scene.tokens) {
        const actor = token.actor;
        
        // Same check as the scene-specific function:
        // If the actor has data and isn't already in our map, add it.
        if (actor?.getFlag("visage", "alternateImages") && !actorsToUpdate.has(actor.id)) {
            // `flags.-=visage` removes the entire 'visage' namespace
            actorsToUpdate.set(actor.id, { _id: actor.id, "flags.-=visage": null });
        }
    }
  }

  if (actorsToUpdate.size > 0) {
    // Perform a single bulk update on all collected actors.
    const updates = Array.from(actorsToUpdate.values());
    await Actor.updateDocuments(updates);
    ui.notifications.info(`Visage | Cleansed data from ${updates.length} actor(s) across all scenes.`);
  } else {
    ui.notifications.info("Visage | No data found on tokens in any scene.");
  }
}