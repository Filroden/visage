/**
 * @file The central logic engine for layering Visage effects.
 * Responsible for calculating the final token appearance by composing
 * a "Base State" (Snapshot) with a stack of "Layers" (Masks/Visages).
 * @module visage
 */

import { VisageUtilities } from "../utils/visage-utilities.js";
import { VisageSystems } from "../integrations/visage-systems.js";
import { MODULE_ID } from "./visage-constants.js";
import { VisageDAT } from "../integrations/visage-dat.js";

/**
 * The VisageComposer class handles the mathematical composition of token data.
 * It implements a non-destructive layering system that allows multiple visual
 * effects (Visages) to be stacked on top of a token's original "True Form".
 */
export class VisageComposer {
    /**
     * Composes the final appearance of a token by layering the active stack on top of its base state.
     * @param {Token} token - The target token object (canvas placeable).
     * @param {Array<Object>|null} [stackOverride=null] - An optional stack of layers to use.
     * @param {Object|null} [baseOverride=null] - An optional base state snapshot to use.
     * @returns {Promise<void>}
     */
    static async compose(token, stackOverride = null, baseOverride = null) {
        if (!token) return;

        // 1. Retrieve Context & Base State
        const allFlags = token.document.flags[MODULE_ID] || {};
        const currentStack = stackOverride ?? (allFlags.activeStack || allFlags.stack || []);

        if (currentStack.length === 0 && !baseOverride) {
            return this.revertToDefault(token.document);
        }

        let base = baseOverride ?? allFlags.originalState;

        if (!base) {
            base = VisageUtilities.extractVisualState(token.document);

            // Explicitly snapshot PF2E linkage flags so they can be perfectly restored
            if (game.system.id === "pf2e") {
                base.flags = base.flags || {};
                base.flags.pf2e = {
                    linkToActorSize: token.document.getFlag("pf2e", "linkToActorSize"),
                    autoscale: token.document.getFlag("pf2e", "autoscale"),
                };
            }
        }

        // 2. Calculate the single composite state
        const state = this._calculateCompositeState(base, currentStack);

        // 3. Reconstruct Final Data
        const finalData = this._reconstructFinalData(state);
        VisageSystems.process(finalData, base, { scaleX: finalData.texture.scaleX, scaleY: finalData.texture.scaleY });

        // 4. Build Atomic Update Payload
        const updateData = {
            ...finalData,
            [`flags.${MODULE_ID}.activeStack`]: currentStack,
            [`flags.${MODULE_ID}.originalState`]: base,
        };

        delete updateData.effects;
        if (updateData.flags) delete updateData.flags;
        if (finalData.light) updateData.light = finalData.light;

        // Dylan's Automated Tokens compatibility
        const datPayload = VisageDAT.getUpdatePayload(token.document, state.finalData?.flags?.["dylans-animated-tokens"]);
        Object.assign(updateData, datPayload);

        // Actively calculate and enforce DAT anchors
        if (VisageDAT.isActive) {
            const datState = state.finalData?.flags?.["dylans-animated-tokens"];
            if (datState?.spritesheet && !datState?.unlockedanchor) {
                const currentScale = updateData.texture?.scaleX ?? 1;
                const anchors = await VisageDAT.getCalculatedAnchors(datState.sheetsrc, datState.sheetstyle, datState.animationframes, currentScale);

                updateData.texture = updateData.texture || {};
                updateData.texture.anchorX = anchors.anchorX;
                updateData.texture.anchorY = anchors.anchorY;
            }
        }

        // Flatten the texture object to bypass third-party module collisions
        if (updateData.texture) {
            for (const [key, val] of Object.entries(updateData.texture)) {
                updateData[`texture.${key}`] = val;
            }
            delete updateData.texture; // Remove the nested object to force flat-key updates
        }

        // 5. Execute Native Update
        await token.document.update(updateData, {
            visageUpdate: true,
            scenescape: true,
            animate: finalData.animateTransition ?? true,
        });
    }

    /**
     * Consolidates the iteration and override logic into a single mathematical pass.
     * Enforces strict separation of concerns by acting purely as a state calculator.
     * @private
     */
    static _calculateCompositeState(base, stack) {
        const state = {
            src: base.texture?.src || "",
            scaleX: Math.abs(base.texture?.scaleX ?? 1),
            scaleY: Math.abs(base.texture?.scaleY ?? 1),
            mirrorX: (base.texture?.scaleX ?? 1) < 0,
            mirrorY: (base.texture?.scaleY ?? 1) < 0,
            anchorX: base.texture?.anchorX ?? 0.5,
            anchorY: base.texture?.anchorY ?? 0.5,
            finalData: foundry.utils.deepClone(base),
        };

        if (!state.finalData.texture) {
            state.finalData.texture = {};
        }

        for (const layer of stack) {
            if (layer.disabled) continue;
            this._applyLayerChanges(state, layer.changes || {}, layer.mode);
        }

        return state;
    }

    /**
     * Helper to apply layer overrides.
     * @private
     */
    static _applyLayerChanges(state, c, mode) {
        state.src = c.texture?.src || state.src;
        state.anchorX = c.texture?.anchorX ?? state.anchorX;
        state.anchorY = c.texture?.anchorY ?? state.anchorY;
        state.scaleX = c.scale ?? state.scaleX;
        state.scaleY = c.scale ?? state.scaleY;
        state.mirrorX = c.mirrorX ?? state.mirrorX;
        state.mirrorY = c.mirrorY ?? state.mirrorY;

        // Merge properties
        Object.assign(state.finalData, {
            disposition: c.disposition ?? state.finalData.disposition,
            name: c.name || state.finalData.name,
            width: c.width ?? state.finalData.width,
            height: c.height ?? state.finalData.height,
            depth: c.depth ?? state.finalData.depth,
            alpha: c.alpha ?? state.finalData.alpha,
            lockRotation: c.lockRotation ?? state.finalData.lockRotation,
            animateTransition: c.animateTransition ?? state.finalData.animateTransition,
        });

        if (c.ring?.enabled) state.finalData.ring = c.ring;
        if (c.light?.active) state.finalData.light = c.light;

        this._applyThirdPartyFlags(state, c.flags?.["dylans-animated-tokens"], mode);
    }

    static _applyThirdPartyFlags(state, datFlag, mode) {
        if (!datFlag) {
            if (mode === "identity") delete state.finalData.flags["dylans-animated-tokens"];
            return;
        }

        state.finalData.flags["dylans-animated-tokens"] = datFlag;
    }

    /**
     * Re-bakes the atomic properties into the standard Foundry data structure.
     * @private
     */
    static _reconstructFinalData(state) {
        const data = state.finalData;
        data.texture.src = state.src;
        data.texture.scaleX = state.scaleX * (state.mirrorX ? -1 : 1);
        data.texture.scaleY = state.scaleY * (state.mirrorY ? -1 : 1);

        // Invert the physical anchor if the texture is mirrored so it remains inside the bounding box
        data.texture.anchorX = state.mirrorX ? 1 - (state.anchorX ?? 0.5) : (state.anchorX ?? 0.5);
        data.texture.anchorY = state.mirrorY ? 1 - (state.anchorY ?? 0.5) : (state.anchorY ?? 0.5);

        return data;
    }

    /**
     * Calculates the final texture orientation, scale, and anchor state.
     */
    static resolveTextureState(stack, originalState) {
        const state = this._calculateCompositeState(originalState || {}, stack);

        return {
            anchorX: state.anchorX,
            anchorY: state.anchorY,
            scaleX: state.scaleX,
            scaleY: state.scaleY,
            mirrorX: state.mirrorX,
            mirrorY: state.mirrorY,
        };
    }

    /**
     * Public API to revert a token to its clean, original state.
     * Removes all Visage effects, clears the stack, and restores the original visual data.
     * @param {TokenDocument} tokenDoc - The token document to revert.
     * @returns {Promise<TokenDocument>} The updated document.
     */
    static async revertToDefault(tokenDoc) {
        if (!tokenDoc) return;
        const flags = tokenDoc.flags[MODULE_ID] || {};
        return this._revert(tokenDoc, flags);
    }

    /**
     * Internal implementation of the revert logic.
     * Distinguishes between tokens that have a "clean snapshot" and those that don't.
     * @private
     * @param {TokenDocument} tokenDoc - The token document.
     * @param {Object} flags - The current flags on the document.
     */
    static async _revert(tokenDoc, flags) {
        // Scenario A: No snapshot exists (e.g. data cleaned manually or never initialised).
        // We just remove the flags to ensure the token is marked as "clean".
        if (!flags.originalState) {
            const clearFlags = {
                [`flags.${MODULE_ID}.activeStack`]: new foundry.data.operators.ForcedDeletion(),
                [`flags.${MODULE_ID}.originalState`]: new foundry.data.operators.ForcedDeletion(),
                [`flags.${MODULE_ID}.identity`]: new foundry.data.operators.ForcedDeletion(),
            };
            return tokenDoc.update(clearFlags, { visageUpdate: true, animate: true });
        }

        // Scenario B: Snapshot exists.
        // Restore the original visual data from the snapshot AND wipe the flags in a single update.
        const original = flags.originalState;

        const updateData = {
            ...original,
            [`flags.${MODULE_ID}.activeStack`]: new foundry.data.operators.ForcedDeletion(),
            [`flags.${MODULE_ID}.stack`]: new foundry.data.operators.ForcedDeletion(), // Clean legacy key from V1
            [`flags.${MODULE_ID}.originalState`]: new foundry.data.operators.ForcedDeletion(),
            [`flags.${MODULE_ID}.identity`]: new foundry.data.operators.ForcedDeletion(),
        };

        // Enforce System Integrity
        const context = {
            scaleX: original.texture?.scaleX ?? 1,
            scaleY: original.texture?.scaleY ?? 1,
        };

        // Dylan's Automated Tokens compatibility
        const datRestore = VisageDAT.getRestorePayload(original);
        Object.assign(updateData, datRestore);
        delete updateData.flags; // Clean up our temporary data transfer object

        VisageSystems.process(updateData, original, context);

        // Flatten the texture object to bypass third-party module collisions
        if (updateData.texture) {
            for (const [key, val] of Object.entries(updateData.texture)) {
                updateData[`texture.${key}`] = val;
            }
            delete updateData.texture; // Remove the nested object to force flat-key updates
        }

        // Execute Native Update
        await tokenDoc.update(updateData, {
            visageUpdate: true,
            scenescape: true, // Acts as a universal passport for Mass Edit compatibility
            animate: original.animateTransition ?? true,
        });
    }

    /**
     * Calculates the "Effective Portrait" based on the current stack priority.
     * Iterates from the top of the stack (Overlays) down to the bottom (Identity).
     * @param {Array<Object>} stack - The active Visage stack.
     * @param {Object} [originalState] - The snapshot of the token/actor before Visage was applied.
     * @param {string} [currentActorImage] - The current Actor image (used as a fallback if no original state exists).
     * @returns {string|null} The resolved image path to display on the Actor sheet.
     */
    static resolvePortrait(stack, originalState, currentActorImage) {
        // 1. Search Stack from Top to Bottom
        // The first layer (highest priority) with a portrait defined "wins".
        for (let i = stack.length - 1; i >= 0; i--) {
            if (stack[i].changes?.portrait) {
                return stack[i].changes.portrait;
            }
        }

        // 2. Fallback to Original State (if we are reverting to base)
        if (originalState?.portrait) {
            return originalState.portrait;
        }

        // 3. Fallback to Current Image (Safety catch for first-time application)
        return currentActorImage;
    }

    /**
     * Resolves the token's logical grid dimensions based on the active stack.
     * Iterates from the top of the stack (Overlays) down to the bottom (Identity).
     * @param {Array<Object>} stack - The active Visage stack.
     * @param {Object} [originalState] - The snapshot of the token before Visage was applied.
     * @returns {Object} The resolved { width, height } of the token.
     */
    static resolveScale(stack, originalState) {
        let width = null;
        let height = null;

        // Search top-down for the highest priority layer that overrides dimensions
        for (let i = stack.length - 1; i >= 0; i--) {
            if (stack[i].disabled) continue;

            if (width === null && stack[i].changes?.width != null) width = stack[i].changes.width;
            if (height === null && stack[i].changes?.height != null) height = stack[i].changes.height;

            // Break early if both dimensions are found
            if (width !== null && height !== null) break;
        }

        // Fallback to original state, or default to 1x1
        return {
            width: width ?? originalState?.width ?? 1,
            height: height ?? originalState?.height ?? 1,
        };
    }

    /**
     * Analyzes the active stack and returns an array of property paths
     * that are currently being actively overridden by Visage layers.
     * @param {Array<Object>} stack - The active Visage stack.
     * @returns {Array<string>} List of flattened property keys.
     */
    static getOverriddenKeys(stack) {
        const keys = new Set();
        for (const layer of stack) {
            if (layer.disabled) continue;
            const c = layer.changes || {};

            if (c.texture?.src != null) keys.add("texture.src");
            if (c.texture?.anchorX != null) keys.add("texture.anchorX");
            if (c.texture?.anchorY != null) keys.add("texture.anchorY");

            // If scale is explicitly controlled, claim the axis properties
            if (c.scale != null) {
                keys.add("texture.scaleX");
                keys.add("texture.scaleY");
            }
            if (c.mirrorX != null) keys.add("texture.scaleX");
            if (c.mirrorY != null) keys.add("texture.scaleY");

            if (c.disposition != null) keys.add("disposition");
            if (c.name != null) keys.add("name");
            if (c.width != null) keys.add("width");
            if (c.height != null) keys.add("height");
            if (c.depth != null) keys.add("depth");
            if (c.alpha != null) keys.add("alpha");
            if (c.lockRotation != null) keys.add("lockRotation");
            if (c.ring?.enabled) keys.add("ring");
            if (c.light?.active) keys.add("light");
        }
        return Array.from(keys);
    }
}
