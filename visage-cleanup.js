/**
 * Removes all Visage-related data from all tokens on the currently active scene.
 * This is a destructive action and cannot be undone.
 * @returns {Promise<void>}
 */
export async function cleanseSceneTokens() {
  if (!canvas.scene) {
    ui.notifications.warn("Visage | No active scene found.");
    return;
  }

  const actorsToUpdate = new Map();
  for (const token of canvas.scene.tokens) {
    const actor = token.actor;
    // Check if the actor has any visage flags and hasn't been processed yet
    if (actor?.getFlag("visage", "alternateImages") && !actorsToUpdate.has(actor.id)) {
      actorsToUpdate.set(actor.id, { _id: actor.id, "flags.-=visage": null });
    }
  }

  if (actorsToUpdate.size > 0) {
    const updates = Array.from(actorsToUpdate.values());
    await Actor.updateDocuments(updates);
    ui.notifications.info(`Visage | Cleansed data from ${updates.length} actor(s) on scene "${canvas.scene.name}".`);
  } else {
    ui.notifications.info("Visage | No data found on tokens in the current scene.");
  }
}

/**
 * Removes all Visage-related data from all tokens in all scenes.
 * This is a destructive action and cannot be undone.
 * @returns {Promise<void>}
 */
export async function cleanseAllTokens() {
  const actorsToUpdate = new Map();

  for (const scene of game.scenes) {
    for (const token of scene.tokens) {
        const actor = token.actor;
        // Check if the actor has any visage flags and hasn't been processed yet
        if (actor?.getFlag("visage", "alternateImages") && !actorsToUpdate.has(actor.id)) {
            actorsToUpdate.set(actor.id, { _id: actor.id, "flags.-=visage": null });
        }
    }
  }

  if (actorsToUpdate.size > 0) {
    const updates = Array.from(actorsToUpdate.values());
    await Actor.updateDocuments(updates);
    ui.notifications.info(`Visage | Cleansed data from ${updates.length} actor(s) across all scenes.`);
  } else {
    ui.notifications.info("Visage | No data found on tokens in any scene.");
  }
}