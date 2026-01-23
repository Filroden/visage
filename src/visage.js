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
    /**
     * The module ID used for scoping settings and flags.
     * @type {string}
     */
    static MODULE_ID = "visage";

    /**
     * The namespace used for document flags.
     * @type {string}
     */
    static DATA_NAMESPACE = "visage";

    /**
     * Tracks whether the Sequencer module (dependency) is fully ready.
     * @type {boolean}
     */
    static sequencerReady = false;

    /**
     * Logs a message to the console with the module prefix.
     * @param {string} message - The message to log.
     * @param {boolean} [force=false] - If true, logs even if debug mode is off.
     */
    static log(message, force = false) { VisageUtilities.log(message, force); }

    /**
     * Resolves a file path, handling wildcards or relative paths via Utilities.
     * @param {string} path - The file path to resolve.
     * @returns {Promise<string>} The resolved path.
     */
    static async resolvePath(path) { return VisageUtilities.resolvePath(path); }

    /**
     * Initializes the Visage API and registers necessary hooks.
     * Sets up the public API under `game.modules.get('visage').api`.
     */
    static initialize() {
        this.log("Initializing Visage API (v3)");
        
        // Expose public API methods
        game.modules.get(this.MODULE_ID).api = {
            apply: this.apply.bind(this),
            remove: this.remove.bind(this),
            revert: this.revert.bind(this),
            getAvailable: this.getAvailable.bind(this),
            isActive: this.isActive.bind(this),
            resolvePath: VisageUtilities.resolvePath.bind(VisageUtilities)
        };

        // Hook into Sequencer to ensure effects are restored when the scene loads
        Hooks.once("sequencer.ready", () => {
            Visage.sequencerReady = true;
            if (canvas.ready) Visage._restoreAll();
        });

        // Restore effects when the canvas (scene) becomes ready
        Hooks.on("canvasReady", () => {
            if (Visage.sequencerReady) setTimeout(() => Visage._restoreAll(), 100);
        });

        // Restore effects on newly created tokens (e.g., drag-and-drop)
        Hooks.on("createToken", (tokenDoc) => {
            if (tokenDoc.object && Visage.sequencerReady) {
                setTimeout(() => VisageSequencer.restore(tokenDoc.object), 250);
            }
        });

        // Clean up effects when a token is deleted
        Hooks.on("deleteToken", (tokenDoc) => {
            if (tokenDoc.object) VisageSequencer.revert(tokenDoc.object);
        });
    }

    /**
     * Internal method to restore visual states for all tokens on the canvas.
     * Called on canvas load to re-apply Sequencer effects stored in flags.
     * @private
     */
    static _restoreAll() {
        if (!Visage.sequencerReady && !game.modules.get("sequencer")?.active) return;
        canvas.tokens.placeables.forEach(token => VisageSequencer.restore(token));
    }

    /**
     * Applies a Visage (mask) to a token.
     * Handles both "Identity" swaps (changing the base token appearance) and "Overlay" additions.
     * * @param {Token|string} tokenOrId - The target Token object or its ID.
     * @param {string} maskId - The ID of the Visage data to apply.
     * @param {Object} [options={}] - Application options.
     * @param {boolean} [options.switchIdentity] - Force this mask to act as the base Identity.
     * @param {boolean} [options.clearStack] - If true, removes all other active masks before applying.
     * @returns {Promise<boolean>} True if application was successful, false otherwise.
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
        // If 'mode' is undefined, infer it: Local data implies Identity, Global implies Overlay.
        const mode = data.mode || (source === "local" ? "identity" : "overlay");
        
        // Prioritize explicit options, otherwise fallback to mode behavior
        const switchIdentity = options.switchIdentity ?? (mode === "identity");
        const clearStack = options.clearStack ?? false;

        // 3. Prepare Layer Data
        // Convert raw data into a runtime Layer object, stamping it with source info.
        const layer = await VisageData.toLayer(data, source);

        // 4. Update the Token Stack
        const ns = this.DATA_NAMESPACE;
        let stack = foundry.utils.deepClone(token.document.getFlag(ns, "activeStack") || []);
        const updateFlags = {};

        // 4a. Handle cleanup of existing Identity effects if we are switching or clearing
        if (clearStack || switchIdentity) {
            if (clearStack) await VisageSequencer.revert(token);
        }

        if (clearStack) {
            // Reset stack completely
            stack = [];
            updateFlags[`flags.${ns}.identity`] = layer.id;
        } else if (switchIdentity) {
            // Locate and remove the previous identity to prevent conflicts
            const currentIdentity = token.document.getFlag(ns, "identity");
            if (currentIdentity) {
                stack = stack.filter(l => l.id !== currentIdentity);
                
                // Explicitly stop the old identity's Sequencer effect.
                // The 'true' flag indicates this was a Base/Identity effect.
                await VisageSequencer.remove(token, currentIdentity, true);
            }
            updateFlags[`flags.${ns}.identity`] = layer.id;
        }

        // 4b. Add new layer to stack (ensure no ID duplicates)
        stack = stack.filter(l => l.id !== layer.id);
        
        if (switchIdentity) {
            stack.unshift(layer); // Identity sits at the bottom of the stack
        } else {
            stack.push(layer); // Overlays sit on top
        }
        
        updateFlags[`flags.${ns}.activeStack`] = stack;

        // 5. Commit Updates & Trigger Visuals
        await token.document.update(updateFlags);
        
        // Re-compose static token properties (Name, HUD, etc.)
        await VisageComposer.compose(token);

        // Apply dynamic visual effects via Sequencer
        const isBase = switchIdentity || clearStack;
        await VisageSequencer.apply(token, layer, isBase);

        return true;
    }

    /**
     * Removes a specific Visage mask from a token.
     * * @param {Token|string} tokenOrId - The target Token object or its ID.
     * @param {string} maskId - The ID of the mask to remove.
     * @returns {Promise<boolean>} True if removed successfully, false if not found.
     */
    static async remove(tokenOrId, maskId) {
        const token = (typeof tokenOrId === "string") ? canvas.tokens.get(tokenOrId) : tokenOrId;
        if (!token) return false;

        const ns = this.DATA_NAMESPACE;
        let stack = foundry.utils.deepClone(token.document.getFlag(ns, "activeStack") || []);
        
        const initialLength = stack.length;
        stack = stack.filter(l => l.id !== maskId);

        // If length hasn't changed, the mask wasn't active
        if (stack.length === initialLength) return false; 

        const updateFlags = {};
        const currentIdentity = token.document.getFlag(ns, "identity");
        
        // If we are removing the current Identity, clear the flag reference
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

        // Stop the visual effect
        const isBase = (currentIdentity === maskId);
        await VisageSequencer.remove(token, maskId, isBase);

        return true;
    }

    /**
     * Reverts a token to its original, default state.
     * Removes all active Visage stacks and visual effects.
     * * @param {Token|string} tokenOrId - The target Token object or its ID.
     * @returns {Promise<boolean>} True if successful.
     */
    static async revert(tokenOrId) {
        const token = (typeof tokenOrId === "string") ? canvas.tokens.get(tokenOrId) : tokenOrId;
        if (!token) return false;
        
        const ns = this.DATA_NAMESPACE;
        
        // Clear all relevant flags
        await token.document.update({ 
            [`flags.${ns}.-=activeStack`]: null, 
            [`flags.${ns}.-=identity`]: null 
        });
        
        // Restore default static properties (Name, Texture path, etc.)
        await VisageComposer.revertToDefault(token.document);
        
        // Kill all Sequencer effects associated with this token
        await VisageSequencer.revert(token);
        return true;
    }

    /**
     * Checks if a specific mask is currently active on a token.
     * * @param {Token|string} tokenOrId - The target Token object or its ID.
     * @param {string} maskId - The ID of the mask to check.
     * @returns {boolean} True if the mask is in the active stack.
     */
    static isActive(tokenOrId, maskId) {
        const token = (typeof tokenOrId === "string") ? canvas.tokens.get(tokenOrId) : tokenOrId;
        if (!token) return false;
        const stack = token.document.getFlag(this.DATA_NAMESPACE, "activeStack") || [];
        return stack.some(l => l.id === maskId);
    }

    /**
     * Retrieves all available Visage options for a specific token.
     * Combines Actor-specific (local) and World-level (global) options.
     * * @param {Token|string} tokenOrId - The target Token object or its ID.
     * @returns {Array<Object>} An array of available Visage data objects.
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
     * Monitors standard Token updates to maintain Visage persistence.
     * * This function intercepts core Foundry updates (e.g., changing token size or name manually).
     * If a Visage stack is active, it updates the "Base" state (what lies beneath the mask)
     * without breaking the currently active illusion, effectively allowing "Ghost Editing."
     * * @param {TokenDocument} tokenDocument - The document being updated.
     * @param {Object} change - The changes being applied.
     * @param {Object} options - Update options.
     * @param {string} userId - The ID of the user performing the update.
     */
    static async handleTokenUpdate(tokenDocument, change, options, userId) {
        // Ignore updates triggered by Visage itself to prevent infinite loops
        if (options.visageUpdate) return;
        
        if (game.user.id !== userId) return;
        if (!tokenDocument.object) return;

        // Define properties that Visage overrides
        const relevantKeys = ["name", "displayName", "disposition", "width", "height", "texture", "ring"];
        const flatChange = foundry.utils.flattenObject(change);
        
        // Ignore visibility toggles (handled by core)
        if ("hidden" in flatChange) return;
        
        const isRelevant = Object.keys(flatChange).some(key => 
            relevantKeys.some(rk => key === rk || key.startsWith(rk + "."))
        );

        if (!isRelevant) return;

        const flags = tokenDocument.flags[this.MODULE_ID] || {};
        const stack = flags.activeStack || flags.stack || [];

        // If Visage is active, capture the change into the "Original State" instead of the visual surface
        if (stack.length > 0) {
            let base = flags.originalState;
            
            // If original state is missing, snapshot current state before modification
            if (!base) base = VisageUtilities.extractVisualState(tokenDocument);
            
            const expandedChange = foundry.utils.expandObject(change);
            
            // Merge the manual changes into the underlying base state
            const dirtyBase = foundry.utils.mergeObject(base, expandedChange, { insertKeys: true, inplace: false });
            
            // Sanitize and re-compose the token to maintain the illusion over the new base
            const cleanBase = VisageUtilities.extractVisualState(dirtyBase);
            await VisageComposer.compose(tokenDocument.object, null, cleanBase);
        }
    }
}