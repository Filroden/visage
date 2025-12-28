/**
 * @file Manages the data layer for the Global Visage Directory.
 * @module visage
 */

import { Visage } from "./visage.js";

/**
 * The specific schema version for Global Visage entries.
 * Incremented when the data structure changes (e.g., adding new fields).
 */
const SCHEMA_VERSION = 1;

/**
 * A static service class responsible for all interactions with the Global Visage database.
 * This class abstracts the Foundry VTT `game.settings` API and implements robust CRUD operations,
 * soft-deletion logic, and garbage collection.
 */
export class VisageGlobalData {

    /**
     * The unique key used to store the global library in world settings.
     * @type {string}
     */
    static SETTING_KEY = "globalVisages";

    /**
     * Initializes the module setting required for storage.
     * Should be called during the `init` hook.
     */
    static registerSettings() {
        game.settings.register(Visage.MODULE_ID, this.SETTING_KEY, {
            name: "Global Visage Library",
            scope: "world",
            config: false,
            type: Object,
            default: {}, // Stored as a map: { [id]: entry }
            onChange: () => {
                // Hook to refresh the Directory UI when data changes from another client
                Hooks.callAll("visageGlobalDataChanged");
            }
        });
    }

    /* -------------------------------------------- */
    /* Read Operations                             */
    /* -------------------------------------------- */

    /**
     * Retrieves the entire raw dataset from settings.
     * @returns {object} The dictionary of all visage entries.
     * @private
     */
    static _getRaw() {
        return game.settings.get(Visage.MODULE_ID, this.SETTING_KEY);
    }

    /**
     * Retrieves all "Active" (non-deleted) visages.
     * @returns {Array<object>} An array of visage objects, sorted by creation date (newest first).
     */
    static get all() {
        const raw = this._getRaw();
        return Object.values(raw)
            .filter(v => !v.deleted)
            .sort((a, b) => b.created - a.created);
    }

    /**
     * Retrieves all "Recycle Bin" (soft-deleted) visages.
     * @returns {Array<object>} An array of deleted visage objects, sorted by deletion date.
     */
    static get bin() {
        const raw = this._getRaw();
        return Object.values(raw)
            .filter(v => v.deleted)
            .sort((a, b) => b.deletedAt - a.deletedAt);
    }

    /**
     * Retrieves a single visage by ID.
     * @param {string} id - The ID of the visage to retrieve.
     * @returns {object|undefined} The visage object or undefined if not found.
     */
    static get(id) {
        return this._getRaw()[id];
    }

    /* -------------------------------------------- */
    /* Write Operations (CRUD)                     */
    /* -------------------------------------------- */

    /**
     * Creates a new Global Visage entry.
     * @param {object} data - The initial data for the visage.
     * @returns {Promise<object>} The created visage object.
     */
    static async create(data) {
        const id = foundry.utils.randomID(16);
        const timestamp = Date.now();

        const entry = {
            id: id,
            schema: SCHEMA_VERSION,
            
            // Metadata
            label: data.label || "New Global Visage",
            category: data.category || "Uncategorized",
            tags: Array.isArray(data.tags) ? data.tags : [],
            created: timestamp,
            updated: timestamp,

            // Recycle Bin Status
            deleted: false,
            deletedAt: null,

            // The Payload (Stencil)
            changes: {
                name: data.changes?.name || null,
                img: data.changes?.img || null,
                scale: typeof data.changes?.scale === "number" ? Math.abs(data.changes.scale) : null,
                isFlippedX: typeof data.changes?.isFlippedX === "boolean" ? data.changes.isFlippedX : null,
                isFlippedY: typeof data.changes?.isFlippedY === "boolean" ? data.changes.isFlippedY : null,
                width: data.changes?.width || null,
                height: data.changes?.height || null,
                disposition: typeof data.changes?.disposition === "number" ? data.changes.disposition : null,
                ring: data.changes?.ring ? foundry.utils.deepClone(data.changes.ring) : null
            }
        };

        const all = this._getRaw();
        all[id] = entry;
        
        await game.settings.set(Visage.MODULE_ID, this.SETTING_KEY, all);
        Visage.log(`Created Global Visage: ${entry.label} (${id})`);
        return entry;
    }

    /**
     * Updates an existing Global Visage.
     * @param {string} id - The ID of the visage to update.
     * @param {object} updates - The partial data to merge (supports dot notation for 'changes').
     * @returns {Promise<object>} The updated visage object.
     */
    static async update(id, updates) {
        const all = this._getRaw();
        if (!all[id]) throw new Error(`Visage | Global entry ${id} not found.`);

        const entry = all[id];
        
        // Merge updates safely
        const merged = foundry.utils.mergeObject(entry, updates, { inplace: false });
        merged.updated = Date.now();
        
        // Ensure schema integrity is maintained during merge
        if (merged.changes?.scale) merged.changes.scale = Math.abs(merged.changes.scale);

        all[id] = merged;
        await game.settings.set(Visage.MODULE_ID, this.SETTING_KEY, all);
        return merged;
    }

    /**
     * Soft-deletes a visage (moves it to the recycle bin).
     * @param {string} id - The ID of the visage to delete.
     * @returns {Promise<void>}
     */
    static async delete(id) {
        return this.update(id, {
            deleted: true,
            deletedAt: Date.now()
        });
    }

    /**
     * Restores a soft-deleted visage.
     * @param {string} id - The ID of the visage to restore.
     * @returns {Promise<void>}
     */
    static async restore(id) {
        return this.update(id, {
            deleted: false,
            deletedAt: null
        });
    }

    /**
     * Permanently deletes a visage from the database (Hard Delete).
     * @param {string} id - The ID of the visage to destroy.
     * @returns {Promise<void>}
     */
    static async destroy(id) {
        const all = this._getRaw();
        if (!all[id]) return;

        delete all[id];
        await game.settings.set(Visage.MODULE_ID, this.SETTING_KEY, all);
        Visage.log(`Permanently destroyed Global Visage (${id})`);
    }

    /* -------------------------------------------- */
    /* Maintenance & Utility                       */
    /* -------------------------------------------- */

    /**
     * Runs the garbage collector to remove items that have been in the recycle bin for too long.
     * Designed to be called during the `ready` hook.
     * Retention period: 30 Days.
     */
    static async runGarbageCollection() {
        if (!game.user.isGM) return;

        const RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 Days
        const now = Date.now();
        const all = this._getRaw();
        let dirty = false;
        let count = 0;

        for (const [id, entry] of Object.entries(all)) {
            if (entry.deleted && entry.deletedAt) {
                if ((now - entry.deletedAt) > RETENTION_MS) {
                    delete all[id];
                    dirty = true;
                    count++;
                }
            }
        }

        if (dirty) {
            await game.settings.set(Visage.MODULE_ID, this.SETTING_KEY, all);
            Visage.log(`Garbage Collection: Removed ${count} expired entries.`);
        }
    }

    /**
     * Exports the selected visages (or all) to a JSON string.
     * @param {Array<string>|null} [ids=null] - Specific IDs to export, or null for entire library.
     * @returns {string} The JSON string.
     */
    static exportToJSON(ids = null) {
        const all = this._getRaw();
        const exportData = {
            version: SCHEMA_VERSION,
            source: "Visage Global Library",
            entries: []
        };

        if (ids) {
            ids.forEach(id => {
                if (all[id]) exportData.entries.push(all[id]);
            });
        } else {
            exportData.entries = Object.values(all);
        }

        return JSON.stringify(exportData, null, 2);
    }

    /**
     * Imports visages from a JSON string.
     * @param {string} jsonString - The raw JSON string to import.
     * @param {object} [options]
     * @param {boolean} [options.overwrite=false] - If true, existing IDs will be overwritten. 
     * If false, new IDs will be generated for conflicts.
     * @returns {Promise<number>} The count of imported entries.
     */
    static async importFromJSON(jsonString, { overwrite = false } = {}) {
        let data;
        try {
            data = JSON.parse(jsonString);
        } catch (e) {
            ui.notifications.error("Visage | Invalid JSON data.");
            return 0;
        }

        if (!Array.isArray(data.entries)) {
            ui.notifications.error("Visage | JSON does not contain valid entries.");
            return 0;
        }

        const all = this._getRaw();
        let count = 0;

        for (const entry of data.entries) {
            // Validate basic structure
            if (!entry.changes) continue;

            let finalId = entry.id;

            // ID Conflict Resolution
            if (all[finalId] && !overwrite) {
                finalId = foundry.utils.randomID(16);
                entry.id = finalId; // Re-stamp the entry
                entry.label = `${entry.label} (Imported)`;
            }

            // Sanitize timestamps
            entry.created = Date.now();
            entry.updated = Date.now();
            entry.deleted = false;
            entry.deletedAt = null;

            all[finalId] = entry;
            count++;
        }

        await game.settings.set(Visage.MODULE_ID, this.SETTING_KEY, all);
        ui.notifications.info(`Visage | Imported ${count} global entries.`);
        return count;
    }
}