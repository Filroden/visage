import { VisageComposer } from "./visage-composer.js";
import { VisageData } from "./visage-data.js"; 
import { VisageUtilities } from "./visage-utilities.js";
import { VisageSequencer } from "./visage-sequencer.js"; 
import { MODULE_ID, DATA_NAMESPACE } from "./visage-constants.js";

/**
 * The core API class for the Visage module.
 * Manages the application, removal, and restoration of visual modifications (Visages) on tokens.
 * Acts as the central controller orchestrating Data, Composer, and Sequencer components.
 */
export class Visage {
    static sequencerReady = false;

    static log(message, force = false) { VisageUtilities.log(message, force); }
    static async resolvePath(path) { return VisageUtilities.resolvePath(path); }

    /**
     * Initializes the Visage API and registers necessary hooks.
     * Sets up the public API under `game.modules.get('visage').api`.
     */
    static initialize() {
        this.log("Initializing Visage API (v3)");
        
        // Expose public API methods
        game.modules.get(MODULE_ID).api = {
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

        // 1. Locate Data
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
        const changes = layer.changes || {};
        const delay = changes.delay || 0; 

        // 2. Prepare Stack Updates
        let stack = foundry.utils.deepClone(token.document.getFlag(DATA_NAMESPACE, "activeStack") || []);
        const updateFlags = {};

        if (clearStack) {
            if (Visage.sequencerReady) await VisageSequencer.revert(token);
            stack = [];
            updateFlags[`flags.${DATA_NAMESPACE}.identity`] = layer.id;
        } else if (switchIdentity) {
            const currentIdentity = token.document.getFlag(DATA_NAMESPACE, "identity");
            if (currentIdentity) {
                stack = stack.filter(l => l.id !== currentIdentity);
                if (Visage.sequencerReady) await VisageSequencer.remove(token, currentIdentity, true);
            }
            updateFlags[`flags.${DATA_NAMESPACE}.identity`] = layer.id;
        }

        // Add the new layer to the stack
        stack = stack.filter(l => l.id !== layer.id);
        if (switchIdentity) stack.unshift(layer);
        else stack.push(layer);
        
        updateFlags[`flags.${DATA_NAMESPACE}.activeStack`] = stack;

        // Calculate Effective Portrait using Composer
        const originalState = token.document.getFlag(DATA_NAMESPACE, "originalState");
        const targetPortrait = VisageComposer.resolvePortrait(
            stack, 
            originalState, 
            token.actor.img
        );

        // 3. Define Orchestration Tasks
        
        // Task A: Visual Effects (Keep existing)
        const runVisualFX = async () => {
            if (VisageUtilities.hasSequencer && changes.effects) {
                const isBase = switchIdentity || clearStack;
                await VisageSequencer.apply(token, layer, isBase);
            }
        };

        // Task B: Data Update (Simplified)
        const runDataUpdate = async () => {
            await token.document.update(updateFlags);
            await VisageComposer.compose(token);

            // Update Actor Portrait
            if (targetPortrait && token.actor) {
                if (token.actor.img !== targetPortrait) {
                    await token.actor.update({ img: targetPortrait });
                }
            }
        };

        // 4. Execute with Transition Timing
        if (delay > 0) {
            runVisualFX();
            setTimeout(runDataUpdate, delay);
        } else if (delay < 0) {
            await runDataUpdate();
            setTimeout(runVisualFX, Math.abs(delay));
        } else {
            runVisualFX();
            await runDataUpdate();
        }

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

        const currentIdentity = token.document.getFlag(DATA_NAMESPACE, "identity");

        let stack = foundry.utils.deepClone(token.document.getFlag(DATA_NAMESPACE, "activeStack") || []);
        
        const initialLength = stack.length;
        stack = stack.filter(l => l.id !== maskId);
        if (stack.length === initialLength) return false;

        // Cache Portrait Before Update
        // We grab the original state now because compose() might wipe the flags if the stack is empty.
        const originalState = token.document.getFlag(DATA_NAMESPACE, "originalState");
        const updateFlags = {};
        
        if (currentIdentity === maskId) {
            updateFlags[`flags.${DATA_NAMESPACE}.-=identity`] = null;
        }

        if (stack.length === 0) updateFlags[`flags.${DATA_NAMESPACE}.-=activeStack`] = null;
        else updateFlags[`flags.${DATA_NAMESPACE}.activeStack`] = stack;

        await token.document.update(updateFlags);
        await VisageComposer.compose(token);

        // Stop Visual Effects
        const isBase = (currentIdentity === maskId);
        if (Visage.sequencerReady) await VisageSequencer.remove(token, maskId, isBase);

        // Revert Actor Portrait using Composer
        if (token.actor) {
            const targetPortrait = VisageComposer.resolvePortrait(
                stack, 
                originalState, 
                originalState?.portrait // Fallback to original
            );
            
            if (targetPortrait && token.actor.img !== targetPortrait) {
                await token.actor.update({ img: targetPortrait });
            }
        }

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
        if (!token) return;

        // CACHE PORTRAIT BEFORE WIPE (Critical Fix)
        const flags = token.document.flags[MODULE_ID] || {};
        const originalPortrait = flags.originalState?.portrait;

        // 1. Remove all Sequencer effects
        if (Visage.sequencerReady) await VisageSequencer.revert(token);
        
        // 2. Revert Token Data (Composer wipes flags here)
        await VisageComposer.revertToDefault(token.document);

        // 3. Revert Actor Portrait (using cached value)
        if (token.actor && originalPortrait && token.actor.img !== originalPortrait) {
            await token.actor.update({ img: originalPortrait });
        }
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
        const stack = token.document.getFlag(DATA_NAMESPACE, "activeStack") || [];
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

        const flags = tokenDocument.flags[MODULE_ID] || {};
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