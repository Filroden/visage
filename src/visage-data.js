/* visage-data.js */
import { VisageUtilities } from "./visage-utilities.js";

const SCHEMA_VERSION = 2;

/**
 * The primary data controller class.
 */
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

    static async toLayer(data, source = "unknown") {
        if (!data) return null;

        const layer = {
            id: data.id,
            label: data.label || "Unknown",
            mode: data.mode || (source === "local" ? "identity" : "overlay"),
            source: source,
            changes: foundry.utils.deepClone(data.changes || {})
        };

        // 1. Recursive Clean Function
        // This removes any keys where the value is null, preventing "overwrite with nothing"
        const clean = (obj) => {
            for (const key in obj) {
                if (obj[key] === null) {
                    delete obj[key];
                } else if (typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
                    clean(obj[key]);
                    // If an object becomes empty after cleaning children (e.g. texture: {}), delete it too
                    if (Object.keys(obj[key]).length === 0) delete obj[key];
                }
            }
        };

        // 2. Clean the changes
        clean(layer.changes);

        // 3. Resolve Paths (Only if texture still exists after cleaning)
        if (layer.changes?.texture?.src) {
            const resolved = await VisageUtilities.resolvePath(layer.changes.texture.src);
            layer.changes.texture.src = resolved || layer.changes.texture.src;
        }

        // 4. Handle Ring (Ensure structure if enabled)
        if (layer.changes?.ring) {
            // If the ring was disabled and "cleaned", it might be gone or empty.
            // If it exists, we format it.
            if (layer.changes.ring.enabled === true) {
                layer.changes.ring = {
                    enabled: true,
                    colors: layer.changes.ring.colors,
                    effects: layer.changes.ring.effects,
                    subject: layer.changes.ring.subject
                };
            } else {
                 // Explicitly ensure disabled rings don't accidentally merge weird data
                 layer.changes.ring = { enabled: false };
            }
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
            mode: "identity",
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

        const atomicScale = c.scale;
        const bakedScaleX = tx.scaleX ?? 1.0;
        const bakedScaleY = tx.scaleY ?? 1.0;

        const isFlippedX = (c.mirrorX !== undefined && c.mirrorX !== null) ? c.mirrorX : (bakedScaleX < 0);
        const isFlippedY = (c.mirrorY !== undefined && c.mirrorY !== null) ? c.mirrorY : (bakedScaleY < 0);

        const alpha = c.alpha ?? 1.0;
        const lockRotation = c.lockRotation ?? false;

        const pathIcon = "modules/visage/icons/navigation.svg";
        const hActive = (c.mirrorX !== undefined && c.mirrorX !== null) || (bakedScaleX < 0);
        const hRot = isFlippedX ? "visage-rotate-270" : "visage-rotate-90";
        const hLabel = game.i18n.localize("VISAGE.Mirror.Badge.H");

        const vActive = (c.mirrorY !== undefined && c.mirrorY !== null) || (bakedScaleY < 0);
        const vRot = isFlippedY ? "visage-rotate-180" : "visage-rotate-0";
        const vLabel = game.i18n.localize("VISAGE.Mirror.Badge.V");

        const isScaleIntent = (atomicScale !== undefined && atomicScale !== null);
        const isScaleNonDefault = Math.abs(bakedScaleX) !== 1.0;
        const isScaleActive = isScaleIntent || isScaleNonDefault;
        
        const finalScale = (atomicScale !== undefined && atomicScale !== null) ? atomicScale : Math.abs(bakedScaleX);
        const displayScaleVal = Math.round(finalScale * 100);
        const scaleLabel = `${displayScaleVal}%`;

        const w = c.width ?? 1;
        const h = c.height ?? 1;
        const isDimIntent = (c.width !== undefined && c.width !== null) || (c.height !== undefined && c.height !== null);
        const isDimNonStandard = (w !== 1) || (h !== 1);
        const isDimActive = isDimIntent || isDimNonStandard;
        const sizeLabel = `${w}x${h}`;

        const isWildcard = options.isWildcard ?? false;
        const wildcardLabel = game.i18n.localize("VISAGE.Wildcard.Label"); 

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

        const isAlphaActive = (c.alpha !== undefined && c.alpha !== null) && c.alpha !== 1.0;
        const isLockActive = (c.lockRotation !== undefined && c.lockRotation !== null);
        const isLocked = (c.lockRotation === true);
        const lockLabel = isLocked 
            ? game.i18n.localize("VISAGE.RotationLock.Locked") 
            : game.i18n.localize("VISAGE.RotationLock.Unlocked");

        const rawEffects = c.effects || [];
        const activeEffects = rawEffects.filter(e => !e.disabled);
        const hasEffects = activeEffects.length > 0;
        
        let effectsTooltip = "";
        if (hasEffects) {
            const listItems = activeEffects.map(e => {
                const icon = e.type === "audio" ? "visage-icon audio" : "visage-icon visual";
                let meta = "";

                if (e.type === "audio") {
                    // Audio: Show Volume
                    const volLabel = game.i18n.localize("VISAGE.Editor.Effects.Volume");
                    meta = `${volLabel}: ${Math.round((e.opacity ?? 0.8) * 100)}%`;
                } else {
                    // Visual: Show Z-Order (Above/Below)
                    // We use the short keys if available, or fallback to the full ones
                    const zLabel = e.zOrder === "below" 
                        ? game.i18n.localize("VISAGE.Editor.Effects.Below") 
                        : game.i18n.localize("VISAGE.Editor.Effects.Above");
                    meta = zLabel;
                }
                
                return `
                <div class='visage-tooltip-row'>
                    <i class='${icon}'></i> 
                    <span class='label'>${e.label || "Effect"}</span>
                    <span class='meta'>${meta}</span>
                </div>`;
            }).join("");
            
            effectsTooltip = `<div class='visage-tooltip-content'>${listItems}</div>`;
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
            alpha: alpha,
            lockRotation: lockRotation,
            mode: data.mode, 
            
            meta: {
                hasRing: ringCtx.enabled,
                hasPulse: ringCtx.hasPulse,
                hasGradient: ringCtx.hasGradient,
                hasWave: ringCtx.hasWave,
                hasInvisibility: ringCtx.hasInvisibility,
                ringColor: ringCtx.colors.ring,
                ringBkg: ringCtx.colors.background,
                
                showDataChip: isScaleActive || isDimActive,
                showFlipBadge: hActive || vActive,
                showDispositionChip: dispClass !== "none",
                tokenName: c.name || null,
                
                hasEffects: hasEffects,
                effectsTooltip: effectsTooltip,

                slots: {
                    scale: { active: isScaleActive, val: scaleLabel },
                    dim: { active: isDimActive, val: sizeLabel },
                    alpha: { active: isAlphaActive, val: `${Math.round(alpha * 100)}%` },
                    lock: { active: isLockActive, val: lockLabel },
                    flipH: { active: hActive, src: pathIcon, cls: hRot, val: hLabel },
                    flipV: { active: vActive, src: pathIcon, cls: vRot, val: vLabel },
                    wildcard: { active: isWildcard, val: wildcardLabel },
                    disposition: { class: dispClass, val: dispLabel }
                }
            }
        };
    }
   
    static _getRawGlobal() { return game.settings.get(this.MODULE_ID, this.SETTING_KEY); }
    static get globals() {
        const raw = this._getRawGlobal();
        return Object.values(raw).filter(v => !v.deleted).map(v => foundry.utils.deepClone(v)).sort((a, b) => b.created - a.created);
    }
    static get bin() {
        const raw = this._getRawGlobal();
        return Object.values(raw).filter(v => v.deleted).map(v => foundry.utils.deepClone(v)).sort((a, b) => b.deletedAt - a.deletedAt);
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
                    mode: data.mode || "identity", 
                    changes: foundry.utils.deepClone(data.changes),
                    deleted: !!data.deleted
                });
            }
        }
        return results.sort((a, b) => a.label.localeCompare(b.label));
    }

    static async promote(actor, visageId) {
        const localVisages = this.getLocal(actor);
        const source = localVisages.find(v => v.id === visageId);
        if (!source) return ui.notifications.warn("Visage | Source not found.");

        const payload = {
            label: source.label,
            category: source.category,
            tags: source.tags ? [...source.tags] : [],
            mode: source.mode, 
            changes: foundry.utils.deepClone(source.changes)
        };

        await this._saveGlobal(payload);
        ui.notifications.info(game.i18n.format("VISAGE.Notifications.Promoted", { name: payload.label }));
    }

    static async commitToDefault(tokenOrId, visageId) {
        const token = (typeof tokenOrId === "string") ? canvas.tokens.get(tokenOrId) : tokenOrId;
        if (!token || !token.actor) return ui.notifications.warn("Visage | No actor found.");
        const targetVisage = this.getLocal(token.actor).find(v => v.id === visageId);
        if (!targetVisage) return ui.notifications.warn("Visage | Target Visage not found.");
        const currentDefault = this.getDefaultAsVisage(token.document);
        if (!currentDefault) return;

        const backupData = {
            label: `${currentDefault.changes.name || token.name} (Backup)`,
            category: "Backup",
            tags: ["Backup", ...(currentDefault.tags || [])],
            mode: "identity",
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
        if (isLinked) await token.actor.update({ prototypeToken: updatePayload });
        else await token.document.update(updatePayload);

        const newOriginalState = VisageUtilities.extractVisualState({
            ...token.document.toObject(), 
            ...foundry.utils.expandObject(updatePayload) 
        });

        await token.document.update({ [`flags.${this.DATA_NAMESPACE}.originalState`]: newOriginalState });

        const VisageApi = game.modules.get(this.MODULE_ID).api;
        if (VisageApi) await VisageApi.remove(token.id, visageId);
        
        ui.notifications.info(game.i18n.format("VISAGE.Notifications.DefaultSwapped", { label: targetVisage.label }));
    }

    static async save(payload, actor = null) {
        if (actor) return this._saveLocal(payload, actor);
        return this._saveGlobal(payload);
    }
    static async delete(id, actor = null) {
        if (actor) return actor.update({ [`flags.${this.DATA_NAMESPACE}.${this.ALTERNATE_FLAG_KEY}.${id}.deleted`]: true });
        return this.updateGlobal(id, { deleted: true, deletedAt: Date.now() });
    }
    static async restore(id, actor = null) {
        if (actor) return actor.update({ [`flags.${this.DATA_NAMESPACE}.${this.ALTERNATE_FLAG_KEY}.${id}.deleted`]: false });
        return this.updateGlobal(id, { deleted: false, deletedAt: null });
    }
    static async destroy(id, actor = null) {
        if (actor) return actor.update({ [`flags.${this.DATA_NAMESPACE}.${this.ALTERNATE_FLAG_KEY}.-=${id}`]: null });
        const all = this._getRawGlobal();
        if (all[id]) {
            delete all[id];
            await game.settings.set(this.MODULE_ID, this.SETTING_KEY, all);
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
            mode: data.mode || "overlay", 
            created: existing ? existing.created : timestamp,
            updated: timestamp,
            deleted: false,
            deletedAt: null,
            changes: foundry.utils.deepClone(data.changes || {})
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
        const entry = {
            id: id,
            label: data.label,
            category: data.category,
            tags: data.tags,
            mode: data.mode || "identity", 
            changes: foundry.utils.deepClone(data.changes || {}),
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