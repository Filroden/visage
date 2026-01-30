/**
 * @file The central logic engine for layering Visage effects.
 * Responsible for calculating the final token appearance by composing
 * a "Base State" (Snapshot) with a stack of "Layers" (Masks/Visages).
 * @module visage
 */

import { Visage } from "./visage.js";
import { VisageUtilities } from "./visage-utilities.js";

/**
 * The VisageComposer class handles the mathematical composition of token data.
 * It implements a non-destructive layering system that allows multiple visual
 * effects (Visages) to be stacked on top of a token's original "True Form".
 */
export class VisageComposer {

    /**
     * Composes the final appearance of a token by layering the active stack on top of its base state.
     * * **Architecture: Decoupled Composition**
     * 1. **Deconstruction:** The Base State is broken down into atomic properties (Source, Magnitude, Orientation).
     * Critically, Foundry's `scaleX` (which handles both size and flipping) is split into `scale` (size) and `mirror` (flip).
     * 2. **Layering:** The stack is iterated from bottom (Identity) to top (Overlay). Each layer can override specific atoms 
     * (e.g., changing Scale) without affecting others (e.g., keeping the previous Orientation).
     * 3. **Reconstruction:** The atomic properties are re-baked into standard Foundry VTT data structures 
     * (combining size and flip back into a signed `scaleX`) for the final database update.
     * * @param {Token} token - The target token object (canvas placeable).
     * @param {Array<Object>|null} [stackOverride=null] - An optional stack of layers to use (e.g., for temporary previews).
     * @param {Object|null} [baseOverride=null] - An optional base state snapshot to use instead of the stored original state.
     * @returns {Promise<void>}
     */
    static async compose(token, stackOverride = null, baseOverride = null) {
        if (!token) return;

        // 1. Retrieve Context
        // Determine which stack to process: the one currently on the token, or a temporary override.
        const allFlags = token.document.flags[Visage.MODULE_ID] || {};
        const currentStack = stackOverride ?? (allFlags.activeStack || allFlags.stack || []);
        
        // 2. Revert Condition
        // If the stack is empty and we aren't forcing a specific base, 
        // we simply revert the token to its clean state.
        if (currentStack.length === 0 && !baseOverride) {
            return this.revertToDefault(token.document);
        }

        // 3. Establish Base State (The "Canvas")
        // The snapshot represents the token's "True Form" beneath all illusions.
        // If no snapshot exists (first application), we extract it from the current document.
        let base = baseOverride ?? allFlags.originalState;
        if (!base) {
            base = VisageUtilities.extractVisualState(token.document);
        }
        
        // --- DECOUPLING PHASE ---
        // Foundry VTT stores "Flip" as a negative Scale value. 
        // We split these apart so layers can target them independently.
        let currentSrc = base.texture?.src || "";
        let currentScaleX = Math.abs(base.texture?.scaleX ?? 1);
        let currentScaleY = Math.abs(base.texture?.scaleY ?? 1);
        
        // Convert signed scale into boolean intent
        let currentMirrorX = (base.texture?.scaleX ?? 1) < 0;
        let currentMirrorY = (base.texture?.scaleY ?? 1) < 0;

        // 4. Layer Composition Loop
        // Iterate from Bottom (Identity) to Top (Overlays/Masks).
        // We clone the base data to serve as the accumulator for our final state.
        const finalData = foundry.utils.deepClone(base);
        if (!finalData.texture) finalData.texture = {};

        for (const layer of currentStack) {
            const c = layer.changes || {}; 

            // A. Texture Source
            if (c.texture?.src) currentSrc = c.texture.src;

            // B. Scale (Magnitude Override)
            let handledScale = false;

            // Priority 1: Atomic Scale (Modern Schema)
            // Checks for the explicit 'scale' property. This overrides individual X/Y scaling.
            if (c.scale !== undefined && c.scale !== null) {
                currentScaleX = c.scale;
                currentScaleY = c.scale; 
                handledScale = true; 
            }

            // Priority 2: Texture Scale (Legacy Schema)
            // If atomic scale is missing, check for legacy baked scale data.
            // This ensures backward compatibility for older masks that haven't been migrated.
            if (!handledScale && c.texture) {
                if (c.texture.scaleX !== undefined) {
                    currentScaleX = Math.abs(c.texture.scaleX);
                    // Legacy data implies flipping via negative scale, so we update mirror intent here too
                    currentMirrorX = c.texture.scaleX < 0;
                }
                if (c.texture.scaleY !== undefined) {
                    currentScaleY = Math.abs(c.texture.scaleY);
                    currentMirrorY = c.texture.scaleY < 0;
                }
            }

            // C. Mirroring (Atomic Override)
            // Applies explicit intent (True/False). 
            // If undefined, the state from the previous layer (or base) persists.
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
        
            // H. Opacity
            if (c.alpha !== undefined && c.alpha !== null) finalData.alpha = c.alpha;

            // I. Rotation Lock
            if (c.lockRotation !== undefined && c.lockRotation !== null) finalData.lockRotation = c.lockRotation;

            // J. Light Source (V3.2)
            if (c.light) finalData.light = c.light;
        }

        // 5. Reconstruction Phase
        // Re-bake the atomic properties into the standard Foundry data structure.
        // We multiply the absolute scale by -1 if mirroring is active.
        finalData.texture.src = currentSrc;
        finalData.texture.scaleX = currentScaleX * (currentMirrorX ? -1 : 1);
        finalData.texture.scaleY = currentScaleY * (currentMirrorY ? -1 : 1);

        // 6. Atomic Update
        // We update the visual data and the state flags in a single operation 
        // to prevent database desynchronization.
        const updateData = {
            ...finalData,
            [`flags.${Visage.MODULE_ID}.activeStack`]: currentStack,
            [`flags.${Visage.MODULE_ID}.originalState`]: base
        };

        // Ensure light is passed correctly (if it exists)
        // This is crucial because light is not part of the standard 'texture' object
        if (finalData.light) updateData.light = finalData.light;

        // pass 'visageUpdate: true' to prevent infinite recursion in update hooks
        await token.document.update(updateData, { visageUpdate: true });
    }

    /**
     * Public API to revert a token to its clean, original state.
     * Removes all Visage effects, clears the stack, and restores the original visual data.
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
     * @param {TokenDocument} tokenDoc - The token document.
     * @param {Object} flags - The current flags on the document.
     */
    static async _revert(tokenDoc, flags) {
        // Scenario A: No snapshot exists (e.g. data cleaned manually or never initialized).
        // We just remove the flags to ensure the token is marked as "clean".
        if (!flags.originalState) {
            const clearFlags = {
                [`flags.${Visage.MODULE_ID}.-=activeStack`]: null,
                [`flags.${Visage.MODULE_ID}.-=originalState`]: null
            };
            return tokenDoc.update(clearFlags, { visageUpdate: true });
        }

        // Scenario B: Snapshot exists.
        // Restore the original visual data from the snapshot AND wipe the flags in a single update.
        const updateData = {
            ...flags.originalState,
            [`flags.${Visage.MODULE_ID}.-=activeStack`]: null,
            [`flags.${Visage.MODULE_ID}.-=stack`]: null, // Clean legacy key from V1
            [`flags.${Visage.MODULE_ID}.-=originalState`]: null
        };

        await tokenDoc.update(updateData, { visageUpdate: true });
    }
}