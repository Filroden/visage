/**
 * @file The central logic for layering Visage effects.
 * @module visage
 */

import { Visage } from "./visage.js";

export class VisageComposer {

    /**
     * Composes the final token data by layering the stack on top of the base state.
     */
    static async compose(token, stackOverride = null, baseOverride = null) {
        if (!token) return;

        // 1. Get Current Flags
        const allFlags = token.document.flags[Visage.MODULE_ID] || {};
        const currentStack = stackOverride ?? (allFlags.activeStack || allFlags.stack || []);
        
        // 2. Revert Logic
        if (currentStack.length === 0 && !baseOverride) {
            return this.revertToDefault(token.document);
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
            if (changes.img) finalData.texture.src = changes.img;
            else if (changes.texture?.src) finalData.texture.src = changes.texture.src;

            // B. Scale (Override)
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
                const currentSignX = finalData.texture.scaleX < 0 ? -1 : 1;
                finalData.texture.scaleX = absScale * currentSignX;
                finalData.texture.scaleY = absScale * (finalData.texture.scaleY < 0 ? -1 : 1);
            }

            // C. Flip (Multiplier)
            if (changes.flipX) finalData.texture.scaleX *= -1;
            if (changes.flipY) finalData.texture.scaleY *= -1;

            // D. Ring
            if (changes.ring && changes.ring.enabled) finalData.ring = changes.ring;

            // E. Disposition
            if (changes.disposition !== undefined && changes.disposition !== null) finalData.disposition = changes.disposition;
            
            // F. Name
            if (changes.name) finalData.name = changes.name;

            // G. Dimensions
            if (changes.width !== undefined && changes.width !== null) finalData.width = changes.width;
            if (changes.height !== undefined && changes.height !== null) finalData.height = changes.height;
        }

        // 5. Apply Update
        const updateData = {
            ...finalData,
            [`flags.${Visage.MODULE_ID}.activeStack`]: currentStack,
            [`flags.${Visage.MODULE_ID}.originalState`]: base
        };

        await token.document.update(updateData, { visageUpdate: true, animation: { duration: 0 } });
    }

    /**
     * Public API to revert a token to its default state.
     * FIX: Added this method to handle external calls from Visage.revert()
     */
    static async revertToDefault(tokenDoc) {
        if (!tokenDoc) return;
        const flags = tokenDoc.flags[Visage.MODULE_ID] || {};
        return this._revert(tokenDoc, flags);
    }

    static async _revert(tokenDoc, flags) {
        if (!flags.originalState) {
            const clearFlags = {
                [`flags.${Visage.MODULE_ID}.-=activeStack`]: null,
                [`flags.${Visage.MODULE_ID}.-=originalState`]: null
            };
            return tokenDoc.update(clearFlags, { visageUpdate: true });
        }

        const updateData = {
            ...flags.originalState,
            [`flags.${Visage.MODULE_ID}.-=activeStack`]: null,
            [`flags.${Visage.MODULE_ID}.-=stack`]: null,
            [`flags.${Visage.MODULE_ID}.-=originalState`]: null
        };

        await tokenDoc.update(updateData, { visageUpdate: true });
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