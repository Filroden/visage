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
    Visage.log("Starting Visage Data Migration...");

    const ns = Visage.DATA_NAMESPACE;
    const legacyKey = Visage.LEGACY_FLAG_KEY;
    const newKey = Visage.ALTERNATE_FLAG_KEY;
    
    // Use a Map to store unique actors to update, preventing duplicate processing.
    const actorsToUpdate = new Map();

    // 1. Scan World Actors (in the sidebar).
    for (const actor of game.actors) {
        const legacyData = actor.getFlag(ns, legacyKey);
        if (legacyData && typeof legacyData === 'object' && Object.keys(legacyData).length > 0) {
            actorsToUpdate.set(actor.uuid, actor);
        }
    }

    // 2. Scan for Unlinked Tokens on all scenes.
    // This is crucial as their actor data is stored with the token, not in `game.actors`.
    for (const scene of game.scenes) {
        for (const token of scene.tokens) {
            if (!token.actorLink && token.actor) {
                const legacyData = token.actor.getFlag(ns, legacyKey);
                if (legacyData && typeof legacyData === 'object' && Object.keys(legacyData).length > 0) {
                    actorsToUpdate.set(token.actor.uuid, token.actor);
                }
            }
        }
    }

    if (actorsToUpdate.size === 0) {
        Visage.log("No legacy Visage data found. Migration not needed.");
        return;
    }

    Visage.log(`Found ${actorsToUpdate.size} unique actors/tokens with legacy data. Migrating...`);

    // 3. Iterate through the unique set of actors and perform the migration.
    for (const actor of actorsToUpdate.values()) {
        const legacyVisages = actor.getFlag(ns, legacyKey);
        // Preserve any existing modern data to avoid data loss if migration is re-run.
        const newVisages = actor.getFlag(ns, newKey) || {};
        
        const updates = {
            [`flags.${ns}.-=${legacyKey}`]: null // Prepare to delete the old key.
        };

        const getUUID = () => foundry.utils.randomID(16);
        
        for (const [key, data] of Object.entries(legacyVisages)) {
            // A legacy key is the visage name; a modern key is a 16-char ID.
            const isLegacyKey = key.length !== 16;
            const uuid = isLegacyKey ? getUUID() : key;

            // Handle both legacy string-only data and object-based data.
            const isObject = typeof data === 'object' && data !== null;
            
            const path = isObject ? (data.path || data) : data;
            const scale = isObject ? (data.scale ?? 1.0) : 1.0;
            
            // Normalize disposition: a value of 2 was used for "Secret" in legacy versions.
            let disposition = (isObject && data.disposition !== undefined) ? data.disposition : null;
            if (disposition === 2) disposition = -2;

            const secret = (isObject && data.secret === true);
            
            newVisages[uuid] = {
                name: isObject && data.name ? data.name : key, // Use old key as name if no name is set.
                path: path,
                scale: scale,
                disposition: disposition,
                secret: secret
            };

            // Update any tokens that were actively using the old name-based key.
            const actorFlags = actor.flags[ns];
            if (actorFlags) {
                for (const [flagKey, flagValue] of Object.entries(actorFlags)) {
                    // Check if a token-specific flag has a `currentFormKey` matching the old name.
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