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

        // 1. Get Current Flags
        const allFlags = token.document.flags[Visage.MODULE_ID] || {};
        // Check 'activeStack', then fallback to 'stack', then default to empty.
        const currentStack = stackOverride ?? (allFlags.activeStack || allFlags.stack || []);
        
        // 2. Revert Logic
        // Only revert if the stack is TRULY empty
        if (currentStack.length === 0 && !baseOverride) {
            return this._revert(token, allFlags);
        }

        // 3. Establish Base State
        let base = baseOverride ?? allFlags.originalState;
        if (!base) {
            base = this._captureSnapshot(token);
        }

        // 4. Layer Changes
        const finalData = foundry.utils.deepClone(base);
        if (!finalData.texture) finalData.texture = {};

        for (const layer of currentStack) {
            const changes = layer.changes || {};

            // A. Texture/Image
            if (changes.img) {
                finalData.texture.src = changes.img;
            } else if (changes.texture?.src) {
                // Handle Unified Model where src might be inside texture
                finalData.texture.src = changes.texture.src;
            }

            // B. Scale & Orientation (Unified Model Support)
            // Check for Unified Model (texture object) first
            if (changes.texture && (changes.texture.scaleX !== undefined || changes.texture.scaleY !== undefined)) {
                // Apply absolute scale logic if present
                if (changes.texture.scaleX !== undefined) finalData.texture.scaleX = changes.texture.scaleX;
                if (changes.texture.scaleY !== undefined) finalData.texture.scaleY = changes.texture.scaleY;
            } 
            // Fallback for Legacy Data (flat scale)
            else if (changes.scale !== undefined && changes.scale !== null) {
                const flipX = (changes.isFlippedX !== undefined) ? changes.isFlippedX : (finalData.texture.scaleX < 0);
                const flipY = (changes.isFlippedY !== undefined) ? changes.isFlippedY : (finalData.texture.scaleY < 0);
                const absScale = Math.abs(changes.scale);
                finalData.texture.scaleX = absScale * (flipX ? -1 : 1);
                finalData.texture.scaleY = absScale * (flipY ? -1 : 1);
            }

            // C. Ring
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

        console.log("Visage | Composing Update:", finalData);

        // 5. Apply Update
        const updateData = {
            ...finalData,
            [`flags.${Visage.MODULE_ID}.activeStack`]: currentStack, // CHANGED: activeStack
            [`flags.${Visage.MODULE_ID}.originalState`]: base
        };

        await token.document.update(updateData, { visageUpdate: true, animation: { duration: 0 } });
    }

    static async _revert(token, flags) {
        if (!flags.originalState) {
            const clearFlags = {
                [`flags.${Visage.MODULE_ID}.-=activeStack`]: null, // CHANGED
                [`flags.${Visage.MODULE_ID}.-=originalState`]: null
            };
            return token.document.update(clearFlags, { visageUpdate: true });
        }

        const updateData = {
            ...flags.originalState,
            [`flags.${Visage.MODULE_ID}.-=activeStack`]: null,
            [`flags.${Visage.MODULE_ID}.-=stack`]: null, // Clean legacy
            [`flags.${Visage.MODULE_ID}.-=originalState`]: null
        };

        await token.document.update(updateData, { visageUpdate: true });
    }

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