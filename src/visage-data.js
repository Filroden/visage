/**
 * @file Manages the data layer for the Visage module.
 * Acts as a unified Repository for both World Settings (Global Masks) and Actor Flags (Local Visages).
 * @module visage
 */

import { Visage } from "./visage.js";

const SCHEMA_VERSION = 1;

export class VisageData {

    static SETTING_KEY = "globalVisages";

    static registerSettings() {
        game.settings.register(Visage.MODULE_ID, this.SETTING_KEY, {
            name: "Global Visage Library",
            scope: "world",
            config: false,
            type: Object,
            default: {},
            onChange: () => Hooks.callAll("visageDataChanged")
        });
    }

    /* -------------------------------------------- */
    /* GLOBAL CONTEXT (World Settings)             */
    /* -------------------------------------------- */

    static _getRawGlobal() {
        return game.settings.get(Visage.MODULE_ID, this.SETTING_KEY);
    }

    static get globals() {
        const raw = this._getRawGlobal();
        return Object.values(raw)
            .filter(v => !v.deleted)
            .sort((a, b) => b.created - a.created);
    }

    static get bin() {
        const raw = this._getRawGlobal();
        return Object.values(raw)
            .filter(v => v.deleted)
            .sort((a, b) => b.deletedAt - a.deletedAt);
    }

    static getGlobal(id) {
        return this._getRawGlobal()[id];
    }

    /* -------------------------------------------- */
    /* LOCAL CONTEXT (Actor Flags)                 */
    /* -------------------------------------------- */

    static getLocal(actor) {
        if (!actor) return [];
        const ns = Visage.DATA_NAMESPACE;
        
        // We only read from the new Unified Key. 
        // Migration script handles the legacy key.
        const sourceData = actor.flags?.[ns]?.[Visage.ALTERNATE_FLAG_KEY] || {};
        const results = [];

        for (const [key, data] of Object.entries(sourceData)) {
            // Robustness: If data is malformed (null/undefined), skip
            if (!data) continue;

            const id = (key.length === 16) ? key : (data.id || foundry.utils.randomID(16));
            
            // Post-Migration, we expect data.changes to exist.
            // If it doesn't, this entry is corrupted or pre-migration.
            if (data.changes) {
                results.push({
                    id: id,
                    label: data.label || data.name || "Unknown",
                    category: data.category || "",
                    tags: Array.isArray(data.tags) ? data.tags : [],
                    changes: data.changes,
                    deleted: !!data.deleted
                });
            }
        }

        return results.sort((a, b) => a.label.localeCompare(b.label));
    }

    /* -------------------------------------------- */
    /* UNIFIED WRITE OPERATIONS                    */
    /* -------------------------------------------- */

    static async save(payload, actor = null) {
        if (actor) return this._saveLocal(payload, actor);
        return this._saveGlobal(payload);
    }

    static async delete(id, actor = null) {
        if (actor) {
            return actor.update({
                [`flags.${Visage.DATA_NAMESPACE}.${Visage.ALTERNATE_FLAG_KEY}.${id}.deleted`]: true
            });
        }
        return this.updateGlobal(id, { deleted: true, deletedAt: Date.now() });
    }

    static async restore(id, actor = null) {
        if (actor) {
            return actor.update({
                [`flags.${Visage.DATA_NAMESPACE}.${Visage.ALTERNATE_FLAG_KEY}.${id}.deleted`]: false
            });
        }
        return this.updateGlobal(id, { deleted: false, deletedAt: null });
    }

    static async destroy(id, actor = null) {
        if (actor) {
            return actor.update({
                [`flags.${Visage.DATA_NAMESPACE}.${Visage.ALTERNATE_FLAG_KEY}.-=${id}`]: null
            });
        }
        const all = this._getRawGlobal();
        if (all[id]) {
            delete all[id];
            await game.settings.set(Visage.MODULE_ID, this.SETTING_KEY, all);
            Visage.log(`Permanently destroyed Global Visage (${id})`);
        }
    }

    /* --- PRIVATE IMPLEMENTATIONS --- */

    static async _saveGlobal(data) {
        const all = this._getRawGlobal();
        const id = data.id || foundry.utils.randomID(16);
        const timestamp = Date.now();

        const existing = all[id];
        
        const entry = {
            id: id,
            schema: SCHEMA_VERSION,
            label: data.label || "New Mask",
            category: data.category || "",
            tags: data.tags || [],
            created: existing ? existing.created : timestamp,
            updated: timestamp,
            deleted: false,
            deletedAt: null,
            changes: data.changes
        };

        all[id] = entry;
        await game.settings.set(Visage.MODULE_ID, this.SETTING_KEY, all);
        Visage.log(`Saved Global Visage: ${entry.label}`);
        return entry;
    }

    static async updateGlobal(id, updates) {
        const all = this._getRawGlobal();
        if (!all[id]) return;
        const merged = foundry.utils.mergeObject(all[id], updates, { inplace: false });
        merged.updated = Date.now();
        all[id] = merged;
        await game.settings.set(Visage.MODULE_ID, this.SETTING_KEY, all);
    }

    static async _saveLocal(data, actor) {
        const id = data.id || foundry.utils.randomID(16);
        
        // Since we are running the Hard Migration, we know the DB is clean.
        // We can safely merge this object in.
        const entry = {
            id: id,
            label: data.label,
            category: data.category,
            tags: data.tags,
            changes: data.changes,
            updated: Date.now()
        };

        await actor.update({
            [`flags.${Visage.DATA_NAMESPACE}.${Visage.ALTERNATE_FLAG_KEY}.${id}`]: entry
        });
        Visage.log(`Saved Local Visage for ${actor.name}: ${entry.label}`);
    }

    static async runGarbageCollection() {
        if (!game.user.isGM) return;
        const RETENTION_MS = 30 * 24 * 60 * 60 * 1000; 
        const now = Date.now();
        const all = this._getRawGlobal();
        let dirty = false;
        let count = 0;

        for (const [id, entry] of Object.entries(all)) {
            if (entry.deleted && entry.deletedAt && (now - entry.deletedAt) > RETENTION_MS) {
                delete all[id];
                dirty = true;
                count++;
            }
        }

        if (dirty) {
            await game.settings.set(Visage.MODULE_ID, this.SETTING_KEY, all);
            Visage.log(`Garbage Collection: Removed ${count} expired entries.`);
        }
    }
}