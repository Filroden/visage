/* visage-data.js */
import { VisageUtilities } from "./visage-utilities.js";

const SCHEMA_VERSION = 1;

/**
 * The primary data controller class.
 * Handles CRUD operations for Visages (Local) and Masks (Global),
 * as well as transforming raw data into usable "Layers" or "Presentation Contexts".
 */
export class VisageData {
    static MODULE_ID = "visage";
    static DATA_NAMESPACE = "visage";
    static ALTERNATE_FLAG_KEY = "alternateVisages";
    static SETTING_KEY = "globalVisages";

    /**
     * Registers the world-level game setting used to store the Global Mask Library.
     */
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

    /**
     * Prepares the Dynamic Token Ring configuration for UI display.
     * Decodes the bitmask effects into boolean flags.
     * @param {Object} ringData - The raw ring data object.
     * @returns {Object} A context object ready for Handlebars.
     */
    static prepareRingContext(ringData) {
        const data = ringData || {};
        const currentEffects = data.effects || 0;
        
        // Define available effects and their bitmask values
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

    /**
     * Extracts the primary image path for a Visage/Mask.
     * Prioritizes Dynamic Ring subjects over standard Token Textures.
     * @param {Object} changes - The changes object from a Visage.
     * @returns {string} The resolved image path or empty string.
     */
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

    /**
     * Converts a stored data entry into a runtime "Layer" for the VisageComposer.
     * Handles path resolution and ensures the structure matches the composer's expectations.
     * @param {Object} data - The stored visage data.
     * @returns {Promise<Object>} The compiled layer object.
     */
    static async toLayer(data) {
        if (!data) return null;

        const layer = {
            id: data.id,
            label: data.label || "Unknown",
            changes: foundry.utils.deepClone(data.changes || {})
        };

        // Ensure texture paths are fully resolved (e.g. wildcard selection happens here)
        if (layer.changes.texture?.src) {
            const resolved = await VisageUtilities.resolvePath(layer.changes.texture.src);
            layer.changes.texture.src = resolved || layer.changes.texture.src;
        }

        // Normalize Ring Data structure
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

    /**
     * Creates a "Virtual Visage" representing the token's current Default state.
     * This allows the "Default" appearance to be treated like any other card in the UI.
     * @param {TokenDocument} tokenDoc - The source token document.
     * @returns {Object} A Visage-like data object.
     */
    static getDefaultAsVisage(tokenDoc) {
        if (!tokenDoc) return null;

        // 1. Try Snapshot (Highest Priority)
        // If a Visage is active, 'originalState' holds the true default data.
        let sourceData = tokenDoc.flags?.[this.MODULE_ID]?.originalState;
        
        // 2. Fallback (If no Visage is active, the token IS the default)
        // We use the current visual state of the token document itself.
        // This ensures we capture any manual edits made to the specific token instance.
        if (!sourceData) {
            sourceData = VisageUtilities.extractVisualState(tokenDoc);
        }

        const src = sourceData.texture?.src || tokenDoc.texture.src;
        
        // Handle Legacy (Baked) vs Atomic Scale
        const scaleX = sourceData.texture?.scaleX ?? sourceData.scaleX ?? 1.0;
        const scaleY = sourceData.texture?.scaleY ?? sourceData.scaleY ?? 1.0; 
        
        const width = sourceData.width ?? 1;
        const height = sourceData.height ?? 1;
        const disposition = sourceData.disposition ?? 0;
        
        const ringData = sourceData.ring 
            ? (sourceData.ring.toObject ? sourceData.ring.toObject() : sourceData.ring) 
            : {};
            
        // Calculate mirroring from negative scale
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

    /**
     * Prepares data for UI rendering (Gallery cards, Editor preview, HUD tiles).
     * Calculates badges, resolves icons, and handles the "Intent vs Default" logic.
     * @param {Object} data - The raw visage data.
     * @param {Object} options - Context options (isWildcard, isActive, etc.).
     * @returns {Object} A context object enriched with `meta` properties for Handlebars.
     */
    static toPresentation(data, options = {}) {
        const c = data.changes || {};
        const tx = c.texture || {};
        
        const displayPath = this.getRepresentativeImage(c);
        const isVideo = options.isVideo ?? foundry.helpers.media.VideoHelper.hasVideoExtension(displayPath);

        // --- 1. RESOLVE VALUES ---
        const atomicScale = c.scale;
        const bakedScaleX = tx.scaleX ?? 1.0;
        const bakedScaleY = tx.scaleY ?? 1.0;

        // Determine Flipped State (Priority: Atomic Mirror > Legacy Negative Scale)
        const isFlippedX = (c.mirrorX !== undefined && c.mirrorX !== null) ? c.mirrorX : (bakedScaleX < 0);
        const isFlippedY = (c.mirrorY !== undefined && c.mirrorY !== null) ? c.mirrorY : (bakedScaleY < 0);

        // Alpha and Lock Rotation states
        const alpha = c.alpha ?? 1.0;
        const lockRotation = c.lockRotation ?? false;

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
        // Active if: Explicit Intent (c.scale exists) OR Legacy Non-Default (baked != 1.0)
        const isScaleIntent = (atomicScale !== undefined && atomicScale !== null);
        const isScaleNonDefault = Math.abs(bakedScaleX) !== 1.0;
        const isScaleActive = isScaleIntent || isScaleNonDefault;
        
        const finalScale = (atomicScale !== undefined && atomicScale !== null) 
            ? atomicScale 
            : Math.abs(bakedScaleX);
        const displayScaleVal = Math.round(finalScale * 100);
        const scaleLabel = `${displayScaleVal}%`;

        // D. Dimensions Logic
        const w = c.width ?? 1;
        const h = c.height ?? 1;
        
        // Active if: Explicit Intent (Not Null) OR Non-Standard Size (Not 1x1)
        const isDimIntent = (c.width !== undefined && c.width !== null) || (c.height !== undefined && c.height !== null);
        const isDimNonStandard = (w !== 1) || (h !== 1);
        const isDimActive = isDimIntent || isDimNonStandard;
        
        const sizeLabel = `${w}x${h}`;

        // E. Wildcard Badge
        const isWildcard = options.isWildcard ?? false;
        const wildcardLabel = game.i18n.localize("VISAGE.Wildcard.Label"); 

        // F. Disposition Chip
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

        // G. Opacity Logic
        // Only active if intent exists AND it's not 1.0
        const isAlphaActive = (c.alpha !== undefined && c.alpha !== null) && c.alpha !== 1.0;
        
        // H. Lock Rotation Logic
        // Active if explicit intent exists (true OR false).
        const isLockActive = (c.lockRotation !== undefined && c.lockRotation !== null);
        const isLocked = (c.lockRotation === true);
        const lockLabel = isLocked 
            ? game.i18n.localize("VISAGE.RotationLock.Locked") 
            : game.i18n.localize("VISAGE.RotationLock.Unlocked");

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

    static _getRawGlobal() {
        return game.settings.get(this.MODULE_ID, this.SETTING_KEY);
    }

    /**
     * @returns {Array<Object>} List of all non-deleted Global Masks.
     */
    static get globals() {
        const raw = this._getRawGlobal();
        return Object.values(raw)
            .filter(v => !v.deleted)
            .map(v => foundry.utils.deepClone(v))
            .sort((a, b) => b.created - a.created);
    }

    /**
     * @returns {Array<Object>} List of deleted Global Masks (Recycle Bin).
     */
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

    /**
     * Retrieves all Local Visages from a specific Actor.
     * @param {Actor} actor - The target actor.
     * @returns {Array<Object>} List of visages.
     */
    static getLocal(actor) {
        if (!actor) return [];
        const ns = this.DATA_NAMESPACE; 
        const sourceData = actor.flags?.[ns]?.[this.ALTERNATE_FLAG_KEY] || {};
        const results = [];

        for (const [key, data] of Object.entries(sourceData)) {
            if (!data) continue;
            // Ensure ID exists (fallback to key for migrated data)
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
     * Creates a deep copy of the data in the world settings so it is accessible to all tokens.
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
        // (ID will be regenerated by _saveGlobal to avoid conflicts)
        const payload = {
            label: source.label,
            category: source.category,
            tags: source.tags ? [...source.tags] : [],
            changes: foundry.utils.deepClone(source.changes)
        };

        await this._saveGlobal(payload);
        
        ui.notifications.info(game.i18n.format("VISAGE.Notifications.Promoted", { name: payload.label }));
    }

    /**
     * Swaps the token's Default state with a specific Visage.
     * Creates a backup of the previous default before overwriting.
     * @param {Token|string} tokenOrId - The target token.
     * @param {string} visageId - The ID of the Visage to make default.
     */
    static async commitToDefault(tokenOrId, visageId) {
        const token = (typeof tokenOrId === "string") ? canvas.tokens.get(tokenOrId) : tokenOrId;
        if (!token || !token.actor) return ui.notifications.warn("Visage | No actor found for commit.");

        const targetVisage = this.getLocal(token.actor).find(v => v.id === visageId);
        if (!targetVisage) return ui.notifications.warn("Visage | Target Visage not found.");

        const currentDefault = this.getDefaultAsVisage(token.document);
        if (!currentDefault) return;

        // 1. Create Backup of Current Default
        const backupData = {
            label: `${currentDefault.changes.name || token.name} (Backup)`,
            category: "Backup",
            tags: ["Backup", ...(currentDefault.tags || [])],
            changes: currentDefault.changes
        };
        await this._saveLocal(backupData, token.actor);

        // 2. Prepare New Default Data (Merge)
        const newDefaultData = foundry.utils.mergeObject(
            foundry.utils.deepClone(currentDefault.changes), 
            foundry.utils.deepClone(targetVisage.changes), 
            { inplace: false, insertKeys: true, overwrite: true }
        );

        // 3. Construct Update Payload for Token Document
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

        // Clean undefined keys
        for (const key of Object.keys(updatePayload)) {
            if (updatePayload[key] === undefined) delete updatePayload[key];
        }

        // 4. Update Token (Linked or Unlinked)
        const isLinked = token.document.isLinked;
        if (isLinked) {
            await token.actor.update({ prototypeToken: updatePayload });
        } else {
            await token.document.update(updatePayload);
        }

        // 5. Update Snapshot Flag (to prevent immediate revert)
        const newOriginalState = VisageUtilities.extractVisualState({
            ...token.document.toObject(), 
            ...foundry.utils.expandObject(updatePayload) 
        });

        await token.document.update({
            [`flags.${this.DATA_NAMESPACE}.originalState`]: newOriginalState
        });

        // 6. Cleanup active visage layers
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

    /* -------------------------------------------- */
    /* INTERNAL STORAGE HELPERS                    */
    /* -------------------------------------------- */

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

    /**
     * Periodically cleans up deleted items from the Recycle Bin.
     * Currently set to auto-delete items older than 30 days.
     */
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