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
    /* DATA HELPERS (Moved from Visage.js)         */
    /* -------------------------------------------- */

    static prepareRingContext(ringData) {
        const data = ringData || {};
        const currentEffects = data.effects || 0;
        
        const availableEffects = [
            { value: 2, label: "VISAGE.RingConfig.Effects.Pulse", key: "RING_PULSE" },
            { value: 4, label: "VISAGE.RingConfig.Effects.Gradient", key: "RING_GRADIENT" },
            { value: 8, label: "VISAGE.RingConfig.Effects.Wave", key: "BKG_WAVE" },
            { value: 16, label: "VISAGE.RingConfig.Effects.Invisibility", key: "INVISIBILITY" }
        ];

        const flags = {
            hasPulse: (currentEffects & 2) !== 0,
            hasGradient: (currentEffects & 4) !== 0,
            hasWave: (currentEffects & 8) !== 0,
            hasInvisibility: (currentEffects & 16) !== 0
        };

        return {
            enabled: data.enabled ?? false,
            colors: {
                ring: data.colors?.ring ?? "#FFFFFF",
                background: data.colors?.background ?? "#000000"
            },
            subject: {
                texture: data.subject?.texture ?? "",
                scale: data.subject?.scale ?? 1.0
            },
            rawEffects: currentEffects, 
            ...flags, 
            effects: availableEffects.map(eff => ({
                ...eff,
                isActive: (currentEffects & eff.value) !== 0
            }))
        };
    }

    /* -------------------------------------------- */
    /* FACTORY METHODS                             */
    /* -------------------------------------------- */

    static async toLayer(data) {
        if (!data) return null;

        const layer = {
            id: data.id,
            label: data.label || "Unknown",
            changes: foundry.utils.deepClone(data.changes || {})
        };

        if (layer.changes.img) {
            if (!layer.changes.texture) layer.changes.texture = {};
            layer.changes.texture.src = await Visage.resolvePath(layer.changes.img);
            delete layer.changes.img;
        } else if (layer.changes.texture?.src) {
            layer.changes.texture.src = await Visage.resolvePath(layer.changes.texture.src);
        }

        if (layer.changes.ring) {
            layer.changes.ring = {
                enabled: layer.changes.ring.enabled === true,
                colors: layer.changes.ring.colors,
                effects: layer.changes.ring.effects,
                subject: layer.changes.ring.subject
            };
        }

        return layer;
    }

    static getDefaultAsVisage(tokenDoc) {
        if (!tokenDoc) return null;
        const actor = tokenDoc.actor;
        const ns = Visage.DATA_NAMESPACE;
        
        let defaults = actor?.flags?.[ns]?.[tokenDoc.id]?.defaults;
        
        if (!defaults) {
            const proto = actor?.prototypeToken || {};
            defaults = {
                name: proto.name || tokenDoc.name,
                token: proto.texture?.src || tokenDoc.texture.src,
                scale: proto.texture?.scaleX ?? 1.0,
                scaleY: proto.texture?.scaleY ?? 1.0,
                width: proto.width ?? 1,
                height: proto.height ?? 1,
                disposition: proto.disposition ?? 0,
                ring: proto.ring ? (proto.ring.toObject ? proto.ring.toObject() : proto.ring) : {}
            };
        }

        const defScaleX = defaults.scale ?? 1.0;
        const defScaleY = defaults.scaleY ?? defaults.scale ?? 1.0;
        const flipX = defaults.isFlippedX ?? (defScaleX < 0);
        const flipY = defaults.isFlippedY ?? (defScaleY < 0);

        return {
            id: "default",
            label: game.i18n.localize("VISAGE.Selector.Default"),
            category: "",
            tags: [],
            isDefault: true,
            changes: {
                name: defaults.name,
                img: defaults.token,
                texture: {
                    src: defaults.token,
                    scaleX: Math.abs(defScaleX) * (flipX ? -1 : 1),
                    scaleY: Math.abs(defScaleY) * (flipY ? -1 : 1)
                },
                width: defaults.width,
                height: defaults.height,
                disposition: defaults.disposition,
                ring: defaults.ring
            }
        };
    }

    static toPresentation(data, options = {}) {
        const c = data.changes || {};
        const tx = c.texture || {};
        
        const rawScaleX = tx.scaleX ?? 1.0;
        const rawScaleY = tx.scaleY ?? 1.0;
        const absScale = Math.abs(rawScaleX);
        const displayScale = Math.round(absScale * 100);
        
        const isFlippedX = rawScaleX < 0;
        const isFlippedY = rawScaleY < 0;

        const isScaleDefault = absScale === 1.0;
        const scaleLabel = isScaleDefault ? "" : `${displayScale}%`;
        
        const w = c.width ?? 1;
        const h = c.height ?? 1;
        const isSizeDefault = w === 1 && h === 1;
        const sizeLabel = isSizeDefault ? "" : `${w}x${h}`;

        let flipIcon = "fas fa-arrows-alt-h"; 
        let flipLabel = "-";
        let flipActive = false;

        if (isFlippedX || isFlippedY) {
            flipActive = true;
            if (isFlippedX && !isFlippedY) {
                flipIcon = "fas fa-arrow-left";
                flipLabel = game.i18n.localize("VISAGE.Mirror.Horizontal.Label");
            } else if (isFlippedY && !isFlippedX) {
                flipIcon = "fas fa-arrow-down";
                flipLabel = game.i18n.localize("VISAGE.Mirror.Vertical.Label");
            } else {
                flipIcon = "fas fa-expand-arrows-alt";
                flipLabel = game.i18n.localize("VISAGE.Mirror.Label.Combined");
            }
        }

        let dispClass = "none";
        let dispLabel = game.i18n.localize("VISAGE.Disposition.NoChange");
        if (c.disposition !== null && c.disposition !== undefined) {
            switch (c.disposition) {
                case 1: dispClass = "friendly"; dispLabel = game.i18n.localize("VISAGE.Disposition.Friendly"); break;
                case 0: dispClass = "neutral"; dispLabel = game.i18n.localize("VISAGE.Disposition.Neutral"); break;
                case -1: dispClass = "hostile"; dispLabel = game.i18n.localize("VISAGE.Disposition.Hostile"); break;
                case -2: dispClass = "secret"; dispLabel = game.i18n.localize("VISAGE.Disposition.Secret"); break;
            }
        }

        // Use internal helper now
        const ringCtx = this.prepareRingContext(c.ring);

        return {
            ...data,
            isActive: options.isActive ?? false,
            isVideo: options.isVideo ?? false,
            isWildcard: options.isWildcard ?? false,
            
            path: c.img || c.texture?.src,
            scale: absScale,
            isFlippedX,
            isFlippedY,
            
            meta: {
                hasRing: ringCtx.enabled,
                hasPulse: ringCtx.hasPulse,
                hasGradient: ringCtx.hasGradient,
                hasWave: ringCtx.hasWave,
                hasInvisibility: ringCtx.hasInvisibility,
                ringColor: ringCtx.colors.ring,
                ringBkg: ringCtx.colors.background,
                
                showDataChip: (scaleLabel !== "") || (sizeLabel !== ""),
                showFlipBadge: flipActive,
                showDispositionChip: dispClass !== "none",
                
                tokenName: c.name || null,
                
                slots: {
                    scale: { active: !isScaleDefault, val: scaleLabel },
                    dim: { active: !isSizeDefault, val: sizeLabel },
                    flip: { active: flipActive, icon: flipIcon, val: flipLabel },
                    disposition: { class: dispClass, val: dispLabel }
                }
            }
        };
    }

    /* -------------------------------------------- */
    /* GLOBAL / LOCAL DATA ACCESS                  */
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

    static getLocal(actor) {
        if (!actor) return [];
        const ns = Visage.DATA_NAMESPACE;
        const sourceData = actor.flags?.[ns]?.[Visage.ALTERNATE_FLAG_KEY] || {};
        const results = [];

        for (const [key, data] of Object.entries(sourceData)) {
            if (!data) continue;
            const id = (key.length === 16) ? key : (data.id || foundry.utils.randomID(16));
            
            if (data.changes) {
                // FIX: Use deepClone to break reference to Actor Flags.
                // This prevents the Gallery's preview logic from permanently mutating
                // the saved flags (e.g. resolving wildcards on disk).
                results.push({
                    id: id,
                    label: data.label || data.name || "Unknown",
                    category: data.category || "",
                    tags: Array.isArray(data.tags) ? data.tags : [],
                    changes: foundry.utils.deepClone(data.changes), // <--- CRITICAL FIX
                    deleted: !!data.deleted
                });
            }
        }
        return results.sort((a, b) => a.label.localeCompare(b.label));
    }

    /* -------------------------------------------- */
    /* WRITE OPERATIONS                            */
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
        for (const [id, entry] of Object.entries(all)) {
            if (entry.deleted && entry.deletedAt && (now - entry.deletedAt) > RETENTION_MS) {
                delete all[id];
                dirty = true;
            }
        }
        if (dirty) await game.settings.set(Visage.MODULE_ID, this.SETTING_KEY, all);
    }
}