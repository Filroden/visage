/**
 * @file Manages the data layer for the Visage module.
 * Acts as a unified Repository for both World Settings (Global Masks) and Actor Flags (Local Visages).
 * * DESIGN NOTE: This class intentionally avoids importing the main `Visage` class to prevent 
 * Circular Dependency issues during module initialization.
 * * @module visage
 */

const SCHEMA_VERSION = 1;

export class VisageData {

    // --- CONSTANTS ---
    // Defined locally to break dependency cycles with the main Visage class.
    static MODULE_ID = "visage";
    static DATA_NAMESPACE = "visage";
    static ALTERNATE_FLAG_KEY = "alternateVisages";
    static SETTING_KEY = "globalVisages";

    /**
     * Registers the Foundry VTT world setting used to store Global Visages.
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

    /**
     * Helper to resolve wildcard paths or S3 URLs into a concrete file path.
     * Mimics `Visage.resolvePath` but implementation is local to avoid imports.
     * @param {string} path - The source path (e.g., "tokens/*").
     * @returns {Promise<string>} The resolved single file path.
     * @private
     */
    static async _resolvePath(path) {
        if (!path || !path.includes('*')) return path;
        try {
            const browseOptions = { wildcard: true };
            let source = "data";
            
            // S3 Handling
            if (/\.s3\./i.test(path)) {
                source = 's3';
                const { bucket, keyPrefix } = foundry.applications.apps.FilePicker.implementation.parseS3URL(path);
                if (bucket) {
                    browseOptions.bucket = bucket;
                    path = keyPrefix;
                }
            } else if (path.startsWith('icons/')) {
                source = 'public';
            }

            const content = await foundry.applications.apps.FilePicker.implementation.browse(source, path, browseOptions);
            if (content.files.length) {
                return content.files[Math.floor(Math.random() * content.files.length)];
            }
        } catch (err) {
            console.warn("VisageData | Wildcard resolution failed", err);
        }
        return path;
    }

    /* -------------------------------------------- */
    /* DATA HELPERS                                */
    /* -------------------------------------------- */

    /**
     * Parses the raw Ring data object into a context usable by the UI.
     * Handles bitwise decoding of ring effects (Pulse, Gradient, etc.).
     * @param {Object} ringData - The raw ring data from flags.
     * @returns {Object} The processed context object.
     */
    static prepareRingContext(ringData) {
        const data = ringData || {};
        const currentEffects = data.effects || 0;
        
        // Bitmask definitions for Ring Effects
        const availableEffects = [
            { value: 2, label: "VISAGE.RingConfig.Effects.Pulse", key: "RING_PULSE" },
            { value: 4, label: "VISAGE.RingConfig.Effects.Gradient", key: "RING_GRADIENT" },
            { value: 8, label: "VISAGE.RingConfig.Effects.Wave", key: "BKG_WAVE" },
            { value: 16, label: "VISAGE.RingConfig.Effects.Invisibility", key: "INVISIBILITY" }
        ];

        // Decode bitmask
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
     * Converts a stored Visage Data object into an active Token Layer object.
     * Resolves wildcards and normalizes structure for the Stack logic.
     * @param {Object} data - The stored data (from Global or Local).
     * @returns {Promise<Object>} The layer object ready for the stack.
     */
    static async toLayer(data) {
        if (!data) return null;

        const layer = {
            id: data.id,
            label: data.label || "Unknown",
            changes: foundry.utils.deepClone(data.changes || {})
        };

        // Resolve Image paths (async)
        if (layer.changes.img) {
            if (!layer.changes.texture) layer.changes.texture = {};
            layer.changes.texture.src = await this._resolvePath(layer.changes.img);
            delete layer.changes.img;
        } else if (layer.changes.texture?.src) {
            layer.changes.texture.src = await this._resolvePath(layer.changes.texture.src);
        }

        // Normalize Ring data
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
     * Generates a virtual "Visage" entry representing the token's Default state.
     * Prioritizes the "Original State" snapshot if it exists; falls back to live token data.
     * @param {TokenDocument} tokenDoc - The token document.
     * @returns {Object|null} A Visage-compatible data object.
     */
    static getDefaultAsVisage(tokenDoc) {
        if (!tokenDoc) return null;

        // 1. Try to find the "Clean" snapshot (captured before any Visage was applied)
        let sourceData = tokenDoc.flags?.[this.MODULE_ID]?.originalState;

        // 2. Fallback: If no snapshot exists, the token is currently in its default state
        if (!sourceData) {
            sourceData = {
                name: tokenDoc.name,
                texture: {
                    src: tokenDoc.texture.src,
                    scaleX: tokenDoc.texture.scaleX,
                    scaleY: tokenDoc.texture.scaleY
                },
                width: tokenDoc.width,
                height: tokenDoc.height,
                disposition: tokenDoc.disposition,
                ring: tokenDoc.ring
            };
        }

        // 3. Normalize Data Structure
        const src = sourceData.texture?.src || sourceData.img || tokenDoc.texture.src;
        
        const scaleX = sourceData.texture?.scaleX ?? sourceData.scaleX ?? 1.0;
        const scaleY = sourceData.texture?.scaleY ?? sourceData.scaleY ?? 1.0; 
        
        const width = sourceData.width ?? 1;
        const height = sourceData.height ?? 1;
        const disposition = sourceData.disposition ?? 0;
        
        const ringData = sourceData.ring 
            ? (sourceData.ring.toObject ? sourceData.ring.toObject() : sourceData.ring) 
            : {};

        // Calculate Flip state from scale signs
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
                img: src,
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
     * Formats raw Visage data into a UI-ready context object for Handlebars.
     * Calculates badges, icons, and localized labels.
     * @param {Object} data - The raw data object.
     * @param {Object} [options] - Additional UI flags (isActive, isVideo, etc.).
     * @returns {Object} The context object for `visage-card.hbs`.
     */
    static toPresentation(data, options = {}) {
        const c = data.changes || {};
        const tx = c.texture || {};
        
        // Scale & Flip Calculations
        const rawScaleX = tx.scaleX ?? 1.0;
        const rawScaleY = tx.scaleY ?? 1.0;
        const absScale = Math.abs(rawScaleX);
        const displayScale = Math.round(absScale * 100);
        
        const isFlippedX = (rawScaleX < 0) || (c.flipX === true);
        const isFlippedY = (tx.scaleY < 0) || (c.flipY === true);

        const isScaleDefault = absScale === 1.0;
        const scaleLabel = isScaleDefault ? "" : `${displayScale}%`;
        
        // Dimension Calculations
        const w = c.width ?? 1;
        const h = c.height ?? 1;
        const isSizeDefault = w === 1 && h === 1;
        const sizeLabel = isSizeDefault ? "" : `${w}x${h}`;

        // Semiotics: Flip Icons
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

        // Semiotics: Disposition Colors
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

        // Return Flattened Context
        return {
            ...data,
            isActive: options.isActive ?? false,
            isVideo: options.isVideo ?? false,
            isWildcard: options.isWildcard ?? false,
            
            path: c.img || c.texture?.src,
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

    static _getRawGlobal() {
        return game.settings.get(this.MODULE_ID, this.SETTING_KEY);
    }

    /**
     * Returns all active Global Visages, sorted by creation date (newest first).
     * @returns {Array<Object>}
     */
    static get globals() {
        const raw = this._getRawGlobal();
        return Object.values(raw)
            .filter(v => !v.deleted)
            .sort((a, b) => b.created - a.created);
    }

    /**
     * Returns all deleted Global Visages (Recycle Bin), sorted by deletion date.
     * @returns {Array<Object>}
     */
    static get bin() {
        const raw = this._getRawGlobal();
        return Object.values(raw)
            .filter(v => v.deleted)
            .sort((a, b) => b.deletedAt - a.deletedAt);
    }

    static getGlobal(id) {
        return this._getRawGlobal()[id];
    }

    /**
     * Retrieves Local Visages stored on a specific Actor.
     * @param {Actor} actor - The actor to retrieve data from.
     * @returns {Array<Object>} List of visage objects.
     */
    static getLocal(actor) {
        if (!actor) return [];
        
        // Access via local constant to ensure safety during initialization
        const ns = this.DATA_NAMESPACE; 
        const sourceData = actor.flags?.[ns]?.[this.ALTERNATE_FLAG_KEY] || {};
        const results = [];

        for (const [key, data] of Object.entries(sourceData)) {
            if (!data) continue;
            // Use key as ID if valid 16-char ID, otherwise fallback to internal ID or generate new
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
     * Unified save method. Delegates to Local or Global save based on presence of actor.
     * @param {Object} payload - The visage data to save.
     * @param {Actor|null} [actor=null] - The target actor (if local).
     */
    static async save(payload, actor = null) {
        if (actor) return this._saveLocal(payload, actor);
        return this._saveGlobal(payload);
    }

    /**
     * Soft-deletes a visage (moves to bin).
     * @param {string} id - The ID of the visage.
     * @param {Actor|null} [actor=null] - The actor (if local).
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
     * Restores a soft-deleted visage from the bin.
     * @param {string} id - The ID of the visage.
     * @param {Actor|null} [actor=null] - The actor (if local).
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
     * Permanently removes a visage from the database.
     * @param {string} id - The ID of the visage.
     * @param {Actor|null} [actor=null] - The actor (if local).
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
            changes: data.changes,
            updated: Date.now()
        };

        await actor.update({
            [`flags.${this.DATA_NAMESPACE}.${this.ALTERNATE_FLAG_KEY}.${id}`]: entry
        });
        console.log(`Visage | Saved Local Visage for ${actor.name}: ${entry.label}`);
    }

    /**
     * Purges soft-deleted global items that have exceeded the retention period (30 days).
     * Only runs for the GM user.
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