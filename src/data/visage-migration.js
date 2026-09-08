/**
 * @file Handles data migration and sanitation for the Visage module.
 * Responsible for upgrading legacy data to the modern Unified Schema (v3.0).
 * Includes "Garbage Collection" routines to scrub obsolete properties from the database.
 * @module visage
 */

import { Visage } from "../core/visage.js";
import { VisageData } from "./visage-data.js";
import { VisageDataModel } from "./visage-data-model.js";
import { MODULE_ID, DATA_NAMESPACE } from "../core/visage-constants.js";

/**
 * Main Migration Routine.
 * Scans the entire world (Actors, Scene Tokens, and World Settings) for legacy Visage data.
 * If found, it upgrades the data structure and forcefully deletes obsolete keys.
 * @returns {Promise<void>}
 */
export async function migrateWorldData() {
    // Step 1: Run Legacy v2.2 Migrations (Cleanup old image paths, baked scales)
    await _migrateV2(DATA_NAMESPACE);

    // Step 2: Run v3.0 Migration (Add 'mode' field for Identity vs Overlay)
    await _migrateV3(DATA_NAMESPACE);

    // Step 3: Run v5.3 Migration (Anchor Default Scrubbing)
    await _migrateV5_3(DATA_NAMESPACE);

    // Step 4: Run v5.10.0 Migration (Array to Dictionary)
    await _migrateV5_10(DATA_NAMESPACE);
}

/**
 * Executes the v5.10.0 Schema Migration.
 * Converts local Visage storage arrays into ID-keyed dictionaries.
 * @param {string} namespace - The data namespace.
 * @private
 */
async function _migrateV5_10(namespace) {
    let updates = 0;
    const targetActors = _getMigrationTargetActors();

    for (const actor of targetActors) {
        updates += await _convertActorVisageArrayToDictionary(actor, namespace);
    }

    if (updates > 0) {
        console.log(`Visage | v5.10.0 Migration Complete: Converted arrays to dictionaries for ${updates} actor(s).`);
    } else {
        console.log(`Visage | v5.10.0 Migration Complete: No legacy arrays found.`);
    }
}

/**
 * Retrieves all linked and unlinked actors in the world.
 * @returns {Array<Actor>} Array of actor documents.
 * @private
 */
function _getMigrationTargetActors() {
    const linkedActors = game.actors.contents;
    const unlinkedActors = game.scenes.contents.flatMap((scene) => scene.tokens.filter((token) => !token.actorLink && token.actor).map((token) => token.actor));
    return [...linkedActors, ...unlinkedActors];
}

/**
 * Converts a single actor's legacy Visage array into a dictionary.
 * @param {Actor} actor - The target actor.
 * @param {string} namespace - The data namespace.
 * @returns {Promise<number>} 1 if updated, 0 if skipped or failed.
 * @private
 */
async function _convertActorVisageArrayToDictionary(actor, namespace) {
    const rawVisages = foundry.utils.getProperty(actor, `flags.${namespace}.alternateVisages`);
    if (!rawVisages) return 0;

    const isArray = Array.isArray(rawVisages);
    const keys = Object.keys(rawVisages);
    if (keys.length === 0) return 0;

    const isUnmigrated = isArray || keys.some((k) => k.length !== 16);
    if (!isUnmigrated) return 0;

    // Normalise into an array for the reducer
    const iterableVisages = isArray ? rawVisages : Object.values(rawVisages);
    const dictionary = _reduceVisageArrayToDictionary(iterableVisages, actor.name);

    try {
        // Explicitly force-delete the legacy property first so the integer keys
        // do not linger alongside the new ID keys.
        await actor.update({ [`flags.${namespace}.alternateVisages`]: new foundry.data.operators.ForcedDeletion() });
        await actor.update({ [`flags.${namespace}.alternateVisages`]: dictionary });
        return 1;
    } catch (err) {
        console.error(`Visage | Failed to migrate actor ${actor.name}:`, err);
        return 0;
    }
}

/**
 * Reduces a raw array of Visage data into a validated ID-keyed dictionary.
 * Passes data through the DataModel as a free repair pass.
 * @param {Array} rawVisages - The legacy array of visages.
 * @param {string} actorName - The name of the actor for logging.
 * @returns {Object} The validated dictionary.
 * @private
 */
function _reduceVisageArrayToDictionary(rawVisages, actorName) {
    return rawVisages.reduce((acc, data) => {
        if (!data) return acc;
        try {
            const model = new VisageDataModel(data);
            const cleanData = model.toObject();
            acc[cleanData.id] = cleanData;
        } catch (err) {
            console.warn(`Visage | Migration skipped corrupted visage on actor ${actorName}:`, err);
        }
        return acc;
    }, {});
}

/**
 * Executes the v5.3 Schema Migration.
 * Scrubs accidental `0.5` default anchors from Visages so they correctly inherit underlying shifts.
 * Applies universally to both identities and overlays.
 * @param {string} namespace - The data namespace.
 * @private
 */
async function _migrateV5_3(namespace) {
    const globalUpdates = await _migrateV5_3Global();
    const actorUpdates = await _migrateV5_3Local(namespace);

    if (globalUpdates > 0 || actorUpdates > 0) {
        console.log(`Visage | v5.3 Migration Complete: Scrubbed default anchors from ${globalUpdates} Global(s) and ${actorUpdates} Actor(s).`);
    }
}

/**
 * Scrubs default anchors from the global library.
 * @private
 */
async function _migrateV5_3Global() {
    const globals = game.settings.get(MODULE_ID, VisageData.SETTING_KEY) || {};
    let updates = 0;
    let hasChanges = false;

    for (const entry of Object.values(globals)) {
        if (_scrubVisageAnchors(entry)) {
            hasChanges = true;
            updates++;
        }
    }

    if (hasChanges) {
        await game.settings.set(MODULE_ID, VisageData.SETTING_KEY, globals);
    }

    return updates;
}

/**
 * Scrubs default anchors from local actor visages, preserving the existing data structure (Array or Object).
 * @param {string} namespace - The data namespace.
 * @private
 */
async function _migrateV5_3Local(namespace) {
    let actorUpdates = 0;

    for (const actor of game.actors) {
        const rawLocals = actor.getFlag(namespace, "alternateVisages");
        if (!rawLocals) continue;

        let hasChanges = false;
        const items = Array.isArray(rawLocals) ? rawLocals : Object.values(rawLocals);

        for (const entry of items) {
            if (_scrubVisageAnchors(entry)) hasChanges = true;
        }

        if (hasChanges) {
            // Write back in the exact format it was received to prevent schema regression
            await actor.setFlag(namespace, "alternateVisages", rawLocals);
            actorUpdates++;
        }
    }

    return actorUpdates;
}

/**
 * Checks and mutates a single visage entry to remove explicit 0.5 anchors.
 * @param {Object} entry - The visage data object.
 * @returns {boolean} True if the entry was modified.
 * @private
 */
function _scrubVisageAnchors(entry) {
    let changed = false;
    if (!entry?.changes?.texture) return false;

    if (entry.changes.texture.anchorX === 0.5) {
        entry.changes.texture.anchorX = null;
        changed = true;
    }

    if (entry.changes.texture.anchorY === 0.5) {
        entry.changes.texture.anchorY = null;
        changed = true;
    }

    return changed;
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
                updates[`flags.${DATA_NAMESPACE}.alternateVisages.${key}.mode`] = "identity";
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

    console.log(`Migration Complete. Actors: ${actorsMigrated}, Globals: ${globalsMigrated}`);
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
        const targetContainer = updates[`flags.${DATA_NAMESPACE}.${newKey}`] || flags[newKey];
        if (targetContainer) {
            for (const [id, entry] of Object.entries(targetContainer)) {
                const cleaned = cleanVisageData(entry);
                // Simple diff check (stringified) to avoid unnecessary database writes
                if (JSON.stringify(cleaned) !== JSON.stringify(entry)) {
                    updates[`flags.${DATA_NAMESPACE}.${newKey}.${id}`] = cleaned;
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
 * 2. Decouples "Baked Scale" into atomic properties.
 * 3. Ensures `mode` exists (defaults to 'identity').
 * 4. Enforces the strict V3 DataModel to guarantee arrays and defaults.
 * @param {Object} entry - The visage data object to clean.
 * @returns {Object} The clean, migrated entry.
 */
export function cleanVisageData(entry) {
    if (!entry.changes) return entry;

    const c = entry.changes;

    // 1. Clean 'img' (Legacy v1)
    if (c.img) {
        c.texture = c.texture || {};
        c.texture.src = c.texture.src || c.img;
        delete c.img;
    }

    // 2. Clean obsolete keys
    delete c.visual; // Legacy v2.2 Dev Artifact
    delete c.delay; // Migrated to individual effects in v4.1

    // 3. Migrate Baked Scale (Legacy v2.0/v2.1)
    _migrateBakedScale(c);

    // 4. Ensure Mode (v3.0)
    entry.mode = entry.mode || "identity";

    // 5. The Ultimate Failsafe: Pass it through the DataModel
    // This instantly upgrades legacy objects with missing `effects` arrays,
    // missing `ring` defaults, or corrupted types.
    try {
        // 1. Let the DataModel clean and structure the data
        const model = new VisageDataModel(entry);
        const cleanedData = model.toObject();

        // 2. Check if Foundry had to self-heal any of the provided values
        let wasSanitized = false;
        const flatOriginal = foundry.utils.flattenObject(entry);

        for (const [key, origValue] of Object.entries(flatOriginal)) {
            const cleanValue = foundry.utils.getProperty(cleanedData, key);

            // We use loose inequality (!=) to ignore harmless type-casting (e.g., "2" == 2)
            // but it will catch real clamping or structural changes (e.g., -1 != 0, or "bob" != true)
            if (origValue != cleanValue) {
                wasSanitized = true;
                break;
            }
        }

        // 3. Attach a temporary meta-flag if we changed their data
        if (wasSanitized) {
            cleanedData._wasSanitized = true;
        }

        return cleanedData;
    } catch (err) {
        const header = game.i18n.localize("VISAGE.Notifications.ImportFailed");
        const footer = game.i18n.localize("VISAGE.Notifications.ImportReview");

        // UX Sanitisation: Strip the technical Foundry prefix
        const cleanMessage = err.message.replaceAll(/\[.*\] validation errors:.*?\n/g, "").trim();

        // Pack the header, the clean list, and the friendly footer together
        throw new Error(`${header}\n${cleanMessage}\n\n${footer}`);
    }
}

/**
 * Decouples "Baked Scale" (e.g. texture.scaleX: -1.5) into atomic properties (scale: 1.5, mirrorX: true).
 * @private
 */
function _migrateBakedScale(c) {
    const tx = c.texture;
    if (!tx || (tx.scaleX === undefined && tx.scaleY === undefined)) return;

    const scaleX = tx.scaleX ?? 1;
    const scaleY = tx.scaleY ?? 1;
    const absX = Math.abs(scaleX);

    // A. Extract Atomic Scale Intent
    if (absX !== 1 && c.scale === undefined) c.scale = absX;

    // B. Extract Mirror Intent
    if (c.mirrorX === undefined && scaleX < 0) c.mirrorX = true;
    if (c.mirrorY === undefined && scaleY < 0) c.mirrorY = true;

    // C. Clean Texture Object
    delete tx.scaleX;
    delete tx.scaleY;

    if (Object.keys(tx).length === 0) delete c.texture;
}
