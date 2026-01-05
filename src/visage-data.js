/**
 * @file Manages the data layer for the Visage module.
 * @module visage
 */

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

    // INTERNAL HELPER: Duplicate of Visage.resolvePath to avoid circular dependency
    static async _resolvePath(path) {
        if (!path) return path;
        if (!path.includes('*') && !path.includes('?')) return path;

        try {
            const browseOptions = {};
            let source = "data";
            let directory = "";
            let pattern = "";

            if (/\.s3\./i.test(path)) {
                source = "s3";
                const { bucket, keyPrefix } = foundry.applications.apps.FilePicker.implementation.parseS3URL(path);
                if (!bucket) return null;
                browseOptions.bucket = bucket;
                const lastSlash = keyPrefix.lastIndexOf('/');
                directory = lastSlash >= 0 ? keyPrefix.slice(0, lastSlash + 1) : "";
                pattern   = lastSlash >= 0 ? keyPrefix.slice(lastSlash + 1) : keyPrefix;
            }
            else {
                if (path.startsWith("icons/")) source = "public";
                const lastSlash = path.lastIndexOf('/');
                directory = lastSlash >= 0 ? path.slice(0, lastSlash + 1) : "";
                pattern   = lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
            }

            const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
            const regex = new RegExp(`^${escaped.replace(/\*/g, ".*").replace(/\?/g, ".")}$`, "i");

            const content = await foundry.applications.apps.FilePicker.implementation.browse(
                source,
                directory,
                browseOptions
            );

            const matches = content.files.filter(file => {
                const rawName = file.split("/").pop();
                let name;
                try {
                    name = decodeURIComponent(rawName);
                } catch {
                    name = rawName;
                }
                return regex.test(name);
            });

            if (matches.length) {
                return matches[Math.floor(Math.random() * matches.length)];
            }
        }
        catch (err) {
            console.warn(`VisageData | Error resolving wildcard path: ${path} | ${err}`);
        }
        return null;
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

        // Resolve wildcards here (for Application only, not Saving)
        if (layer.changes.img) {
            if (!layer.changes.texture) layer.changes.texture = {};
            layer.changes.texture.src = await this._resolvePath(layer.changes.img);
            delete layer.changes.img;
        } else if (layer.changes.texture?.src) {
            layer.changes.texture.src = await this._resolvePath(layer.changes.texture.src);
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

    // FIX: Return deep clones of global data to prevent reference tainting
    static get globals() {
        const raw = this._getRawGlobal();
        return Object.values(raw)
            .filter(v => !v.deleted)
            .map(v => foundry.utils.deepClone(v)) // CLONE HERE
            .sort((a, b) => b.created - a.created);
    }

    static get bin() {
        const raw = this._getRawGlobal();
        return Object.values(raw)
            .filter(v => v.deleted)
            .map(v => foundry.utils.deepClone(v)) // CLONE HERE
            .sort((a, b) => b.deletedAt - a.deletedAt);
    }

    // FIX: Return deep clone of global data to prevent reference tainting
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
                    changes: foundry.utils.deepClone(data.changes), // Local already cloned here
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
        
        // DEEP CLONE changes to sever references to UI/Preview objects
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