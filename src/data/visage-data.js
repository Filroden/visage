import { VisageUtilities } from "../utils/visage-utilities.js";
import { MODULE_ID, DATA_NAMESPACE } from "../core/visage-constants.js";

/**
 * The primary data controller class for Visage.
 * Responsible for CRUD operations on both Global (World Settings) and Local (Actor Flags) data.
 * Handles data normalization, presentation formatting, and state extraction.
 */
export class VisageData {
    // ==========================================
    // 1. CONSTANTS & REGISTRATION
    // ==========================================

    /** Flag key for storing local visages on an Actor. */
    static ALTERNATE_FLAG_KEY = "alternateVisages";

    /** Setting key for storing global visages in world settings. */
    static SETTING_KEY = "globalVisages";

    /**
     * Registers the module settings required for data storage.
     * Sets up the global dictionary object and change listeners.
     */
    static registerSettings() {
        game.settings.register(MODULE_ID, this.SETTING_KEY, {
            name: "Global Visage Library",
            scope: "world",
            config: false,
            type: Object,
            default: {},
            onChange: () => Hooks.callAll("visageDataChanged"),
        });
    }

    // ==========================================
    // 2. CORE DATA ACCESS (GETTERS)
    // ==========================================

    /**
     * Retrieves all active global visages.
     * @returns {Array} List of global visages, sorted by creation date (newest first).
     */
    static get globals() {
        const raw = this._getRawGlobal();
        return Object.values(raw)
            .filter((v) => !v.deleted)
            .map((v) => foundry.utils.deepClone(v))
            .sort((a, b) => b.created - a.created);
    }

    /**
     * Retrieves all soft-deleted global visages.
     * @returns {Array} List of deleted global visages (Trash), sorted by deletion date.
     */
    static get bin() {
        const raw = this._getRawGlobal();
        return Object.values(raw)
            .filter((v) => v.deleted)
            .map((v) => foundry.utils.deepClone(v))
            .sort((a, b) => b.deletedAt - a.deletedAt);
    }

    /**
     * Retrieves a single global visage by its ID.
     * @param {string} id - The ID of the visage.
     * @returns {Object|null} The cloned visage data or null if not found.
     */
    static getGlobal(id) {
        const data = this._getRawGlobal()[id];
        return data ? foundry.utils.deepClone(data) : null;
    }

    /**
     * Retrieves all local visages stored on a specific Actor.
     * @param {Actor} actor - The actor document.
     * @returns {Array} Sorted list of local visages (alphabetical by label).
     */
    static getLocal(actor) {
        if (!actor) return [];
        const sourceData =
            actor.flags?.[DATA_NAMESPACE]?.[this.ALTERNATE_FLAG_KEY] || {};
        const results = [];

        for (const [key, data] of Object.entries(sourceData)) {
            if (!data) continue;

            // Handle legacy data structure where ID might not be in the body
            const id =
                key.length === 16 ? key : data.id || foundry.utils.randomID(16);
            if (data.changes) {
                results.push({
                    id: id,
                    label: data.label || data.name || "Unknown",
                    category: data.category || "",
                    tags: Array.isArray(data.tags) ? data.tags : [],
                    mode: data.mode || "identity",
                    changes: foundry.utils.deepClone(data.changes),
                    automation: data.automation
                        ? foundry.utils.deepClone(data.automation)
                        : undefined,
                    deleted: !!data.deleted,
                });
            }
        }
        return results.sort((a, b) => a.label.localeCompare(b.label));
    }

    // ==========================================
    // 3. PERSISTENCE (CRUD)
    // ==========================================

    /**
     * Saves a Visage (creates or updates). Routes to local or global storage automatically.
     * @param {Object} payload - The data to save.
     * @param {Actor|null} [actor=null] - The target actor (null implies Global storage).
     */
    static async save(payload, actor = null) {
        if (!actor && !game.user.isGM) {
            ui.notifications.error(
                "VISAGE.Notifications.Error.PermissionDenied",
                { localize: true },
            );
            return;
        }
        return actor
            ? this._saveLocal(payload, actor)
            : this._saveGlobal(payload);
    }

    /**
     * Soft-deletes a Visage.
     * @param {string} id - The ID of the visage.
     * @param {Actor|null} [actor=null] - The target actor (null implies Global storage).
     */
    static async delete(id, actor = null) {
        if (!actor && !game.user.isGM) return;

        if (actor) {
            await actor.update({
                [`flags.${DATA_NAMESPACE}.${this.ALTERNATE_FLAG_KEY}.${id}.deleted`]: true,
            });
            Hooks.callAll("visageDataChanged");
            return;
        }
        return this.updateGlobal(id, { deleted: true, deletedAt: Date.now() });
    }

    /**
     * Restores a soft-deleted Visage from the bin.
     * @param {string} id - The ID of the visage.
     * @param {Actor|null} [actor=null] - The target actor.
     */
    static async restore(id, actor = null) {
        if (actor) {
            await actor.update({
                [`flags.${DATA_NAMESPACE}.${this.ALTERNATE_FLAG_KEY}.${id}.deleted`]: false,
            });
            Hooks.callAll("visageDataChanged");
            return;
        }
        return this.updateGlobal(id, { deleted: false, deletedAt: null });
    }

    /**
     * Permanently destroys a Visage record.
     * @param {string} id - The ID of the visage.
     * @param {Actor|null} [actor=null] - The target actor.
     */
    static async destroy(id, actor = null) {
        if (actor) {
            await actor.update({
                [`flags.${DATA_NAMESPACE}.${this.ALTERNATE_FLAG_KEY}.-=${id}`]:
                    null,
            });
            Hooks.callAll("visageDataChanged");
            return;
        }
        const all = this._getRawGlobal();
        if (all[id]) {
            delete all[id];
            await game.settings.set(MODULE_ID, this.SETTING_KEY, all);
        }
    }

    // --- Private Storage Helpers ---

    /** @private */
    static _getRawGlobal() {
        return game.settings.get(MODULE_ID, this.SETTING_KEY);
    }

    /** @private */
    static async _saveGlobal(data) {
        const all = this._getRawGlobal();
        const id = data.id || foundry.utils.randomID(16);
        const timestamp = Date.now();
        const existing = all[id];

        // --- AUTOMATION CLEANUP (GLOBAL) ---
        if (
            existing?.automation?.enabled &&
            (!data.automation || !data.automation.enabled)
        ) {
            const VisageApi = game.modules.get(MODULE_ID)?.api;
            if (VisageApi) {
                canvas.tokens.placeables.forEach((t) => {
                    VisageApi.remove(t.id, id);
                });
            }
        }

        const entry = {
            id: id,
            label: data.label || "New Mask",
            category: data.category || "",
            tags: data.tags || [],
            mode: data.mode || "overlay",
            public: data.public ?? false,
            created: existing ? existing.created : timestamp,
            updated: timestamp,
            deleted: false,
            deletedAt: null,
            changes: foundry.utils.deepClone(data.changes || {}),
            automation: data.automation
                ? foundry.utils.deepClone(data.automation)
                : undefined,
        };

        // Scrub the entire constructed entry to catch root-level automation and nested changes
        this._scrubPayload(entry);

        all[id] = entry;
        await game.settings.set(MODULE_ID, this.SETTING_KEY, all);
        return entry;
    }

    /** @private */
    static async updateGlobal(id, updates) {
        const all = this._getRawGlobal();
        if (!all[id]) return;

        const merged = foundry.utils.mergeObject(all[id], updates, {
            inplace: false,
        });
        merged.updated = Date.now();
        all[id] = merged;

        await game.settings.set(MODULE_ID, this.SETTING_KEY, all);
    }

    /** @private */
    static async _saveLocal(data, actor) {
        const id = data.id || foundry.utils.randomID(16);

        // --- AUTOMATION CLEANUP (LOCAL) ---
        const existing =
            actor.flags?.[DATA_NAMESPACE]?.[this.ALTERNATE_FLAG_KEY]?.[id];
        if (
            existing?.automation?.enabled &&
            (!data.automation || !data.automation.enabled)
        ) {
            const VisageApi = game.modules.get(MODULE_ID)?.api;
            if (VisageApi) {
                canvas.tokens.placeables
                    .filter((t) => t.actor?.id === actor.id)
                    .forEach((t) => VisageApi.remove(t.id, id));
            }
        }

        const entry = {
            id: id,
            label: data.label,
            category: data.category,
            tags: data.tags,
            mode: data.mode || "identity",
            changes: foundry.utils.deepClone(data.changes || {}),
            automation: data.automation
                ? foundry.utils.deepClone(data.automation)
                : undefined,
            updated: Date.now(),
        };

        // Scrub the entire constructed entry to catch root-level automation and nested changes
        this._scrubPayload(entry);

        // Explicitly delete old bloat first to bypass Foundry's Deep Merge resurrection
        if (existing) {
            await actor.update({
                [`flags.${DATA_NAMESPACE}.${this.ALTERNATE_FLAG_KEY}.-=${id}`]:
                    null,
            });
        }

        // Save the new perfectly clean entry
        await actor.update({
            [`flags.${DATA_NAMESPACE}.${this.ALTERNATE_FLAG_KEY}.${id}`]: entry,
        });

        console.log(
            `Visage | Saved Local Visage for ${actor.name}: ${entry.label}`,
        );
        Hooks.callAll("visageDataChanged");
    }

    // ==========================================
    // 4. TRANSFORMERS (Adapters & UI Prep)
    // ==========================================

    /**
     * Recursively scrubs nulls, empty arrays, empty objects, and untouched default blocks.
     * Preserves user-configured data even if it is currently toggled off.
     * @private
     */
    static _scrubPayload(obj) {
        // 1. Smart-Scrub: Remove blocks ONLY if they are disabled AND untouched/empty

        // Light: Delete if disabled AND emits no light (dim and bright are 0 or missing)
        if (
            obj.light &&
            (obj.light.active === false || obj.light.active === "false")
        ) {
            if (!obj.light.dim && !obj.light.bright) delete obj.light;
        }

        // Automation: Delete if disabled AND has no condition triggers built
        if (
            obj.automation &&
            (obj.automation.enabled === false ||
                obj.automation.enabled === "false")
        ) {
            if (
                !obj.automation.conditions ||
                obj.automation.conditions.length === 0
            )
                delete obj.automation;
        }

        // Strip legacy global delay (migrated to individual effects in v4.1)
        if (obj.delay !== undefined) {
            delete obj.delay;
        }

        // 2. Standard recursive scrub for nulls and completely empty arrays/objects
        for (const key in obj) {
            if (obj[key] === undefined) continue;

            if (obj[key] === null) {
                delete obj[key];
            } else if (Array.isArray(obj[key])) {
                // Strip empty arrays
                if (obj[key].length === 0) delete obj[key];
            } else if (typeof obj[key] === "object") {
                this._scrubPayload(obj[key]);
                // Strip completely empty objects
                if (Object.keys(obj[key]).length === 0) delete obj[key];
            }
        }
        return obj;
    }

    /**
     * Converts a stored DB data object into a runtime 'Layer' object.
     * Cleans empty keys, resolves wildcards, and normalizes ring data.
     * @param {Object} data - The stored Visage data.
     * @param {string} [source="unknown"] - The source type ('local' or 'global').
     * @returns {Promise<Object|null>} The sanitized runtime Layer object.
     */
    static async toLayer(data, source = "unknown") {
        if (!data) return null;

        const layer = {
            id: data.id,
            label: data.label || "Unknown",
            mode: data.mode || (source === "local" ? "identity" : "overlay"),
            source: source,
            changes: foundry.utils.deepClone(data.changes || {}),
            automation: data.automation
                ? foundry.utils.deepClone(data.automation)
                : undefined,
        };

        // Clean legacy data on the fly (new data is already scrubbed before saving)
        VisageData._scrubPayload(layer.changes);

        // Resolve Wildcard Paths
        if (layer.changes?.texture?.src) {
            const resolved = await VisageUtilities.resolvePath(
                layer.changes.texture.src,
            );
            layer.changes.texture.src = resolved || layer.changes.texture.src;
        }

        if (layer.changes?.portrait) {
            const resolvedPortrait = await VisageUtilities.resolvePath(
                layer.changes.portrait,
            );
            if (resolvedPortrait) layer.changes.portrait = resolvedPortrait;
        }

        // Handle Ring Data Structure Normalization
        if (layer.changes?.ring) {
            if (layer.changes.ring.enabled === true) {
                layer.changes.ring = {
                    enabled: true,
                    colors: layer.changes.ring.colors,
                    effects: layer.changes.ring.effects,
                    subject: layer.changes.ring.subject,
                };
            } else {
                layer.changes.ring = { enabled: false };
            }
        }

        return layer;
    }

    /**
     * Captures the default state of a Token as a virtual Visage object.
     * This represents the "True Form" of the token before any Visage is applied.
     * @param {TokenDocument} tokenDoc - The target token document.
     * @returns {Object|null} A Visage data object representing the default state.
     */
    static getDefaultAsVisage(tokenDoc) {
        if (!tokenDoc) return null;

        // Retrieve cached original state, otherwise snapshot now
        let sourceData =
            tokenDoc.flags?.[MODULE_ID]?.originalState ||
            VisageUtilities.extractVisualState(tokenDoc);

        const src = sourceData.texture?.src || tokenDoc.texture.src;
        const scaleX = sourceData.texture?.scaleX ?? sourceData.scaleX ?? 1.0;
        const scaleY = sourceData.texture?.scaleY ?? sourceData.scaleY ?? 1.0;

        const ringData = sourceData.ring?.toObject
            ? sourceData.ring.toObject()
            : sourceData.ring || {};
        const lightData = sourceData.light?.toObject
            ? sourceData.light.toObject()
            : sourceData.light ||
              tokenDoc.light?.toObject?.() ||
              tokenDoc.light;
        const portrait = sourceData.portrait || tokenDoc.actor?.img || null;

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
                    scaleX: Math.abs(scaleX) * (scaleX < 0 ? -1 : 1),
                    scaleY: Math.abs(scaleY) * (scaleY < 0 ? -1 : 1),
                    anchorX: sourceData.texture?.anchorX ?? 0.5,
                    anchorY: sourceData.texture?.anchorY ?? 0.5,
                },
                width: sourceData.width ?? 1,
                height: sourceData.height ?? 1,
                disposition: sourceData.disposition ?? 0,
                light: lightData,
                portrait: portrait,
                ring: ringData,
            },
        };
    }

    /**
     * Generates the default structure for a new automation block.
     * @returns {Object} The default automation schema.
     */
    static getDefaultAutomation() {
        return {
            enabled: false,
            logic: "AND",
            conditions: [],
            onEnter: { action: "apply", priority: 0 },
            onExit: { action: "remove", delay: 0 },
        };
    }

    /**
     * Formats raw Visage data into a rich View-Model object ready for Handlebars rendering.
     * Extracts metadata for UI badges (scales, flips, rings, effects).
     * @param {Object} data - The raw Visage data.
     * @param {Object} [options={}] - Formatting options (isActive, isWildcard, resolvedPath, etc.).
     * @returns {Object} The data formatted for the UI.
     */
    static toPresentation(data, options = {}) {
        const c = data.changes || {};
        const tx = c.texture || {};

        // 1. Path & Media Resolutions
        const resolvedPath =
            options.resolvedPath || this.getRepresentativeImage(c);
        const cleanPath = VisageUtilities.cleanPath(resolvedPath);
        const isVideo = options.isVideo ?? VisageUtilities.isVideo(cleanPath);

        // 2. Base Scales & Flips
        const bakedScaleX = tx.scaleX ?? 1.0;
        const bakedScaleY = tx.scaleY ?? 1.0;
        const finalScale = c.scale ?? Math.abs(bakedScaleX);
        const alpha = c.alpha ?? 1.0;
        const lockRotation = c.lockRotation ?? false;

        const anchorXVal = tx.anchorX ?? 0.5;
        const anchorYVal = tx.anchorY ?? 0.5;

        // 3. Helper extractions
        const mirrorData = this._getMirrorData(c, bakedScaleX, bakedScaleY);
        const dispData = this._getDispositionData(c.disposition);
        const ringCtx = this.prepareRingContext(c.ring);

        // 4. Boolean Activity Flags
        const isScaleActive =
            (c.scale !== undefined && c.scale !== null) ||
            Math.abs(bakedScaleX) !== 1.0;
        const isDimActive =
            (c.width !== undefined && c.width !== null) ||
            (c.height !== undefined && c.height !== null);
        const isAnchorActive = anchorXVal !== 0.5 || anchorYVal !== 0.5;
        const isWildcard = options.isWildcard ?? false;

        const showDataChip =
            isScaleActive || isDimActive || isAnchorActive || isWildcard;

        // 5. Tooltips (Effects & Portraits)
        const activeEffects = (c.effects || []).filter((e) => !e.disabled);
        const showEffectsBadge =
            activeEffects.length > 0 ||
            (c.light && (c.light.dim > 0 || c.light.bright > 0)) ||
            (c.delay !== undefined && c.delay !== 0);

        let portraitTooltip = "";
        if (c.portrait) {
            const displayPortrait = VisageUtilities.cleanPath(
                options.resolvedPortrait || c.portrait,
            );
            portraitTooltip = `<img src='${displayPortrait}' class='visage-tooltip-image' alt='Portrait' />`;
        }

        return {
            ...data,
            isActive: options.isActive ?? false,
            isVideo,
            isWildcard,
            path: cleanPath,
            resolvedPath: cleanPath,
            scale: finalScale,
            isFlippedX: mirrorData.x.flipped,
            isFlippedY: mirrorData.y.flipped,
            forceFlipX: mirrorData.x.flipped,
            forceFlipY: mirrorData.y.flipped,
            alpha,
            lockRotation,
            mode: data.mode,
            isPublic: data.public ?? false,

            meta: {
                hasAutomation: data.automation?.enabled ?? false,
                hasRing: ringCtx.enabled,
                hasPulse: ringCtx.hasPulse,
                hasGradient: ringCtx.hasGradient,
                hasWave: ringCtx.hasWave,
                hasInvisibility: ringCtx.hasInvisibility,
                ringColor: ringCtx.colors.ring,
                ringBkg: ringCtx.colors.background,
                showDataChip,
                showFlipBadge: mirrorData.x.active || mirrorData.y.active,
                showDispositionChip: dispData.class !== "none",
                tokenName: c.name || null,
                showEffectsBadge,
                effectsTooltip: showEffectsBadge
                    ? this._getTooltipContent(c, activeEffects)
                    : "",
                hasPortrait: !!c.portrait,
                portraitTooltip,
                slots: {
                    scale: {
                        active: isScaleActive,
                        val: `${Math.round(finalScale * 100)}%`,
                    },
                    dim: {
                        active: isDimActive,
                        val: `${c.width ?? 1}x${c.height ?? 1}`,
                    },
                    anchor: {
                        active: isAnchorActive,
                        val: `${anchorXVal} / ${anchorYVal}`,
                    },
                    alpha: {
                        active:
                            c.alpha !== undefined &&
                            c.alpha !== null &&
                            c.alpha !== 1.0,
                        val: `${Math.round(alpha * 100)}%`,
                    },
                    lock: {
                        active:
                            c.lockRotation !== undefined &&
                            c.lockRotation !== null,
                        val: c.lockRotation
                            ? game.i18n.localize("VISAGE.RotationLock.Locked")
                            : game.i18n.localize(
                                  "VISAGE.RotationLock.Unlocked",
                              ),
                    },
                    flipH: mirrorData.x.slot,
                    flipV: mirrorData.y.slot,
                    wildcard: {
                        active: isWildcard,
                        val: game.i18n.localize("VISAGE.Wildcard.Label"),
                    },
                    disposition: dispData,
                },
            },
        };
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

        const availableEffects = [
            {
                value: 2,
                label: "VISAGE.RingConfig.Effects.Pulse",
                key: "RING_PULSE",
            },
            {
                value: 4,
                label: "VISAGE.RingConfig.Effects.Gradient",
                key: "RING_GRADIENT",
            },
            {
                value: 8,
                label: "VISAGE.RingConfig.Effects.Wave",
                key: "BKG_WAVE",
            },
            {
                value: 16,
                label: "VISAGE.RingConfig.Effects.Invisibility",
                key: "INVISIBILITY",
            },
        ];

        return {
            enabled: data.enabled ?? false,
            colors: {
                ring: data.colors?.ring ?? "#FFFFFF",
                background: data.colors?.background ?? "#000000",
            },
            subject: {
                texture: data.subject?.texture ?? "",
                scale: data.subject?.scale ?? 1.0,
            },
            rawEffects: currentEffects,
            hasPulse: (currentEffects & 2) !== 0,
            hasGradient: (currentEffects & 4) !== 0,
            hasWave: (currentEffects & 8) !== 0,
            hasInvisibility: (currentEffects & 16) !== 0,
            effects: availableEffects.map((eff) => ({
                ...eff,
                isActive: (currentEffects & eff.value) !== 0,
            })),
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
        if (changes.ring?.enabled && changes.ring.subject?.texture)
            return changes.ring.subject.texture;
        return changes.texture?.src || "";
    }

    // --- Private Presentation Helpers ---

    /** @private */
    static _getMirrorData(changes, bakedScaleX, bakedScaleY) {
        const pathIcon = "modules/visage/icons/navigation.svg";
        const isFlippedX =
            changes.mirrorX !== undefined && changes.mirrorX !== null
                ? changes.mirrorX
                : bakedScaleX < 0;
        const isFlippedY =
            changes.mirrorY !== undefined && changes.mirrorY !== null
                ? changes.mirrorY
                : bakedScaleY < 0;

        return {
            x: {
                flipped: isFlippedX,
                active:
                    (changes.mirrorX !== undefined &&
                        changes.mirrorX !== null) ||
                    bakedScaleX < 0,
                slot: {
                    active:
                        (changes.mirrorX !== undefined &&
                            changes.mirrorX !== null) ||
                        bakedScaleX < 0,
                    src: pathIcon,
                    cls: isFlippedX ? "visage-rotate-270" : "visage-rotate-90",
                    val: game.i18n.localize("VISAGE.Mirror.Badge.H"),
                },
            },
            y: {
                flipped: isFlippedY,
                active:
                    (changes.mirrorY !== undefined &&
                        changes.mirrorY !== null) ||
                    bakedScaleY < 0,
                slot: {
                    active:
                        (changes.mirrorY !== undefined &&
                            changes.mirrorY !== null) ||
                        bakedScaleY < 0,
                    src: pathIcon,
                    cls: isFlippedY ? "visage-rotate-180" : "visage-rotate-0",
                    val: game.i18n.localize("VISAGE.Mirror.Badge.V"),
                },
            },
        };
    }

    /** @private */
    static _getDispositionData(disposition) {
        if (disposition === undefined || disposition === null) {
            return {
                class: "none",
                val: game.i18n.localize("VISAGE.Disposition.NoChange"),
            };
        }
        const map = {
            1: { class: "friendly", val: "VISAGE.Disposition.Friendly" },
            0: { class: "neutral", val: "VISAGE.Disposition.Neutral" },
            "-1": { class: "hostile", val: "VISAGE.Disposition.Hostile" },
            "-2": { class: "secret", val: "VISAGE.Disposition.Secret" },
        };
        const target = map[disposition] || map[0];
        return { class: target.class, val: game.i18n.localize(target.val) };
    }

    /** @private */
    static _getTooltipContent(c, activeEffects) {
        let content = "";

        // A. Light (Top)
        if (c.light && (c.light.dim > 0 || c.light.bright > 0)) {
            let animLabel = "";
            if (c.light.animation?.type) {
                const type = c.light.animation.type;
                const key = `VISAGE.LightAnim.${type.charAt(0).toUpperCase() + type.slice(1)}`;
                const label = game.i18n.has(key)
                    ? game.i18n.localize(key)
                    : type;
                animLabel = ` • ${label.replace(" (*)", "")}`;
            }
            content += `
            <div class='visage-tooltip-row header'>
                <i class='visage-icon light'></i> 
                <span class='label'>${game.i18n.localize("VISAGE.Editor.Light.Title")}</span>
                <span class='meta'>${c.light.dim} / ${c.light.bright}${animLabel}</span>
            </div>`;
        }

        // B. Sequencer Effects (Middle)
        if (activeEffects.length > 0) {
            content += activeEffects
                .map((e) => {
                    const icon =
                        e.type === "audio"
                            ? "visage-icon audio"
                            : "visage-icon visual";
                    const meta =
                        e.type === "audio"
                            ? `${game.i18n.localize("VISAGE.Editor.Effects.Volume")}: ${Math.round((e.opacity ?? 0.8) * 100)}%`
                            : `${e.zOrder === "below" ? game.i18n.localize("VISAGE.Editor.Effects.Below") : game.i18n.localize("VISAGE.Editor.Effects.Above")} • ${Math.round((e.scale ?? 1.0) * 100)}%`;

                    return `
                <div class='visage-tooltip-row'>
                    <i class='${icon}'></i> 
                    <span class='label'>${e.label || "Effect"}</span>
                    <span class='meta'>${meta}</span>
                </div>`;
                })
                .join("");
        }

        return `<div class='visage-tooltip-content'>${content}</div>`;
    }

    // ==========================================
    // 5. BUSINESS OPERATIONS (State Logic)
    // ==========================================

    /**
     * Promotes a Local Visage (Actor-specific) to a Global Visage (World Setting).
     * @param {Actor} actor - The source actor.
     * @param {string} visageId - The ID of the local visage to promote.
     */
    static async promote(actor, visageId) {
        const localVisages = this.getLocal(actor);
        const source = localVisages.find((v) => v.id === visageId);

        if (!source) return ui.notifications.warn("Visage | Source not found.");

        const payload = {
            label: source.label,
            category: source.category,
            tags: source.tags ? [...source.tags] : [],
            mode: source.mode,
            changes: foundry.utils.deepClone(source.changes),
            automation: source.automation
                ? foundry.utils.deepClone(source.automation)
                : undefined,
        };

        await this._saveGlobal(payload);
        ui.notifications.info(
            game.i18n.format("VISAGE.Notifications.Promoted", {
                name: payload.label,
            }),
        );
    }

    /**
     * Commits a Visage to be the new "Default" appearance of a token/actor.
     * @param {Token|string} tokenOrId - The target token.
     * @param {string} visageId - The ID of the Visage to commit.
     */
    static async commitToDefault(tokenOrId, visageId) {
        const token =
            typeof tokenOrId === "string"
                ? canvas.tokens.get(tokenOrId)
                : tokenOrId;
        if (!token || !token.actor)
            return ui.notifications.warn("Visage | No actor found.");

        const targetVisage = this.getLocal(token.actor).find(
            (v) => v.id === visageId,
        );
        if (!targetVisage)
            return ui.notifications.warn("Visage | Target Visage not found.");

        const currentDefault = this.getDefaultAsVisage(token.document);
        if (!currentDefault) return;

        // 1. Backup current default
        await this._saveLocal(
            {
                label: `${currentDefault.changes.name || token.name} (Backup)`,
                category: "Backup",
                tags: ["Backup", ...(currentDefault.tags || [])],
                mode: "identity",
                changes: currentDefault.changes,
            },
            token.actor,
        );

        // 2. Prepare new default data
        const newDefaultData = foundry.utils.mergeObject(
            foundry.utils.deepClone(currentDefault.changes),
            foundry.utils.deepClone(targetVisage.changes),
            { inplace: false, insertKeys: true, overwrite: true },
        );

        // 3. Construct update payload
        const updatePayload = {};
        if (newDefaultData.name) updatePayload.name = newDefaultData.name;
        if (newDefaultData.texture) {
            if (newDefaultData.texture.src)
                updatePayload["texture.src"] = newDefaultData.texture.src;
            if (newDefaultData.texture.scaleX !== undefined)
                updatePayload["texture.scaleX"] = newDefaultData.texture.scaleX;
            if (newDefaultData.texture.scaleY !== undefined)
                updatePayload["texture.scaleY"] = newDefaultData.texture.scaleY;
        }
        if (newDefaultData.width !== undefined)
            updatePayload.width = newDefaultData.width;
        if (newDefaultData.height !== undefined)
            updatePayload.height = newDefaultData.height;
        if (newDefaultData.disposition !== undefined)
            updatePayload.disposition = newDefaultData.disposition;
        if (newDefaultData.ring) updatePayload.ring = newDefaultData.ring;
        if (newDefaultData.light) updatePayload.light = newDefaultData.light;

        for (const key of Object.keys(updatePayload)) {
            if (updatePayload[key] === undefined) delete updatePayload[key];
        }

        // 4. Apply Updates
        if (token.document.isLinked)
            await token.actor.update({ prototypeToken: updatePayload });
        else await token.document.update(updatePayload);

        // 5. Update the "Original State" flag
        const newOriginalState = VisageUtilities.extractVisualState({
            ...token.document.toObject(),
            ...foundry.utils.expandObject(updatePayload),
        });

        await token.document.update({
            [`flags.${DATA_NAMESPACE}.originalState`]: newOriginalState,
        });

        // 6. Remove the active mask
        const VisageApi = game.modules.get(MODULE_ID).api;
        if (VisageApi) await VisageApi.remove(token.id, visageId);

        ui.notifications.info(
            game.i18n.format("VISAGE.Notifications.DefaultSwapped", {
                label: targetVisage.label,
            }),
        );
    }

    /**
     * Runs garbage collection on Global Visages.
     * Removes items from the bin that have exceeded the 30-day retention period.
     */
    static async runGarbageCollection() {
        if (!game.user.isGM) return;

        const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
        const now = Date.now();
        const all = this._getRawGlobal();
        let dirty = false;

        for (const [id, entry] of Object.entries(all)) {
            if (
                entry.deleted &&
                entry.deletedAt &&
                now - entry.deletedAt > RETENTION_MS
            ) {
                delete all[id];
                dirty = true;
            }
        }

        if (dirty) await game.settings.set(MODULE_ID, this.SETTING_KEY, all);
    }
}
