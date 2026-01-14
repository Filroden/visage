/**
 * @file Handles data migration logic for the Visage module.
 * Performs a "Hard Migration" to upgrade legacy data (v1.x) to the modern Unified Model (v2.0/v2.2).
 * Also handles garbage collection for orphaned token data.
 * @module visage
 */

import { Visage } from "./visage.js";
import { VisageData } from "./visage-data.js"; // Added import for SETTING_KEY

export async function migrateWorldData() {
    const ns = Visage.DATA_NAMESPACE;
    const legacyKey = Visage.LEGACY_FLAG_KEY || "visages"; 
    const newKey = Visage.ALTERNATE_FLAG_KEY || "alternateVisages";

    ui.notifications.info("Visage: Starting Migration to v2.2...");
    console.group("Visage | Migration v2.2");

    // --- PHASE 0: INDEX ALL TOKENS ---
    const worldTokenMap = new Map(); 
    for (const scene of game.scenes) {
        for (const token of scene.tokens) {
            worldTokenMap.set(token.id, token);
        }
    }

    const actorsToUpdate = new Map();
    for (const actor of game.actors) actorsToUpdate.set(actor.id, actor);
    for (const token of worldTokenMap.values()) {
        if (!token.actorLink && token.actor) {
            actorsToUpdate.set(token.actor.id, token.actor);
        }
    }

    // =========================================================
    // PHASE 1: MIGRATE ACTORS (Local Library & Defaults)
    // =========================================================
    for (const actor of actorsToUpdate.values()) {
        const actorFlags = actor.flags[ns] || {};
        if (Object.keys(actorFlags).length === 0) continue;

        let updates = {};
        let performUpdate = false;

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

        // 1b. Repair v2 Schema (img -> texture.src) for existing local data
        if (modernData && !legacyData) {
            for (const [id, entry] of Object.entries(modernData)) {
                if (entry.changes && entry.changes.img && !entry.changes.texture?.src) {
                    const texture = entry.changes.texture || { scaleX: 1, scaleY: 1 };
                    texture.src = entry.changes.img;
                    
                    updates[`flags.${ns}.${newKey}.${id}.changes.texture`] = texture;
                    updates[`flags.${ns}.${newKey}.${id}.changes.-=img`] = null;
                    performUpdate = true;
                }
            }
        }

        // 1c. Upgrade to v2.2 (Decouple Scale & Mirror)
        const dataToCheck = modernData || (updates[`flags.${ns}.${newKey}`] || {});
        
        for (const [id, entry] of Object.entries(dataToCheck)) {
            // Check if this entry still has legacy scale data
            if (entry.changes?.texture?.scaleX !== undefined) {
                // Clone, Migrate, and Stage Update
                const migrated = migrateEntryV2_2(foundry.utils.deepClone(entry));
                updates[`flags.${ns}.${newKey}.${id}`] = migrated;
                performUpdate = true;
            }
        }

        // 1d. Snapshot & Defaults Repair
        for (const [key, flagData] of Object.entries(actorFlags)) {
            if (key === legacyKey || key === newKey) continue; 
            if (key.length !== 16) continue; 

            const tokenDoc = worldTokenMap.get(key);

            // Garbage Collection
            if (!tokenDoc) {
                updates[`flags.${ns}.-=${key}`] = null;
                performUpdate = true;
                continue;
            }

            // Snapshot Repair
            if (flagData?.defaults) {
                const defs = foundry.utils.deepClone(flagData.defaults);
                let defaultsChanged = false;

                if (defs.img && !defs.texture?.src) {
                    if (!defs.texture) defs.texture = { scaleX: 1, scaleY: 1 };
                    defs.texture.src = defs.img;
                    delete defs.img;
                    defaultsChanged = true;
                }
                if (defs.token && !defs.texture?.src) {
                    if (!defs.texture) defs.texture = { scaleX: 1, scaleY: 1 };
                    defs.texture.src = defs.token;
                    delete defs.token;
                    defaultsChanged = true;
                }

                // Patch Missing Properties
                const sourceData = tokenDoc.toObject();
                if (defs.ring === undefined) { defs.ring = sourceData.ring; defaultsChanged = true; }
                if (defs.width === undefined) { defs.width = sourceData.width ?? 1; defaultsChanged = true; }
                if (defs.height === undefined) { defs.height = sourceData.height ?? 1; defaultsChanged = true; }

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
    // PHASE 2: MIGRATE ACTIVE TOKENS (On Canvas)
    // =========================================================
    for (const token of worldTokenMap.values()) {
        const originalState = token.flags[ns]?.originalState;
        
        // 1. Snapshot Repair (Existing Logic)
        if (originalState && (originalState.img || originalState.token) && !originalState.texture?.src) {
            const newState = foundry.utils.deepClone(originalState);
            
            if (!newState.texture) newState.texture = { scaleX: 1, scaleY: 1 };
            newState.texture.src = newState.img || newState.token;
            
            delete newState.img; 
            delete newState.token;

            await token.update({
                [`flags.${ns}.originalState`]: newState
            });
            console.log(`Visage | Repaired Active Token Snapshot: ${token.name}`);
        }

        // 2. Migrate Active Stacks (MOVED INSIDE THE LOOP)
        const stack = token.flags[ns]?.activeStack;
        if (stack && Array.isArray(stack)) {
            let stackDirty = false;
            
            // Map through the stack and migrate any legacy layers
            const newStack = stack.map(layer => {
                if (layer.changes?.texture?.scaleX !== undefined) {
                    stackDirty = true;
                    return migrateEntryV2_2(foundry.utils.deepClone(layer));
                }
                return layer;
            });

            if (stackDirty) {
                await token.update({
                    [`flags.${ns}.activeStack`]: newStack
                });
                console.log(`Visage | Migrated Active Stack for Token: ${token.name}`);
            }
        }
    }

    // =========================================================
    // PHASE 3: MIGRATE GLOBAL MASKS (World Settings)
    // =========================================================
    // This fixes the issue you identified: migrating the Global Library
    const globalKey = VisageData.SETTING_KEY;
    const globals = game.settings.get(Visage.MODULE_ID, globalKey);
    let globalsDirty = false;

    if (globals) {
        for (const [id, entry] of Object.entries(globals)) {
             // Repair img -> texture.src
             if (entry.changes && entry.changes.img && !entry.changes.texture?.src) {
                const texture = entry.changes.texture || { scaleX: 1, scaleY: 1 };
                texture.src = entry.changes.img;
                entry.changes.texture = texture;
                delete entry.changes.img;
                globalsDirty = true;
             }

             // Upgrade to v2.2
             // We run this directly on the object because we save the whole thing later
             if (entry.changes?.texture?.scaleX !== undefined) {
                 migrateEntryV2_2(entry); // Mutates 'entry' in place
                 globalsDirty = true;
             }
        }

        if (globalsDirty) {
            await game.settings.set(Visage.MODULE_ID, globalKey, globals);
            console.log("Visage | Migrated Global Mask Library");
        }
    }

    console.groupEnd();
    ui.notifications.info(`Visage: Migration & Cleanup Complete.`);
}

function normalizeEntry(id, data, fallbackName) {
    // v2.0 Data Pass-through & Repair
    if (data.changes) {
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

    // v1.0 Data Conversion
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

/**
 * Helper: Migrates a single Visage entry from v2.1 (Destructive) to v2.2 (Intent-based).
 * Extracts baked 'texture.scaleX/Y' into atomic 'scale', 'mirrorX', and 'mirrorY'.
 * @param {Object} entry - The visage data object.
 * @returns {Object} The migrated entry.
 */
function migrateEntryV2_2(entry) {
    if (!entry.changes) return entry;
    
    const c = entry.changes;
    const tx = c.texture;
    
    // Check if migration is needed (presence of legacy baked scale)
    if (tx && (tx.scaleX !== undefined || tx.scaleY !== undefined)) {
        
        // 1. Extract Magnitude (Scale)
        // We prioritize scaleX magnitude. Default to 1.0 if missing.
        const rawScale = Math.abs(tx.scaleX ?? (tx.scaleY ?? 1.0));
        
        // 2. Extract Orientation (Mirror)
        // In Foundry, negative value = flipped.
        const isFlippedX = (tx.scaleX ?? 1) < 0;
        const isFlippedY = (tx.scaleY ?? 1) < 0;

        // 3. Set New Atomic Properties (Intent)
        c.scale = rawScale;
        c.mirrorX = isFlippedX;
        c.mirrorY = isFlippedY;

        // 4. Clean Legacy Data
        // We delete these so the Composer knows to use the atomic properties
        delete tx.scaleX;
        delete tx.scaleY;
    }
    return entry;
}