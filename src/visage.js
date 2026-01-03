/**
 * @file Contains the core business logic and API for the Visage module.
 * Acts as the Controller layer, orchestrating data retrieval, stack management, and token composition.
 * @module visage
 */

import { VisageComposer } from "./visage-composer.js";
import { VisageData } from "./visage-data.js"; 

export class Visage {
    static MODULE_ID = "visage";
    static DATA_NAMESPACE = "visage";

    /**
     * Logs messages to the console if Debug Mode is enabled.
     * @param {string} message - The message to log.
     * @param {boolean} [force=false] - If true, logs regardless of debug settings.
     */
    static log(message, force = false) {
        const shouldLog = force || game.modules.get('_dev-mode')?.api?.getPackageDebugValue(this.MODULE_ID);
        if (shouldLog) console.log(`${this.MODULE_ID} | ${message}`);
    }

    /**
     * Resolves wildcard paths or S3 bucket URLs into a concrete file path.
     * Used to pick a random image from a folder if a wildcard is provided.
     * @param {string} path - The image path (e.g., "tokens/guards/*").
     * @returns {Promise<string>} The resolved single file path.
     */
    static async resolvePath(path) {
        if (!path || !path.includes('*')) return path;
        try {
            const browseOptions = { wildcard: true };
            let source = "data";

            // Handle S3 Bucket parsing
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
            
            // Return a random file from the resolved directory
            if (content.files.length) {
                return content.files[Math.floor(Math.random() * content.files.length)];
            }
        } catch (err) {
            this.log(`Error resolving wildcard path: ${path} | ${err}`, true);
        }
        return path;
    }

    /**
     * Initializes the module API, exposing methods for macros and third-party modules.
     */
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

    /**
     * Applies a specific mask or visage to a token.
     * @param {Token|string} tokenOrId - The target token or its ID.
     * @param {string} maskId - The ID of the visage/mask to apply.
     * @param {Object} [options] - Application options.
     * @param {boolean} [options.clearStack=false] - If true, removes all existing masks (Shapechange behavior).
     * @param {boolean} [options.switchIdentity=false] - If true, replaces only the base Identity but keeps other masks (Disguise Self behavior).
     * @returns {Promise<boolean>} True if successful.
     */
    static async apply(tokenOrId, maskId, options = { clearStack: false, switchIdentity: false }) {
        const token = (typeof tokenOrId === "string") ? canvas.tokens.get(tokenOrId) : tokenOrId;
        if (!token) return false;

        // 1. SMART LOOKUP: Check Local Actor flags first, then Global World settings.
        let data = VisageData.getLocal(token.actor).find(v => v.id === maskId);
        if (!data) data = VisageData.getGlobal(maskId);
        
        if (!data) {
            console.warn(`Visage | Mask ID '${maskId}' not found.`);
            return false;
        }

        // 2. PREPARE LAYER: Convert storage format to active layer format.
        let layer;
        if (VisageData.toLayer) {
            layer = await VisageData.toLayer(data);
        } else {
            // Fallback factory if VisageData.toLayer isn't available (legacy safety)
            layer = {
                id: data.id,
                label: data.label || "Unknown",
                changes: foundry.utils.deepClone(data.changes || {})
            };
            if (layer.changes.img) {
                layer.changes.texture = { src: await this.resolvePath(layer.changes.img) };
            }
        }

        // 3. UPDATE STACK
        const ns = this.DATA_NAMESPACE;
        let stack = foundry.utils.deepClone(token.document.getFlag(ns, "activeStack") || []);
        const updateFlags = {};

        // CASE A: Clear Stack (Shapechange / Reset)
        // Wipes everything. The new layer becomes the sole Identity.
        if (options.clearStack) {
            stack = [];
            updateFlags[`flags.${ns}.identity`] = layer.id;
        } 
        // CASE B: Switch Identity (Preserve Masks)
        // Finds the old "Identity" layer, removes it, and inserts the new one.
        // Keeps all other cosmetic masks (invisibility, etc.) intact.
        else if (options.switchIdentity) {
            const currentIdentity = token.document.getFlag(ns, "identity");
            if (currentIdentity) {
                stack = stack.filter(l => l.id !== currentIdentity);
            }
            updateFlags[`flags.${ns}.identity`] = layer.id;
        }

        // Deduplicate: Ensure we don't add the same ID twice.
        stack = stack.filter(l => l.id !== layer.id);
        stack.push(layer);
        
        updateFlags[`flags.${ns}.activeStack`] = stack;

        // 4. ATOMIC WRITE & COMPOSE
        await token.document.update(updateFlags);
        await VisageComposer.compose(token);
        return true;
    }

    /**
     * Removes a specific mask/layer from the token's stack.
     * @param {Token|string} tokenOrId - The target token.
     * @param {string} maskId - The ID of the layer to remove.
     * @returns {Promise<boolean>} True if successful.
     */
    static async remove(tokenOrId, maskId) {
        const token = (typeof tokenOrId === "string") ? canvas.tokens.get(tokenOrId) : tokenOrId;
        if (!token) return false;

        const ns = this.DATA_NAMESPACE;
        let stack = foundry.utils.deepClone(token.document.getFlag(ns, "activeStack") || []);
        
        const initialLength = stack.length;
        stack = stack.filter(l => l.id !== maskId);

        // Optimization: Don't trigger update if nothing changed
        if (stack.length === initialLength) return false;

        const updateFlags = {};

        // If we just removed the layer marked as "Identity", unset the identity flag.
        // This effectively reverts the token to its "Default" state implicitly.
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

    /**
     * Reverts the token completely to its original state (removes all Visage effects).
     * @param {Token|string} tokenOrId - The target token.
     */
    static async revert(tokenOrId) {
        const token = (typeof tokenOrId === "string") ? canvas.tokens.get(tokenOrId) : tokenOrId;
        if (!token) return false;

        const ns = this.DATA_NAMESPACE;
        // Atomic wipe of all Visage flags
        await token.document.update({
            [`flags.${ns}.-=activeStack`]: null,
            [`flags.${ns}.-=identity`]: null
        });
        
        await VisageComposer.revertToDefault(token.document);
        return true;
    }

    /**
     * Checks if a specific mask ID is currently active on the token.
     * @param {Token|string} tokenOrId - The target token.
     * @param {string} maskId - The mask ID to check.
     * @returns {boolean}
     */
    static isActive(tokenOrId, maskId) {
        const token = (typeof tokenOrId === "string") ? canvas.tokens.get(tokenOrId) : tokenOrId;
        if (!token) return false;
        
        const stack = token.document.getFlag(this.DATA_NAMESPACE, "activeStack") || [];
        return stack.some(l => l.id === maskId);
    }

    /**
     * Retrieves all available visages (Local + Global) for a token.
     * @param {Token|string} tokenOrId - The target token.
     * @returns {Array<Object>} List of available visage data objects.
     */
    static getAvailable(tokenOrId) {
        const token = (typeof tokenOrId === "string") ? canvas.tokens.get(tokenOrId) : tokenOrId;
        const actor = token?.actor;
        if (!actor) return [];

        const local = VisageData.getLocal(actor).map(v => ({ ...v, type: "local" }));
        const global = VisageData.globals.map(v => ({ ...v, type: "global" }));
        return [...local, ...global];
    }

    /**
     * Intercepts token updates to handle the "Ghost Edit" problem.
     * * THE PROBLEM: When a user edits a token (e.g., changes scale) while a Visage is active,
     * Foundry updates the *current* visual state. If we don't intervene, this change is lost
     * when the Visage is removed (because Visage reverts to the *old* snapshot).
     * * THE SOLUTION: We detect manual edits, intercept them, and update the "Clean Snapshot"
     * stored in the flags instead of just the visual token.
     * * @param {TokenDocument} tokenDocument - The token document being updated.
     * @param {Object} change - The changes being applied.
     * @param {Object} options - Update options.
     * @param {string} userId - The ID of the user triggering the update.
     */
    static async handleTokenUpdate(tokenDocument, change, options, userId) {
        // Ignore updates triggered by Visage itself to prevent infinite loops
        if (options.visageUpdate) return;
        if (game.user.id !== userId) return;

        const actor = tokenDocument.actor;
        if (!actor) return;
        const tokenId = tokenDocument.id;

        // PART A: CAPTURE DEFAULTS
        // If the user manually changes properties (Name, Image, Size) via Token Config,
        // we must update the stored "Default" state in the Actor flags.
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
            
            // Persist the new "Default" state to the Actor
            if (Object.keys(updateData).length > 0) actor.update(updateData);
        }

        // PART B: MAINTAIN GLOBAL STACK
        // If the token has active effects, we must re-compose the token appearance.
        // We take the *new* base state (from the update) and re-apply the stack on top of it.
        const flags = tokenDocument.flags[this.MODULE_ID] || {};
        const stack = flags.activeStack || flags.stack || [];

        if (stack.length > 0) {
            let base = flags.originalState;
            if (!base) {
                base = VisageComposer._captureSnapshot(tokenDocument.object);
            }

            // Merge the manual change into the base snapshot
            const newBase = foundry.utils.mergeObject(base, change, { 
                insertKeys: false, 
                inplace: false 
            });

            // Re-run composition with the updated base
            await VisageComposer.compose(tokenDocument.object, null, newBase);
        }
    }
}