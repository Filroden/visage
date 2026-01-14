/**
 * @file Contains the core logic for the Visage module.
 * Acts as the primary API entry point and handles the high-level orchestration
 * of applying, removing, and reverting visual effects on tokens.
 * @module visage
 */

import { VisageComposer } from "./visage-composer.js";
import { VisageData } from "./visage-data.js"; 
import { VisageUtilities } from "./visage-utilities.js";

/**
 * The main API class for Visage.
 * Provides static methods to manipulate Token appearance stacks.
 */
export class Visage {
    static MODULE_ID = "visage";
    static DATA_NAMESPACE = "visage";

    /**
     * Proxies logging to the utility class.
     * @param {string} message - The message to log.
     * @param {boolean} [force=false] - Whether to bypass debug settings.
     * @internal
     */
    static log(message, force = false) {
        VisageUtilities.log(message, force);
    }

    /**
     * Resolves a file path, handling wildcards and video extensions.
     * @param {string} path - The file path to resolve.
     * @returns {Promise<string>} The resolved URL.
     */
    static async resolvePath(path) {
        return VisageUtilities.resolvePath(path);
    }

    /**
     * Initializes the module API, exposing methods to other modules via `game.modules.get('visage').api`.
     */
    static initialize() {
        this.log("Initializing Visage API (v2)");
        game.modules.get(this.MODULE_ID).api = {
            apply: this.apply.bind(this),
            remove: this.remove.bind(this),
            revert: this.revert.bind(this),
            getAvailable: this.getAvailable.bind(this),
            isActive: this.isActive.bind(this),
            resolvePath: VisageUtilities.resolvePath.bind(VisageUtilities)
        };
    }

    /* -------------------------------------------- */
    /* CORE LOGIC METHODS                          */
    /* -------------------------------------------- */

    /**
     * Applies a Visage or Mask to a token.
     * Handles the logic for "Identity Swaps" (base layer) vs "Mask Stacking" (top layers).
     * * @param {Token|string} tokenOrId - The target token object or its ID.
     * @param {string} maskId - The ID of the Visage/Mask to apply.
     * @param {Object} [options] - Application options.
     * @param {boolean} [options.clearStack=false] - If true, removes all existing layers before applying (Transform/Shapechange).
     * @param {boolean} [options.switchIdentity=false] - If true, replaces the bottom-most "Identity" layer while preserving upper masks.
     * @returns {Promise<boolean>} True if successful, false otherwise.
     */
    static async apply(tokenOrId, maskId, options = { clearStack: false, switchIdentity: false }) {
        const token = (typeof tokenOrId === "string") ? canvas.tokens.get(tokenOrId) : tokenOrId;
        if (!token) return false;

        // 1. Locate Data (Local Actor Priority -> Global Library)
        let data = VisageData.getLocal(token.actor).find(v => v.id === maskId);
        if (!data) data = VisageData.getGlobal(maskId);
        
        if (!data) {
            console.warn(`Visage | Mask ID '${maskId}' not found.`);
            return false;
        }

        // 2. Prepare Layer Data
        // Converts the stored data format into a runtime layer object.
        let layer;
        if (VisageData.toLayer) {
            layer = await VisageData.toLayer(data);
        } else {
            // Fallback for direct data objects
            layer = {
                id: data.id,
                label: data.label || "Unknown",
                changes: foundry.utils.deepClone(data.changes || {})
            };
            if (layer.changes.img) {
                layer.changes.texture = { src: await this.resolvePath(layer.changes.img) };
            }
        }

        // 3. Update the Stack
        const ns = this.DATA_NAMESPACE;
        let stack = foundry.utils.deepClone(token.document.getFlag(ns, "activeStack") || []);
        const updateFlags = {};

        if (options.clearStack) {
            // Option A: Hard Reset (e.g., Polymorph)
            stack = [];
            updateFlags[`flags.${ns}.identity`] = layer.id;
        } else if (options.switchIdentity) {
            // Option B: Identity Swap (e.g., Disguise Self)
            // Removes the current base identity but keeps effects (like "Invisible") on top.
            const currentIdentity = token.document.getFlag(ns, "identity");
            if (currentIdentity) {
                stack = stack.filter(l => l.id !== currentIdentity);
            }
            updateFlags[`flags.${ns}.identity`] = layer.id;
        }

        // Remove duplicates of the applied layer if it already exists in the stack
        stack = stack.filter(l => l.id !== layer.id);
        
        // Stack Order Logic:
        // - Identity layers go to the BOTTOM (start of array).
        // - Mask layers go to the TOP (end of array).
        if (options.switchIdentity) {
            stack.unshift(layer);
        } else {
            stack.push(layer);
        }
        
        updateFlags[`flags.${ns}.activeStack`] = stack;

        // 4. Atomic Write & Compose
        await token.document.update(updateFlags);
        await VisageComposer.compose(token);
        return true;
    }

    /**
     * Removes a specific layer from the token's stack.
     * @param {Token|string} tokenOrId - The target token object or its ID.
     * @param {string} maskId - The ID of the layer to remove.
     * @returns {Promise<boolean>} True if removed, false if not found.
     */
    static async remove(tokenOrId, maskId) {
        const token = (typeof tokenOrId === "string") ? canvas.tokens.get(tokenOrId) : tokenOrId;
        if (!token) return false;

        const ns = this.DATA_NAMESPACE;
        let stack = foundry.utils.deepClone(token.document.getFlag(ns, "activeStack") || []);
        
        const initialLength = stack.length;
        stack = stack.filter(l => l.id !== maskId);

        if (stack.length === initialLength) return false; // Layer was not present

        const updateFlags = {};

        // If we removed the tracked Identity layer, clear the identity flag
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
     * Reverts the token to its original, clean state.
     * Removes all stacks, identities, and temporary effects.
     * @param {Token|string} tokenOrId - The target token.
     * @returns {Promise<boolean>}
     */
    static async revert(tokenOrId) {
        const token = (typeof tokenOrId === "string") ? canvas.tokens.get(tokenOrId) : tokenOrId;
        if (!token) return false;

        const ns = this.DATA_NAMESPACE;
        
        // Clear Stack and Identity flags
        await token.document.update({
            [`flags.${ns}.-=activeStack`]: null,
            [`flags.${ns}.-=identity`]: null
        });
        
        // Restore original state via Composer
        await VisageComposer.revertToDefault(token.document);
        return true;
    }

    /**
     * Checks if a specific mask/visage is currently active on the token.
     * @param {Token|string} tokenOrId - The target token.
     * @param {string} maskId - The ID to check.
     * @returns {boolean}
     */
    static isActive(tokenOrId, maskId) {
        const token = (typeof tokenOrId === "string") ? canvas.tokens.get(tokenOrId) : tokenOrId;
        if (!token) return false;
        
        const stack = token.document.getFlag(this.DATA_NAMESPACE, "activeStack") || [];
        return stack.some(l => l.id === maskId);
    }

    /**
     * Retrieves all available Visages/Masks for a token (Local + Global).
     * @param {Token|string} tokenOrId - The target token.
     * @returns {Array<Object>} Combined list of available options.
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
     * Intercepts standard Token updates to preserve the non-destructive stack.
     * * When a user manually edits a token (e.g. via Token Config) while a Mask is active,
     * this method intercepts that update. Instead of modifying the token directly (which
     * is currently masked), it applies the changes to the `originalState` snapshot.
     * * This ensures that when the mask is removed, the user's manual edits are revealed,
     * rather than being overwritten by the mask or lost entirely.
     * * @param {TokenDocument} tokenDocument - The document being updated.
     * @param {Object} change - The change object (delta).
     * @param {Object} options - Update options.
     * @param {string} userId - The ID of the user performing the update.
     */
    static async handleTokenUpdate(tokenDocument, change, options, userId) {
        // Prevention: Ignore internal updates or updates from other users
        if (options.visageUpdate) return;
        if (game.user.id !== userId) return;
        if (!tokenDocument.object) return;

        // 1. Filter Irrelevant Updates
        // Only trigger recomposition if a VISUAL property is changed.
        const relevantKeys = [
            "name", "displayName", "disposition", "width", "height", 
            "texture", "ring"
        ];
        
        // Flatten the change object to detect nested updates (e.g., "texture.src")
        const flatChange = foundry.utils.flattenObject(change);

        // Immediate Abort: Changing Hidden state should bypass this logic
        if ("hidden" in flatChange) return;
        
        const isRelevant = Object.keys(flatChange).some(key => {
            return relevantKeys.some(rk => key === rk || key.startsWith(rk + "."));
        });

        if (!isRelevant) return;

        const flags = tokenDocument.flags[this.MODULE_ID] || {};
        const stack = flags.activeStack || flags.stack || [];

        // 2. Intercept Logic
        // Only intercept if a Visage/Mask is currently active.
        if (stack.length > 0) {
            let base = flags.originalState;
            
            // Fallback: If no snapshot exists, capture current state immediately.
            if (!base) {
                base = VisageUtilities.extractVisualState(tokenDocument);
            }

            // A. Expand: Convert dot-notation keys back to object structure
            const expandedChange = foundry.utils.expandObject(change);

            // B. Merge: Apply the user's manual edits into the Snapshot (Background)
            const dirtyBase = foundry.utils.mergeObject(base, expandedChange, { 
                insertKeys: true, 
                inplace: false 
            });

            // C. Clean: Ensure only tracked visual properties are saved
            const cleanBase = VisageUtilities.extractVisualState(dirtyBase);

            // D. Re-Compose: Update the token using the new base + existing stack
            await VisageComposer.compose(tokenDocument.object, null, cleanBase);
        }
    }
}