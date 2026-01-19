/**
 * @file Contains the core logic for the Visage module.
 * Acts as the primary API entry point.
 * @module visage
 */

import { VisageComposer } from "./visage-composer.js";
import { VisageData } from "./visage-data.js"; 
import { VisageUtilities } from "./visage-utilities.js";
import { VisageSequencer } from "./visage-sequencer.js"; 

export class Visage {
    static MODULE_ID = "visage";
    static DATA_NAMESPACE = "visage";
    
    // Track Sequencer State
    static sequencerReady = false;

    static log(message, force = false) { VisageUtilities.log(message, force); }
    static async resolvePath(path) { return VisageUtilities.resolvePath(path); }

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

        // --- COORDINATED RESTORATION SYSTEM ---
        
        // 1. Listen for Sequencer to finish building its Database
        Hooks.once("sequencer.ready", () => {
            Visage.sequencerReady = true;
            // If canvas is already waiting, trigger restore now
            if (canvas.ready) {
                Visage._restoreAll();
            }
        });

        // 2. Listen for Canvas Load
        Hooks.on("canvasReady", () => {
            // Only restore if Sequencer is already done. 
            // If not, we wait for the 'sequencer.ready' hook above to fire.
            if (Visage.sequencerReady) {
                setTimeout(() => Visage._restoreAll(), 100);
            }
        });

        // 3. New Tokens (Drop/Spawn)
        Hooks.on("createToken", (tokenDoc) => {
            if (tokenDoc.object && Visage.sequencerReady) {
                setTimeout(() => VisageSequencer.restore(tokenDoc.object), 250);
            }
        });

        // 4. Cleanup
        Hooks.on("deleteToken", (tokenDoc) => {
            if (tokenDoc.object) {
                VisageSequencer.revert(tokenDoc.object);
            }
        });
    }

    /**
     * Helper to trigger restoration on all tokens in the current scene.
     */
    static _restoreAll() {
        // Double-check Sequencer hasn't crashed or unloaded
        if (!Visage.sequencerReady && !game.modules.get("sequencer")?.active) return;

        canvas.tokens.placeables.forEach(token => {
            VisageSequencer.restore(token);
        });
    }

    /* -------------------------------------------- */
    /* CORE LOGIC METHODS                          */
    /* -------------------------------------------- */

    static async apply(tokenOrId, maskId, options = { clearStack: false, switchIdentity: false }) {
        const token = (typeof tokenOrId === "string") ? canvas.tokens.get(tokenOrId) : tokenOrId;
        if (!token) return false;

        let data = VisageData.getLocal(token.actor).find(v => v.id === maskId);
        if (!data) data = VisageData.getGlobal(maskId);
        
        if (!data) {
            console.warn(`Visage | Mask ID '${maskId}' not found.`);
            return false;
        }

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

        const ns = this.DATA_NAMESPACE;
        let stack = foundry.utils.deepClone(token.document.getFlag(ns, "activeStack") || []);
        const updateFlags = {};

        if (options.clearStack || options.switchIdentity) {
            if (options.clearStack) await VisageSequencer.revert(token);
        }

        if (options.clearStack) {
            stack = [];
            updateFlags[`flags.${ns}.identity`] = layer.id;
        } else if (options.switchIdentity) {
            const currentIdentity = token.document.getFlag(ns, "identity");
            if (currentIdentity) {
                stack = stack.filter(l => l.id !== currentIdentity);
            }
            updateFlags[`flags.${ns}.identity`] = layer.id;
        }

        stack = stack.filter(l => l.id !== layer.id);
        
        if (options.switchIdentity) {
            stack.unshift(layer);
        } else {
            stack.push(layer);
        }
        
        updateFlags[`flags.${ns}.activeStack`] = stack;

        await token.document.update(updateFlags);
        await VisageComposer.compose(token);

        const isBase = options.switchIdentity || options.clearStack;
        await VisageSequencer.apply(token, layer, isBase);

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

        const isBase = (currentIdentity === maskId);
        await VisageSequencer.remove(token, maskId, isBase);

        return true;
    }

    static async revert(tokenOrId) {
        const token = (typeof tokenOrId === "string") ? canvas.tokens.get(tokenOrId) : tokenOrId;
        if (!token) return false;

        const ns = this.DATA_NAMESPACE;
        
        await token.document.update({
            [`flags.${ns}.-=activeStack`]: null,
            [`flags.${ns}.-=identity`]: null
        });
        
        await VisageComposer.revertToDefault(token.document);
        await VisageSequencer.revert(token);

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
        if (!tokenDocument.object) return;

        const relevantKeys = ["name", "displayName", "disposition", "width", "height", "texture", "ring"];
        const flatChange = foundry.utils.flattenObject(change);
        if ("hidden" in flatChange) return;
        
        const isRelevant = Object.keys(flatChange).some(key => relevantKeys.some(rk => key === rk || key.startsWith(rk + ".")));
        if (!isRelevant) return;

        const flags = tokenDocument.flags[this.MODULE_ID] || {};
        const stack = flags.activeStack || flags.stack || [];

        if (stack.length > 0) {
            let base = flags.originalState;
            if (!base) base = VisageUtilities.extractVisualState(tokenDocument);
            
            const expandedChange = foundry.utils.expandObject(change);
            const dirtyBase = foundry.utils.mergeObject(base, expandedChange, { insertKeys: true, inplace: false });
            const cleanBase = VisageUtilities.extractVisualState(dirtyBase);
            await VisageComposer.compose(tokenDocument.object, null, cleanBase);
        }
    }
}