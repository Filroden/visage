import { VisageComposer } from "./visage-composer.js";
import { VisageData } from "./visage-data.js"; 
import { VisageUtilities } from "./visage-utilities.js";
import { VisageSequencer } from "./visage-sequencer.js"; 

/**
 * The core API class for the Visage module.
 * Manages the application, removal, and restoration of visual modifications (Visages) on tokens.
 * Acts as the central controller orchestrating Data, Composer, and Sequencer components.
 */
export class Visage {
    static MODULE_ID = "visage";
    static DATA_NAMESPACE = "visage";
    static sequencerReady = false;

    static log(message, force = false) { VisageUtilities.log(message, force); }
    static async resolvePath(path) { return VisageUtilities.resolvePath(path); }

    static initialize() {
        this.log("Initializing Visage API (v3.2)");
        game.modules.get(this.MODULE_ID).api = {
            apply: this.apply.bind(this),
            remove: this.remove.bind(this),
            revert: this.revert.bind(this),
            getAvailable: this.getAvailable.bind(this),
            isActive: this.isActive.bind(this),
            resolvePath: VisageUtilities.resolvePath.bind(VisageUtilities)
        };

        Hooks.once("sequencer.ready", () => {
            Visage.sequencerReady = true;
            if (canvas.ready) Visage._restoreAll();
        });
        Hooks.on("canvasReady", () => {
            if (Visage.sequencerReady) setTimeout(() => Visage._restoreAll(), 100);
        });
        Hooks.on("createToken", (tokenDoc) => {
            if (tokenDoc.object && Visage.sequencerReady) setTimeout(() => VisageSequencer.restore(tokenDoc.object), 250);
        });
        Hooks.on("deleteToken", (tokenDoc) => {
            if (tokenDoc.object) VisageSequencer.revert(tokenDoc.object);
        });
    }

    static _restoreAll() {
        if (!Visage.sequencerReady && !game.modules.get("sequencer")?.active) return;
        canvas.tokens.placeables.forEach(token => VisageSequencer.restore(token));
    }

    /**
     * Applies a Visage with Transition Timing logic.
     */
    static async apply(tokenOrId, maskId, options = {}) {
        const token = (typeof tokenOrId === "string") ? canvas.tokens.get(tokenOrId) : tokenOrId;
        if (!token) return false;

        let data = VisageData.getLocal(token.actor).find(v => v.id === maskId);
        let source = "local";
        if (!data) {
            data = VisageData.getGlobal(maskId);
            source = "global";
        }
        if (!data) return false;

        const mode = data.mode || (source === "local" ? "identity" : "overlay");
        const switchIdentity = options.switchIdentity ?? (mode === "identity");
        const clearStack = options.clearStack ?? false;

        const layer = await VisageData.toLayer(data, source);
        const ns = this.DATA_NAMESPACE;
        let stack = foundry.utils.deepClone(token.document.getFlag(ns, "activeStack") || []);
        const updateFlags = {};

        // 1. Snapshot logic (Phase 1)
        if (!token.document.getFlag(ns, "originalState")) {
            const original = VisageUtilities.extractVisualState(token.document);
            await token.document.setFlag(ns, "originalState", original);
        }

        if (clearStack || switchIdentity) {
            if (clearStack) await VisageSequencer.revert(token);
        }
        if (clearStack) {
            stack = [];
            updateFlags[`flags.${ns}.identity`] = layer.id;
        } else if (switchIdentity) {
            const currentIdentity = token.document.getFlag(ns, "identity");
            if (currentIdentity) {
                stack = stack.filter(l => l.id !== currentIdentity);
                await VisageSequencer.remove(token, currentIdentity, true);
            }
            updateFlags[`flags.${ns}.identity`] = layer.id;
        }

        stack = stack.filter(l => l.id !== layer.id);
        if (switchIdentity) stack.unshift(layer); else stack.push(layer);
        
        updateFlags[`flags.${ns}.activeStack`] = stack;
        await token.document.update(updateFlags);

        // --- v3.2 TRANSITION LOGIC ---
        const delay = layer.delay || 0;
        const isEffectsLead = delay >= 0;
        const waitTime = Math.abs(delay);

        // v3.2 Helper: Apply Actor Portrait Update
        // Only if this layer has portrait data.
        const applyPortrait = async () => {
             if (layer.changes.portrait && token.actor) {
                 await token.actor.update({ img: layer.changes.portrait });
             }
        };

        const applyTokenUpdate = async () => {
             await VisageComposer.compose(token);
             await applyPortrait();
        };

        const applyEffects = async () => {
             const isBase = switchIdentity || clearStack;
             await VisageSequencer.apply(token, layer, isBase);
        };

        // Execution Flow
        if (isEffectsLead) {
            // 1. Effects First
            await applyEffects();
            if (waitTime > 0) await new Promise(r => setTimeout(r, waitTime));
            // 2. Token Data
            await applyTokenUpdate();
        } else {
            // 1. Token Data First
            await applyTokenUpdate();
            if (waitTime > 0) await new Promise(r => setTimeout(r, waitTime));
            // 2. Effects
            await applyEffects();
        }

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

        if (stack.length === 0) updateFlags[`flags.${ns}.-=activeStack`] = null;
        else updateFlags[`flags.${ns}.activeStack`] = stack;

        const originalState = token.document.getFlag(ns, "originalState");

        await token.document.update(updateFlags);
        
        // Re-compose Token Data
        await VisageComposer.compose(token);
        
        // v3.2 Restore Portrait logic
        // If stack is empty or we removed the identity, check if we need to revert portrait
        const remainingIdentity = stack.find(l => l.mode === "identity");
        
        if (token.actor) {
            if (remainingIdentity && remainingIdentity.changes.portrait) {
                // If another identity is present with a portrait, use it
                await token.actor.update({ img: remainingIdentity.changes.portrait });
            } else if (originalState && originalState.portrait) {
                // Otherwise revert to original
                await token.actor.update({ img: originalState.portrait });
            }
        }

        const isBase = (currentIdentity === maskId);
        await VisageSequencer.remove(token, maskId, isBase);
        return true;
    }

    static async revert(tokenOrId) {
        const token = (typeof tokenOrId === "string") ? canvas.tokens.get(tokenOrId) : tokenOrId;
        if (!token) return false;
        
        const ns = this.DATA_NAMESPACE;
        const originalState = token.document.getFlag(ns, "originalState");

        await token.document.update({ 
            [`flags.${ns}.-=activeStack`]: null, 
            [`flags.${ns}.-=identity`]: null 
        });
        
        await VisageComposer.revertToDefault(token.document);
        
        // v3.2 Revert Portrait
        if (token.actor && originalState && originalState.portrait) {
            await token.actor.update({ img: originalState.portrait });
        }

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

        // v3.2: Added light to relevant keys
        const relevantKeys = ["name", "displayName", "disposition", "width", "height", "texture", "ring", "light"]; 
        const flatChange = foundry.utils.flattenObject(change);
        
        // Ignore visibility toggles (handled by core)
        if ("hidden" in flatChange) return;
        
        const isRelevant = Object.keys(flatChange).some(key => relevantKeys.some(rk => key === rk || key.startsWith(rk + ".")));
        if (!isRelevant) return;

        const flags = tokenDocument.flags[this.MODULE_ID] || {};
        const stack = flags.activeStack || [];

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