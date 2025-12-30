/**
 * @file Contains the core logic for the Visage module. This class manages actor data, token updates, and provides the public API.
 * @module visage
 */

import { VisageComposer } from "./visage-composer.js";

/**
 * The primary class responsible for all Visage module logic.
 * It handles data normalization, token modifications, and API exposure.
 */
export class Visage {
    /**
     * The ID of the module, used for namespacing and referencing.
     * @type {string}
     */
    static MODULE_ID = "visage";

    /**
     * The namespace used for storing module data on actor flags.
     * @type {string}
     */
    static DATA_NAMESPACE = "visage";

    /**
     * The key for the modern visage data structure within the actor flags.
     * @type {string}
     */
    static ALTERNATE_FLAG_KEY = "alternateVisages";

    /**
     * The key for the legacy (pre-v1.0) visage data structure.
     * @type {string}
     */
    static LEGACY_FLAG_KEY = "alternateImages";

    /**
     * Logs a message to the console if developer mode is enabled.
     * @param {string} message The message to log.
     * @param {boolean} [force=false] If true, logs the message regardless of the developer mode setting.
     */
    static log(message, force = false) {
        const shouldLog = force || game.modules.get('_dev-mode')?.api?.getPackageDebugValue(this.MODULE_ID);
        if (shouldLog) {
            console.log(`${this.MODULE_ID} | ${message}`);
        }
    }

    /**
     * Resolves a file path that may contain a wildcard ('*').
     * If a wildcard is present, it fetches the list of matching files and returns a random one.
     * Otherwise, it returns the original path.
     * @param {string} path The file path to resolve.
     * @returns {Promise<string>} The resolved file path, or the original path if no wildcard or match is found.
     */
    static async resolvePath(path) {
        if (!path || !path.includes('*')) return path;
        try {
            const browseOptions = { wildcard: true };
            let source = "data";
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
            this.log(`Error resolving wildcard path: ${path} | ${err}`, true);
        }
        return path;
    }

    /**
     * Prepares the context for a dynamic ring.
     * Returns both an array for UI loops (effects) and flat booleans for logic/templates.
     */
    static prepareRingContext(ringData) {
        const data = ringData || {};
        const currentEffects = data.effects || 0;
        
        const availableEffects = [
            { value: 2, label: "VISAGE.RingConfig.Effects.Pulse", key: "RING_PULSE" },
            { value: 4, label: "VISAGE.RingConfig.Effects.Gradient", key: "RING_GRADIENT" },
            { value: 8, label: "VISAGE.RingConfig.Effects.Wave", key: "BKG_WAVE" },
            { value: 16, label: "VISAGE.RingConfig.Effects.Invisibility", key: "INVISIBILITY" }
        ];

        // Calculate booleans once, centrally
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
            // The bitmask integer itself (useful for saving)
            rawEffects: currentEffects, 
            // Flat booleans for easy checking (e.g. ctx.hasPulse)
            ...flags, 
            // Array for building UI checkboxes
            effects: availableEffects.map(eff => ({
                ...eff,
                isActive: (currentEffects & eff.value) !== 0
            }))
        };
    }

    /**
     * Initializes the module and exposes the public API.
     * This method is called once when the module is ready.
     */
    static initialize() {
        this.log("Initializing Visage");
        game.modules.get(this.MODULE_ID).api = {
            setVisage: this.setVisage.bind(this),
            getForms: this.getForms.bind(this),
            isFormActive: this.isFormActive.bind(this),
            resolvePath: this.resolvePath.bind(this)
        };
    }

    /**
     * Retrieves, normalizes, and sorts all visages for a given actor.
     * @param {Actor} actor The actor document to retrieve visages from.
     * @returns {Array<object>} A sorted array of normalized visage objects.
     */
    static getVisages(actor) {
        if (!actor) return [];

        const ns = this.DATA_NAMESPACE;
        const flags = actor.flags?.[ns] || {};
        const sourceData = flags[this.ALTERNATE_FLAG_KEY] || flags[this.LEGACY_FLAG_KEY] || {};

        const results = [];

        for (const [key, data] of Object.entries(sourceData)) {
            const isObject = typeof data === 'object' && data !== null;
            // Ensure a unique ID.
            const id = (key.length === 16) ? key : foundry.utils.randomID(16);
            const name = (isObject && data.name) ? data.name : key;
            const path = isObject ? (data.path || "") : (data || "");
            
            // --- Normalize Scale & Flips ---
            const rawScale = isObject ? (data.scale ?? 1.0) : 1.0;
            const scale = Math.abs(rawScale); // Always positive

            // 1. Check for explicit boolean. 2. Fallback to negative scale (Legacy)
            let isFlippedX = false;
            if (isObject && data.isFlippedX !== undefined) isFlippedX = data.isFlippedX;
            else isFlippedX = rawScale < 0;

            let isFlippedY = false;
            if (isObject && data.isFlippedY !== undefined) isFlippedY = data.isFlippedY;

            let disposition = (isObject && data.disposition !== undefined) ? data.disposition : null;
            if (disposition === 2) disposition = -2;
            if (isObject && data.secret === true) disposition = -2;

            const ring = (isObject && data.ring) ? data.ring : null;
            const width = isObject ? (data.width ?? 1) : 1;
            const height = isObject ? (data.height ?? 1) : 1;

            results.push({
                id, name, path, scale, 
                isFlippedX, isFlippedY,
                disposition, ring, width, height
            });
        }

        return results.sort((a, b) => a.name.localeCompare(b.name));
    }

    /**
     * Captures and stores the "default" appearance of a token when it's first created or manually changed.
     * This ensures there's a baseline to revert to.
     * @param {TokenDocument} tokenDocument The document of the token being updated.
     * @param {object} change The differential data that is changing.
     * @param {object} options Additional options, including `visageUpdate` to prevent recursion.
     * @protected
     */
    static handleTokenUpdate(tokenDocument, change, options) {
        if (options.visageUpdate) return;
        const actor = tokenDocument.actor;
        if (!actor) return;

        const hasChangedName = "name" in change;
        const hasChangedTextureSrc = "texture" in change && "src" in change.texture;
        const hasChangedTextureScale = "texture" in change && ("scaleX" in change.texture || "scaleY" in change.texture);
        const hasChangedDisposition = "disposition" in change;
        const hasChangedRing = "ring" in change;
        const hasChangedSize = "width" in change || "height" in change;

        if (hasChangedName || hasChangedTextureSrc || hasChangedTextureScale || hasChangedDisposition || hasChangedRing || hasChangedSize) {
            const tokenId = tokenDocument.id;
            const updateData = {};

            if (hasChangedName) updateData[`flags.${this.DATA_NAMESPACE}.${tokenId}.defaults.name`] = change.name;
            if (hasChangedTextureSrc) updateData[`flags.${this.DATA_NAMESPACE}.${tokenId}.defaults.token`] = change.texture.src;
            if (hasChangedTextureScale) {
                const newScale = change.texture.scaleX ?? change.texture.scaleY; 
                if (newScale !== undefined) updateData[`flags.${this.DATA_NAMESPACE}.${tokenId}.defaults.scale`] = newScale;
            }
            if (hasChangedDisposition) updateData[`flags.${this.DATA_NAMESPACE}.${tokenId}.defaults.disposition`] = change.disposition;
            if (hasChangedRing) {
                updateData[`flags.${this.DATA_NAMESPACE}.${tokenId}.defaults.ring`] = change.ring;
            }
            if (hasChangedSize) {
                if ("width" in change) updateData[`flags.${this.DATA_NAMESPACE}.${tokenId}.defaults.width`] = change.width;
                if ("height" in change) updateData[`flags.${this.DATA_NAMESPACE}.${tokenId}.defaults.height`] = change.height;
            }

            if (Object.keys(updateData).length > 0) {
                actor.update(updateData).then(() => this.log(`Default visage updated for token ${tokenId}.`));
            }
        }
    }

    /**
     * Applies a specific visage to a token, updating its appearance and state.
     * @param {string} actorId The ID of the actor.
     * @param {string} tokenId The ID of the token.
     * @param {string} formKey The key of the form to apply ("default" or a UUID).
     */
    static async setVisage(actorId, tokenId, formKey) {
        const token = canvas.tokens.get(tokenId);
        if (!token) return;
        const actor = token.actor;

        let data = null;

        // CASE 1: APPLYING DEFAULT
        if (formKey === "default") {
            const ns = this.DATA_NAMESPACE;
            // 1. Try to get saved defaults specific to this token instance
            const savedDefaults = actor.flags?.[ns]?.[tokenId]?.defaults || {};
            
            // 2. Fallback to Prototype Token (e.g. if no specific default saved yet)
            const proto = actor.prototypeToken;
            
            // Robustly determine Scale & Flip from saved defaults or prototype
            // (Similar logic to _getTokenDefaults in config)
            const defScaleRaw = savedDefaults.scale ?? proto.texture.scaleX ?? 1.0;
            const defScaleYRaw = savedDefaults.scaleY ?? proto.texture.scaleY ?? 1.0;

            data = {
                name: savedDefaults.name || proto.name,
                path: savedDefaults.token || proto.texture.src,
                // Normalize Scale/Flip
                scale: Math.abs(defScaleRaw),
                isFlippedX: savedDefaults.isFlippedX ?? (defScaleRaw < 0),
                isFlippedY: savedDefaults.isFlippedY ?? (defScaleYRaw < 0),
                width: savedDefaults.width ?? proto.width ?? 1,
                height: savedDefaults.height ?? proto.height ?? 1,
                disposition: savedDefaults.disposition ?? proto.disposition ?? 0,
                // Ensure Ring object structure
                ring: savedDefaults.ring || (proto.ring?.toObject ? proto.ring.toObject() : proto.ring) || {}
            };

        } 
        // CASE 2: APPLYING ALTERNATE
        else {
            const alternates = this.getVisages(actor);
            data = alternates.find(v => v.id === formKey);
        }

        if (!data) {
            console.warn(`Visage | Could not find form data for key: ${formKey}`);
            return;
        }

        // Resolve the image path (Handles Wildcards)
        const resolvedPath = await this.resolvePath(data.path);

        // Construct the Base Update for the Composer
        const baseUpdate = {
            name: data.name,
            texture: {
                src: resolvedPath,
                // Apply Scale & Flip logic
                scaleX: Math.abs(data.scale) * (data.isFlippedX ? -1 : 1),
                scaleY: Math.abs(data.scale) * (data.isFlippedY ? -1 : 1)
            },
            width: data.width || 1,
            height: data.height || 1,
            disposition: data.disposition ?? token.document.disposition,
            // Full Ring Override
            ring: data.ring ? {
                 enabled: data.ring.enabled === true,
                 colors: data.ring.colors,
                 effects: data.ring.effects,
                 subject: data.ring.subject
            } : { enabled: false }
        };

        // Update the Actor Flag to remember selection
        const flagKey = `flags.${this.DATA_NAMESPACE}.${tokenId}.currentFormKey`;
        await token.actor.update({ [flagKey]: formKey });

        // Trigger the Composer to layer Global Effects on top of this new Base
        await VisageComposer.compose(token, null, baseUpdate);
    }

    /**
     * Gets a list of all available forms for a given actor, including default values.
     * @param {string} actorId The ID of the actor.
     * @param {string|null} [tokenId=null] The ID of the token, used to retrieve token-specific defaults.
     * @returns {Array<object>|null} An array of form objects, or null if no visages are defined.
     */
    static getForms(actorId, tokenId = null) {
        const actor = game.actors.get(actorId);
        if (!actor) return null;

        let defaults;
        if (tokenId) defaults = actor.flags?.[this.DATA_NAMESPACE]?.[tokenId]?.defaults;
        
        if (!defaults) {
            const proto = actor.prototypeToken;
            defaults = { 
                name: proto.name, 
                token: proto.texture.src,
                ring: proto.ring 
            };
        }

        const normalizedVisages = this.getVisages(actor);
        if (!normalizedVisages.length) return null;

        return normalizedVisages.map(data => {
            return {
                key: data.id,
                name: data.name || defaults.name,
                path: data.path || defaults.token,
                scale: data.scale,
                disposition: data.disposition,
                ring: data.ring,
                width: data.width,
                height: data.height
            };
        });
    }

    /**
     * Checks if a specific form is currently active on a token.
     * @param {string} actorId The ID of the actor.
     * @param {string} tokenId The ID of the token.
     * @param {string} formKey The key of the form to check.
     * @returns {boolean} True if the form is active, false otherwise.
     */
    static isFormActive(actorId, tokenId, formKey) {
        const actor = game.actors.get(actorId);
        const currentFormKey = actor?.flags?.[this.DATA_NAMESPACE]?.[tokenId]?.currentFormKey;
        // If no form has been explicitly set, the 'default' form is considered active.
        if (currentFormKey === undefined && formKey === 'default') return true;
        return currentFormKey === formKey;
    }

    /**
     * Handles token updates to manage state synchronization.
     * 1. Captures "Default" state when a token is manually modified.
     * 2. Detects manual edits on tokens with active Global Visages, updates the 'originalState' 
     * snapshot, and re-applies the stack so the global effects persist correctly.
     * * @param {TokenDocument} tokenDocument The document of the token being updated.
     * @param {object} change The differential data that is changing.
     * @param {object} options Additional options.
     * @param {string} userId The ID of the user triggering the update.
     */
    static async handleTokenUpdate(tokenDocument, change, options, userId) {
        // 1. Filter: Ignore updates triggered by Visage itself (prevent infinite loops)
        if (options.visageUpdate) return;

        // 2. Filter: Only run for the triggering user to avoid race conditions (One client handles the logic)
        if (game.user.id !== userId) return;

        const actor = tokenDocument.actor;
        if (!actor) return;
        const tokenId = tokenDocument.id;

        // --- PART A: CAPTURE DEFAULTS (Existing Logic) ---
        // Checks if core properties changed, and updates the 'default' visage flag.
        const hasChangedName = "name" in change;
        const hasChangedTextureSrc = "texture" in change && "src" in change.texture;
        const hasChangedTextureScale = "texture" in change && ("scaleX" in change.texture || "scaleY" in change.texture);
        const hasChangedDisposition = "disposition" in change;
        const hasChangedRing = "ring" in change;
        const hasChangedSize = "width" in change || "height" in change;

        if (hasChangedName || hasChangedTextureSrc || hasChangedTextureScale || hasChangedDisposition || hasChangedRing || hasChangedSize) {
            const updateData = {};

            if (hasChangedName) updateData[`flags.${this.DATA_NAMESPACE}.${tokenId}.defaults.name`] = change.name;
            if (hasChangedTextureSrc) updateData[`flags.${this.DATA_NAMESPACE}.${tokenId}.defaults.token`] = change.texture.src;
            if (hasChangedTextureScale) {
                const newScale = change.texture.scaleX ?? change.texture.scaleY; 
                if (newScale !== undefined) updateData[`flags.${this.DATA_NAMESPACE}.${tokenId}.defaults.scale`] = newScale;
            }
            if (hasChangedDisposition) updateData[`flags.${this.DATA_NAMESPACE}.${tokenId}.defaults.disposition`] = change.disposition;
            if (hasChangedRing) {
                updateData[`flags.${this.DATA_NAMESPACE}.${tokenId}.defaults.ring`] = change.ring;
            }
            if (hasChangedSize) {
                if ("width" in change) updateData[`flags.${this.DATA_NAMESPACE}.${tokenId}.defaults.width`] = change.width;
                if ("height" in change) updateData[`flags.${this.DATA_NAMESPACE}.${tokenId}.defaults.height`] = change.height;
            }

            if (Object.keys(updateData).length > 0) {
                // Update actor defaults (fire and forget)
                actor.update(updateData);
            }
        }

        // --- PART B: MAINTAIN GLOBAL STACK (New Logic) ---
        // If a stack exists, we assume the manual edit was intended for the "Base" token.
        // We update 'originalState' and then re-compose the stack on top.
        const flags = tokenDocument.flags[this.MODULE_ID] || {};
        const stack = flags.stack || [];

        if (stack.length > 0) {
            // Import Composer dynamically to avoid circular dependency issues
            const { VisageComposer } = await import("./visage-composer.js");

            // 1. Get the current saved base, or snapshot if missing
            let base = flags.originalState;
            if (!base) {
                base = VisageComposer._captureSnapshot(tokenDocument.object);
            }

            // 2. Merge the manual 'change' into the 'base'
            // We use foundry.utils.mergeObject to handle nested data (like texture.src) correctly
            const newBase = foundry.utils.mergeObject(base, change, { 
                insertKeys: false, 
                inplace: false 
            });

            // 3. Re-Compose
            // We trigger the Composer with the NEW base.
            // This ensures the Stack effects are re-calculated on top of the user's manual changes.
            await VisageComposer.compose(tokenDocument.object, null, newBase);
        }
    }

}