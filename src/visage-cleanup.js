/* visage-cleanup.js */
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
        if (original.texture?.src) {
            updates["texture.src"] = original.texture.src;
        }
        
        // Restore dimensions and scaling
        if (original.width) updates["width"] = original.width;
        if (original.height) updates["height"] = original.height;
        if (original.texture?.scaleX) updates["texture.scaleX"] = original.texture.scaleX;
        if (original.texture?.scaleY) updates["texture.scaleY"] = original.texture.scaleY;
        
        // Restore Ring Data
        if (original.ring) updates["ring"] = original.ring;

        // Restore other properties
        if (original.name) updates["name"] = original.name;
        if (original.displayName !== undefined) updates["displayName"] = original.displayName;
        if (original.disposition !== undefined) updates["disposition"] = original.disposition;
    }

    return updates;
}

/**
 * Cleanses all tokens in the CURRENT SCENE.
 * Useful for fixing a specific map without nuking the whole world.
 */
export async function cleanseSceneTokens() {
    if (!canvas.scene) return;
    const tokenUpdates = [];
    let count = 0;

    for (const token of canvas.scene.tokens) {
        if (token.flags?.[Visage.DATA_NAMESPACE]) {
            const revertUpdate = await getRevertData(token);
            if (revertUpdate) {
                tokenUpdates.push(revertUpdate);
                count++;
            }
        }
    }

    if (tokenUpdates.length > 0) {
        await canvas.scene.updateEmbeddedDocuments("Token", tokenUpdates);
        ui.notifications.info(`Visage | Cleansed ${count} tokens in the current scene.`);
    } else {
        ui.notifications.info("Visage | No tokens needed cleansing.");
    }
}

/**
 * Cleanses ALL tokens and actors in the WORLD.
 * This is a "Nuclear Option" for removing Visage data from entities.
 * NOTE: This does NOT delete the Global Mask Library (World Settings).
 */
export async function cleanseAllTokens() {
  let count = 0;
  
  ui.notifications.info("Visage | Starting Global Cleanup...");

  // 1. Iterate over every Scene
  for (const scene of game.scenes) {
    const tokenUpdates = []; 
    const actorUpdates = new Map();
    const unlinkedPromises = [];

    for (const token of scene.tokens) {
        // A. Actor Cleanup (Remove Local Visages)
        const actor = token.actor;
        if (actor?.flags?.[Visage.DATA_NAMESPACE]) {
            const deleteKey = `flags.-=${Visage.DATA_NAMESPACE}`;
            const updateData = { _id: actor.id, [deleteKey]: null };
            
            if (token.actorLink) {
                 if (!actorUpdates.has(actor.id)) actorUpdates.set(actor.id, updateData);
            } else {
                // Unlinked actors must be updated individually via the token's synthetic actor
                unlinkedPromises.push(actor.update({ [deleteKey]: null }));
            }
        }

        // B. Token Cleanup (Revert Appearance)
        if (token.flags?.[Visage.DATA_NAMESPACE]) {
             const revertUpdate = await getRevertData(token);
             if (revertUpdate) {
                 tokenUpdates.push(revertUpdate);
                 count++;
             }
        }
    }
    
    // Execute per-scene bulk updates to prevent database locks
    if (actorUpdates.size > 0) await Actor.updateDocuments(Array.from(actorUpdates.values()));
    if (unlinkedPromises.length > 0) await Promise.all(unlinkedPromises);
    if (tokenUpdates.length > 0) await scene.updateEmbeddedDocuments("Token", tokenUpdates);
  }

  // 2. Clean Actors in the Sidebar (that might not be on any scene)
  const sidebarActorUpdates = [];
  for (const actor of game.actors) {
      if (actor.flags?.[Visage.DATA_NAMESPACE]) {
          sidebarActorUpdates.push({ 
              _id: actor.id, 
              [`flags.-=${Visage.DATA_NAMESPACE}`]: null 
          });
      }
  }
  if (sidebarActorUpdates.length > 0) {
      await Actor.updateDocuments(sidebarActorUpdates);
      count += sidebarActorUpdates.length;
  }

  ui.notifications.info(`Visage | Global Cleanup Complete. Reverted/Cleaned ${count} entities.`);
}