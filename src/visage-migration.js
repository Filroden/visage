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
 * 2. **Library Migration**: Convert legacy "visages" format to the new "alternateVisages" format and fix Schema (img -> texture.src).
 * 3. **Snapshot Repair**: Patch "Default" snapshots with missing v2 properties (Dynamic Ring, Dimensions, Schema).
 * 4. **Active Token Repair**: Fix "originalState" flags on tokens currently on the canvas.
 * 5. **Garbage Collection**: Delete data for tokens that no longer exist in the world.
 */
export async function migrateWorldData() {
    const ns = Visage.DATA_NAMESPACE;
    const legacyKey = Visage.LEGACY_FLAG_KEY || "visages"; 
    const newKey = Visage.ALTERNATE_FLAG_KEY || "alternateVisages";

    ui.notifications.info("Visage: Starting Migration to v2.2...");
    console.group("Visage | Migration v2.2");

    // --- PHASE 0: INDEX ALL TOKENS ---
    const worldTokenMap = new Map(); // ID -> TokenDocument
    for (const scene of game.scenes) {
        for (const token of scene.tokens) {
            worldTokenMap.set(token.id, token);
        }
    }

    // Identify unique Actors to process
    const actorsToUpdate = new Map();
    for (const actor of game.actors) actorsToUpdate.set(actor.id, actor);
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
        if (Object.keys(actorFlags).length === 0) continue;

        let updates = {};
        let performUpdate = false;

        // =========================================================
        // PHASE 1: MIGRATE LIBRARY (The "Visages")
        // =========================================================
        const legacyData = actorFlags[legacyKey];
        const modernData = actorFlags[newKey];

        // 1a. Convert v1 -> v2 if legacy exists
        if (legacyData) {
            const cleanData = modernData ? foundry.utils.deepClone(modernData) : {};
            
            for (const [key, raw] of Object.entries(legacyData)) {
                if (!raw) continue;
                const uuid = foundry.utils.randomID(16);
                cleanData[uuid] = normalizeEntry(uuid, raw, key);
            }
            
            updates[`flags.${ns}.-=${legacyKey}`] = null;
            updates[`flags.${ns}.${newKey}`] = cleanData;
            performUpdate = true;
        }

        // 1b. Repair v2 Schema (img -> texture.src)
        // This runs if modernData exists (either pre-existing or just created above)
        // Note: If we just created it in 1a, normalizeEntry handles it, but this double-checks existing v2.0 data.
        if (modernData && !legacyData) {
            for (const [id, entry] of Object.entries(modernData)) {
                // If entry has 'img' at root of changes but no 'texture.src'
                if (entry.changes && entry.changes.img && !entry.changes.texture?.src) {
                    const texture = entry.changes.texture || { scaleX: 1, scaleY: 1 };
                    texture.src = entry.changes.img;
                    
                    updates[`flags.${ns}.${newKey}.${id}.changes.texture`] = texture;
                    updates[`flags.${ns}.${newKey}.${id}.changes.-=img`] = null;
                    performUpdate = true;
                }
            }
        }

        // =========================================================
        // PHASE 2: MIGRATE DEFAULTS (The "Snapshots" stored on Actor)
        // =========================================================
        for (const [key, flagData] of Object.entries(actorFlags)) {
            if (key === legacyKey || key === newKey) continue; 
            if (key.length !== 16) continue; 

            const tokenDoc = worldTokenMap.get(key);

            // A. GARBAGE COLLECTION
            if (!tokenDoc) {
                updates[`flags.${ns}.-=${key}`] = null;
                performUpdate = true;
                continue;
            }

            // B. SNAPSHOT REPAIR (Fixes the "defaults" object)
            if (flagData?.defaults) {
                const defs = foundry.utils.deepClone(flagData.defaults);
                let defaultsChanged = false;

                // 1. Repair Schema (img -> texture.src)
                if (defs.img && !defs.texture?.src) {
                    if (!defs.texture) defs.texture = { scaleX: 1, scaleY: 1 };
                    defs.texture.src = defs.img;
                    delete defs.img;
                    defaultsChanged = true;
                }

                // 2. Patch Missing v2 Properties
                const sourceData = tokenDoc.toObject();
                if (defs.ring === undefined) {
                    defs.ring = sourceData.ring;
                    defaultsChanged = true;
                }
                if (defs.width === undefined || defs.height === undefined) {
                    defs.width = sourceData.width ?? 1;
                    defs.height = sourceData.height ?? 1;
                    defaultsChanged = true;
                }

                if (defaultsChanged) {
                    updates[`flags.${ns}.${key}.defaults`] = defs;
                    performUpdate = true;
                }
            }
        }

        if (performUpdate) {
            await actor.update(updates);
            console.log(`Visage | Migrated Actor: ${actor.name}`);
        }
    }

    // =========================================================
    // PHASE 3: FIX ACTIVE TOKENS (originalState)
    // =========================================================
    // If a token currently has a Visage active, its "originalState" flag 
    // might still be using the old 'img' schema. We must fix this so 'Revert' works.
    for (const token of worldTokenMap.values()) {
        const originalState = token.flags[ns]?.originalState;
        
        if (originalState && originalState.img && !originalState.texture?.src) {
            const newState = foundry.utils.deepClone(originalState);
            
            if (!newState.texture) newState.texture = { scaleX: 1, scaleY: 1 };
            newState.texture.src = newState.img;
            delete newState.img; // Remove legacy field

            await token.update({
                [`flags.${ns}.originalState`]: newState
            });
            console.log(`Visage | Repaired Active Token Snapshot: ${token.name}`);
        }
    }

    console.groupEnd();
    ui.notifications.info(`Visage: Migration & Cleanup Complete.`);
}

/**
 * Helper: Converts any raw data format (v1 or partial v2) into the strict Unified Model v2.2.
 */
function normalizeEntry(id, data, fallbackName) {
    if (data.changes) {
        // v2.0 Data: Ensure it complies with v2.2 (texture.src)
        const changes = foundry.utils.deepClone(data.changes);
        if (changes.img && !changes.texture?.src) {
            if (!changes.texture) changes.texture = { scaleX: 1, scaleY: 1 };
            changes.texture.src = changes.img;
            delete changes.img;
        }

        return {
            id: id,
            label: data.label || data.name || fallbackName,
            category: data.category || "",
            tags: Array.isArray(data.tags) ? data.tags : [],
            changes: changes,
            deleted: !!data.deleted,
            updated: Date.now()
        };
    }

    // v1.0 Data (Legacy Flat Format)
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
            texture: {
                src: path,
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