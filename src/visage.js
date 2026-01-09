/**
 * @file Contains the core logic for the Visage module.
 * @module visage
 */

import { VisageComposer } from "./visage-composer.js";
import { VisageData } from "./visage-data.js"; 
import { VisageUtilities } from "./visage-utilities.js";

export class Visage {
    static MODULE_ID = "visage";
    static DATA_NAMESPACE = "visage";

    // Proxy for backward compatibility
    static log(message, force = false) {
        VisageUtilities.log(message, force);
    }

    // Proxy for backward compatibility
    static async resolvePath(path) {
        return VisageUtilities.resolvePath(path);
    }

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
        // Filter out loops and ownership
        if (options.visageUpdate) return;
        if (game.user.id !== userId) return;
        if (!tokenDocument.object) return;

        // --- Filter Irrelevant Updates ---
        // We only trigger a recomposition if a VISUAL property changed.
        const relevantKeys = [
            "name", "displayName", "disposition", "width", "height", 
            "texture", "img", "ring"
        ];
        
        // Flatten the change object to handle nested updates like "texture.src"
        const flatChange = foundry.utils.flattenObject(change);

        // If the token is being Hidden/Unhidden, abort immediately.
        if ("hidden" in flatChange) return;
        
        // Check if ANY key in the change object starts with a relevant key
        const isRelevant = Object.keys(flatChange).some(key => {
            return relevantKeys.some(rk => key === rk || key.startsWith(rk + "."));
        });

        if (!isRelevant) return;

        const flags = tokenDocument.flags[this.MODULE_ID] || {};
        const stack = flags.activeStack || flags.stack || [];

        // Only intercept updates if a Visage is active (masking the default)
        if (stack.length > 0) {
            let base = flags.originalState;
            
            // Fallback: If no snapshot exists, capture current state.
            if (!base) {
                base = VisageUtilities.extractVisualState(tokenDocument);
            }

            // 1. EXPAND: Handle dot-notation keys (e.g. "texture.src")
            const expandedChange = foundry.utils.expandObject(change);

            // 2. MERGE: Apply changes to the snapshot
            const dirtyBase = foundry.utils.mergeObject(base, expandedChange, { 
                insertKeys: true, 
                inplace: false 
            });

            // 3. CLEAN: Strip out non-visual properties
            const cleanBase = VisageUtilities.extractVisualState(dirtyBase);

            // 4. UPDATE: Write the new snapshot and recompose
            await VisageComposer.compose(tokenDocument.object, null, cleanBase);
        }
    }
}