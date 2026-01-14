/**
 * @file The central logic engine for layering Visage effects.
 * Handles the composition of multiple cosmetic layers into a final token update
 * and manages the preservation of original token data via snapshots.
 * @module visage
 */

import { Visage } from "./visage.js";
import { VisageUtilities } from "./visage-utilities.js";

export class VisageComposer {

    /**
     * Composes the final appearance of a token by layering the active stack on top of its base state.
     * This is a non-destructive operation that calculates the final properties without overwriting
     * the "Original State" flag.
     * * @param {Token} token - The target token object (canvas placeable).
     * @param {Array<Object>|null} [stackOverride=null] - An optional stack of layers to use instead of the current flags.
     * @param {Object|null} [baseOverride=null] - An optional base state snapshot to use instead of the stored original.
     * @returns {Promise<void>}
     */
    static async compose(token, stackOverride = null, baseOverride = null) {
        if (!token) return;

        // 1. Retrieve Context
        const allFlags = token.document.flags[Visage.MODULE_ID] || {};
        const currentStack = stackOverride ?? (allFlags.activeStack || allFlags.stack || []);
        
        // 2. Revert Condition
        if (currentStack.length === 0 && !baseOverride) {
            return this.revertToDefault(token.document);
        }

        // 3. Establish Base State (The "Canvas")
        let base = baseOverride ?? allFlags.originalState;
        if (!base) {
            base = VisageUtilities.extractVisualState(token.document);
        }
        
        // --- DECOUPLE BASE STATE ---
        // Extract atomic properties from the base Foundry data
        let currentSrc = base.texture?.src || "";
        let currentScaleX = Math.abs(base.texture?.scaleX ?? 1);
        let currentScaleY = Math.abs(base.texture?.scaleY ?? 1);
        let currentMirrorX = (base.texture?.scaleX ?? 1) < 0;
        let currentMirrorY = (base.texture?.scaleY ?? 1) < 0;

        // 4. Layer Composition Loop
        const finalData = foundry.utils.deepClone(base);
        if (!finalData.texture) finalData.texture = {};

        for (const layer of currentStack) {
            const c = layer.changes || {}; // Use 'c' consistently

            // A. Texture Source
            if (c.texture?.src) currentSrc = c.texture.src;

            // B. Scale (Magnitude Override)
            if (c.scale !== undefined && c.scale !== null) {
                currentScaleX = c.scale;
                currentScaleY = c.scale; 
            }

            // C. Mirroring (Orientation Override)
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

        // 5. Reconstruct Foundry Data
        finalData.texture.src = currentSrc;
        finalData.texture.scaleX = currentScaleX * (currentMirrorX ? -1 : 1);
        finalData.texture.scaleY = currentScaleY * (currentMirrorY ? -1 : 1);

        // 6. Atomic Update
        const updateData = {
            ...finalData,
            [`flags.${Visage.MODULE_ID}.activeStack`]: currentStack,
            [`flags.${Visage.MODULE_ID}.originalState`]: base
        };

        await token.document.update(updateData, { visageUpdate: true, animation: { duration: 0 } });
    }

    /**
     * Public API to revert a token to its clean, original state.
     * Removes all Visage effects and flags.
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
        // If no snapshot exists, simply removing the flags is sufficient.
        if (!flags.originalState) {
            const clearFlags = {
                [`flags.${Visage.MODULE_ID}.-=activeStack`]: null,
                [`flags.${Visage.MODULE_ID}.-=originalState`]: null
            };
            return tokenDoc.update(clearFlags, { visageUpdate: true });
        }

        // If a snapshot exists, restore the original visual data AND wipe the flags.
        const updateData = {
            ...flags.originalState,
            [`flags.${Visage.MODULE_ID}.-=activeStack`]: null,
            [`flags.${Visage.MODULE_ID}.-=stack`]: null, // Clean legacy key
            [`flags.${Visage.MODULE_ID}.-=originalState`]: null
        };

        await tokenDoc.update(updateData, { visageUpdate: true, animation: { duration: 0 } });
    }
}