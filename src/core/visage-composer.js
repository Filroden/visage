/**
 * @file The central logic engine for layering Visage effects.
 * Responsible for calculating the final token appearance by composing
 * a "Base State" (Snapshot) with a stack of "Layers" (Masks/Visages).
 * @module visage
 */

import { VisageUtilities } from "../utils/visage-utilities.js";
import { VisageSystems } from "../integrations/visage-systems.js";
import { MODULE_ID } from "./visage-constants.js";

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

        const base = baseOverride ?? allFlags.originalState ?? VisageUtilities.extractVisualState(token.document);

        // 2. Initialise State & Iterate Layers
        const state = this._initializeCompositionState(base);
        for (const layer of currentStack) {
            this._applyLayerOverrides(state, layer);
        }

        // 3. Reconstruct Final Data
        const finalData = this._reconstructFinalData(state);
        VisageSystems.process(finalData, base, { scaleX: finalData.texture.scaleX, scaleY: finalData.texture.scaleY });

        // 4. Build Atomic Update Payload
        const updateData = {
            ...finalData,
            [`flags.${MODULE_ID}.activeStack`]: currentStack,
            [`flags.${MODULE_ID}.originalState`]: base,
        };

        delete updateData.effects; // Sanity check
        if (finalData.light) updateData.light = finalData.light;

        // 5. Execute Update
        await token.document.update(updateData, {
            visageUpdate: true,
            scenescape: true,
        });
    }

    // ==========================================
    // COMPOSER HELPER METHODS
    // ==========================================

    /**
     * Deconstructs the base state into decoupled atomic properties for layering.
     * @private
     */
    static _initializeCompositionState(base) {
        const finalData = foundry.utils.deepClone(base);
        if (!finalData.texture) finalData.texture = {};

        return {
            src: base.texture?.src || "",
            scaleX: Math.abs(base.texture?.scaleX ?? 1),
            scaleY: Math.abs(base.texture?.scaleY ?? 1),
            mirrorX: (base.texture?.scaleX ?? 1) < 0,
            mirrorY: (base.texture?.scaleY ?? 1) < 0,
            anchorX: base.texture?.anchorX ?? 0.5,
            anchorY: base.texture?.anchorY ?? 0.5,
            finalData: finalData,
        };
    }

    /**
     * Applies a single layer's overrides to the working composition state.
     * @private
     */
    static _applyLayerOverrides(state, layer) {
        if (layer.disabled) return;
        const c = layer.changes || {};

        // A. Texture & Anchors (Fallback to existing state if null/undefined)
        state.src = c.texture?.src || state.src;
        state.anchorX = c.texture?.anchorX ?? state.anchorX;
        state.anchorY = c.texture?.anchorY ?? state.anchorY;

        // B. Scale (Atomic Override)
        state.scaleX = c.scale ?? state.scaleX;
        state.scaleY = c.scale ?? state.scaleY;

        // C. Mirroring
        state.mirrorX = c.mirrorX ?? state.mirrorX;
        state.mirrorY = c.mirrorY ?? state.mirrorY;

        // D. Core Token Data
        state.finalData.disposition = c.disposition ?? state.finalData.disposition;
        state.finalData.name = c.name || state.finalData.name;
        state.finalData.width = c.width ?? state.finalData.width;
        state.finalData.height = c.height ?? state.finalData.height;
        state.finalData.depth = c.depth ?? state.finalData.depth;
        state.finalData.alpha = c.alpha ?? state.finalData.alpha;
        state.finalData.lockRotation = c.lockRotation ?? state.finalData.lockRotation;

        // E. Dynamic Ring and Light Data
        if (c.ring?.enabled) state.finalData.ring = c.ring;
        if (c.light?.active) state.finalData.light = c.light;
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
        data.texture.anchorX = state.anchorX;
        data.texture.anchorY = state.anchorY;
        return data;
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
            return tokenDoc.update(clearFlags, { visageUpdate: true });
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

        VisageSystems.process(updateData, original, context);

        await tokenDoc.update(updateData, {
            visageUpdate: true,
            scenescape: true, // Acts as a universal passport for Mass Edit compatibility
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
     * Calculates the final texture orientation, scale, and anchor state based on the current stack priority.
     * Iterates from the bottom of the stack (Identity) up to the top (Overlays).
     * @param {Array<Object>} stack - The active Visage stack.
     * @param {Object} [originalState] - The snapshot of the token before Visage was applied.
     * @returns {Object} { anchorX, anchorY, scaleX, scaleY, mirrorX, mirrorY }
     */
    static resolveTextureState(stack, originalState) {
        let anchorX = originalState?.texture?.anchorX ?? 0.5;
        let anchorY = originalState?.texture?.anchorY ?? 0.5;

        // Capture absolute scale, ignoring the sign which denotes the mirror state
        let scaleX = Math.abs(originalState?.texture?.scaleX ?? 1);
        let scaleY = Math.abs(originalState?.texture?.scaleY ?? 1);

        let mirrorX = (originalState?.texture?.scaleX ?? 1) < 0;
        let mirrorY = (originalState?.texture?.scaleY ?? 1) < 0;

        for (const layer of stack) {
            if (layer.disabled) continue;
            const c = layer.changes || {};

            // Fallback to the current loop state if the layer doesn't override it
            anchorX = c.texture?.anchorX ?? anchorX;
            anchorY = c.texture?.anchorY ?? anchorY;

            // Capture atomic scale overrides
            scaleX = c.scale ?? scaleX;
            scaleY = c.scale ?? scaleY;

            mirrorX = c.mirrorX ?? mirrorX;
            mirrorY = c.mirrorY ?? mirrorY;
        }

        return { anchorX, anchorY, scaleX, scaleY, mirrorX, mirrorY };
    }
}
