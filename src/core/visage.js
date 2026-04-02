import { VisageComposer } from "./visage-composer.js";
import { VisageData } from "../data/visage-data.js";
import { VisageUtilities } from "../utils/visage-utilities.js";
import { VisageSequencer } from "../integrations/visage-sequencer.js";
import { VisageTokenMagic } from "../integrations/visage-tmfx.js";
import { MODULE_ID, DATA_NAMESPACE } from "./visage-constants.js";
import { VisageMassEdit } from "../integrations/visage-mass-edit.js";

/**
 * The core API class for the Visage module.
 * Manages the application, removal, and restoration of visual modifications (Visages) on tokens.
 * Acts as the central controller orchestrating Data, Composer, and Sequencer components.
 */
export class Visage {
    static sequencerReady = false;

    static log(message, force = false) {
        VisageUtilities.log(message, force);
    }
    static async resolvePath(path) {
        return VisageUtilities.resolvePath(path);
    }

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
            resolvePath: VisageUtilities.resolvePath.bind(VisageUtilities),
            toggleLayer: this.toggleLayer.bind(this),
            reorderStack: this.reorderStack.bind(this),
            restoreMassEdit: VisageMassEdit.forceRestore.bind(VisageMassEdit),
        };

        // 1. Sequencer-Specific Initialisation
        Hooks.once("sequencer.ready", () => {
            Visage.sequencerReady = true;
            // If the scene is already fully drawn, restore immediately
            if (canvas.ready) Visage._restoreAll();
        });

        // 2. Core Scene Synchronisation
        Hooks.on("canvasReady", () => {
            // Only restore if Sequencer has finished its own boot process
            if (Visage.sequencerReady) {
                Visage._restoreAll();
            }
        });

        // 3. Token Generation
        Hooks.on("createToken", (tokenDoc, options, userId) => {
            if (game.user.id !== userId) return;

            // Safely check both the physical object and the dependency natively
            if (Visage.sequencerReady && tokenDoc.object) {
                VisageSequencer.restore(tokenDoc.object);
            }
        });

        // Cleanup audio when a token is physically deleted from the canvas
        Hooks.on("deleteToken", (tokenDoc) => {
            if (Visage.sequencerReady) VisageSequencer.revert(tokenDoc.id);
        });

        // Terminate all audio gracefully when the scene unloads
        Hooks.on("canvasTearDown", () => {
            if (Visage.sequencerReady) VisageSequencer.stopAllAudio();
        });
    }

    /**
     * Internal method to restore visual states for all tokens on the canvas.
     * Called on canvas load to re-apply Sequencer effects stored in flags.
     * @private
     */
    static _restoreAll() {
        if (!Visage.sequencerReady && !game.modules.get("sequencer")?.active) return;
        canvas.tokens.placeables.forEach((token) => VisageSequencer.restore(token));
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
        const token = typeof tokenOrId === "string" ? canvas.tokens.get(tokenOrId) : tokenOrId;
        if (!token) return false;

        // 1. Locate Data
        let data = VisageData.getLocal(token.actor).find((v) => v.id === maskId);
        let source = "local";
        if (!data) {
            data = VisageData.getGlobal(maskId);
            source = "global";
        }
        if (!data) return false;

        // Prevent players from applying Global Visages that are not Public
        if (source === "global" && !game.user.isGM && !data.public) {
            console.warn(`Visage | User ${game.user.name} attempted to apply private Global Visage ${maskId}`);
            return false;
        }

        const mode = data.mode || (source === "local" ? "identity" : "overlay");
        const switchIdentity = options.switchIdentity ?? mode === "identity";
        const clearStack = options.clearStack ?? false;

        const layer = await VisageData.toLayer(data, source);
        const changes = layer.changes || {};

        // 2. Prepare Stack Updates
        const currentStack = token.document.getFlag(DATA_NAMESPACE, "activeStack") || [];
        let stack = foundry.utils.deepClone(currentStack);
        const updateFlags = {};

        // --- Calculate the Matrix Diff ---
        if (clearStack) {
            if (Visage.sequencerReady) await VisageSequencer.revert(token);
            if (VisageTokenMagic.isActive) await VisageTokenMagic.revert(token); // FIX 1: Wipe all TMFX on clearStack

            stack = [];
            updateFlags[`flags.${DATA_NAMESPACE}.identity`] = layer.id;
        } else if (switchIdentity) {
            const currentIdentity = token.document.getFlag(DATA_NAMESPACE, "identity");
            if (currentIdentity) {
                const oldIdentityLayer = stack.find((l) => l.id === currentIdentity); // Capture the old layer data

                stack = stack.filter((l) => l.id !== currentIdentity);
                if (Visage.sequencerReady) await VisageSequencer.remove(token, currentIdentity, true);
                if (VisageTokenMagic.isActive && oldIdentityLayer) await VisageTokenMagic.removeLayer(token, oldIdentityLayer);
            }
            updateFlags[`flags.${DATA_NAMESPACE}.identity`] = layer.id;
        }

        // If we are actively overwriting an existing Visage with the same ID, wipe its old TMFX state first
        const overwrittenLayer = stack.find((l) => l.id === layer.id);
        if (overwrittenLayer && VisageTokenMagic.isActive) {
            await VisageTokenMagic.removeLayer(token, overwrittenLayer);
        }

        stack = stack.filter((l) => l.id !== layer.id);
        if (switchIdentity) stack.unshift(layer);
        else stack.push(layer);

        updateFlags[`flags.${DATA_NAMESPACE}.activeStack`] = stack;

        // Call the single source of truth
        const { originalState, anticipatedState, matrixChanged } = this._evaluateMatrixDiff(token.document, currentStack, stack);

        const targetPortrait = VisageComposer.resolvePortrait(stack, originalState, token.actor.img);

        // 3. Define Orchestration Tasks

        // Task A: Visual Effects
        const runVisualFX = async () => {
            if (!VisageUtilities.hasSequencer) return;

            // Seamlessly realign existing layers if the token physically shifted
            if (matrixChanged) {
                for (const activeLayer of stack) {
                    if (activeLayer.id === layer.id) continue;
                    VisageSequencer.refreshMatrix(token, activeLayer.id, anticipatedState);
                }
            }

            // --- Always call apply, even if there are no new effects. ---
            // VisageSequencer.apply handles tearing down the old base layer internally
            // before returning early if the new layer is empty.
            const isBase = switchIdentity || clearStack;
            await VisageSequencer.apply(token, layer, isBase, false, anticipatedState);
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

        // Task C: Macro Execution
        const runMacros = (offsetMS, activeFX) => {
            const macros = activeFX.filter((e) => e.type === "macro" && e.uuid);

            for (const macroEffect of macros) {
                // Calculate true start time relative to the Zero Anchor
                const trueDelayMS = (macroEffect.delay || 0) * 1000 + offsetMS;

                setTimeout(async () => {
                    try {
                        const macroObj = await fromUuid(macroEffect.uuid);
                        if (macroObj) {
                            macroObj.execute({
                                actor: token.actor,
                                token: token.document,
                                visage: data,
                                action: "apply",
                            });
                        } else {
                            ui.notifications.warn(
                                game.i18n.format("VISAGE.Notifications.MacroNotFound", {
                                    uuid: macroEffect.uuid,
                                }),
                            );
                        }
                    } catch (err) {
                        console.error("Visage | Macro Execution Error:", err);
                    }
                }, trueDelayMS);
            }
        };

        // Task D: Token Magic FX
        const runTMFX = (offsetMS, activeFX) => {
            if (!VisageTokenMagic.isActive) return;

            const tmfxEffects = activeFX.filter((e) => e.type === "tmfx" && (e.tmfxPreset || e.tmfxPayload));

            for (const effect of tmfxEffects) {
                const trueDelayMS = (effect.delay || 0) * 1000 + offsetMS;
                setTimeout(() => {
                    // Note: 'token' here is the Placeable Object (canvas.tokens.get), which TMFX requires
                    VisageTokenMagic.applyEffect(token, layer.id, effect);
                }, trueDelayMS);
            }
        };

        // 4. Execute with Transition Timing

        // Calculate the Token Swap Offset (Zero Anchor) based on the most negative effect delay
        const activeEffects = (changes.visageEffects || []).filter((e) => !e.disabled);
        const minDelaySeconds = activeEffects.length ? Math.min(0, ...activeEffects.map((e) => e.delay || 0)) : 0;
        const offsetMS = Math.abs(minDelaySeconds) * 1000;

        // Visual and Audio effects natively handle their own start times (including positive delays)
        // inside VisageSequencer, so we always fire them immediately.
        runVisualFX();

        // Macros and filters calculate their own relative start times against the anchor
        runMacros(offsetMS, activeEffects);
        runTMFX(offsetMS, activeEffects);

        // Delay the actual token image/data swap if we have negative delays (pre-effects)
        if (offsetMS > 0) {
            setTimeout(async () => {
                await runDataUpdate();
                Hooks.callAll("visageApplied", token, data);
            }, offsetMS);
        } else {
            await runDataUpdate();
            Hooks.callAll("visageApplied", token, data);
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
        const token = typeof tokenOrId === "string" ? canvas.tokens.get(tokenOrId) : tokenOrId;
        if (!token) return false;

        const currentIdentity = token.document.getFlag(DATA_NAMESPACE, "identity");
        const currentStack = token.document.getFlag(DATA_NAMESPACE, "activeStack") || [];

        let stack = foundry.utils.deepClone(currentStack);
        const initialLength = stack.length;
        stack = stack.filter((l) => l.id !== maskId);
        if (stack.length === initialLength) return false;

        // Call the single source of truth
        const { originalState, anticipatedState, matrixChanged } = this._evaluateMatrixDiff(token.document, currentStack, stack);

        const updateFlags = {};

        // Use V14 explicit deletion operators for atomic batch updates (Instantiate with 'new')
        if (currentIdentity === maskId) {
            updateFlags[`flags.${DATA_NAMESPACE}.identity`] = new foundry.data.operators.ForcedDeletion();
        }

        if (stack.length === 0) {
            updateFlags[`flags.${DATA_NAMESPACE}.activeStack`] = new foundry.data.operators.ForcedDeletion();
        } else {
            updateFlags[`flags.${DATA_NAMESPACE}.activeStack`] = stack;
        }

        await token.document.update(updateFlags);
        await VisageComposer.compose(token);

        // Stop Visual Effects
        const isBase = currentIdentity === maskId;
        if (Visage.sequencerReady) {
            await VisageSequencer.remove(token, maskId, isBase);

            // --- Re-align survivors ---
            if (matrixChanged && stack.length > 0) {
                for (const activeLayer of stack) {
                    VisageSequencer.refreshMatrix(token, activeLayer.id, anticipatedState);
                }
            }
        }

        // Stop Token Magic FX
        if (VisageTokenMagic.isActive) {
            const removedLayer = currentStack.find((l) => l.id === maskId);
            if (removedLayer) await VisageTokenMagic.removeLayer(token, removedLayer);
        }

        if (token.actor) {
            const targetPortrait = VisageComposer.resolvePortrait(stack, originalState, originalState?.portrait);
            if (targetPortrait && token.actor.img !== targetPortrait) {
                await token.actor.update({ img: targetPortrait });
            }
        }

        Hooks.callAll("visageRemoved", token, maskId);
        return true;
    }

    /**
     * Reverts a token to its original, default state.
     * Removes all active Visage stacks and visual effects.
     * * @param {Token|string} tokenOrId - The target Token object or its ID.
     * @returns {Promise<boolean>} True if successful.
     */
    static async revert(tokenOrId) {
        const token = typeof tokenOrId === "string" ? canvas.tokens.get(tokenOrId) : tokenOrId;
        if (!token) return;

        // CACHE PORTRAIT BEFORE WIPE (Critical Fix)
        const flags = token.document.flags[MODULE_ID] || {};
        const originalPortrait = flags.originalState?.portrait;

        // Remove all Sequencer effects
        if (Visage.sequencerReady) await VisageSequencer.revert(token);

        // Remove all Visage-owned TMFX filters
        if (VisageTokenMagic.isActive) await VisageTokenMagic.revert(token);

        // Revert Token Data (Composer wipes flags here)
        await VisageComposer.revertToDefault(token.document);

        // Revert Actor Portrait (using cached value)
        if (token.actor && originalPortrait && token.actor.img !== originalPortrait) {
            await token.actor.update({ img: originalPortrait });
        }

        Hooks.callAll("visageReverted", token);
    }

    /**
     * Checks if a specific mask is currently active on a token.
     * * @param {Token|string} tokenOrId - The target Token object or its ID.
     * @param {string} maskId - The ID of the mask to check.
     * @returns {boolean} True if the mask is in the active stack.
     */
    static isActive(tokenOrId, maskId) {
        const token = typeof tokenOrId === "string" ? canvas.tokens.get(tokenOrId) : tokenOrId;
        if (!token) return false;
        const stack = token.document.getFlag(DATA_NAMESPACE, "activeStack") || [];
        return stack.some((l) => l.id === maskId);
    }

    /**
     * Retrieves all available Visage options for a specific token.
     * Combines Actor-specific (local) and World-level (global) options.
     * * @param {Token|string} tokenOrId - The target Token object or its ID.
     * @returns {Array<Object>} An array of available Visage data objects.
     */
    static getAvailable(tokenOrId) {
        const token = typeof tokenOrId === "string" ? canvas.tokens.get(tokenOrId) : tokenOrId;
        const actor = token?.actor;
        if (!actor) return [];

        const local = VisageData.getLocal(actor).map((v) => ({
            ...v,
            type: "local",
        }));

        let globals = VisageData.globals.map((v) => ({ ...v, type: "global" }));
        if (!game.user.isGM) {
            globals = globals.filter((v) => v.public === true);
        }

        return [...local, ...globals];
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
        const relevantKeys = ["name", "displayName", "disposition", "width", "height", "depth", "texture", "ring", "texture.anchorX", "texture.anchorY"];
        const flatChange = foundry.utils.flattenObject(change);

        // Ignore visibility toggles (handled by core)
        if ("hidden" in flatChange) return;

        const isRelevant = Object.keys(flatChange).some((key) => relevantKeys.some((rk) => key === rk || key.startsWith(rk + ".")));

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
            const dirtyBase = foundry.utils.mergeObject(base, expandedChange, {
                insertKeys: true,
                inplace: false,
            });

            // Sanitize and re-compose the token to maintain the illusion over the new base
            const cleanBase = VisageUtilities.extractVisualState(dirtyBase);
            await VisageComposer.compose(tokenDocument.object, null, cleanBase);
        }
    }

    // [Add these methods to the Visage class]

    /**
     * Toggles the visibility of a specific layer in the stack.
     * This triggers a "Loud Update" (plays effects if turning ON).
     * @param {Token|string} tokenOrId
     * @param {string} layerId
     */
    static async toggleLayer(tokenOrId, layerId) {
        const token = typeof tokenOrId === "string" ? canvas.tokens.get(tokenOrId) : tokenOrId;
        if (!token) return;

        const currentStack = token.document.getFlag(DATA_NAMESPACE, "activeStack") || [];
        const stack = foundry.utils.deepClone(currentStack);
        const layer = stack.find((l) => l.id === layerId);
        if (!layer) return;

        layer.disabled = !layer.disabled;
        const isVisible = !layer.disabled;

        // Call the single source of truth
        const { anticipatedState, matrixChanged } = this._evaluateMatrixDiff(token.document, currentStack, stack);

        await token.document.update({ [`flags.${DATA_NAMESPACE}.activeStack`]: stack });
        await VisageComposer.compose(token);

        // 1. Handle Sequencer Animations
        if (Visage.sequencerReady) {
            if (matrixChanged) {
                for (const activeLayer of stack) {
                    if (activeLayer.id === layerId) {
                        // If this is the layer being toggled ON, it needs a full apply
                        if (isVisible) await VisageSequencer.apply(token, activeLayer, false, false, anticipatedState);
                    } else {
                        // All other surviving layers just get a matrix refresh
                        VisageSequencer.refreshMatrix(token, activeLayer.id, anticipatedState);
                    }
                }
                // If this is the layer being toggled OFF, remove it
                if (!isVisible) await VisageSequencer.remove(token, layerId, false);
            } else {
                // Standard behavior if the physical matrix didn't change
                if (isVisible) await VisageSequencer.apply(token, layer, false, false, anticipatedState);
                else await VisageSequencer.remove(token, layerId, false);
            }
        }

        // 2. Handle Token Magic FX Filters
        if (VisageTokenMagic.isActive) {
            if (isVisible) await VisageTokenMagic.applyLayer(token, layer);
            else await VisageTokenMagic.removeLayer(token, layer);
        }
    }

    /**
     * Reorders the active stack based on a list of IDs.
     * This triggers a "Silent Update" (updates data/Z-index, skips One-Shots).
     * @param {Token|string} tokenOrId
     * @param {Array<string>} newOrderIds - Array of Layer IDs in the desired order (Bottom to Top).
     */
    static async reorderStack(tokenOrId, newOrderIds) {
        const token = typeof tokenOrId === "string" ? canvas.tokens.get(tokenOrId) : tokenOrId;
        if (!token) return;

        const currentStack = token.document.getFlag(DATA_NAMESPACE, "activeStack") || [];

        // Sort the stack to match the new ID order
        // Layers not in newOrderIds (shouldn't happen) are moved to the bottom
        const newStack = currentStack.sort((a, b) => {
            const indexA = newOrderIds.indexOf(a.id);
            const indexB = newOrderIds.indexOf(b.id);
            return (indexA === -1 ? 0 : indexA) - (indexB === -1 ? 0 : indexB);
        });

        // 1. Update Data
        await token.document.update({
            [`flags.${DATA_NAMESPACE}.activeStack`]: newStack,
        });

        // 2. Update Composer (Recalculate Stacking Rules)
        await VisageComposer.compose(token);

        // 3. Update Sequencer (Z-Index Only)
        // We do NOT call apply() here to avoid replaying explosions.
        // Assuming VisageSequencer has a method to just refresh Z-sorting.
        // If not, this is where you'd implement a 'softRefresh' method.
        if (Visage.sequencerReady && VisageSequencer.updateStackOrder) {
            await VisageSequencer.updateStackOrder(token);
        }
    }

    /**
     * Evaluates the visual matrix difference between the current stack and the anticipated stack.
     * Centralises the logic for detecting scale, anchor, and mirror changes.
     * @param {TokenDocument} tokenDocument - The document of the target token.
     * @param {Array<Object>} currentStack - The stack currently active on the token.
     * @param {Array<Object>} newStack - The anticipated stack after changes are applied.
     * @returns {Object} { originalState, anticipatedState, matrixChanged }
     * @private
     */
    static _evaluateMatrixDiff(tokenDocument, currentStack, newStack) {
        let originalState = tokenDocument.getFlag(DATA_NAMESPACE, "originalState");

        // Safely extract the original state if it doesn't exist yet
        if (!originalState && newStack.length > 0) {
            originalState = VisageUtilities.extractVisualState(tokenDocument);
        }

        const currentState = VisageComposer.resolveTextureState(currentStack, originalState);
        const anticipatedState = VisageComposer.resolveTextureState(newStack, originalState);

        const matrixChanged =
            currentState.anchorX !== anticipatedState.anchorX ||
            currentState.anchorY !== anticipatedState.anchorY ||
            currentState.mirrorX !== anticipatedState.mirrorX ||
            currentState.mirrorY !== anticipatedState.mirrorY ||
            currentState.scaleX !== anticipatedState.scaleX ||
            currentState.scaleY !== anticipatedState.scaleY;

        return { originalState, anticipatedState, matrixChanged };
    }
}
