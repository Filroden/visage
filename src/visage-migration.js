/**
 * @file Handles data migration and sanitation for the Visage module.
 * Responsible for upgrading legacy data (v1.x, v2.0, v2.1) to the modern v2.2 Unified Schema.
 * Includes "Garbage Collection" routines to scrub obsolete properties from the database.
 * @module visage
 */

import { Visage } from "./visage.js";
import { VisageData } from "./visage-data.js"; 

/**
 * Main Migration Routine.
 * Scans the entire world (Actors, Scene Tokens, and World Settings) for legacy Visage data.
 * If found, it upgrades the data structure and forcefully deletes obsolete keys.
 */
export async function migrateWorldData() {
    const ns = Visage.DATA_NAMESPACE;
    const legacyKey = Visage.LEGACY_FLAG_KEY || "visages"; 
    const newKey = Visage.ALTERNATE_FLAG_KEY || "alternateVisages";

    ui.notifications.info("Visage: Starting Migration to v2.2...");
    console.group("Visage | Migration v2.2");

    // =========================================================
    // PHASE 0: INDEXING (Find all Data Sources)
    // =========================================================
    // We must find "Synthetic Actors" (Unlinked Tokens) because they hold their own flags
    // and are NOT included in the standard game.actors collection.
    
    const worldTokenMap = new Map(); 
    for (const scene of game.scenes) {
        for (const token of scene.tokens) {
            worldTokenMap.set(token.id, token);
        }
    }

    const actorsToUpdate = new Map();
    // 1. Add all sidebar actors
    for (const actor of game.actors) actorsToUpdate.set(actor.id, actor);
    
    // 2. Add all unlinked token actors
    for (const token of worldTokenMap.values()) {
        if (!token.actorLink && token.actor) {
            actorsToUpdate.set(token.actor.id, token.actor);
        }
    }

    // =========================================================
    // PHASE 1: MIGRATE ACTORS (Sidebar & Synthetic)
    // =========================================================
    for (const actor of actorsToUpdate.values()) {
        const actorFlags = actor.flags[ns] || {};
        if (Object.keys(actorFlags).length === 0) continue;

        let updates = {};
        let performUpdate = false;

        const legacyData = actorFlags[legacyKey];
        const modernData = actorFlags[newKey];

        // 1a. Convert v1 (Old Flag Key) -> v2 (New Flag Key)
        if (legacyData) {
            const cleanData = modernData ? foundry.utils.deepClone(modernData) : {};
            for (const [key, raw] of Object.entries(legacyData)) {
                if (!raw) continue;
                const uuid = foundry.utils.randomID(16);
                cleanData[uuid] = normalizeEntry(uuid, raw, key);
            }
            updates[`flags.${ns}.-=${legacyKey}`] = null; // Delete old key
            updates[`flags.${ns}.${newKey}`] = cleanData;
            performUpdate = true;
        }

        // 1b. Upgrade to v2.2 & Deep Clean
        // We scan for specific legacy artifacts: 'img', 'visual', and baked 'scale'.
        const dataToCheck = modernData || (updates[`flags.${ns}.${newKey}`] || {});
        
        for (const [id, entry] of Object.entries(dataToCheck)) {
            const hasLegacyScale = entry.changes?.texture?.scaleX !== undefined;
            const hasLegacyImg = entry.changes?.img !== undefined;
            const hasVisual = entry.changes?.visual !== undefined;

            if (hasLegacyScale || hasLegacyImg || hasVisual) {
                // A. Migrate Data (In Memory)
                const migrated = cleanVisageData(foundry.utils.deepClone(entry));
                
                // B. Stage New Data
                const flagRoot = `flags.${ns}.${newKey}.${id}`;
                updates[flagRoot] = migrated;

                // C. Nuclear Cleanup (Force Delete Keys)
                // Foundry's update() is a merge operation. To actually delete a key from the database,
                // we must use the special "-=key" syntax.
                if (hasLegacyImg) updates[`${flagRoot}.changes.-=img`] = null;
                if (hasVisual) updates[`${flagRoot}.changes.-=visual`] = null;
                if (hasLegacyScale) {
                    updates[`${flagRoot}.changes.texture.-=scaleX`] = null;
                    updates[`${flagRoot}.changes.texture.-=scaleY`] = null;
                }
                
                performUpdate = true;
            }
        }

        // 1c. Orphan Garbage Collection
        // Removes leftover "Default Snapshot" data erroneously stored on the Actor 
        // (legacy behavior) instead of the Token.
        for (const [key, flagData] of Object.entries(actorFlags)) {
            if (key === legacyKey || key === newKey) continue; 
            if (key.length !== 16) continue; // Ignore non-ID keys

            const tokenDoc = worldTokenMap.get(key);

            // If the token no longer exists, delete the orphan data
            if (!tokenDoc) {
                updates[`flags.${ns}.-=${key}`] = null;
                performUpdate = true;
                continue;
            }

            // If it exists, attempt to repair it (just in case)
            if (flagData?.defaults) {
                const defs = foundry.utils.deepClone(flagData.defaults);
                let defaultsChanged = false;

                if (defs.img && !defs.texture?.src) {
                    if (!defs.texture) defs.texture = { scaleX: 1, scaleY: 1 };
                    defs.texture.src = defs.img;
                    delete defs.img;
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
    // PHASE 2: MIGRATE ACTIVE TOKENS (On Canvas)
    // =========================================================
    // Tokens on the canvas might have active effects ("Stacks") or snapshots ("Original State")
    // that contain legacy data structures. These need immediate patching.
    for (const token of worldTokenMap.values()) {
        const originalState = token.flags[ns]?.originalState;
        
        // 2a. Snapshot Repair
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

        // 2b. Stack Migration
        // If a mask is currently active, it lives in the 'activeStack' array.
        // Arrays are replaced entirely on update, so we don't need "-=" syntax here.
        const stack = token.flags[ns]?.activeStack;
        if (stack && Array.isArray(stack)) {
            let stackDirty = false;
            
            const newStack = stack.map(layer => {
                const hasLegacy = layer.changes?.texture?.scaleX !== undefined 
                               || layer.changes?.img !== undefined
                               || layer.changes?.visual !== undefined;

                if (hasLegacy) {
                    stackDirty = true;
                    return cleanVisageData(foundry.utils.deepClone(layer));
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
    const globalKey = VisageData.SETTING_KEY;
    const globals = game.settings.get(Visage.MODULE_ID, globalKey);
    let globalsDirty = false;

    if (globals) {
        for (const [id, entry] of Object.entries(globals)) {
             const hasLegacy = entry.changes?.texture?.scaleX !== undefined 
                            || entry.changes?.img !== undefined
                            || entry.changes?.visual !== undefined;

             if (hasLegacy) {
                 cleanVisageData(entry); // Mutates 'entry' in place
                 globalsDirty = true;
             }
        }

        if (globalsDirty) {
            // Settings are simple objects, so saving overwrites the DB entry.
            // No need for "-=" syntax here.
            await game.settings.set(Visage.MODULE_ID, globalKey, globals);
            console.log("Visage | Migrated Global Mask Library");
        }
    }

    console.groupEnd();
    ui.notifications.info(`Visage: Migration & Cleanup Complete.`);
}

/**
 * Normalizes v1 data into the basic v2 structure.
 */
function normalizeEntry(id, data, fallbackName) {
    if (data.changes) {
        return cleanVisageData(foundry.utils.deepClone(data));
    }
    
    // Fallback construction for raw v1 data
    return {
        id: id,
        label: data.label || data.name || fallbackName,
        changes: {},
        updated: Date.now()
    };
}

/**
 * Universal Cleaner: Migrates a Visage entry to v2.2 and strips ALL legacy data.
 * - Converts 'img' -> 'texture.src'
 * - Removes 'visual' objects
 * - Decouples baked 'texture.scaleX' -> atomic 'scale', 'mirrorX'
 * @param {Object} entry - The visage data object.
 * @returns {Object} The clean, migrated entry.
 */
export function cleanVisageData(entry) {
    if (!entry.changes) return entry;
    
    const c = entry.changes;

    // 1. Clean 'img' (Legacy v1)
    if (c.img) {
        if (!c.texture) c.texture = {};
        if (!c.texture.src) c.texture.src = c.img;
        delete c.img;
    }

    // 2. Clean 'visual' (Legacy v2.2 Dev Artifact)
    if (c.visual) {
        delete c.visual;
    }

    // 3. Migrate Baked Scale (Legacy v2.0/v2.1)
    const tx = c.texture;
    if (tx && (tx.scaleX !== undefined || tx.scaleY !== undefined)) {
        
        // Extract Data
        const rawScale = Math.abs(tx.scaleX ?? (tx.scaleY ?? 1.0));
        const isFlippedX = (tx.scaleX ?? 1) < 0;
        const isFlippedY = (tx.scaleY ?? 1) < 0;

        // Set New Atomic Properties
        c.scale = rawScale;
        c.mirrorX = isFlippedX;
        c.mirrorY = isFlippedY;

        // Delete Legacy Keys
        delete tx.scaleX;
        delete tx.scaleY;
    }
    
    return entry;
}