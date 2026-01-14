/**
 * @file The central logic engine for layering Visage effects.
 * Responsible for calculating the final token appearance by composing
 * a "Base State" (Snapshot) with a stack of "Layers" (Masks/Visages).
 * @module visage
 */

import { Visage } from "./visage.js";
import { VisageUtilities } from "./visage-utilities.js";

export class VisageComposer {

    /**
     * Composes the final appearance of a token by layering the active stack on top of its base state.
     * * ARCHITECTURE NOTE:
     * This method implements a "Decoupled Composition" strategy:
     * 1. Deconstructs the Base State into atomic properties (Source, Magnitude, Orientation).
     * 2. Iterates through the stack, allowing layers to override specific atoms (e.g., Scale)
     * without affecting others (e.g., Orientation).
     * 3. Reconstructs the standard Foundry VTT data structure (texture.scaleX with sign) for the final update.
     * * @param {Token} token - The target token object (canvas placeable).
     * @param {Array<Object>|null} [stackOverride=null] - An optional stack of layers to use (e.g., for previews).
     * @param {Object|null} [baseOverride=null] - An optional base state snapshot to use instead of the stored original.
     * @returns {Promise<void>}
     */
    static async compose(token, stackOverride = null, baseOverride = null) {
        if (!token) return;

        // 1. Retrieve Context
        const allFlags = token.document.flags[Visage.MODULE_ID] || {};
        const currentStack = stackOverride ?? (allFlags.activeStack || allFlags.stack || []);
        
        // 2. Revert Condition
        // If the stack is empty, we simply revert to the clean snapshot.
        if (currentStack.length === 0 && !baseOverride) {
            return this.revertToDefault(token.document);
        }

        // 3. Establish Base State (The "Canvas")
        // The snapshot represents the token's "True Form" beneath all illusions.
        let base = baseOverride ?? allFlags.originalState;
        if (!base) {
            base = VisageUtilities.extractVisualState(token.document);
        }
        
        // --- DECOUPLING PHASE ---
        // Foundry stores Flip as a negative Scale. We split these apart so they can be 
        // targeted independently by the stack layers.
        let currentSrc = base.texture?.src || "";
        let currentScaleX = Math.abs(base.texture?.scaleX ?? 1);
        let currentScaleY = Math.abs(base.texture?.scaleY ?? 1);
        let currentMirrorX = (base.texture?.scaleX ?? 1) < 0;
        let currentMirrorY = (base.texture?.scaleY ?? 1) < 0;

        // 4. Layer Composition Loop
        // Iterate from Bottom (Identity) to Top (Masks).
        const finalData = foundry.utils.deepClone(base);
        if (!finalData.texture) finalData.texture = {};

        for (const layer of currentStack) {
            const c = layer.changes || {}; 

            // A. Texture Source
            if (c.texture?.src) currentSrc = c.texture.src;

            // B. Scale (Magnitude Override)
            let handledScale = false;

            // Priority: v2.2 Atomic Scale
            // Checks for the explicit 'scale' property introduced in v2.2.
            if (c.scale !== undefined && c.scale !== null) {
                currentScaleX = c.scale;
                currentScaleY = c.scale; 
                handledScale = true; 
            }

            // Fallback: v1/v2.1 Legacy Texture Scale
            // If atomic scale is missing, check for legacy baked scale data.
            // This ensures backward compatibility for un-migrated masks.
            if (!handledScale && c.texture) {
                if (c.texture.scaleX !== undefined) {
                    currentScaleX = Math.abs(c.texture.scaleX);
                    // Legacy data implies flipping via negative scale
                    currentMirrorX = c.texture.scaleX < 0;
                }
                if (c.texture.scaleY !== undefined) {
                    currentScaleY = Math.abs(c.texture.scaleY);
                    currentMirrorY = c.texture.scaleY < 0;
                }
            }

            // C. Mirroring (Atomic Override)
            // Applies explicit intent (True/False). If undefined, the previous layer's state persists.
            if (c.mirrorX !== undefined && c.mirrorX !== null) currentMirrorX = c.mirrorX;
            if (c.mirrorY !== undefined && c.mirrorY !== null) currentMirrorY = c.mirrorY;

            // D. Dynamic Ring
            if (c.ring) { finalData.ring = c.ring; }

            // E. Disposition
            if (c.disposition !== undefined && c.disposition !== null) {
                finalData.disposition = c.disposition;
            }
            
            // F. Name Override
            if (c.name) finalData.name = c.name;

            // G. Dimensions
            if (c.width !== undefined && c.width !== null) finalData.width = c.width;
            if (c.height !== undefined && c.height !== null) finalData.height = c.height;
        }

        // 5. Reconstruction Phase
        // Re-bake the atomic properties into the standard Foundry data structure.
        finalData.texture.src = currentSrc;
        finalData.texture.scaleX = currentScaleX * (currentMirrorX ? -1 : 1);
        finalData.texture.scaleY = currentScaleY * (currentMirrorY ? -1 : 1);

        // 6. Atomic Update
        // Flags are updated simultaneously to prevent state desynchronization.
        const updateData = {
            ...finalData,
            [`flags.${Visage.MODULE_ID}.activeStack`]: currentStack,
            [`flags.${Visage.MODULE_ID}.originalState`]: base
        };

        await token.document.update(updateData, { visageUpdate: true, animation: { duration: 0 } });
    }

    /**
     * Public API to revert a token to its clean, original state.
     * Removes all Visage effects, clears the stack, and deletes the snapshot flag.
     * @param {TokenDocument} tokenDoc - The token document to revert.
     * @returns {Promise<TokenDocument>} The updated document.
     */
    static async revertToDefault(tokenDoc) {
        if (!tokenDoc) return;
        const flags = tokenDoc.flags[Visage.MODULE_ID] || {};
        return this._revert(tokenDoc, flags);
    }

    /**
     * Internal implementation of the revert logic.
     * Distinguishes between tokens that have a "clean snapshot" and those that don't.
     * @private
     */
    static async _revert(tokenDoc, flags) {
        // Scenario A: No snapshot exists (e.g. data cleaned manually).
        // We just remove the flags to ensure a clean state.
        if (!flags.originalState) {
            const clearFlags = {
                [`flags.${Visage.MODULE_ID}.-=activeStack`]: null,
                [`flags.${Visage.MODULE_ID}.-=originalState`]: null
            };
            return tokenDoc.update(clearFlags, { visageUpdate: true });
        }

        // Scenario B: Snapshot exists.
        // Restore the original visual data AND wipe the flags in a single update.
        const updateData = {
            ...flags.originalState,
            [`flags.${Visage.MODULE_ID}.-=activeStack`]: null,
            [`flags.${Visage.MODULE_ID}.-=stack`]: null, // Clean legacy key
            [`flags.${Visage.MODULE_ID}.-=originalState`]: null
        };

        await tokenDoc.update(updateData, { visageUpdate: true, animation: { duration: 0 } });
    }
}