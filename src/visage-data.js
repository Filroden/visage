import { VisageUtilities } from "./visage-utilities.js";

/**
 * The primary data controller class for Visage.
 * Responsible for CRUD operations on both Global (World Settings) and Local (Actor Flags) data.
 * Handles data normalization, presentation formatting, and state extraction.
 */
export class VisageData {
    static MODULE_ID = "visage";
    static DATA_NAMESPACE = "visage";
    
    /** Flag key for storing local visages on an Actor. */
    static ALTERNATE_FLAG_KEY = "alternateVisages";
    
    /** Setting key for storing global visages in world settings. */
    static SETTING_KEY = "globalVisages";

    /**
     * Registers the module settings required for data storage.
     * Sets up the global dictionary object and change listeners.
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
     * Prepares data for the Ring Configuration UI.
     * Parses bitmask effects into readable boolean flags and UI-ready objects.
     * @param {Object} ringData - The raw ring data from the document.
     * @returns {Object} Context object for the Handlebars template.
     */
    static prepareRingContext(ringData) {
        const data = ringData || {};
        const currentEffects = data.effects || 0;
        
        // Define available ring effects (Foundry Core Standard)
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

    /**
     * Determines the most representative image path for a Visage.
     * Prioritizes Dynamic Token Ring subjects over standard texture files.
     * @param {Object} changes - The changes object containing visual data.
     * @returns {string} The resolved file path.
     */
    static getRepresentativeImage(changes) {
        if (!changes) return "";
        if (changes.ring?.enabled && changes.ring.subject?.texture) {
            return changes.ring.subject.texture;
        }
        if (changes.texture?.src) return changes.texture.src;
        return changes.texture?.src || "";
    }

    /**
     * Converts a stored data object into a runtime 'Layer' object.
     * * Cleans empty keys to prevent overwriting existing data with nulls.
     * * Resolves wildcard paths into concrete file paths.
     * * Normalizes Token Ring data structures.
     * @param {Object} data - The stored Visage data.
     * @param {string} [source="unknown"] - The source type ('local' or 'global').
     * @returns {Promise<Object|null>} The sanitized runtime Layer object.
     */
    static async toLayer(data, source = "unknown") {
        if (!data) return null;

        const layer = {
            id: data.id,
            label: data.label || "Unknown",
            // Inherit mode if present, otherwise infer from source (Local=Identity, Global=Overlay)
            mode: data.mode || (source === "local" ? "identity" : "overlay"),
            source: source,
            changes: foundry.utils.deepClone(data.changes || {})
        };

        // 1. Recursive Clean Function
        // Used to remove null values and empty objects from the diff.
        // This ensures that applying this layer doesn't unintentionally unset other properties.
        const clean = (obj) => {
            for (const key in obj) {
                if (obj[key] === null) {
                    delete obj[key];
                } else if (typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
                    clean(obj[key]);
                    // If an object (like 'texture') becomes empty after cleaning children, remove it entirely
                    if (Object.keys(obj[key]).length === 0) delete obj[key];
                }
            }
        };

        // 2. Clean the changes object
        clean(layer.changes);

        // 3. Resolve Wildcard Paths
        // This must happen after cleaning to ensure we actually have a texture to resolve.
        if (layer.changes?.texture?.src) {
            const resolved = await VisageUtilities.resolvePath(layer.changes.texture.src);
            layer.changes.texture.src = resolved || layer.changes.texture.src;
        }

        // 4. Handle Ring Data Structure
        if (layer.changes?.ring) {
            if (layer.changes.ring.enabled === true) {
                // Ensure complete structure for enabled rings
                layer.changes.ring = {
                    enabled: true,
                    colors: layer.changes.ring.colors,
                    effects: layer.changes.ring.effects,
                    subject: layer.changes.ring.subject
                };
            } else {
                 // Explicitly minimize disabled rings to avoid merging stale color data
                 layer.changes.ring = { enabled: false };
            }
        }

        return layer;
    }

    /**
     * Captures the default state of a Token as a virtual Visage object.
     * This represents the "True Form" of the token before any Visage is applied.
     * @param {TokenDocument} tokenDoc - The target token document.
     * @returns {Object} A Visage data object representing the default state.
     */
    static getDefaultAsVisage(tokenDoc) {
        if (!tokenDoc) return null;

        // Retrieve the cached original state if one exists (Visage active), otherwise snapshot now.
        let sourceData = tokenDoc.flags?.[this.MODULE_ID]?.originalState;
        if (!sourceData) {
            // If linked, use prototype token to bypass temporary canvas effects
            if (tokenDoc.isLinked && tokenDoc.actor) {
                sourceData = tokenDoc.actor.prototypeToken.toObject();
            } else {
                sourceData = VisageUtilities.extractVisualState(tokenDoc);
            }
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
        
        // NEW: Capture Light Configuration
        const lightData = sourceData.light
            ? (sourceData.light.toObject ? sourceData.light.toObject() : sourceData.light)
            : (tokenDoc.light.toObject ? tokenDoc.light.toObject() : tokenDoc.light);

        // NEW: Capture Portrait (Actor Image)
        const portrait = sourceData.portrait || tokenDoc.actor?.img || null;

        // Check for flipped state in scale
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
                
                // V3.2 Properties
                light: lightData,
                portrait: portrait,
                delay: 0,
                
                ring: ringData
            }
        };
    }

    /**
     * Formats raw Visage data into a rich object ready for Handlebars rendering.
     * Generates metadata for UI badges (scales, flips, rings, effects).
     * @param {Object} data - The raw Visage data.
     * @param {Object} [options={}] - Formatting options (isActive, isWildcard, etc.).
     * @returns {Object} The data formatted for the Gallery/Editor UI.
     */
    static toPresentation(data, options = {}) {
        const c = data.changes || {};
        const tx = c.texture || {};
        
        const displayPath = this.getRepresentativeImage(c);
        const isVideo = options.isVideo ?? foundry.helpers.media.VideoHelper.hasVideoExtension(displayPath);

        // Normalize Scale Data
        const atomicScale = c.scale;
        const bakedScaleX = tx.scaleX ?? 1.0;
        const bakedScaleY = tx.scaleY ?? 1.0;

        // Determine Mirroring (Flip) state
        const isFlippedX = (c.mirrorX !== undefined && c.mirrorX !== null) ? c.mirrorX : (bakedScaleX < 0);
        const isFlippedY = (c.mirrorY !== undefined && c.mirrorY !== null) ? c.mirrorY : (bakedScaleY < 0);

        const alpha = c.alpha ?? 1.0;
        const lockRotation = c.lockRotation ?? false;

        // --- Metadata Generation for UI Badges ---

        // 1. Mirror Badges
        const pathIcon = "modules/visage/icons/navigation.svg";
        const hActive = (c.mirrorX !== undefined && c.mirrorX !== null) || (bakedScaleX < 0);
        const hRot = isFlippedX ? "visage-rotate-270" : "visage-rotate-90";
        const hLabel = game.i18n.localize("VISAGE.Mirror.Badge.H");

        const vActive = (c.mirrorY !== undefined && c.mirrorY !== null) || (bakedScaleY < 0);
        const vRot = isFlippedY ? "visage-rotate-180" : "visage-rotate-0";
        const vLabel = game.i18n.localize("VISAGE.Mirror.Badge.V");

        // 2. Scale Badge
        const isScaleIntent = (atomicScale !== undefined && atomicScale !== null);
        const isScaleNonDefault = Math.abs(bakedScaleX) !== 1.0;
        const isScaleActive = isScaleIntent || isScaleNonDefault;
        
        const finalScale = (atomicScale !== undefined && atomicScale !== null) ? atomicScale : Math.abs(bakedScaleX);
        const displayScaleVal = Math.round(finalScale * 100);
        const scaleLabel = `${displayScaleVal}%`;

        // 3. Dimensions Badge
        const w = c.width ?? 1;
        const h = c.height ?? 1;
        const isDimIntent = (c.width !== undefined && c.width !== null) || (c.height !== undefined && c.height !== null);
        const isDimNonStandard = (w !== 1) || (h !== 1);
        const isDimActive = isDimIntent || isDimNonStandard;
        const sizeLabel = `${w}x${h}`;

        // 4. Disposition Badge
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

        // 5. Effects / Light / Delay Badges
        const rawEffects = c.effects || [];
        const activeEffects = rawEffects.filter(e => !e.disabled);
        const hasEffects = activeEffects.length > 0;
        
        // FIX: A light is only "Active" if it exists AND has a radius > 0.
        // This prevents default tokens (0/0) from showing the icon.
        const hasLight = c.light && (c.light.dim > 0 || c.light.bright > 0);
        const hasDelay = (c.delay !== undefined && c.delay !== 0);
        
        // Show badge if ANY of these behavior modifiers are present
        const showEffectsBadge = hasEffects || hasLight || hasDelay;
        let effectsTooltip = "";

        if (showEffectsBadge) {
            let content = "";

            // A. Light (Top)
            if (hasLight) {
                const l = c.light;
                // V3.2: Resolve Animation Label
                let animLabel = "";
                if (l.animation && l.animation.type) {
                    // Try to localize "VISAGE.LightAnim.Type", fallback to raw type if missing
                    const key = `VISAGE.LightAnim.${l.animation.type.charAt(0).toUpperCase() + l.animation.type.slice(1)}`;
                    const label = game.i18n.has(key) ? game.i18n.localize(key) : l.animation.type;
                    // Strip the asterisk (*) if present for cleaner UI
                    animLabel = ` • ${label.replace(" (*)", "")}`;
                }

                content += `
                <div class='visage-tooltip-row header'>
                    <i class='visage-icon light'></i> 
                    <span class='label'>${game.i18n.localize("VISAGE.Editor.Light.Title")}</span>
                    <span class='meta'>${l.dim} / ${l.bright}${animLabel}</span>
                </div>`;
            }

            // B. Sequencer Effects (Middle)
            if (hasEffects) {
                content += activeEffects.map(e => {
                    const icon = e.type === "audio" ? "visage-icon audio" : "visage-icon visual";
                    let meta = "";
                    if (e.type === "audio") {
                        const volLabel = game.i18n.localize("VISAGE.Editor.Effects.Volume");
                        meta = `${volLabel}: ${Math.round((e.opacity ?? 0.8) * 100)}%`; 
                    } else {
                        const zLabel = e.zOrder === "below" 
                            ? game.i18n.localize("VISAGE.Editor.Effects.Below") 
                            : game.i18n.localize("VISAGE.Editor.Effects.Above");
                        meta = `${zLabel} • ${Math.round((e.scale ?? 1.0) * 100)}%`;
                    }
                    
                    return `
                        <div class='visage-tooltip-row'>
                            <i class='${icon}'></i> 
                            <span class='label'>${e.label || "Effect"}</span>
                            <span class='meta'>${meta}</span>
                        </div>`;
                }).join("");
            }

            // C. Delay (Bottom)
            if (hasDelay) {
                const s = Math.abs(c.delay) / 1000;
                const dirLabel = c.delay > 0 
                    ? game.i18n.localize("VISAGE.Editor.TransitionDelay.EffectsLead") 
                    : game.i18n.localize("VISAGE.Editor.TransitionDelay.TokenLeads");
                
                content += `
                <div class='visage-tooltip-row footer'>
                    <i class='visage-icon timer'></i> 
                    <span class='label'>${game.i18n.localize("VISAGE.Editor.TransitionDelay.Label")}</span>
                    <span class='meta'>${s}s (${dirLabel})</span>
                </div>`;
            }
            
            effectsTooltip = `<div class='visage-tooltip-content'>${content}</div>`;
        }

        // 6. Ring Context
        const ringCtx = this.prepareRingContext(c.ring);
        const isWildcard = options.isWildcard ?? false;

        // 7. Portrait Badge
        const hasPortrait = !!(c.portrait);
        let portraitTooltip = "";
        if (hasPortrait) {
            // Embed the image directly in the tooltip
            portraitTooltip = `<img src='${c.portrait}' class='visage-tooltip-image' alt='Portrait' />`;
        }

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
                
                // V3.2 Badges
                showEffectsBadge: showEffectsBadge,
                effectsTooltip: effectsTooltip,
                hasPortrait: hasPortrait,
                portraitTooltip: portraitTooltip,

                slots: {
                    scale: { active: isScaleActive, val: scaleLabel },
                    dim: { active: isDimActive, val: sizeLabel },
                    alpha: { active: (c.alpha !== undefined && c.alpha !== null) && c.alpha !== 1.0, val: `${Math.round(alpha * 100)}%` },
                    lock: { active: (c.lockRotation !== undefined && c.lockRotation !== null), val: c.lockRotation ? game.i18n.localize("VISAGE.RotationLock.Locked") : game.i18n.localize("VISAGE.RotationLock.Unlocked") },
                    flipH: { active: hActive, src: pathIcon, cls: hRot, val: hLabel },
                    flipV: { active: vActive, src: pathIcon, cls: vRot, val: vLabel },
                    wildcard: { active: isWildcard, val: game.i18n.localize("VISAGE.Wildcard.Label") },
                    disposition: { class: dispClass, val: dispLabel }
                }
            }
        };
    }
   
    /**
     * Retrieves the raw settings object for global visages.
     * @private
     */
    static _getRawGlobal() { return game.settings.get(this.MODULE_ID, this.SETTING_KEY); }

    /**
     * @returns {Array} List of all active global visages, sorted by creation date.
     */
    static get globals() {
        const raw = this._getRawGlobal();
        return Object.values(raw).filter(v => !v.deleted).map(v => foundry.utils.deepClone(v)).sort((a, b) => b.created - a.created);
    }

    /**
     * @returns {Array} List of deleted global visages (Trash), sorted by deletion date.
     */
    static get bin() {
        const raw = this._getRawGlobal();
        return Object.values(raw).filter(v => v.deleted).map(v => foundry.utils.deepClone(v)).sort((a, b) => b.deletedAt - a.deletedAt);
    }

    /**
     * Retrieves a single global visage by ID.
     * @param {string} id - The ID of the visage.
     * @returns {Object|null} The visage data or null.
     */
    static getGlobal(id) {
        const data = this._getRawGlobal()[id];
        return data ? foundry.utils.deepClone(data) : null;
    }

    /**
     * Retrieves all local visages stored on a specific Actor.
     * @param {Actor} actor - The actor document.
     * @returns {Array} Sorted list of local visages.
     */
    static getLocal(actor) {
        if (!actor) return [];
        const ns = this.DATA_NAMESPACE; 
        const sourceData = actor.flags?.[ns]?.[this.ALTERNATE_FLAG_KEY] || {};
        const results = [];

        for (const [key, data] of Object.entries(sourceData)) {
            if (!data) continue;
            // Handle legacy data structure where ID might not be in the body
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

    /**
     * Promotes a Local Visage (Actor-specific) to a Global Visage (World Setting).
     * @param {Actor} actor - The source actor.
     * @param {string} visageId - The ID of the local visage to promote.
     */
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

    /**
     * Commits a Visage to be the new "Default" appearance of a token/actor.
     * * Creates a backup of the current default appearance as a Local Visage.
     * * Updates the Token Prototype (if linked) or Token Document (if unlinked).
     * * Refreshes the "Original State" flag to prevent Visage from trying to "restore" the old look.
     * * Removes the active Visage effect since it is now the base reality.
     * @param {Token|string} tokenOrId - The target token.
     * @param {string} visageId - The ID of the Visage to commit.
     */
    static async commitToDefault(tokenOrId, visageId) {
        const token = (typeof tokenOrId === "string") ? canvas.tokens.get(tokenOrId) : tokenOrId;
        if (!token || !token.actor) return ui.notifications.warn("Visage | No actor found.");
        
        const targetVisage = this.getLocal(token.actor).find(v => v.id === visageId);
        if (!targetVisage) return ui.notifications.warn("Visage | Target Visage not found.");
        
        const currentDefault = this.getDefaultAsVisage(token.document);
        if (!currentDefault) return;

        // 1. Backup current default
        const backupData = {
            label: `${currentDefault.changes.name || token.name} (Backup)`,
            category: "Backup",
            tags: ["Backup", ...(currentDefault.tags || [])],
            mode: "identity",
            changes: currentDefault.changes
        };
        await this._saveLocal(backupData, token.actor);

        // 2. Prepare new default data (Merge target on top of current default)
        const newDefaultData = foundry.utils.mergeObject(
            foundry.utils.deepClone(currentDefault.changes), 
            foundry.utils.deepClone(targetVisage.changes), 
            { inplace: false, insertKeys: true, overwrite: true }
        );

        // 3. Construct update payload for the Document
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
        
        // V3.2 Properties
        if (newDefaultData.light) updatePayload.light = newDefaultData.light;

        // Clean undefined keys
        for (const key of Object.keys(updatePayload)) {
            if (updatePayload[key] === undefined) delete updatePayload[key];
        }

        // 4. Apply Updates
        const isLinked = token.document.isLinked;
        if (isLinked) await token.actor.update({ prototypeToken: updatePayload });
        else await token.document.update(updatePayload);

        // Note: We do NOT commit 'portrait' here because changing the token default 
        // doesn't inherently imply changing the Actor's permanent portrait.

        // 5. Update the "Original State" flag so Visage accepts this as the new normal
        const newOriginalState = VisageUtilities.extractVisualState({
            ...token.document.toObject(), 
            ...foundry.utils.expandObject(updatePayload) 
        });

        await token.document.update({ [`flags.${this.DATA_NAMESPACE}.originalState`]: newOriginalState });

        // 6. Remove the active mask (since it is now the base)
        const VisageApi = game.modules.get(this.MODULE_ID).api;
        if (VisageApi) await VisageApi.remove(token.id, visageId);
        
        ui.notifications.info(game.i18n.format("VISAGE.Notifications.DefaultSwapped", { label: targetVisage.label }));
    }

    /**
     * Saves a Visage (creates or updates).
     * @param {Object} payload - The data to save.
     * @param {Actor|null} [actor=null] - The target actor (null implies Global).
     */
    static async save(payload, actor = null) {
        if (actor) return this._saveLocal(payload, actor);
        return this._saveGlobal(payload);
    }

    /**
     * Soft-deletes a Visage.
     * @param {string} id - The ID of the visage.
     * @param {Actor|null} [actor=null] - The target actor (null implies Global).
     */
    static async delete(id, actor = null) {
        if (actor) return actor.update({ [`flags.${this.DATA_NAMESPACE}.${this.ALTERNATE_FLAG_KEY}.${id}.deleted`]: true });
        return this.updateGlobal(id, { deleted: true, deletedAt: Date.now() });
    }

    /**
     * Restores a soft-deleted Visage from the bin.
     * @param {string} id - The ID of the visage.
     * @param {Actor|null} [actor=null] - The target actor.
     */
    static async restore(id, actor = null) {
        if (actor) return actor.update({ [`flags.${this.DATA_NAMESPACE}.${this.ALTERNATE_FLAG_KEY}.${id}.deleted`]: false });
        return this.updateGlobal(id, { deleted: false, deletedAt: null });
    }

    /**
     * Permanently destroys a Visage record.
     * @param {string} id - The ID of the visage.
     * @param {Actor|null} [actor=null] - The target actor.
     */
    static async destroy(id, actor = null) {
        if (actor) return actor.update({ [`flags.${this.DATA_NAMESPACE}.${this.ALTERNATE_FLAG_KEY}.-=${id}`]: null });
        const all = this._getRawGlobal();
        if (all[id]) {
            delete all[id];
            await game.settings.set(this.MODULE_ID, this.SETTING_KEY, all);
        }
    }

    // --- Internal Save/Update Helpers ---

    static async _saveGlobal(data) {
        const all = this._getRawGlobal();
        const id = data.id || foundry.utils.randomID(16);
        const timestamp = Date.now();
        const existing = all[id];
        
        const entry = {
            id: id,
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

    /**
     * Runs garbage collection on Global Visages.
     * Removes items from the bin that have exceeded the retention period (30 days).
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