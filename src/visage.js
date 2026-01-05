/**
 * @file Contains the core logic for the Visage module.
 * @module visage
 */

import { VisageComposer } from "./visage-composer.js";
import { VisageData } from "./visage-data.js"; 

export class Visage {
    static MODULE_ID = "visage";
    static DATA_NAMESPACE = "visage";

    static log(message, force = false) {
        const shouldLog = force || game.modules.get('_dev-mode')?.api?.getPackageDebugValue(this.MODULE_ID);
        if (shouldLog) console.log(`${this.MODULE_ID} | ${message}`);
    }

    /**
     * Resolves wildcard paths or S3 bucket URLs into a concrete file path.
     * Filters the directory contents to ensure only files matching the wildcard pattern are selected.
     * @param {string} path - The image path (e.g., "tokens/guards/bear-*.png").
     * @returns {Promise<string|null>} The resolved single file path, or null if resolution fails.
     */
    static async resolvePath(path) {
        if (!path) return path;
        
        // Optimization: If no wildcard, return as is.
        if (!path.includes('*') && !path.includes('?')) return path;

        try {
            const browseOptions = {};
            let source = "data";
            let directory = "";
            let pattern = "";

            // Handle S3 Bucket parsing FIRST
            if (/\.s3\./i.test(path)) {
                source = "s3";
                const { bucket, keyPrefix } = foundry.applications.apps.FilePicker.implementation.parseS3URL(path);

                if (!bucket) return null; // Return null on invalid S3 to prevent 404s

                browseOptions.bucket = bucket;

                const lastSlash = keyPrefix.lastIndexOf('/');
                directory = lastSlash >= 0 ? keyPrefix.slice(0, lastSlash + 1) : "";
                pattern   = lastSlash >= 0 ? keyPrefix.slice(lastSlash + 1) : keyPrefix;
            }
            else {
                // Non-S3 paths
                if (path.startsWith("icons/")) source = "public";

                const lastSlash = path.lastIndexOf('/');
                directory = lastSlash >= 0 ? path.slice(0, lastSlash + 1) : "";
                pattern   = lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
            }

            // Convert wildcard pattern to RegExp
            // 1. Escape special characters (including dots, brackets, etc.)
            // 2. Replace * with .*
            // 3. Replace ? with .
            const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
            const regex = new RegExp(`^${escaped.replace(/\*/g, ".*").replace(/\?/g, ".")}$`, "i");

            const content = await foundry.applications.apps.FilePicker.implementation.browse(
                source,
                directory,
                browseOptions
            );

            // Filter files to those matching the wildcard
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
            this.log(`Error resolving wildcard path: ${path} | ${err}`, true);
        }

        // GUARD: If we found no matches or hit an error, return null.
        // This tells the UI to show a placeholder instead of trying to load "bear-*.png" as an image.
        return null;
    }

    static initialize() {
        this.log("Initializing Visage API (v2)");
        game.modules.get(this.MODULE_ID).api = {
            apply: this.apply.bind(this),
            remove: this.remove.bind(this),
            revert: this.revert.bind(this),
            getAvailable: this.getAvailable.bind(this),
            isActive: this.isActive.bind(this),
            resolvePath: this.resolvePath.bind(this)
        };
    }

    /* -------------------------------------------- */
    /* CORE LOGIC METHODS                          */
    /* -------------------------------------------- */

    static async apply(tokenOrId, maskId, options = { clearStack: false, switchIdentity: false }) {
        const token = (typeof tokenOrId === "string") ? canvas.tokens.get(tokenOrId) : tokenOrId;
        if (!token) return false;

        // 1. SMART LOOKUP
        let data = VisageData.getLocal(token.actor).find(v => v.id === maskId);
        if (!data) data = VisageData.getGlobal(maskId);
        
        if (!data) {
            console.warn(`Visage | Mask ID '${maskId}' not found.`);
            return false;
        }

        // 2. Prepare Layer
        let layer;
        if (VisageData.toLayer) {
            layer = await VisageData.toLayer(data);
        } else {
            layer = {
                id: data.id,
                label: data.label || "Unknown",
                changes: foundry.utils.deepClone(data.changes || {})
            };
            if (layer.changes.img) {
                layer.changes.texture = { src: await this.resolvePath(layer.changes.img) };
            }
        }

        // 3. Update Stack
        const ns = this.DATA_NAMESPACE;
        let stack = foundry.utils.deepClone(token.document.getFlag(ns, "activeStack") || []);
        const updateFlags = {};

        // OPTION A: Clear Stack (Shapechange / Reset)
        if (options.clearStack) {
            stack = [];
            updateFlags[`flags.${ns}.identity`] = layer.id;
        } 
        // OPTION B: Switch Identity (Preserve Masks)
        else if (options.switchIdentity) {
            const currentIdentity = token.document.getFlag(ns, "identity");
            if (currentIdentity) {
                stack = stack.filter(l => l.id !== currentIdentity);
            }
            updateFlags[`flags.${ns}.identity`] = layer.id;
        }

        // Deduplicate and push new layer to stack
        stack = stack.filter(l => l.id !== layer.id);
        
        // If switching identity, Insert at BOTTOM (start). Otherwise Push to TOP (end).
        if (options.switchIdentity) {
            stack.unshift(layer);
        } else {
            stack.push(layer);
        }
        
        updateFlags[`flags.${ns}.activeStack`] = stack;

        // 4. Atomic Write
        await token.document.update(updateFlags);
        await VisageComposer.compose(token);
        return true;
    }

    static async remove(tokenOrId, maskId) {
        const token = (typeof tokenOrId === "string") ? canvas.tokens.get(tokenOrId) : tokenOrId;
        if (!token) return false;

        const ns = this.DATA_NAMESPACE;
        let stack = foundry.utils.deepClone(token.document.getFlag(ns, "activeStack") || []);
        
        const initialLength = stack.length;
        stack = stack.filter(l => l.id !== maskId);

        if (stack.length === initialLength) return false;

        const updateFlags = {};

        // If we just removed the Identity layer, unset the flag
        const currentIdentity = token.document.getFlag(ns, "identity");
        if (currentIdentity === maskId) {
            updateFlags[`flags.${ns}.-=identity`] = null;
        }

        if (stack.length === 0) {
            updateFlags[`flags.${ns}.-=activeStack`] = null;
        } else {
            updateFlags[`flags.${ns}.activeStack`] = stack;
        }

        await token.document.update(updateFlags);
        await VisageComposer.compose(token);
        return true;
    }

    static async revert(tokenOrId) {
        const token = (typeof tokenOrId === "string") ? canvas.tokens.get(tokenOrId) : tokenOrId;
        if (!token) return false;

        const ns = this.DATA_NAMESPACE;
        // Clear Stack and Identity in one go
        await token.document.update({
            [`flags.${ns}.-=activeStack`]: null,
            [`flags.${ns}.-=identity`]: null
        });
        
        await VisageComposer.revertToDefault(token.document);
        return true;
    }

    static isActive(tokenOrId, maskId) {
        const token = (typeof tokenOrId === "string") ? canvas.tokens.get(tokenOrId) : tokenOrId;
        if (!token) return false;
        
        const stack = token.document.getFlag(this.DATA_NAMESPACE, "activeStack") || [];
        return stack.some(l => l.id === maskId);
    }

    static getAvailable(tokenOrId) {
        const token = (typeof tokenOrId === "string") ? canvas.tokens.get(tokenOrId) : tokenOrId;
        const actor = token?.actor;
        if (!actor) return [];

        const local = VisageData.getLocal(actor).map(v => ({ ...v, type: "local" }));
        const global = VisageData.globals.map(v => ({ ...v, type: "global" }));
        return [...local, ...global];
    }

    static async handleTokenUpdate(tokenDocument, change, options, userId) {
        if (options.visageUpdate) return;
        if (game.user.id !== userId) return;

        const actor = tokenDocument.actor;
        if (!actor) return;
        const tokenId = tokenDocument.id;

        // PART A: CAPTURE DEFAULTS
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
            if (hasChangedRing) updateData[`flags.${this.DATA_NAMESPACE}.${tokenId}.defaults.ring`] = change.ring;
            if (hasChangedSize) {
                if ("width" in change) updateData[`flags.${this.DATA_NAMESPACE}.${tokenId}.defaults.width`] = change.width;
                if ("height" in change) updateData[`flags.${this.DATA_NAMESPACE}.${tokenId}.defaults.height`] = change.height;
            }
            if (Object.keys(updateData).length > 0) actor.update(updateData);
        }

        // PART B: MAINTAIN GLOBAL STACK
        const flags = tokenDocument.flags[this.MODULE_ID] || {};
        const stack = flags.activeStack || flags.stack || [];

        if (stack.length > 0) {
            let base = flags.originalState;
            if (!base) {
                base = VisageComposer._captureSnapshot(tokenDocument.object);
            }

            const newBase = foundry.utils.mergeObject(base, change, { 
                insertKeys: false, 
                inplace: false 
            });

            await VisageComposer.compose(tokenDocument.object, null, newBase);
        }
    }
}