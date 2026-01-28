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
     * @param {Token} token - The token object (placeable) to update.
     * @param {Array<Object>} [stackOverride=null] - Optional. A specific stack to apply (used for previews/reverts).
     * @param {Object} [baseOverride=null] - Optional. A specific base state to start from (used when the base token is updated).
     * @returns {Promise<void>}
     */
    static async compose(token, stackOverride = null, baseOverride = null) {
        const tokenDoc = token.document;
        if (!tokenDoc) return;

        // 1. Fetch State
        // The "Original State" is the snapshot of the token BEFORE any Visage was applied.
        // We always start calculation from this clean state to prevent data corruption ("drift").
        const originalState = baseOverride || tokenDoc.getFlag(Visage.MODULE_ID, "originalState");
        if (!originalState) return; 

        // The Stack is the ordered list of Visages currently applied (Identity -> Overlay 1 -> Overlay 2).
        const stack = stackOverride || tokenDoc.getFlag(Visage.MODULE_ID, "activeStack") || [];
        
        // If stack is empty, we are effectively reverting to default.
        if (stack.length === 0) return this.revertToDefault(tokenDoc);

        // 2. Initialize Accumulator
        // We start with the original state and progressively merge layers on top.
        // We use deepClone to ensure we don't accidentally mutate the saved flag data.
        let finalState = foundry.utils.deepClone(originalState);

        // 3. Layer Iteration
        // Iterate through the stack (bottom to top).
        for (const layer of stack) {
            const changes = layer.changes || {};
            
            // A. Identity Mode (Destructive Replacement)
            // If this layer is an Identity (e.g. Polymorph), it establishes a NEW base.
            // We discard previous accumulation for specific properties (like texture) but keep others.
            if (layer.mode === "identity") {
                 // For identity, we want to start fresh with this layer's properties
                 // But we merge into the *original* state defaults to ensure we have valid fallbacks for missing props.
                 // Actually, usually Identity just overrides. 
                 // Let's merge the layer changes ON TOP of the current accumulator.
                 finalState = foundry.utils.mergeObject(finalState, changes, { inplace: true, insertKeys: true });
            } 
            // B. Overlay Mode (Additive)
            else {
                // For overlays, we merge carefully.
                // Texture: Overlays usually DON'T change the token image unless specifically requested.
                // However, our data model allows it.
                finalState = foundry.utils.mergeObject(finalState, changes, { inplace: true, insertKeys: true });
            }
        }

        // 4. Reconstruction (Baking)
        // Convert our internal "Visage Schema" back into "Foundry Token Data".
        // This primarily involves recombining Scale/Mirroring and normalizing Texture paths.
        
        const updates = {};
        
        // Texture & Scale Reconstruction
        // Visage stores scale (size) and mirror (flip) separately.
        // Foundry stores them combined in texture.scaleX / texture.scaleY.
        const textureSrc = finalState.texture?.src || originalState.texture?.src;
        
        // Resolve atomic properties (fallback to original if a layer deleted them but didn't replace them)
        const scale = finalState.scale ?? originalState.scale ?? 1.0;
        const mirrorX = finalState.mirrorX ?? (originalState.texture?.scaleX < 0);
        const mirrorY = finalState.mirrorY ?? (originalState.texture?.scaleY < 0);

        // Calculate final Foundry values
        const finalScaleX = Math.abs(scale) * (mirrorX ? -1 : 1);
        const finalScaleY = Math.abs(scale) * (mirrorY ? -1 : 1);

        updates.texture = {
            src: textureSrc,
            scaleX: finalScaleX,
            scaleY: finalScaleY
        };

        // Pass-through Properties
        // These properties map 1:1 from Visage Data to Token Data.
        if (finalState.width !== undefined) updates.width = finalState.width;
        if (finalState.height !== undefined) updates.height = finalState.height;
        if (finalState.alpha !== undefined) updates.alpha = finalState.alpha;
        if (finalState.lockRotation !== undefined) updates.lockRotation = finalState.lockRotation;
        if (finalState.disposition !== undefined) updates.disposition = finalState.disposition;
        if (finalState.name !== undefined) updates.name = finalState.name;
        
        // Complex Objects (Ring, Light)
        // We allow the mergeObject in step 3 to handle the deep merging of these.
        if (finalState.ring) updates.ring = finalState.ring;
        
        // v3.2: Light Source Handling
        if (finalState.light) updates.light = finalState.light;

        // 5. Execute Update
        // We tag this update so our hooks know it comes from Visage (preventing infinite loops).
        return tokenDoc.update(updates, { visageUpdate: true });
    }

    /**
     * Reverts a token to its stored "Original State" and clears active flags.
     * @param {TokenDocument} tokenDoc - The token to revert.
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
        // Scenario A: No snapshot exists (e.g. data cleaned manually or never initialized).
        // We just remove the flags to ensure the token is marked as "clean".
        if (!flags.originalState) {
            const clearFlags = {
                [`flags.${Visage.MODULE_ID}.-=activeStack`]: null,
                [`flags.${Visage.MODULE_ID}.-=originalState`]: null,
                [`flags.${Visage.MODULE_ID}.-=identity`]: null
            };
            return tokenDoc.update(clearFlags, { visageUpdate: true });
        }

        // Scenario B: Snapshot exists.
        // Restore the original visual data from the snapshot AND wipe the flags in a single update.
        // v3.2: This now automatically restores 'light' if it exists in originalState.
        const updateData = {
            ...flags.originalState,
            [`flags.${Visage.MODULE_ID}.-=activeStack`]: null,
            [`flags.${Visage.MODULE_ID}.-=stack`]: null, // Clean legacy key from V1
            [`flags.${Visage.MODULE_ID}.-=originalState`]: null,
            [`flags.${Visage.MODULE_ID}.-=identity`]: null
        };

        // Clean internal Visage properties that shouldn't exist on a raw token
        delete updateData.scale;
        delete updateData.mirrorX;
        delete updateData.mirrorY;
        // Clean portrait from token update (it's handled by Actor update in cleanup/visage.js)
        delete updateData.portrait;

        return tokenDoc.update(updateData, { visageUpdate: true });
    }
}