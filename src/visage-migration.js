/**
 * @file Handles data migration logic for the Visage module.
 * Performs a "Hard Migration" to upgrade legacy data (v1.x) to the modern Unified Model (v2.0).
 * Also handles garbage collection for orphaned token data.
 * @module visage
 */

import { Visage } from "./visage.js";

/**
 * Performs a global migration of all Visage data across all Actors in the world.
 * * STRATEGY:
 * 1. **Index**: Build a map of all valid tokens in all scenes.
 * 2. **Library Migration**: Convert legacy "visages" format to the new "alternateVisages" format.
 * 3. **Snapshot Repair**: Patch "Default" snapshots with missing v2 properties (Dynamic Ring, Dimensions).
 * 4. **Garbage Collection**: Delete data for tokens that no longer exist in the world.
 */
export async function migrateWorldData() {
    const ns = Visage.DATA_NAMESPACE;
    const legacyKey = Visage.LEGACY_FLAG_KEY || "visages"; // Fallback if constant is missing
    const newKey = Visage.ALTERNATE_FLAG_KEY || "alternateVisages";

    ui.notifications.info("Visage: Starting Migration to v2.0...");
    console.group("Visage | Migration v2.0");

    // --- PHASE 0: INDEX ALL TOKENS ---
    // We need a complete list of valid tokens to determine if data is orphaned.
    const worldTokenMap = new Map(); // ID -> TokenDocument
    for (const scene of game.scenes) {
        for (const token of scene.tokens) {
            worldTokenMap.set(token.id, token);
        }
    }

    // Identify unique Actors to process (Real Actors + Synthetic Token Actors)
    const actorsToUpdate = new Map();
    for (const actor of game.actors) actorsToUpdate.set(actor.id, actor);
    
    // Add unlinked actors found in the scene index
    for (const token of worldTokenMap.values()) {
        if (!token.actorLink && token.actor) {
            actorsToUpdate.set(token.actor.id, token.actor);
        }
    }

    if (actorsToUpdate.size === 0) {
        console.log("Visage | No actors found to migrate.");
        console.groupEnd();
        return;
    }

    for (const actor of actorsToUpdate.values()) {
        const actorFlags = actor.flags[ns] || {};
        
        // Skip actors with no visage data to save DB writes
        if (Object.keys(actorFlags).length === 0) continue;

        let updates = {};
        let performUpdate = false;

        // =========================================================
        // PHASE 1: MIGRATE LIBRARY (The "Visages")
        // =========================================================
        const legacyData = actorFlags[legacyKey];
        const modernData = actorFlags[newKey];

        // If either exists, we must ensure they are unified under the new key
        if (legacyData || modernData) {
            const allSourceData = { ...(legacyData || {}), ...(modernData || {}) };
            const cleanData = {};
            const getUUID = () => foundry.utils.randomID(16);

            for (const [key, raw] of Object.entries(allSourceData)) {
                // Safety Check: Is this valid data?
                if (!raw) continue;
                
                // If key is not a standard 16-char ID (e.g., sequential integer from v1), generate a new UUID
                const isLegacyKey = key.length !== 16;
                const uuid = isLegacyKey ? getUUID() : key;
                
                cleanData[uuid] = normalizeEntry(uuid, raw, key);
            }

            // Nuke the old key and write the new clean object
            if (legacyData) updates[`flags.${ns}.-=${legacyKey}`] = null;
            updates[`flags.${ns}.${newKey}`] = cleanData;
            performUpdate = true;
        }

        // =========================================================
        // PHASE 2: MIGRATE DEFAULTS (The "Snapshots")
        // =========================================================
        // Iterate over flag keys. Keys that are 16-chars long (Token IDs) represent specific token state snapshots.
        for (const [key, flagData] of Object.entries(actorFlags)) {
            if (key === legacyKey || key === newKey) continue; // Skip library containers
            if (key.length !== 16) continue; // Not a valid Token ID

            const tokenDoc = worldTokenMap.get(key);

            // A. GARBAGE COLLECTION
            // If the token ID in the flags doesn't match any token in the world index, delete it.
            if (!tokenDoc) {
                updates[`flags.${ns}.-=${key}`] = null;
                performUpdate = true;
                console.log(`Visage | GC: Removing orphaned data for missing token ${key}`);
                continue;
            }

            // B. SNAPSHOT REPAIR
            // If the token exists, check if its "Default State" snapshot is missing new v2 properties.
            if (flagData?.defaults) {
                const defs = flagData.defaults;
                const sourceData = tokenDoc.toObject(); // Get current state to patch missing holes

                // Check for specific v2 properties
                const missingRing = defs.ring === undefined;
                const missingDims = defs.width === undefined || defs.height === undefined;

                if (missingRing || missingDims) {
                    const newDefaults = { ...defs };
                    
                    if (missingRing) newDefaults.ring = sourceData.ring;
                    if (missingDims) {
                        newDefaults.width = sourceData.width ?? 1;
                        newDefaults.height = sourceData.height ?? 1;
                    }

                    // Write the patched defaults back to the actor
                    updates[`flags.${ns}.${key}.defaults`] = newDefaults;
                    performUpdate = true;
                }
            }
        }

        if (performUpdate) {
            await actor.update(updates);
            console.log(`Migrated ${actor.name}`);
        }
    }

    console.groupEnd();
    ui.notifications.info(`Visage: Migration & Cleanup Complete.`);
}

/**
 * Helper: Converts any raw data format (v1 or partial v2) into the strict Unified Model v2.0.
 * Handles normalizing image paths, flip logic, and ring structure.
 * * @param {string} id - The ID for the entry.
 * @param {Object} data - The raw data to normalize.
 * @param {string} fallbackName - A fallback name if the data lacks a label.
 * @returns {Object} A fully compliant Visage Data Object.
 */
function normalizeEntry(id, data, fallbackName) {
    // If it already has the 'changes' structure, just pass it through with minor cleanup
    if (data.changes) {
        return {
            id: id,
            label: data.label || data.name || fallbackName,
            category: data.category || "",
            tags: Array.isArray(data.tags) ? data.tags : [],
            changes: data.changes,
            deleted: !!data.deleted,
            updated: Date.now()
        };
    }

    // Handle legacy flat format (v1)
    const isObject = typeof data === 'object' && data !== null;
    const path = isObject ? (data.path || data.token || "") : (data || "");
    const label = (isObject && data.name) ? data.name : fallbackName;
    
    // Scale & Flip Logic
    const rawScale = isObject ? (data.scale ?? 1.0) : 1.0;
    const scale = Math.abs(rawScale);
    let isFlippedX = (isObject && data.isFlippedX !== undefined) ? data.isFlippedX : (rawScale < 0);
    const isFlippedY = (isObject && data.isFlippedY) || false;

    // Disposition Mapping
    let disposition = (isObject && data.disposition !== undefined) ? data.disposition : null;
    if (disposition === 2 || (isObject && data.secret === true)) disposition = -2;

    return {
        id: id,
        label: label,
        category: "",
        tags: [],
        deleted: false,
        updated: Date.now(),
        changes: {
            name: label,
            img: path,
            texture: { 
                scaleX: scale * (isFlippedX ? -1 : 1), 
                scaleY: scale * (isFlippedY ? -1 : 1) 
            },
            width: isObject ? (data.width ?? 1) : 1,
            height: isObject ? (data.height ?? 1) : 1,
            disposition: disposition,
            ring: (isObject && data.ring) ? data.ring : null
        }
    };
}