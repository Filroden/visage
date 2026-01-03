/**
 * @file Utility functions for data cleanup.
 * @module visage
 */

import { Visage } from "./visage.js";

async function getRevertData(token) {
    const ns = Visage.DATA_NAMESPACE;
    const flags = token.flags?.[ns];
    if (!flags) return null;

    // 1. Prepare the "Wipe" command
    const updates = {
        _id: token.id,
        [`flags.-=${ns}`]: null
    };

    // 2. Retrieve Original State Snapshot (if it exists)
    // If we simply delete flags, the token stays looking like a dragon.
    // We must restore the pixels to what they were before Visage touched them.
    const original = flags.originalState;
    
    if (original) {
        // Restore texture path
        if (original.texture?.src) updates["texture.src"] = original.texture.src;
        else if (original.img) updates["texture.src"] = original.img; // Legacy compat

        // Restore Scales / Flips
        if (original.texture?.scaleX !== undefined) updates["texture.scaleX"] = original.texture.scaleX;
        else if (original.scaleX !== undefined) updates["texture.scaleX"] = original.scaleX;

        if (original.texture?.scaleY !== undefined) updates["texture.scaleY"] = original.texture.scaleY;
        else if (original.scaleY !== undefined) updates["texture.scaleY"] = original.scaleY;

        // Restore Dimensions
        if (original.width) updates["width"] = original.width;
        if (original.height) updates["height"] = original.height;

        // Restore Ring
        if (original.ring) updates["ring"] = original.ring;

        // Restore Name (if overridden)
        if (original.name) updates["name"] = original.name;
    } else {
        // Fallback: If no snapshot exists, we can try to reset to Prototype
        // But usually, if there's no originalState, Visage hasn't "taken over" yet,
        // so just deleting flags is safe.
    }

    return updates;
}

export async function cleanseSceneTokens() {
  if (!canvas.scene) return;

  const actorUpdates = new Map();
  const unlinkedActorPromises = [];
  const tokenUpdates = [];
  let count = 0;
  
  for (const token of canvas.scene.tokens) {
    // A. Cleanse Actor Flags (Local Visages)
    const actor = token.actor;
    if (actor?.flags?.[Visage.DATA_NAMESPACE]) {
        const deleteKey = `flags.-=${Visage.DATA_NAMESPACE}`;
        const updateData = { _id: actor.id, [deleteKey]: null };
        
        if (token.actorLink) {
            if (!actorUpdates.has(actor.id)) {
                actorUpdates.set(actor.id, updateData);
                count++;
            }
        } else {
            unlinkedActorPromises.push(actor.update({ [deleteKey]: null }));
            count++;
        }
    }

    // B. Cleanse Token Data (Global Masks + Active State)
    if (token.flags?.[Visage.DATA_NAMESPACE]) {
        const revertUpdate = await getRevertData(token);
        if (revertUpdate) {
            tokenUpdates.push(revertUpdate);
            count++;
        }
    }
  }

  if (count > 0) {
    if (actorUpdates.size > 0) await Actor.updateDocuments(Array.from(actorUpdates.values()));
    if (unlinkedActorPromises.length > 0) await Promise.all(unlinkedActorPromises);
    if (tokenUpdates.length > 0) await canvas.scene.updateEmbeddedDocuments("Token", tokenUpdates);
    
    ui.notifications.info(`Visage | Cleansed and reverted ${count} entities on scene "${canvas.scene.name}".`);
  } else {
    ui.notifications.info("Visage | No active Visage data found on this scene.");
  }
}

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
    
    if (actorUpdates.size > 0) await Actor.updateDocuments(Array.from(actorUpdates.values()));
    if (unlinkedPromises.length > 0) await Promise.all(unlinkedPromises);
    if (tokenUpdates.length > 0) await scene.updateEmbeddedDocuments("Token", tokenUpdates);
  }

  ui.notifications.info(`Visage | World Cleanse complete. Processed ${count} entities.`);
}