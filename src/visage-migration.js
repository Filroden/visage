/**
 * @file Handles data migration logic for the Visage module.
 * Performs a "Hard Migration" to upgrade legacy data to the modern Unified Model (v2.0).
 * @module visage
 */

import { Visage } from "./visage.js";

/**
 * Performs a global migration of all Visage data.
 * STRATEGY: HARD MIGRATION & GARBAGE COLLECTION
 * 1. Normalize "Visage Gallery" entries (v1 -> v2).
 * 2. Scan and repair "Token Defaults" snapshots.
 * 3. Garbage collect snapshots for tokens that no longer exist.
 */
export async function migrateWorldData() {
    const ns = Visage.DATA_NAMESPACE;
    const legacyKey = Visage.LEGACY_FLAG_KEY;
    const newKey = Visage.ALTERNATE_FLAG_KEY;

    ui.notifications.info("Visage: Starting Migration to v2.0...");
    console.group("Visage | Migration v2.0");

    // --- PREP: INDEX ALL TOKENS ---
    // We need to know which tokens actually exist to fix their defaults or GC them.
    const worldTokenMap = new Map(); // ID -> TokenDocument
    for (const scene of game.scenes) {
        for (const token of scene.tokens) {
            worldTokenMap.set(token.id, token);
        }
    }

    // Identify Actors to process
    const actorsToUpdate = new Map();
    for (const actor of game.actors) actorsToUpdate.set(actor.id, actor);
    // Add unlinked actors from scenes
    for (const token of worldTokenMap.values()) {
        if (!token.actorLink && token.actor) {
            actorsToUpdate.set(token.actor.id, token.actor);
        }
    }

    if (actorsToUpdate.size === 0) return;

    for (const actor of actorsToUpdate.values()) {
        const actorFlags = actor.flags[ns] || {};
        
        // Skip actors with no visage data
        if (Object.keys(actorFlags).length === 0) continue;

        let updates = {};
        let performUpdate = false;

        // =========================================================
        // PHASE 1: MIGRATE LIBRARY (The "Visages")
        // =========================================================
        const legacyData = actorFlags[legacyKey];
        const modernData = actorFlags[newKey];

        if (legacyData || modernData) {
            const allSourceData = { ...(legacyData || {}), ...(modernData || {}) };
            const cleanData = {};
            const getUUID = () => foundry.utils.randomID(16);

            for (const [key, raw] of Object.entries(allSourceData)) {
                // Garbage check: Is this actually a visage entry?
                if (!raw) continue;
                
                const isLegacyKey = key.length !== 16;
                const uuid = isLegacyKey ? getUUID() : key;
                cleanData[uuid] = normalizeEntry(uuid, raw, key);
            }

            // Nuke & Pave
            updates[`flags.${ns}.-=${legacyKey}`] = null;
            updates[`flags.${ns}.${newKey}`] = cleanData;
            performUpdate = true;
        }

        // =========================================================
        // PHASE 2: MIGRATE DEFAULTS (The "Snapshots")
        // =========================================================
        // Iterate over keys that look like Token IDs (16 chars)
        for (const [key, flagData] of Object.entries(actorFlags)) {
            if (key === legacyKey || key === newKey) continue; // Skip library keys
            if (key.length !== 16) continue; // Not a valid ID

            const tokenDoc = worldTokenMap.get(key);

            // A. GARBAGE COLLECTION
            // If the token no longer exists in any scene, delete the data.
            if (!tokenDoc) {
                updates[`flags.${ns}.-=${key}`] = null;
                performUpdate = true;
                console.log(`Visage | GC: Removing orphaned data for missing token ${key}`);
                continue;
            }

            // B. SNAPSHOT REPAIR
            // If token exists, ensure its "defaults" snapshot is v2.0 compliant.
            if (flagData?.defaults) {
                const defs = flagData.defaults;
                const sourceData = tokenDoc.toObject(); // Get current state as patch source

                // Check for missing v2 properties
                const missingRing = defs.ring === undefined;
                const missingDims = defs.width === undefined || defs.height === undefined;

                if (missingRing || missingDims) {
                    const newDefaults = { ...defs };
                    
                    if (missingRing) newDefaults.ring = sourceData.ring;
                    if (missingDims) {
                        newDefaults.width = sourceData.width ?? 1;
                        newDefaults.height = sourceData.height ?? 1;
                    }

                    // Write the patched defaults back
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
 * Helper: Convert any format to v2 Unified Model
 */
function normalizeEntry(id, data, fallbackName) {
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

    const isObject = typeof data === 'object' && data !== null;
    const path = isObject ? (data.path || data.token || "") : (data || "");
    const label = (isObject && data.name) ? data.name : fallbackName;
    
    const rawScale = isObject ? (data.scale ?? 1.0) : 1.0;
    const scale = Math.abs(rawScale);
    let isFlippedX = (isObject && data.isFlippedX !== undefined) ? data.isFlippedX : (rawScale < 0);
    const isFlippedY = (isObject && data.isFlippedY) || false;

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
            texture: { scaleX: scale * (isFlippedX ? -1 : 1), scaleY: scale * (isFlippedY ? -1 : 1) },
            width: isObject ? (data.width ?? 1) : 1,
            height: isObject ? (data.height ?? 1) : 1,
            disposition: disposition,
            ring: (isObject && data.ring) ? data.ring : null
        }
    };
}