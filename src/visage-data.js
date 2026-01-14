/* visage-data.js */
import { VisageUtilities } from "./visage-utilities.js";

const SCHEMA_VERSION = 1;

export class VisageData {
    static MODULE_ID = "visage";
    static DATA_NAMESPACE = "visage";
    static ALTERNATE_FLAG_KEY = "alternateVisages";
    static SETTING_KEY = "globalVisages";

    static registerSettings() {
        game.settings.register(this.MODULE_ID, this.SETTING_KEY, {
            name: "Global Visage Library",
            scope: "world",
            config: false,
            type: Object,
            default: {},
            onChange: () => Hooks.callAll("visageDataChanged")
        });
    }

    /* -------------------------------------------- */
    /* DATA HELPERS                                */
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

    static getRepresentativeImage(changes) {
        if (!changes) return "";
        if (changes.ring?.enabled && changes.ring.subject?.texture) {
            return changes.ring.subject.texture;
        }
        if (changes.texture?.src) return changes.texture.src;
        return changes.texture?.src || "";
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

        if (layer.changes.texture?.src) {
            const resolved = await VisageUtilities.resolvePath(layer.changes.texture.src);

            layer.changes.texture.src = resolved || layer.changes.texture.src;
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

        let sourceData = tokenDoc.flags?.[this.MODULE_ID]?.originalState;

        if (!sourceData) {
            sourceData = VisageUtilities.extractVisualState(tokenDoc);
        }

        const src = sourceData.texture?.src || tokenDoc.texture.src;
        const scaleX = sourceData.texture?.scaleX ?? sourceData.scaleX ?? 1.0;
        const scaleY = sourceData.texture?.scaleY ?? sourceData.scaleY ?? 1.0; 
        const width = sourceData.width ?? 1;
        const height = sourceData.height ?? 1;
        const disposition = sourceData.disposition ?? 0;
        const ringData = sourceData.ring 
            ? (sourceData.ring.toObject ? sourceData.ring.toObject() : sourceData.ring) 
            : {};
        const flipX = scaleX < 0;
        const flipY = scaleY < 0;

        return {
            id: "default",
            label: game.i18n.localize("VISAGE.Selector.Default"),
            category: "",
            tags: [],
            isDefault: true,
            changes: {
                name: sourceData.name,
                texture: {
                    src: src,
                    scaleX: Math.abs(scaleX) * (flipX ? -1 : 1),
                    scaleY: Math.abs(scaleY) * (flipY ? -1 : 1)
                },
                width: width,
                height: height,
                disposition: disposition,
                ring: ringData
            }
        };
    }

    static toPresentation(data, options = {}) {
        const c = data.changes || {};
        const tx = c.texture || {};
        
        const displayPath = this.getRepresentativeImage(c);
        const isVideo = options.isVideo ?? foundry.helpers.media.VideoHelper.hasVideoExtension(displayPath);

        // --- 1. RESOLVE VALUES ---
        const atomicScale = c.scale;
        const bakedScaleX = tx.scaleX ?? 1.0;
        const bakedScaleY = tx.scaleY ?? 1.0;

        // Visual State (Image Preview)
        const isFlippedX = (c.mirrorX !== undefined && c.mirrorX !== null) ? c.mirrorX : (bakedScaleX < 0);
        const isFlippedY = (c.mirrorY !== undefined && c.mirrorY !== null) ? c.mirrorY : (bakedScaleY < 0);

        // --- ICON LOGIC ---
        const pathIcon = "modules/visage/icons/navigation.svg";

        // A. Horizontal Badge
        const hActive = (c.mirrorX !== undefined && c.mirrorX !== null) || (bakedScaleX < 0);
        const hRot = isFlippedX ? "visage-rotate-270" : "visage-rotate-90";
        const hLabel = game.i18n.localize("VISAGE.Mirror.Badge.H");

        // B. Vertical Badge
        const vActive = (c.mirrorY !== undefined && c.mirrorY !== null) || (bakedScaleY < 0);
        const vRot = isFlippedY ? "visage-rotate-180" : "visage-rotate-0";
        const vLabel = game.i18n.localize("VISAGE.Mirror.Badge.V");

        // C. Scale Badge
        const isScaleIntent = (atomicScale !== undefined && atomicScale !== null);
        const isScaleNonDefault = Math.abs(bakedScaleX) !== 1.0;
        const isScaleActive = isScaleIntent || isScaleNonDefault;
        
        const finalScale = (atomicScale !== undefined && atomicScale !== null) 
            ? atomicScale 
            : Math.abs(bakedScaleX);
        const displayScaleVal = Math.round(finalScale * 100);
        const scaleLabel = `${displayScaleVal}%`;

        // D. Dimensions
        const w = c.width ?? 1;
        const h = c.height ?? 1;
        const isSizeDefault = w === 1 && h === 1;
        const sizeLabel = `${w}x${h}`;

        // E. Wildcard Badge
        const isWildcard = options.isWildcard ?? false;
        const wildcardLabel = game.i18n.localize("VISAGE.Wildcard.Label");

        // F. Disposition
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

        const ringCtx = this.prepareRingContext(c.ring);

        return {
            ...data,
            isActive: options.isActive ?? false,
            isVideo: isVideo,
            isWildcard: isWildcard,
            path: displayPath,
            scale: finalScale,
            
            isFlippedX,
            isFlippedY,
            forceFlipX: isFlippedX,
            forceFlipY: isFlippedY,
            
            meta: {
                hasRing: ringCtx.enabled,
                hasPulse: ringCtx.hasPulse,
                hasGradient: ringCtx.hasGradient,
                hasWave: ringCtx.hasWave,
                hasInvisibility: ringCtx.hasInvisibility,
                ringColor: ringCtx.colors.ring,
                ringBkg: ringCtx.colors.background,
                
                showDataChip: isScaleActive || !isSizeDefault,
                showFlipBadge: hActive || vActive,
                showDispositionChip: dispClass !== "none",
                tokenName: c.name || null,
                
                slots: {
                    scale: { active: isScaleActive, val: scaleLabel },
                    dim: { active: !isSizeDefault, val: sizeLabel },
                    flipH: { active: hActive, src: pathIcon, cls: hRot, val: hLabel },
                    flipV: { active: vActive, src: pathIcon, cls: vRot, val: vLabel },
                    wildcard: { active: isWildcard, val: wildcardLabel },
                    disposition: { class: dispClass, val: dispLabel }
                }
            }
        };
    }

    static _getRawGlobal() {
        return game.settings.get(this.MODULE_ID, this.SETTING_KEY);
    }

    static get globals() {
        const raw = this._getRawGlobal();
        return Object.values(raw)
            .filter(v => !v.deleted)
            .map(v => foundry.utils.deepClone(v))
            .sort((a, b) => b.created - a.created);
    }

    static get bin() {
        const raw = this._getRawGlobal();
        return Object.values(raw)
            .filter(v => v.deleted)
            .map(v => foundry.utils.deepClone(v))
            .sort((a, b) => b.deletedAt - a.deletedAt);
    }

    static getGlobal(id) {
        const data = this._getRawGlobal()[id];
        return data ? foundry.utils.deepClone(data) : null;
    }

    static getLocal(actor) {
        if (!actor) return [];
        const ns = this.DATA_NAMESPACE; 
        const sourceData = actor.flags?.[ns]?.[this.ALTERNATE_FLAG_KEY] || {};
        const results = [];

        for (const [key, data] of Object.entries(sourceData)) {
            if (!data) continue;
            const id = (key.length === 16) ? key : (data.id || foundry.utils.randomID(16));
            if (data.changes) {
                results.push({
                    id: id,
                    label: data.label || data.name || "Unknown",
                    category: data.category || "",
                    tags: Array.isArray(data.tags) ? data.tags : [],
                    changes: foundry.utils.deepClone(data.changes),
                    deleted: !!data.deleted
                });
            }
        }
        return results.sort((a, b) => a.label.localeCompare(b.label));
    }

    /* -------------------------------------------- */
    /* DATA OPERATIONS                              */
    /* -------------------------------------------- */

    /**
     * Promotes a Local Visage to the Global Mask Library.
     * Creates a deep copy of the data in the world settings.
     * @param {Actor} actor - The source actor.
     * @param {string} visageId - The ID of the local visage to promote.
     */
    static async promote(actor, visageId) {
        const localVisages = this.getLocal(actor);
        const source = localVisages.find(v => v.id === visageId);
        
        if (!source) {
            ui.notifications.warn("Visage | Could not find source visage to promote.");
            return;
        }

        // Prepare Payload: Deep Clone and Strip ID
        const payload = {
            label: source.label,
            category: source.category,
            tags: source.tags ? [...source.tags] : [],
            changes: foundry.utils.deepClone(source.changes)
        };

        // Note: _saveGlobal handles ID generation and timestamping
        await this._saveGlobal(payload);
        
        ui.notifications.info(game.i18n.format("VISAGE.Notifications.Promoted", { name: payload.label }));
    }

    static async commitToDefault(tokenOrId, visageId) {
        const token = (typeof tokenOrId === "string") ? canvas.tokens.get(tokenOrId) : tokenOrId;
        if (!token || !token.actor) return ui.notifications.warn("Visage | No actor found for commit.");

        const targetVisage = this.getLocal(token.actor).find(v => v.id === visageId);
        if (!targetVisage) return ui.notifications.warn("Visage | Target Visage not found.");

        const currentDefault = this.getDefaultAsVisage(token.document);
        if (!currentDefault) return;

        const backupData = {
            label: `${currentDefault.changes.name || token.name} (Backup)`,
            category: "Backup",
            tags: ["Backup", ...(currentDefault.tags || [])],
            changes: currentDefault.changes
        };
        
        await this._saveLocal(backupData, token.actor);

        const newDefaultData = foundry.utils.mergeObject(
            foundry.utils.deepClone(currentDefault.changes), 
            foundry.utils.deepClone(targetVisage.changes), 
            { inplace: false, insertKeys: true, overwrite: true }
        );

        const updatePayload = {};
        if (newDefaultData.name) updatePayload.name = newDefaultData.name;
        if (newDefaultData.texture) {
            if (newDefaultData.texture.src) updatePayload["texture.src"] = newDefaultData.texture.src;
            if (newDefaultData.texture.scaleX !== undefined) updatePayload["texture.scaleX"] = newDefaultData.texture.scaleX;
            if (newDefaultData.texture.scaleY !== undefined) updatePayload["texture.scaleY"] = newDefaultData.texture.scaleY;
        }
        if (newDefaultData.width !== undefined) updatePayload.width = newDefaultData.width;
        if (newDefaultData.height !== undefined) updatePayload.height = newDefaultData.height;
        if (newDefaultData.disposition !== undefined) updatePayload.disposition = newDefaultData.disposition;
        if (newDefaultData.ring) updatePayload.ring = newDefaultData.ring;

        for (const key of Object.keys(updatePayload)) {
            if (updatePayload[key] === undefined) delete updatePayload[key];
        }

        const isLinked = token.document.isLinked;
        if (isLinked) {
            await token.actor.update({ prototypeToken: updatePayload });
        } else {
            await token.document.update(updatePayload);
        }

        const newOriginalState = VisageUtilities.extractVisualState({
            ...token.document.toObject(), 
            ...foundry.utils.expandObject(updatePayload) 
        });

        await token.document.update({
            [`flags.${this.DATA_NAMESPACE}.originalState`]: newOriginalState
        });

        const VisageApi = game.modules.get(this.MODULE_ID).api;
        if (VisageApi) {
            await VisageApi.remove(token.id, visageId);
        }
        
        ui.notifications.info(game.i18n.format("VISAGE.Notifications.DefaultSwapped", { label: targetVisage.label }));
    }

    static async save(payload, actor = null) {
        if (actor) return this._saveLocal(payload, actor);
        return this._saveGlobal(payload);
    }

    static async delete(id, actor = null) {
        if (actor) {
            return actor.update({
                [`flags.${this.DATA_NAMESPACE}.${this.ALTERNATE_FLAG_KEY}.${id}.deleted`]: true
            });
        }
        return this.updateGlobal(id, { deleted: true, deletedAt: Date.now() });
    }

    static async restore(id, actor = null) {
        if (actor) {
            return actor.update({
                [`flags.${this.DATA_NAMESPACE}.${this.ALTERNATE_FLAG_KEY}.${id}.deleted`]: false
            });
        }
        return this.updateGlobal(id, { deleted: false, deletedAt: null });
    }

    static async destroy(id, actor = null) {
        if (actor) {
            return actor.update({
                [`flags.${this.DATA_NAMESPACE}.${this.ALTERNATE_FLAG_KEY}.-=${id}`]: null
            });
        }
        const all = this._getRawGlobal();
        if (all[id]) {
            delete all[id];
            await game.settings.set(this.MODULE_ID, this.SETTING_KEY, all);
            console.log(`Visage | Permanently destroyed Global Visage (${id})`);
        }
    }

    static async _saveGlobal(data) {
        const all = this._getRawGlobal();
        const id = data.id || foundry.utils.randomID(16);
        const timestamp = Date.now();
        const existing = all[id];
        const changes = foundry.utils.deepClone(data.changes || {});

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
            changes: changes
        };

        all[id] = entry;
        await game.settings.set(this.MODULE_ID, this.SETTING_KEY, all);
        return entry;
    }

    static async updateGlobal(id, updates) {
        const all = this._getRawGlobal();
        if (!all[id]) return;
        const merged = foundry.utils.mergeObject(all[id], updates, { inplace: false });
        merged.updated = Date.now();
        all[id] = merged;
        await game.settings.set(this.MODULE_ID, this.SETTING_KEY, all);
    }

    static async _saveLocal(data, actor) {
        const id = data.id || foundry.utils.randomID(16);
        const changes = foundry.utils.deepClone(data.changes || {});

        const entry = {
            id: id,
            label: data.label,
            category: data.category,
            tags: data.tags,
            changes: changes,
            updated: Date.now()
        };

        await actor.update({
            [`flags.${this.DATA_NAMESPACE}.${this.ALTERNATE_FLAG_KEY}.${id}`]: entry
        });
        console.log(`Visage | Saved Local Visage for ${actor.name}: ${entry.label}`);
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
        if (dirty) await game.settings.set(this.MODULE_ID, this.SETTING_KEY, all);
    }
}