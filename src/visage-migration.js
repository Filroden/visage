/**
 * @file Handles data migration logic for the Visage module.
 * Performs a "Hard Migration" to upgrade legacy data to the modern Unified Model (v2.0).
 * @module visage
 */

import { Visage } from "./visage.js";

/**
 * Performs a global migration of all Visage data.
 * * STRATEGY: HARD MIGRATION (Nuke and Pave)
 * 1. Reads all Visage data (Legacy "alternateImages" and Beta "alternateVisages").
 * 2. Normalizes every entry into the strict v2.0 Unified Model.
 * 3. STEP A: Delete BOTH the legacy and modern flags completely from the actor.
 * 4. STEP B: Write the clean, normalized object to the modern flag.
 * * This two-step process prevents Foundry from "merging" the clean data with the old dirty data.
 *
 * @returns {Promise<void>}
 */
export async function migrateWorldData() {
    const actorsToUpdate = new Map();

    // 1. Scan World Actors
    for (const actor of game.actors) {
        const hasLegacy = actor.flags?.[Visage.DATA_NAMESPACE]?.[Visage.LEGACY_FLAG_KEY];
        const hasModern = actor.flags?.[Visage.DATA_NAMESPACE]?.[Visage.ALTERNATE_FLAG_KEY];
        if (hasLegacy || hasModern) {
            actorsToUpdate.set(actor.id, actor);
        }
    }

    // 2. Scan Unlinked Tokens in Scenes
    for (const scene of game.scenes) {
        for (const token of scene.tokens) {
            if (!token.actorLink) {
                const actor = token.actor;
                const hasLegacy = actor?.flags?.[Visage.DATA_NAMESPACE]?.[Visage.LEGACY_FLAG_KEY];
                const hasModern = actor?.flags?.[Visage.DATA_NAMESPACE]?.[Visage.ALTERNATE_FLAG_KEY];
                
                if (hasLegacy || hasModern) {
                    actorsToUpdate.set(token.id, actor);
                }
            }
        }
    }

    if (actorsToUpdate.size === 0) return;

    const ns = Visage.DATA_NAMESPACE;
    const legacyKey = Visage.LEGACY_FLAG_KEY;
    const newKey = Visage.ALTERNATE_FLAG_KEY;

    ui.notifications.info("Visage: Starting Migration to v2.0...");
    console.group("Visage | Migration v2.0");

    for (const actor of actorsToUpdate.values()) {
        // Fetch raw data
        const legacyData = actor.getFlag(ns, legacyKey) || {};
        const modernData = actor.getFlag(ns, newKey) || {};
        
        // Merge sources (Modern takes precedence if ID collision)
        const allSourceData = { ...legacyData, ...modernData };
        const cleanData = {};
        
        // Track if we actually have data to migrate
        if (Object.keys(allSourceData).length === 0) continue;

        // Helper to generate IDs
        const getUUID = () => foundry.utils.randomID(16);

        // --- 1. PREPARE CLEAN DATA ---
        for (const [key, raw] of Object.entries(allSourceData)) {
            // Determine ID
            const isLegacyKey = key.length !== 16;
            const uuid = isLegacyKey ? getUUID() : key;

            // Normalize
            const entry = normalizeEntry(uuid, raw, key);
            cleanData[uuid] = entry;
        }

        // --- 2. THE "NUKE" (Delete Everything) ---
        // We delete BOTH keys to ensure no merging happens.
        try {
            await actor.update({
                [`flags.${ns}.-=${legacyKey}`]: null,
                [`flags.${ns}.-=${newKey}`]: null
            });
        } catch (err) {
            console.warn(`Visage | Migration cleanup warning for ${actor.name}`, err);
        }

        // --- 3. THE "PAVE" (Write Clean Data) ---
        // Now that the flags are gone, we write the fresh object.
        // We also check for active visage references that might need ID updates.
        const updateData = {
            [`flags.${ns}.${newKey}`]: cleanData
        };

        // Fix Active References (if using old name key)
        const actorFlags = actor.flags[ns];
        if (actorFlags) {
            for (const [flagKey, flagValue] of Object.entries(actorFlags)) {
                if (flagKey.length === 16 && flagValue?.currentFormKey) {
                    // Check if currentFormKey matches a Legacy Name we just migrated
                    // Note: This logic is tricky because we just deleted the flags, 
                    // but 'allSourceData' still holds the map.
                    // If the token is wearing "My Face", and we mapped "My Face" -> "UUID-123", update it.
                    // (Simple check: if currentFormKey is NOT in cleanData keys, it might be legacy)
                    if (!cleanData[flagValue.currentFormKey] && allSourceData[flagValue.currentFormKey]) {
                        // Find the new UUID for this legacy name
                        for (const [newId, entry] of Object.entries(cleanData)) {
                            if (entry.label === flagValue.currentFormKey) {
                                updateData[`flags.${ns}.${flagKey}.currentFormKey`] = newId;
                                break;
                            }
                        }
                    }
                }
            }
        }

        await actor.update(updateData);
        console.log(`Migrated ${actor.name} (${Object.keys(cleanData).length} entries)`);
    }

    console.groupEnd();
    ui.notifications.info(`Visage: Migration Complete. Updated ${actorsToUpdate.size} actors.`);
}

/**
 * Pure helper to convert any format (v1 string, v1 object, v2 messy) into v2 Clean.
 */
function normalizeEntry(id, data, fallbackName) {
    // If it's already perfect (has changes object), we extract JUST the changes
    // to drop any root-level garbage.
    if (data.changes) {
        return {
            id: id,
            label: data.label || data.name || fallbackName,
            category: data.category || "",
            tags: Array.isArray(data.tags) ? data.tags : [],
            changes: data.changes, // Keep the nested structure
            deleted: !!data.deleted,
            updated: Date.now()
        };
    }

    // LEGACY MIGRATION LOGIC (v1 -> v2)
    const isObject = typeof data === 'object' && data !== null;
    const path = isObject ? (data.path || data.token || "") : (data || "");
    const label = (isObject && data.name) ? data.name : fallbackName;
    
    // Scale & Flip
    const rawScale = isObject ? (data.scale ?? 1.0) : 1.0;
    const scale = Math.abs(rawScale);
    let isFlippedX = false;
    
    if (isObject && data.isFlippedX !== undefined) isFlippedX = data.isFlippedX;
    else isFlippedX = rawScale < 0; // Legacy negative scale trick

    const isFlippedY = (isObject && data.isFlippedY) || false;

    // Disposition
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