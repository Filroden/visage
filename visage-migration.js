/**
 * @file Handles data migration logic for the Visage module. This script is responsible for upgrading legacy
 * data structures to the modern format, ensuring a smooth transition between module versions.
 * @module visage
 */

import { Visage } from "./visage.js";

/**
 * Performs a global migration of all Visage data from the legacy name-keyed format (`alternateImages`)
 * to the modern UUID-keyed format (`alternateVisages`).
 *
 * This function is idempotent, meaning it is safe to run multiple times. It performs a "Deep Scan" to
 * ensure all data is migrated, covering two primary sources:
 * 1.  **World Actors**: Actors that exist in the `game.actors` directory.
 * 2.  **Unlinked Tokens**: Synthetic actors embedded in tokens across all scenes, which do not
 *     exist in the world directory.
 *
 * The migration process for each found actor involves:
 * - Reading the legacy `alternateImages` data.
 * - For each entry, generating a new stable UUID if one doesn't exist.
 * - Normalizing data fields (e.g., converting legacy `disposition: 2` to `-2`).
 * - Updating the `currentFormKey` on any tokens that were referencing the old name-based key to
 *   point to the new UUID, preserving the user's selection.
 * - Writing the new data to the `alternateVisages` flag and unsetting the old `alternateImages` flag.
 *
 * @returns {Promise<void>} A promise that resolves when the migration is complete.
 */
export async function migrateWorldData() {
    const actorsToUpdate = new Map();

    // 1. Scan World Actors
    for (const actor of game.actors) {
        if (actor.flags?.[Visage.DATA_NAMESPACE]?.[Visage.LEGACY_FLAG_KEY]) {
            actorsToUpdate.set(actor.id, actor);
        }
    }

    // 2. Scan Unlinked Tokens in Scenes
    for (const scene of game.scenes) {
        for (const token of scene.tokens) {
            if (!token.actorLink && token.actor?.flags?.[Visage.DATA_NAMESPACE]?.[Visage.LEGACY_FLAG_KEY]) {
                // Use token ID as unique key for unlinked actors
                actorsToUpdate.set(token.id, token.actor);
            }
        }
    }

    if (actorsToUpdate.size === 0) return;

    const ns = Visage.DATA_NAMESPACE;
    const legacyKey = Visage.LEGACY_FLAG_KEY;
    const newKey = Visage.ALTERNATE_FLAG_KEY;

    ui.notifications.info("Visage: Migrating data to version 2.0...");

    for (const actor of actorsToUpdate.values()) {
        const legacyVisages = actor.getFlag(ns, legacyKey);
        const newVisages = actor.getFlag(ns, newKey) || {};
        
        const updates = {
            [`flags.${ns}.-=${legacyKey}`]: null
        };

        const getUUID = () => foundry.utils.randomID(16);
        
        for (const [key, data] of Object.entries(legacyVisages)) {
            const isLegacyKey = key.length !== 16;
            const uuid = isLegacyKey ? getUUID() : key;
            const isObject = typeof data === 'object' && data !== null;
            
            // --- v2.0 NORMALIZATION LOGIC ---
            const rawScale = isObject ? (data.scale ?? 1.0) : 1.0;
            const scale = Math.abs(rawScale); 
            const isFlippedX = rawScale < 0; // Convert negative scale to flip flag
            
            const path = isObject ? (data.path || data) : data;
            
            let disposition = (isObject && data.disposition !== undefined) ? data.disposition : null;
            if (disposition === 2) disposition = -2;

            const secret = (isObject && data.secret === true);
            
            newVisages[uuid] = {
                name: isObject && data.name ? data.name : key,
                path: path,
                scale: scale,
                isFlippedX: isFlippedX, 
                isFlippedY: false, // Default for legacy
                disposition: disposition,
                secret: secret,
                ring: isObject ? data.ring : null, 
                width: isObject ? (data.width ?? 1) : 1,
                height: isObject ? (data.height ?? 1) : 1
            };

            // Update active tokens referencing old keys
            const actorFlags = actor.flags[ns];
            if (actorFlags) {
                for (const [flagKey, flagValue] of Object.entries(actorFlags)) {
                    if (flagKey.length === 16 && flagValue?.currentFormKey === key) {
                        updates[`flags.${ns}.${flagKey}.currentFormKey`] = uuid;
                    }
                }
            }
        }

        updates[`flags.${ns}.${newKey}`] = newVisages;
        await actor.update(updates);
        Visage.log(`Migrated actor: ${actor.name} (${actor.id})`);
    }

    ui.notifications.info(`Visage: Successfully migrated data for ${actorsToUpdate.size} actors/tokens.`);
}