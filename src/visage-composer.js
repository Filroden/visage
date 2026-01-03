/**
 * @file The central logic engine for layering Visage effects.
 * Handles the composition of multiple cosmetic layers into a final token update
 * and manages the preservation of original token data via snapshots.
 * @module visage
 */

import { Visage } from "./visage.js";

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
        // If the stack is empty and we aren't simulating a specific base, revert to default.
        if (currentStack.length === 0 && !baseOverride) {
            return this.revertToDefault(token.document);
        }

        // 3. Establish Base State (The "Canvas" to paint on)
        // If no clean snapshot exists, capture the current state as the baseline.
        let base = baseOverride ?? allFlags.originalState;
        if (!base) {
            base = this._captureSnapshot(token);
        }

        // 4. Layer Composition Loop
        // Clone the base state so we don't mutate the reference
        const finalData = foundry.utils.deepClone(base);
        if (!finalData.texture) finalData.texture = {};

        for (const layer of currentStack) {
            const changes = layer.changes || {};

            // A. Texture/Image
            if (changes.img) finalData.texture.src = changes.img;
            else if (changes.texture?.src) finalData.texture.src = changes.texture.src;

            // B. Scale Handling
            // Supports both legacy top-level 'scale' and v10+ 'texture.scaleX/Y'
            if (changes.texture) {
                if (changes.texture.scaleX !== undefined) {
                    const currentSign = finalData.texture.scaleX < 0 ? -1 : 1;
                    finalData.texture.scaleX = Math.abs(changes.texture.scaleX) * currentSign;
                }
                if (changes.texture.scaleY !== undefined) {
                    const currentSign = finalData.texture.scaleY < 0 ? -1 : 1;
                    finalData.texture.scaleY = Math.abs(changes.texture.scaleY) * currentSign;
                }
            } 
            else if (changes.scale !== undefined && changes.scale !== null) {
                const absScale = Math.abs(changes.scale);
                // Preserve existing flip orientation (sign)
                const currentSignX = finalData.texture.scaleX < 0 ? -1 : 1;
                const currentSignY = finalData.texture.scaleY < 0 ? -1 : 1;
                
                finalData.texture.scaleX = absScale * currentSignX;
                finalData.texture.scaleY = absScale * currentSignY;
            }

            // C. Flip Flags (Multiplicative)
            // Toggling a flip multiplies the current scale by -1
            if (changes.flipX) finalData.texture.scaleX *= -1;
            if (changes.flipY) finalData.texture.scaleY *= -1;

            // D. Dynamic Ring (v12+)
            if (changes.ring && changes.ring.enabled) finalData.ring = changes.ring;

            // E. Disposition (Color Ring)
            if (changes.disposition !== undefined && changes.disposition !== null) {
                finalData.disposition = changes.disposition;
            }
            
            // F. Name Override
            if (changes.name) finalData.name = changes.name;

            // G. Dimensions (Grid Size)
            if (changes.width !== undefined && changes.width !== null) finalData.width = changes.width;
            if (changes.height !== undefined && changes.height !== null) finalData.height = changes.height;
        }

        // 5. Atomic Update
        // Write the visual changes AND the stack state in a single database transaction.
        const updateData = {
            ...finalData,
            [`flags.${Visage.MODULE_ID}.activeStack`]: currentStack,
            [`flags.${Visage.MODULE_ID}.originalState`]: base
        };

        // Disable animation for instant cosmetic swaps
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

        await tokenDoc.update(updateData, { visageUpdate: true });
    }

    /**
     * Captures the current visual properties of a token to serve as a restoration point.
     * Only captures cosmetic properties (Name, Image, Scale, Ring), ignores stats (HP, AC).
     * @param {Token} token - The token object to snapshot.
     * @returns {Object} A data object representing the token's visual state.
     * @private
     */
    static _captureSnapshot(token) {
        const doc = token.document;
        return {
            name: doc.name,
            displayName: doc.displayName,
            disposition: doc.disposition,
            texture: {
                src: doc.texture.src,
                scaleX: doc.texture.scaleX,
                scaleY: doc.texture.scaleY
            },
            // Handle v12 Ring data safely
            ring: doc.ring?.toObject?.() ?? doc.ring ?? {},
            width: doc.width,
            height: doc.height,
            alpha: doc.alpha
        };
    }
}