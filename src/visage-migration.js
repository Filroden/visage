/**
 * @file Handles data migration and sanitation for the Visage module.
 * Responsible for upgrading legacy data to the modern Unified Schema (v3.0).
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
    
    // Step 1: Run Legacy v2.2 Migrations (Cleanup old image paths, baked scales)
    await _migrateV2(ns);

    // Step 2: Run v3.0 Migration (Add 'mode' field for Identity vs Overlay)
    await _migrateV3(ns);
}

/**
 * Executes the v3.0 Schema Migration.
 * Ensures all Visages and Masks have a 'mode' property.
 * - Local Visages -> Default to 'identity'
 * - Global Masks -> Default to 'overlay'
 */
async function _migrateV3(ns) {
    ui.notifications.info("Visage: Verifying Data Schema (v3.0)...");
    console.groupCollapsed("Visage | Schema Migration v3.0");

    // 1. Migrate Local Visages (Flags on Actors)
    let actorsMigrated = 0;
    for (const actor of game.actors) {
        const flagData = actor.flags[ns] || {};
        const alternates = flagData.alternateVisages || {};
        
        let updates = {};
        let hasUpdates = false;

        for (const [key, data] of Object.entries(alternates)) {
            // If missing 'mode', default to 'identity' (classic Visage behavior)
            if (!data.mode) {
                updates[`flags.${ns}.alternateVisages.${key}.mode`] = "identity";
                hasUpdates = true;
            }
        }

        if (hasUpdates) {
            try {
                await actor.update(updates);
                actorsMigrated++;
                console.log(`Migrated Actor: ${actor.name}`);
            } catch (err) {
                console.warn(`Failed to migrate actor ${actor.name}:`, err);
            }
        }
    }

    // 2. Migrate Global Library (World Settings)
    const globals = game.settings.get(Visage.MODULE_ID, VisageData.SETTING_KEY);
    let globalUpdates = false;
    let globalsMigrated = 0;

    for (const [key, data] of Object.entries(globals)) {
        // If missing 'mode', default to 'overlay' (classic Mask behavior)
        if (!data.mode) {
            globals[key].mode = "overlay";
            globalUpdates = true;
            globalsMigrated++;
        }
    }

    if (globalUpdates) {
        await game.settings.set(Visage.MODULE_ID, VisageData.SETTING_KEY, globals);
        console.log(`Migrated ${globalsMigrated} Global Entries.`);
    }

    console.log(`Migration Complete. Actors: ${actorsMigrated}, Globals: ${globalsMigrated}`);
    console.groupEnd();
}

/**
 * Legacy v2.2 Migration Logic.
 * kept for compatibility with older worlds upgrading directly to v3.
 */
async function _migrateV2(ns) {
    const legacyKey = Visage.LEGACY_FLAG_KEY || "visages"; 
    const newKey = Visage.ALTERNATE_FLAG_KEY || "alternateVisages";

    console.groupCollapsed("Visage | Legacy Cleanups (v2.2)");

    // 1. Find "Synthetic Actors" (Unlinked Tokens)
    const worldTokenMap = new Map(); 
    for (const scene of game.scenes) {
        for (const token of scene.tokens) {
            if (!token.isLinked && token.actor) {
                worldTokenMap.set(token.actor.id, token.actor);
            }
        }
    }
    const allActors = [...game.actors, ...worldTokenMap.values()];

    // 2. Iterate and Migrate
    for (const actor of allActors) {
        const flags = actor.flags[ns];
        if (!flags) continue;

        let updates = {};
        let hasUpdates = false;

        // A. Move Legacy 'visages' -> 'alternateVisages'
        if (flags[legacyKey] && !flags[newKey]) {
            updates[`flags.${ns}.${newKey}`] = flags[legacyKey];
            updates[`flags.${ns}.-=${legacyKey}`] = null;
            hasUpdates = true;
        }

        // B. Clean Data Structure inside 'alternateVisages'
        const targetContainer = updates[`flags.${ns}.${newKey}`] || flags[newKey];
        if (targetContainer) {
            for (const [id, entry] of Object.entries(targetContainer)) {
                const cleaned = cleanVisageData(entry);
                // Simple diff check (stringified)
                if (JSON.stringify(cleaned) !== JSON.stringify(entry)) {
                    updates[`flags.${ns}.${newKey}.${id}`] = cleaned;
                    hasUpdates = true;
                }
            }
        }

        // C. Apply Updates
        if (hasUpdates) {
            await actor.update(updates);
            console.log(`Cleaned Actor: ${actor.name}`);
        }
    }
    console.groupEnd();
}

/**
 * Universal Cleaner: Migrates a Visage entry to v3 standards.
 * - Converts 'img' -> 'texture.src'
 * - Decouples baked 'texture.scaleX' -> atomic 'scale', 'mirrorX'
 * - Ensures 'mode' exists (defaults to 'identity' if missing during object cleaning)
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
        const scaleX = tx.scaleX ?? 1.0;
        const scaleY = tx.scaleY ?? 1.0;
        
        const absX = Math.abs(scaleX);
        
        // A. Extract Atomic Scale Intent
        // If scale isn't 1.0, we assume the user intended to scale the token
        if (absX !== 1.0 && c.scale === undefined) {
            c.scale = absX; 
        }

        // B. Extract Mirror Intent
        if (c.mirrorX === undefined && scaleX < 0) c.mirrorX = true;
        if (c.mirrorY === undefined && scaleY < 0) c.mirrorY = true;

        // C. Clean Texture Object (Remove baked scale)
        delete tx.scaleX;
        delete tx.scaleY;
        
        // Remove texture object if empty
        if (Object.keys(tx).length === 0) delete c.texture;
    }

    // 4. Ensure Mode (v3.0)
    // If we are cleaning an object in isolation, we default to identity.
    // The bulk migration handles context-aware defaults (overlay vs identity).
    if (!entry.mode) {
        entry.mode = "identity";
    }

    return entry;
}