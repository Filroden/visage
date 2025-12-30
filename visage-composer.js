/**
 * @file The central logic for layering Visage effects.
 * @module visage
 */

import { Visage } from "./visage.js";

export class VisageComposer {

    /**
     * Composes the final token data by layering the stack on top of the base state.
     * @param {Token} token - The token object (placeable).
     * @param {Array} [stackOverride=null] - Optional stack to use instead of the current flag.
     * @param {Object} [baseOverride=null] - Optional base data to use instead of the current originalState.
     * @returns {Promise<void>}
     */
    static async compose(token, stackOverride = null, baseOverride = null) {
        if (!token) return;

        // 1. Get Current Flags (Correctly accessing the module scope)
        const allFlags = token.document.flags[Visage.MODULE_ID] || {};
        const currentStack = stackOverride ?? (allFlags.stack || []);
        
        // 2. Revert Logic
        // We ONLY revert if the stack is empty AND we are NOT applying a new base visage.
        // This handles the "Clear All" case.
        if (currentStack.length === 0 && !baseOverride) {
            return this._revert(token, allFlags);
        }

        // 3. Establish Base State (Original State)
        let base = baseOverride ?? allFlags.originalState;
        
        // If no base exists yet, capture the current token state as the base
        if (!base) {
            base = this._captureSnapshot(token);
        }

        // 4. Layer Changes
        // Deep clone base to avoid mutating the snapshot
        const finalData = foundry.utils.deepClone(base);
        
        // Ensure structure exists
        if (!finalData.texture) finalData.texture = {};

        for (const layer of currentStack) {
            const changes = layer.changes || {};

            // A. Texture/Image
            if (changes.img) {
                finalData.texture.src = changes.img;
            }

            // B. Scale & Orientation
            if (changes.scale !== undefined && changes.scale !== null) {
                // Determine Flip State for this layer
                // If layer has explicit flip, use it. Else fall back to Base state.
                const flipX = (changes.isFlippedX !== undefined) ? changes.isFlippedX : (finalData.texture.scaleX < 0);
                const flipY = (changes.isFlippedY !== undefined) ? changes.isFlippedY : (finalData.texture.scaleY < 0);
                
                const absScale = Math.abs(changes.scale);
                finalData.texture.scaleX = absScale * (flipX ? -1 : 1);
                finalData.texture.scaleY = absScale * (flipY ? -1 : 1);
            }

            // C. Ring (Override)
            if (changes.ring && changes.ring.enabled) {
                finalData.ring = changes.ring;
            }

            // D. Disposition
            if (changes.disposition !== undefined && changes.disposition !== null) {
                finalData.disposition = changes.disposition;
            }
            
            // E. Name
            if (changes.name) {
                finalData.name = changes.name;
            }

            // F. Dimensions
            if (changes.width !== undefined && changes.width !== null) {
                finalData.width = changes.width;
            }
            if (changes.height !== undefined && changes.height !== null) {
                finalData.height = changes.height;
            }
        }

        // DEBUG: Log what we are sending to Foundry
        console.log("Visage | Composing Update:", finalData);

        // 5. Apply Update
        const updateData = {
            ...finalData,
            [`flags.${Visage.MODULE_ID}.stack`]: currentStack,
            [`flags.${Visage.MODULE_ID}.originalState`]: base // Ensure base is saved
        };

        await token.document.update(updateData, { visageUpdate: true, animation: { duration: 0 } });
    }

    /**
     * Reverts the token to its original state and clears flags.
     */
    static async _revert(token, flags) {
        // If we don't have an original state, there is nothing to revert to.
        // We just clear the flags to be safe.
        if (!flags.originalState) {
            const clearFlags = {
                [`flags.${Visage.MODULE_ID}.-=stack`]: null,
                [`flags.${Visage.MODULE_ID}.-=originalState`]: null
            };
            return token.document.update(clearFlags, { visageUpdate: true });
        }

        // Restore original state and delete flags
        const updateData = {
            ...flags.originalState,
            [`flags.${Visage.MODULE_ID}.-=stack`]: null,
            [`flags.${Visage.MODULE_ID}.-=originalState`]: null,
            // Also clear legacy flags if they exist to be clean
            [`flags.${Visage.MODULE_ID}.-=activeVisage`]: null 
        };

        await token.document.update(updateData, { visageUpdate: true });
    }

    /**
     * Captures the current token state to serve as the "Base Layer".
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
            ring: doc.ring?.toObject?.() ?? doc.ring ?? {},
            width: doc.width,
            height: doc.height,
            alpha: doc.alpha
        };
    }
}