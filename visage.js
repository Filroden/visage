/**
 * @file visage.js
 * @description The core logic class for the Visage module.
 * @module visage
 */

export class Visage {
    static MODULE_ID = "visage";
    static DATA_NAMESPACE = "visage";
    static ALTERNATE_FLAG_KEY = "alternateVisages";
    static LEGACY_FLAG_KEY = "alternateImages";

    static log(message, force = false) {
        const shouldLog = force || game.modules.get('_dev-mode')?.api?.getPackageDebugValue(this.MODULE_ID);
        if (shouldLog) {
            console.log(`${this.MODULE_ID} | ${message}`);
        }
    }

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
     * Centralized Data Normalization.
     * Retrieves, sanitizes, and standardizes all visage data for an actor.
     * * @param {Actor} actor - The actor to retrieve data from.
     * @returns {Array<object>} An array of normalized visage objects.
     */
    static getVisages(actor) {
        if (!actor) return [];

        const ns = this.DATA_NAMESPACE;
        const flags = actor.flags?.[ns] || {};
        // 1. Prefer new key, fallback to old
        const sourceData = flags[this.ALTERNATE_FLAG_KEY] || flags[this.LEGACY_FLAG_KEY] || {};

        const results = [];

        for (const [key, data] of Object.entries(sourceData)) {
            // 2. Normalize Data Structure (Object vs String)
            const isObject = typeof data === 'object' && data !== null;
            
            // 3. Normalize ID (Legacy Name vs UUID)
            // If key is not a UUID (16 chars), generate a temporary one for UI stability
            const id = (key.length === 16) ? key : foundry.utils.randomID(16);
            
            const name = (isObject && data.name) ? data.name : key;
            const path = isObject ? (data.path || "") : (data || "");
            const scale = isObject ? (data.scale ?? 1.0) : 1.0;

            // 4. Normalize Disposition
            let disposition = (isObject && data.disposition !== undefined) ? data.disposition : null;
            
            // Fix legacy '2' value
            if (disposition === 2) disposition = -2;
            
            // Fix legacy 'secret' boolean (merge into disposition)
            if (isObject && data.secret === true) disposition = -2;

            results.push({
                id,
                name,
                path,
                scale,
                disposition
            });
        }

        // 5. Sort Alphabetically
        return results.sort((a, b) => a.name.localeCompare(b.name));
    }

    static handleTokenUpdate(tokenDocument, change, options) {
        if (options.visageUpdate) return;
        const actor = tokenDocument.actor;
        if (!actor) return;

        const hasChangedName = "name" in change;
        const hasChangedTextureSrc = "texture" in change && "src" in change.texture;
        const hasChangedTextureScale = "texture" in change && ("scaleX" in change.texture || "scaleY" in change.texture);
        const hasChangedDisposition = "disposition" in change;

        if (hasChangedName || hasChangedTextureSrc || hasChangedTextureScale || hasChangedDisposition) {
            const tokenId = tokenDocument.id;
            const updateData = {};

            if (hasChangedName) updateData[`flags.${this.DATA_NAMESPACE}.${tokenId}.defaults.name`] = change.name;
            if (hasChangedTextureSrc) updateData[`flags.${this.DATA_NAMESPACE}.${tokenId}.defaults.token`] = change.texture.src;
            if (hasChangedTextureScale) {
                const newScale = change.texture.scaleX ?? change.texture.scaleY; 
                if (newScale !== undefined) updateData[`flags.${this.DATA_NAMESPACE}.${tokenId}.defaults.scale`] = newScale;
            }
            if (hasChangedDisposition) updateData[`flags.${this.DATA_NAMESPACE}.${tokenId}.defaults.disposition`] = change.disposition;

            if (Object.keys(updateData).length > 0) {
                actor.update(updateData).then(() => this.log(`Default visage updated for token ${tokenId}.`));
            }
        }
    }

    static async setVisage(actorId, tokenId, formKey) {
        const token = canvas.tokens.get(tokenId);
        if (!token?.actor) return false;
        const actor = token.actor;

        const moduleData = actor.flags?.[this.DATA_NAMESPACE] || {};
        const tokenData = moduleData[tokenId] || {};
        
        let newName, newTokenPath, newScale, newDisposition;

        if (formKey === 'default') {
            const defaults = tokenData.defaults;
            if (!defaults) return false;
            
            newName = defaults.name;
            newTokenPath = defaults.token;
            newScale = defaults.scale ?? 1.0;
            newDisposition = defaults.disposition ?? 0; 
        } else {
            // USE THE NEW HELPER to find the correct entry
            const allVisages = this.getVisages(actor);
            const visageData = allVisages.find(v => v.id === formKey);
            
            if (!visageData) {
                this.log(`Form key "${formKey}" not found via getVisages`, true);
                // Fallback: Try direct lookup in case the key was legacy name
                const rawData = (moduleData[this.ALTERNATE_FLAG_KEY] || moduleData[this.LEGACY_FLAG_KEY] || {})[formKey];
                if (!rawData) return false;
                
                // If fallback worked, it means the user passed a legacy name-key via macro
                // We construct a temp object to proceed
                const isObject = typeof rawData === 'object';
                visageData = {
                    name: isObject ? (rawData.name || formKey) : formKey,
                    path: isObject ? (rawData.path || "") : rawData,
                    scale: isObject ? (rawData.scale ?? 1.0) : 1.0,
                    disposition: isObject ? rawData.disposition : null
                };
                if (visageData.disposition === 2) visageData.disposition = -2;
            }

            const defaults = tokenData.defaults;
            if (!defaults) return false;
            
            newName = visageData.name || defaults.name;
            newTokenPath = visageData.path || defaults.token;
            newScale = visageData.scale ?? 1.0;
            newDisposition = visageData.disposition;
        }

        const finalTokenPath = await this.resolvePath(newTokenPath);

        const updateData = {
            "name": newName,
            "texture.src": finalTokenPath,
            "texture.scaleX": newScale,
            "texture.scaleY": Math.abs(newScale)
        };

        if (newDisposition !== null && newDisposition !== undefined) {
            updateData.disposition = newDisposition;
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

    static getForms(actorId, tokenId = null) {
        const actor = game.actors.get(actorId);
        if (!actor) return null;

        let defaults;
        if (tokenId) defaults = actor.flags?.[this.DATA_NAMESPACE]?.[tokenId]?.defaults;
        
        if (!defaults) {
            const proto = actor.prototypeToken;
            defaults = { name: proto.name, token: proto.texture.src };
        }

        // USE THE NEW HELPER
        const normalizedVisages = this.getVisages(actor);
        if (!normalizedVisages.length) return null;

        return normalizedVisages.map(data => {
            return {
                key: data.id,
                name: data.name || defaults.name,
                path: data.path || defaults.token,
                scale: data.scale,
                disposition: data.disposition
            };
        });
    }

    static isFormActive(actorId, tokenId, formKey) {
        const actor = game.actors.get(actorId);
        const currentFormKey = actor?.flags?.[this.DATA_NAMESPACE]?.[tokenId]?.currentFormKey;
        if (currentFormKey === undefined && formKey === 'default') return true;
        return currentFormKey === formKey;
    }
}