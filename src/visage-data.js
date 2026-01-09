/**
 * @file Manages the data layer for the Visage module.
 * Handles Storage, Retrieval, Data Transformation, and Database Writes for both
 * Local Identities (Actor Flags) and Global Overrides (World Settings).
 * @module visage
 */

import { VisageUtilities } from "./visage-utilities.js";

const SCHEMA_VERSION = 1;

/**
 * Static class responsible for all data operations.
 */
export class VisageData {

    static MODULE_ID = "visage";
    static DATA_NAMESPACE = "visage";
    static ALTERNATE_FLAG_KEY = "alternateVisages";
    static SETTING_KEY = "globalVisages";

    /**
     * Registers the world-level settings used to store Global Masks.
     * Called during the module initialization phase.
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
     * transforms raw Foundry V12 ring data into a context object usable by Handlebars.
     * Decodes bitwise effect flags into boolean properties.
     * @param {Object} ringData - The raw ring data object from the token or flag.
     * @returns {Object} A presentation-ready object containing colors, active effects, and enabled state.
     */
    static prepareRingContext(ringData) {
        const data = ringData || {};
        const currentEffects = data.effects || 0;
        
        // Map of bitwise values to effect keys
        const availableEffects = [
            { value: 2, label: "VISAGE.RingConfig.Effects.Pulse", key: "RING_PULSE" },
            { value: 4, label: "VISAGE.RingConfig.Effects.Gradient", key: "RING_GRADIENT" },
            { value: 8, label: "VISAGE.RingConfig.Effects.Wave", key: "BKG_WAVE" },
            { value: 16, label: "VISAGE.RingConfig.Effects.Invisibility", key: "INVISIBILITY" }
        ];

        // Decode bitmasks
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

    /**
     * Converts a stored data object (Visage/Mask) into a runtime Layer object.
     * Resolves wildcards and normalizes texture paths during the conversion.
     * @param {Object} data - The stored Visage data.
     * @returns {Promise<Object|null>} The runtime layer ready for the stack, or null if invalid.
     */
    static async toLayer(data) {
        if (!data) return null;

        const layer = {
            id: data.id,
            label: data.label || "Unknown",
            changes: foundry.utils.deepClone(data.changes || {})
        };

        // Resolve Image Paths (Wildcards/S3)
        if (layer.changes.texture?.src) {
            layer.changes.texture.src = await VisageUtilities.resolvePath(layer.changes.texture.src);
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
     * Creates a standard Visage data object representing the token's current "Default" state.
     * Used for the "Default" tile in the HUD and for backup operations.
     * @param {TokenDocument} tokenDoc - The token document to analyze.
     * @returns {Object|null} A Visage data object or null if no document provided.
     */
    static getDefaultAsVisage(tokenDoc) {
        if (!tokenDoc) return null;

        // Try to read the specific "Clean Snapshot" flag first.
        let sourceData = tokenDoc.flags?.[this.MODULE_ID]?.originalState;

        // If no snapshot exists (token has never been modified by Visage), extract current state.
        if (!sourceData) {
            sourceData = VisageUtilities.extractVisualState(tokenDoc);
        }

        // Normalize Data
        const src = sourceData.texture?.src || sourceData.img || tokenDoc.texture.src;
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

    /**
     * Determines the primary image path for a Visage, handling Ring Subject Textures.
     * @param {Object} changes - The changes object from the Visage data.
     * @returns {string} The path to the image that should be displayed.
     */
    static getRepresentativeImage(changes) {
        if (!changes) return "";
        
        // Priority 1: If Ring is Enabled AND has a Subject Texture override
        if (changes.ring?.enabled && changes.ring.subject?.texture) {
            return changes.ring.subject.texture;
        }

        // Priority 2: Standard Token Image
        return changes.img || changes.texture?.src || "";
    }

    /**
     * Prepares a Visage data object for display in the UI (Gallery/HUD).
     * Calculates human-readable labels for scale, dimensions, and flip state.
     * @param {Object} data - The raw Visage data.
     * @param {Object} [options={}] - Additional context flags (isActive, isVideo, etc).
     * @returns {Object} The decorated object ready for Handlebars.
     */
    static toPresentation(data, options = {}) {
        const c = data.changes || {};
        const tx = c.texture || {};
        
        const displayPath = this.getRepresentativeImage(c);

        // Calculate Scale display (e.g., "150%")
        const rawScaleX = tx.scaleX ?? 1.0;
        const rawScaleY = tx.scaleY ?? 1.0;
        const absScale = Math.abs(rawScaleX);
        const displayScale = Math.round(absScale * 100);
        
        const isFlippedX = rawScaleX < 0;
        const isFlippedY = rawScaleY < 0;

        const isScaleDefault = absScale === 1.0;
        const scaleLabel = isScaleDefault ? "" : `${displayScale}%`;
        
        // Calculate Dimensions display (e.g., "2x2")
        const w = c.width ?? 1;
        const h = c.height ?? 1;
        const isSizeDefault = w === 1 && h === 1;
        const sizeLabel = isSizeDefault ? "" : `${w}x${h}`;

        // Calculate Mirroring Badge
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

        // Calculate Disposition Class
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
            isVideo: options.isVideo ?? false,
            isWildcard: options.isWildcard ?? false,
            path: displayPath,
            scale: absScale,
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

    /**
     * @private
     * @returns {Object} The raw settings object for global masks.
     */
    static _getRawGlobal() {
        return game.settings.get(this.MODULE_ID, this.SETTING_KEY);
    }

    /**
     * Retrieves all active (non-deleted) Global Masks.
     * @returns {Array<Object>} Sorted array of mask objects.
     */
    static get globals() {
        const raw = this._getRawGlobal();
        return Object.values(raw)
            .filter(v => !v.deleted)
            .map(v => foundry.utils.deepClone(v))
            .sort((a, b) => b.created - a.created);
    }

    /**
     * Retrieves all soft-deleted Global Masks (The Recycle Bin).
     * @returns {Array<Object>} Sorted array of deleted mask objects.
     */
    static get bin() {
        const raw = this._getRawGlobal();
        return Object.values(raw)
            .filter(v => v.deleted)
            .map(v => foundry.utils.deepClone(v))
            .sort((a, b) => b.deletedAt - a.deletedAt);
    }

    /**
     * Retrieves a specific Global Mask by ID.
     * @param {string} id 
     * @returns {Object|null}
     */
    static getGlobal(id) {
        const data = this._getRawGlobal()[id];
        return data ? foundry.utils.deepClone(data) : null;
    }

    /**
     * Retrieves all Local Visages stored on a specific Actor.
     * @param {Actor} actor - The actor to retrieve forms for.
     * @returns {Array<Object>} Sorted array of visage objects.
     */
    static getLocal(actor) {
        if (!actor) return [];
        
        const ns = this.DATA_NAMESPACE; 
        const sourceData = actor.flags?.[ns]?.[this.ALTERNATE_FLAG_KEY] || {};
        const results = [];

        for (const [key, data] of Object.entries(sourceData)) {
            if (!data) continue;
            // Handle legacy IDs where the key was the ID
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
    /* WRITE OPERATIONS                            */
    /* -------------------------------------------- */

    /**
     * Updates the token's default appearance (Prototype) to match a specific Visage.
     * 1. Creates a backup of the current default state.
     * 2. Merges the target Visage data into the current default.
     * 3. Updates the Actor/Token and the Visage 'Original State' flag.
     * 4. Removes the active mask layer for that visage.
     * * @param {TokenDocument|string} tokenOrId - The target token.
     * @param {string} visageId - The ID of the local Visage to commit.
     * @returns {Promise<void>}
     */
    static async commitToDefault(tokenOrId, visageId) {
        const token = (typeof tokenOrId === "string") ? canvas.tokens.get(tokenOrId) : tokenOrId;
        if (!token || !token.actor) return ui.notifications.warn("Visage | No actor found for commit.");

        // 1. Get Target Visage Data
        const targetVisage = this.getLocal(token.actor).find(v => v.id === visageId);
        if (!targetVisage) return ui.notifications.warn("Visage | Target Visage not found.");

        // 2. Backup Current Default
        // Capture the underlying default state (ignoring currently active masks)
        const currentDefault = this.getDefaultAsVisage(token.document);
        
        // Safety: If for some reason we can't generate a default, abort.
        if (!currentDefault) return;

        const backupData = {
            label: `${currentDefault.changes.name || token.name} (Backup)`,
            category: "Backup",
            tags: ["Backup", ...(currentDefault.tags || [])],
            changes: currentDefault.changes
        };
        
        // Save Backup to Actor
        await this._saveLocal(backupData, token.actor);

        // 3. Calculate New Default Data
        // Merge target changes on top of current default to preserve properties 
        // not explicitly defined in the Visage (e.g., token size, disposition).
        const newDefaultData = foundry.utils.mergeObject(
            foundry.utils.deepClone(currentDefault.changes), 
            foundry.utils.deepClone(targetVisage.changes), 
            { inplace: false, insertKeys: true, overwrite: true }
        );

        // 4. Build Update Payload (STRICT V2 MAPPING)
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

        // Clean undefined keys to prevent db errors
        for (const key of Object.keys(updatePayload)) {
            if (updatePayload[key] === undefined) delete updatePayload[key];
        }

        // 5. Perform Updates
        const isLinked = token.document.isLinked;
        
        // A. Update the Actual Default (Prototype or Token)
        if (isLinked) {
            await token.actor.update({ prototypeToken: updatePayload });
        } else {
            await token.document.update(updatePayload);
        }

        // B. Update the "Hidden" Base State (flags.visage.originalState)
        // This ensures that if the user hits "Revert" later, they revert to THIS new state,
        // not the old backup.
        const newOriginalState = VisageUtilities.extractVisualState({
            ...token.document.toObject(), 
            ...foundry.utils.expandObject(updatePayload) // Use expandObject to correctly merge "texture.src" into {texture: {src}}
        });

        await token.document.update({
            [`flags.${this.DATA_NAMESPACE}.originalState`]: newOriginalState
        });

        // C. Remove the Active Layer (Auto-Revert)
        // Since the base token now matches the Visage, we remove the temporary Visage layer
        // to keep the stack clean.
        const VisageApi = game.modules.get(this.MODULE_ID).api;
        if (VisageApi) {
            await VisageApi.remove(token.id, visageId);
        }
        
        ui.notifications.info(game.i18n.format("VISAGE.Notifications.DefaultSwapped", { label: targetVisage.label }));
    }

    /**
     * Router method to save a Visage/Mask.
     * @param {Object} payload - The data to save.
     * @param {Actor|null} [actor=null] - If provided, saves locally. Otherwise, saves globally.
     */
    static async save(payload, actor = null) {
        if (actor) return this._saveLocal(payload, actor);
        return this._saveGlobal(payload);
    }

    /**
     * Soft deletes a Visage/Mask.
     * @param {string} id 
     * @param {Actor|null} [actor=null] 
     */
    static async delete(id, actor = null) {
        if (actor) {
            return actor.update({
                [`flags.${this.DATA_NAMESPACE}.${this.ALTERNATE_FLAG_KEY}.${id}.deleted`]: true
            });
        }
        return this.updateGlobal(id, { deleted: true, deletedAt: Date.now() });
    }

    /**
     * Restores a soft-deleted Visage/Mask.
     * @param {string} id 
     * @param {Actor|null} [actor=null] 
     */
    static async restore(id, actor = null) {
        if (actor) {
            return actor.update({
                [`flags.${this.DATA_NAMESPACE}.${this.ALTERNATE_FLAG_KEY}.${id}.deleted`]: false
            });
        }
        return this.updateGlobal(id, { deleted: false, deletedAt: null });
    }

    /**
     * Permanently deletes a Visage/Mask.
     * @param {string} id 
     * @param {Actor|null} [actor=null] 
     */
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
    /* INTERNAL SAVE HANDLERS                      */
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
     * Purges Global Masks that have been in the bin for more than 30 days.
     * Only runs for GMs to prevent permission errors.
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