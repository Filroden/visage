/* visage.js */
import { VisageComposer } from "./visage-composer.js";
import { VisageData } from "./visage-data.js"; 
import { VisageUtilities } from "./visage-utilities.js";
import { VisageSequencer } from "./visage-sequencer.js"; 

export class Visage {
    static MODULE_ID = "visage";
    static DATA_NAMESPACE = "visage";
    static sequencerReady = false;

    static log(message, force = false) { VisageUtilities.log(message, force); }
    static async resolvePath(path) { return VisageUtilities.resolvePath(path); }

    static initialize() {
        // ... [Initialization logic unchanged] ...
        this.log("Initializing Visage API (v2)");
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
            if (tokenDoc.object && Visage.sequencerReady) {
                setTimeout(() => VisageSequencer.restore(tokenDoc.object), 250);
            }
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
     * Unified Application Logic.
     * Determines whether to swap identity or stack mask based on data.mode.
     */
    static async apply(tokenOrId, maskId, options = {}) {
        const token = (typeof tokenOrId === "string") ? canvas.tokens.get(tokenOrId) : tokenOrId;
        if (!token) return false;

        // 1. Locate Data & Determine Source
        let data = VisageData.getLocal(token.actor).find(v => v.id === maskId);
        let source = "local";
        
        if (!data) {
            data = VisageData.getGlobal(maskId);
            source = "global";
        }
        
        if (!data) {
            console.warn(`Visage | Mask ID '${maskId}' not found.`);
            return false;
        }

        // 2. Determine Mode & Options
        // Fallback: If no mode, use legacy logic (Local=Identity, Global=Overlay)
        const mode = data.mode || (source === "local" ? "identity" : "overlay");
        
        // Force options based on mode, but allow explicit override if passed
        const switchIdentity = options.switchIdentity ?? (mode === "identity");
        const clearStack = options.clearStack ?? false;

        // 3. Prepare Layer
        // We pass 'source' so VisageData can stamp it onto the layer for UI coloring
        const layer = await VisageData.toLayer(data, source);

        // 4. Update the Stack
        const ns = this.DATA_NAMESPACE;
        let stack = foundry.utils.deepClone(token.document.getFlag(ns, "activeStack") || []);
        const updateFlags = {};

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
            }
            updateFlags[`flags.${ns}.identity`] = layer.id;
        }

        // Remove existing instance of this specific layer (no duplicates in stack)
        stack = stack.filter(l => l.id !== layer.id);
        
        if (switchIdentity) {
            stack.unshift(layer); // Identity at bottom
        } else {
            stack.push(layer); // Overlay at top
        }
        
        updateFlags[`flags.${ns}.activeStack`] = stack;

        await token.document.update(updateFlags);
        await VisageComposer.compose(token);

        const isBase = switchIdentity || clearStack;
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

    // ... [revert, isActive, getAvailable, handleTokenUpdate unchanged] ...
    static async revert(tokenOrId) {
        const token = (typeof tokenOrId === "string") ? canvas.tokens.get(tokenOrId) : tokenOrId;
        if (!token) return false;
        const ns = this.DATA_NAMESPACE;
        await token.document.update({ [`flags.${ns}.-=activeStack`]: null, [`flags.${ns}.-=identity`]: null });
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