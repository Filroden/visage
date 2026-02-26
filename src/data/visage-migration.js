/**
 * @file Handles data migration and sanitation for the Visage module.
 * Responsible for upgrading legacy data to the modern Unified Schema (v3.0).
 * Includes "Garbage Collection" routines to scrub obsolete properties from the database.
 * @module visage
 */

import { Visage } from "../core/visage.js";
import { VisageData } from "./visage-data.js";
import { MODULE_ID, DATA_NAMESPACE } from "../core/visage-constants.js";

/**
 * Main Migration Routine.
 * Scans the entire world (Actors, Scene Tokens, and World Settings) for legacy Visage data.
 * If found, it upgrades the data structure and forcefully deletes obsolete keys.
 * @returns {Promise<void>}
 */
export async function migrateWorldData() {
    // Step 1: Run Legacy v2.2 Migrations (Cleanup old image paths, baked scales)
    // Ensures data is clean before adding new v3 properties.
    await _migrateV2(DATA_NAMESPACE);

    // Step 2: Run v3.0 Migration (Add 'mode' field for Identity vs Overlay)
    // This is the critical step for the v3.0 "Unified Model" update.
    await _migrateV3(DATA_NAMESPACE);
}

/**
 * Executes the v3.0 Schema Migration.
 * Ensures all Visages and Masks have a 'mode' property.
 * * **Logic:**
 * - Local Visages (Actors) -> Default to 'identity' (preserves classic Visage behavior).
 * - Global Masks (Settings) -> Default to 'overlay' (preserves classic Mask behavior).
 * @param {string} DATA_NAMESPACE - The data namespace.
 * @private
 */
async function _migrateV3(DATA_NAMESPACE) {
    ui.notifications.info("Visage: Verifying Data Schema (v3.0)...");
    console.groupCollapsed("Visage | Schema Migration v3.0");

    // 1. Migrate Local Visages (Flags on Actors)
    let actorsMigrated = 0;
    for (const actor of game.actors) {
        const flagData = actor.flags[DATA_NAMESPACE] || {};
        const alternates = flagData.alternateVisages || {};

        let updates = {};
        let hasUpdates = false;

        for (const [key, data] of Object.entries(alternates)) {
            // If missing 'mode', default to 'identity' (classic Visage behavior)
            if (!data.mode) {
                updates[
                    `flags.${DATA_NAMESPACE}.alternateVisages.${key}.mode`
                ] = "identity";
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
    const globals = game.settings.get(MODULE_ID, VisageData.SETTING_KEY);
    let globalUpdates = false;
    let globalsMigrated = 0;

    for (const [key, data] of Object.entries(globals)) {
        // Run universal cleaner on Globals too
        const cleaned = cleanVisageData(data);

        // If missing 'mode', default to 'overlay' (classic Mask behavior)
        if (!cleaned.mode) {
            cleaned.mode = "overlay";
        }

        // Check if data changed
        if (JSON.stringify(cleaned) !== JSON.stringify(data)) {
            globals[key] = cleaned;
            globalUpdates = true;
            globalsMigrated++;
        }
    }

    if (globalUpdates) {
        await game.settings.set(MODULE_ID, VisageData.SETTING_KEY, globals);
        console.log(`Migrated ${globalsMigrated} Global Entries.`);
    }

    console.log(
        `Migration Complete. Actors: ${actorsMigrated}, Globals: ${globalsMigrated}`,
    );
    console.groupEnd();
}

/**
 * Legacy v2.2 Migration Logic.
 * Kept for compatibility with older worlds upgrading directly to v3.
 * Handles moving data from `visages` (v1) to `alternateVisages` (v2) and cleaning image paths.
 * @param {string} DATA_NAMESPACE - The data namespace.
 * @private
 */
async function _migrateV2(DATA_NAMESPACE) {
    const legacyKey = Visage.LEGACY_FLAG_KEY || "visages";
    const newKey = Visage.ALTERNATE_FLAG_KEY || "alternateVisages";

    console.groupCollapsed("Visage | Legacy Cleanups (v2.2)");

    // 1. Find "Synthetic Actors" (Unlinked Tokens)
    // We must scan the canvas/scenes because unlinked tokens have their own actor data
    // that is NOT present in game.actors.
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
        const flags = actor.flags[DATA_NAMESPACE];
        if (!flags) continue;

        let updates = {};
        let hasUpdates = false;

        // A. Move Legacy 'visages' -> 'alternateVisages'
        if (flags[legacyKey] && !flags[newKey]) {
            updates[`flags.${DATA_NAMESPACE}.${newKey}`] = flags[legacyKey];
            updates[`flags.${DATA_NAMESPACE}.-=${legacyKey}`] = null;
            hasUpdates = true;
        }

        // B. Clean Data Structure inside 'alternateVisages'
        const targetContainer =
            updates[`flags.${DATA_NAMESPACE}.${newKey}`] || flags[newKey];
        if (targetContainer) {
            for (const [id, entry] of Object.entries(targetContainer)) {
                const cleaned = cleanVisageData(entry);
                // Simple diff check (stringified) to avoid unnecessary database writes
                if (JSON.stringify(cleaned) !== JSON.stringify(entry)) {
                    updates[`flags.${DATA_NAMESPACE}.${newKey}.${id}`] =
                        cleaned;
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
 * * **Transformations:**
 * 1. Converts legacy `img` property to `texture.src`.
 * 2. Decouples "Baked Scale" (e.g. `texture.scaleX: -1.5`) into atomic properties (`scale: 1.5`, `mirrorX: true`).
 * 3. Ensures `mode` exists (defaults to 'identity' if missing during object cleaning).
 * @param {Object} entry - The visage data object to clean.
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
    // We separate the magnitude (scale) from the orientation (mirror/flip)
    // so they can be layered independently by the Composer.
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
        // We delete these so they don't override the atomic properties during composition.
        delete tx.scaleX;
        delete tx.scaleY;

        // Remove texture object if empty to keep DB clean
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
