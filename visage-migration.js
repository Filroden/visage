/**
 * Migration script for Visage data.
 * Migrates alternate visages from a name-keyed object (old) 
 * to a UUID-keyed object with the name as a property (new).
 * * UPDATED: Now performs a "Deep Scan" to include unlinked tokens on scenes.
 */
import { Visage } from "./visage.js";

/**
 * Performs a global migration of all Visage data across all Actors and Tokens.
 * This is an idempotent function designed to run once per world update.
 * @returns {Promise<void>}
 */
export async function migrateWorldData() {
    Visage.log("Starting Visage Data Migration...");

    const ns = Visage.DATA_NAMESPACE;
    const legacyKey = Visage.LEGACY_FLAG_KEY; // "alternateImages"
    const newKey = Visage.ALTERNATE_FLAG_KEY; // "alternateVisages"
    
    // Use a Map to store unique actors to update.
    // Key: Actor UUID, Value: Actor Document
    const actorsToUpdate = new Map();

    // 1. Check World Actors (Sidebar)
    for (const actor of game.actors) {
        const legacyData = actor.getFlag(ns, legacyKey);
        if (legacyData && typeof legacyData === 'object' && Object.keys(legacyData).length > 0) {
            actorsToUpdate.set(actor.uuid, actor);
        }
    }

    // 2. Check Unlinked Tokens on All Scenes
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
        Visage.log("No legacy Visage data found anywhere. Migration complete.");
        return;
    }

    Visage.log(`Found ${actorsToUpdate.size} unique actors/tokens with legacy data. Migrating...`);

    // 3. Build the array of update operations
    // Note: We process updates sequentially or in batches to be safe, 
    // though Actor.updateDocuments handles world actors well. 
    // Synthetic actors must be updated individually or via their token.
    
    for (const actor of actorsToUpdate.values()) {
        const legacyVisages = actor.getFlag(ns, legacyKey);
        const newVisages = actor.getFlag(ns, newKey) || {}; // Preserve existing new data if any
        
        const updates = {
            [`flags.${ns}.-=${legacyKey}`]: null // Prepare to delete old key
        };

        // Helper to generate UUID
        const getUUID = () => foundry.utils.randomID(16);
        
        // Iterate over the old structure (key is the name)
        for (const [key, data] of Object.entries(legacyVisages)) {
            // Check if it's already a UUID (length 16) or legacy name
            // This allows re-running the script safely on partially migrated data
            const isLegacyKey = key.length !== 16;
            const uuid = isLegacyKey ? getUUID() : key;

            // Ensure data is the full object structure (handles legacy string-only path)
            const isObject = typeof data === 'object' && data !== null;
            
            const path = isObject ? (data.path || data) : data;
            const scale = isObject ? (data.scale ?? 1.0) : 1.0;
            
            // Fix Disposition: 2 -> -2
            let disposition = (isObject && data.disposition !== undefined) ? data.disposition : null;
            if (disposition === 2) disposition = -2;

            // Fix Secret: explicit boolean
            const secret = (isObject && data.secret === true);
            
            // Build the new object structure
            newVisages[uuid] = {
                name: isObject && data.name ? data.name : key, // Use old key as name
                path: path,
                scale: scale,
                disposition: disposition,
                secret: secret
            };

            // Update active form on tokens if they reference the old name
            // Check the token-specific flags on this actor
            const actorFlags = actor.flags[ns];
            if (actorFlags) {
                for (const [flagKey, flagValue] of Object.entries(actorFlags)) {
                    // If this flag key is a token ID (16 chars) and has a currentFormKey
                    if (flagKey.length === 16 && flagValue?.currentFormKey === key) {
                        updates[`flags.${ns}.${flagKey}.currentFormKey`] = uuid;
                    }
                }
            }
        }

        updates[`flags.${ns}.${newKey}`] = newVisages;
        
        // Apply update
        await actor.update(updates);
        Visage.log(`Migrated actor: ${actor.name}`);
    }

    // 4. Force a notification for completion
    ui.notifications.info(`Visage: Migrated data for ${actorsToUpdate.size} actors/tokens.`);
}