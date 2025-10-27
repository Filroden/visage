/**
 * Migration script for Visage data.
 * Migrates alternate visages from a name-keyed object (old) 
 * to a UUID-keyed object with the name as a property (new).
 */
import { Visage } from "./visage.js"; // Import Visage for namespace and keys

/**
 * Performs a global migration of all Visage data across all Actors.
 * This is an idempotent function designed to run once per world update.
 * @returns {Promise<void>}
 */
export async function migrateWorldData() {
    Visage.log("Starting Visage Data Migration...");

    const ns = Visage.DATA_NAMESPACE;
    const legacyKey = Visage.LEGACY_FLAG_KEY; // "alternateImages"
    const newKey = Visage.ALTERNATE_FLAG_KEY; // "alternateVisages"
    
    // 1. Collect all actors that need updating
    const actorsToUpdate = [];
    for (const actor of game.actors) {
        // Check if the actor has the old legacy flag
        const legacyData = actor.getFlag(ns, legacyKey);
        if (legacyData && typeof legacyData === 'object' && Object.keys(legacyData).length > 0) {
            actorsToUpdate.push(actor);
        }
    }

    if (actorsToUpdate.length === 0) {
        Visage.log("No legacy Visage data found. Migration complete.");
        return;
    }

    Visage.log(`Found ${actorsToUpdate.length} actors with legacy data. Migrating...`);

    // 2. Build the array of update operations
    const updateOperations = [];

    for (const actor of actorsToUpdate) {
        const legacyVisages = actor.getFlag(ns, legacyKey);
        
        // The new, UUID-keyed object
        const newVisages = {};
        
        // Iterate over the old structure (key is the name)
        for (const [name, data] of Object.entries(legacyVisages)) {
            // Generate a UUID for the new key
            const uuid = foundry.utils.randomID(16);

            // Ensure data is the full object structure (handles legacy string-only path)
            const isObject = typeof data === 'object' && data !== null;
            
            const path = isObject ? (data.path || data) : data;
            const scale = isObject ? (data.scale ?? 1.0) : 1.0;
            const disposition = isObject ? (data.disposition ?? null) : null;
            
            // Build the new object structure
            newVisages[uuid] = {
                name: name, // The old key becomes the name property
                path: path,
                scale: scale,
                disposition: disposition
            };

            // Additionally, check all token data for this actor.
            // If the currentFormKey points to the old name, update it to the new UUID.
            const tokenData = actor.getFlag(ns, actor.id); // Check the token-specific data
            if (tokenData?.currentFormKey === name) {
                 updateOperations.push({
                    _id: actor.id,
                    [`flags.${ns}.${actor.id}.currentFormKey`]: uuid
                });
            }
        }

        // Add the migration operation to the queue
        updateOperations.push({
            _id: actor.id,
            // 1. Set the new flag (UUID-keyed data)
            [`flags.${ns}.${newKey}`]: newVisages,
            // 2. Remove the old flag (name-keyed data)
            [`flags.${ns}.-=${legacyKey}`]: null
        });
    }

    // 3. Perform a single bulk update
    if (updateOperations.length > 0) {
        await Actor.updateDocuments(updateOperations);
        Visage.log(`Successfully migrated data for ${actorsToUpdate.length} actors.`);
    }

    // 4. Force a notification for completion
    ui.notifications.info("Visage module data migration to UUID structure complete.");
}