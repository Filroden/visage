/**
 * @file Contains the core logic for the Visage module. This class manages actor data, token updates, and provides the public API.
 * @module visage
 */

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
     * This function is responsible for ensuring data consistency. It reads visage data from actor flags,
     * gracefully handling both modern (object-based) and legacy (string-based) formats.
     * For each entry, it guarantees a unique `id`. If an entry is from a legacy data source and lacks a
     * stable 16-character ID as its key, a new random ID is generated. This ensures that all visages,
     * regardless of their original format, can be uniquely identified and referenced throughout the system.
     *
     * @param {Actor} actor The actor document to retrieve visages from.
     * @returns {Array<object>} A sorted array of normalized visage objects. Each object includes
     *                          `id`, `name`, `path`, `scale`, `disposition`, and `ring`.
     */
    static getVisages(actor) {
        if (!actor) return [];

        const ns = this.DATA_NAMESPACE;
        const flags = actor.flags?.[ns] || {};
        const sourceData = flags[this.ALTERNATE_FLAG_KEY] || flags[this.LEGACY_FLAG_KEY] || {};

        const results = [];

        for (const [key, data] of Object.entries(sourceData)) {
            const isObject = typeof data === 'object' && data !== null;
            // Ensure a unique ID. If the key isn't a proper ID, generate one.
            const id = (key.length === 16) ? key : foundry.utils.randomID(16);
            const name = (isObject && data.name) ? data.name : key;
            const path = isObject ? (data.path || "") : (data || "");
            const scale = isObject ? (data.scale ?? 1.0) : 1.0;

            // Normalize disposition: secret flag maps to -2, 2 is an invalid value.
            let disposition = (isObject && data.disposition !== undefined) ? data.disposition : null;
            if (disposition === 2) disposition = -2;
            if (isObject && data.secret === true) disposition = -2;

            const ring = (isObject && data.ring) ? data.ring : null;
            const width = isObject ? (data.width ?? 1) : 1;
            const height = isObject ? (data.height ?? 1) : 1;

            results.push({
                id, name, path, scale, disposition, ring, width, height
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
     * Applies a selected visage or reverts to the default state for a specific token.
     * @param {string} actorId The ID of the actor.
     * @param {string} tokenId The ID of the token to modify.
     * @param {string} formKey The key of the form to apply, or 'default' to revert.
     * @returns {Promise<boolean>} True if the update was successful, false otherwise.
     */
    static async setVisage(actorId, tokenId, formKey) {
        const token = canvas.tokens.get(tokenId);
        if (!token?.actor) return false;
        const actor = token.actor;

        const moduleData = actor.flags?.[this.DATA_NAMESPACE] || {};
        const tokenData = moduleData[tokenId] || {};
        
        let newName, newTokenPath, newScale, newDisposition, newRing, newWidth, newHeight;

        if (formKey === 'default') {
            const defaults = tokenData.defaults;
            if (!defaults) {
                this.log(`Cannot reset to default; no defaults saved for token ${tokenId}.`, true);
                return false;
            }
            
            newName = defaults.name;
            newTokenPath = defaults.token;
            newScale = defaults.scale ?? 1.0;
            newDisposition = defaults.disposition ?? 0;
            newRing = defaults.ring;
            newWidth = defaults.width ?? 1;
            newHeight = defaults.height ?? 1;

        } else {
            const allVisages = this.getVisages(actor);
            const visageData = allVisages.find(v => v.id === formKey);
            
            // Fallback for legacy keys if a direct ID match fails.
            let rawData = visageData;
            if (!rawData) {
                const rawSource = (moduleData[this.ALTERNATE_FLAG_KEY] || moduleData[this.LEGACY_FLAG_KEY] || {});
                const legacyEntry = rawSource[formKey];
                if (legacyEntry) {
                   const isObject = typeof legacyEntry === 'object';
                   rawData = {
                       name: isObject ? (legacyEntry.name || formKey) : formKey,
                       path: isObject ? (legacyEntry.path || "") : legacyEntry,
                       scale: isObject ? (legacyEntry.scale ?? 1.0) : 1.0,
                       disposition: isObject ? legacyEntry.disposition : null,
                       ring: isObject ? legacyEntry.ring : null,
                       width: isObject ? (legacyEntry.width ?? 1) : 1,
                       height: isObject ? (legacyEntry.height ?? 1) : 1
                   };
                } else {
                    this.log(`Form key "${formKey}" not found`, true);
                    return false;
                }
            }

            const defaults = tokenData.defaults;
            if (!defaults) return false;
            
            newName = rawData.name || defaults.name;
            newTokenPath = rawData.path || defaults.token;
            newScale = rawData.scale ?? 1.0;
            newDisposition = rawData.disposition;
            
            // If the visage has no specific ring configuration, use the token's default.
            const hasRingConfig = rawData.ring && !foundry.utils.isEmpty(rawData.ring);
            newRing = hasRingConfig ? rawData.ring : defaults.ring;
            
            newWidth = rawData.width ?? defaults.width ?? 1;
            newHeight = rawData.height ?? defaults.height ?? 1;
        }

        const finalTokenPath = await this.resolvePath(newTokenPath);

        const updateData = {
            "name": newName,
            "texture.src": finalTokenPath,
            "texture.scaleX": newScale,
            "texture.scaleY": Math.abs(newScale),
            "width": newWidth,
            "height": newHeight
        };

        if (newDisposition !== null && newDisposition !== undefined) {
            updateData.disposition = newDisposition;
        }

        if (newRing !== undefined) {
            updateData.ring = newRing;
        }

        try {
            await token.document.update(updateData, { visageUpdate: true });
            await actor.update({
                [`flags.${this.DATA_NAMESPACE}.${tokenId}.currentFormKey`]: formKey
            });
            return true;
        } catch (error) {
            this.log(`Failed to update token ${tokenId}: ${error}`, true);
            return false;
        }
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
                ring: data.ring
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
}