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

    static getVisages(actor) {
        if (!actor) return [];

        const ns = this.DATA_NAMESPACE;
        const flags = actor.flags?.[ns] || {};
        const sourceData = flags[this.ALTERNATE_FLAG_KEY] || flags[this.LEGACY_FLAG_KEY] || {};

        const results = [];

        for (const [key, data] of Object.entries(sourceData)) {
            const isObject = typeof data === 'object' && data !== null;
            const id = (key.length === 16) ? key : foundry.utils.randomID(16);
            const name = (isObject && data.name) ? data.name : key;
            const path = isObject ? (data.path || "") : (data || "");
            const scale = isObject ? (data.scale ?? 1.0) : 1.0;

            let disposition = (isObject && data.disposition !== undefined) ? data.disposition : null;
            if (disposition === 2) disposition = -2;
            if (isObject && data.secret === true) disposition = -2;

            const ring = (isObject && data.ring) ? data.ring : null;

            results.push({
                id, name, path, scale, disposition, ring
            });
        }

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
        const hasChangedRing = "ring" in change;

        if (hasChangedName || hasChangedTextureSrc || hasChangedTextureScale || hasChangedDisposition || hasChangedRing) {
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
        
        let newName, newTokenPath, newScale, newDisposition, newRing;

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

        } else {
            const allVisages = this.getVisages(actor);
            const visageData = allVisages.find(v => v.id === formKey);
            
            // Fallback for legacy keys
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
                       ring: isObject ? legacyEntry.ring : null
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
            
            // FIX: Check if ring data is populated. If it's empty object {}, use defaults.
            const hasRingConfig = rawData.ring && !foundry.utils.isEmpty(rawData.ring);
            newRing = hasRingConfig ? rawData.ring : defaults.ring;
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

    static isFormActive(actorId, tokenId, formKey) {
        const actor = game.actors.get(actorId);
        const currentFormKey = actor?.flags?.[this.DATA_NAMESPACE]?.[tokenId]?.currentFormKey;
        if (currentFormKey === undefined && formKey === 'default') return true;
        return currentFormKey === formKey;
    }
}