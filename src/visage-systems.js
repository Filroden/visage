/**
 * @file Handles system-specific logic and overrides.
 * Keeps the core VisageComposer agnostic by isolating system quirks here.
 * @module visage
 */

import { MODULE_ID } from "./visage-constants.js";

export class VisageSystems {

    /**
     * Processes system-specific overrides for the final token data.
     * @param {Object} finalData - The accumulated update payload (mutable).
     * @param {Object} base - The original "True Form" state of the token.
     * @param {Object} context - Calculated values from the composer (currentScaleX, etc).
     */
    static process(finalData, base, context) {
        const allowOverrides = game.settings.get(MODULE_ID, "allowSystemOverrides");
        if (!allowOverrides) return;

        const systemId = game.system.id;

        if (systemId === "pf2e") {
            this._handlePF2E(finalData, base, context);
        }
    }

    /**
     * Pathfinder 2e Override:
     * Unlocks the 'linkToActorSize' flag if Visage is modifying dimensions or scale.
     */
    static _handlePF2E(finalData, base, context) {
        // 1. Dimensions
        // Use nullish coalescing to ensure undefined values are treated as default (1)
        const baseWidth = base.width ?? 1;
        const baseHeight = base.height ?? 1;
        
        // If finalData lacks the key, it implies no change, so we default to the base value
        const finalWidth = finalData.width ?? baseWidth;
        const finalHeight = finalData.height ?? baseHeight;
        
        const modifiesDimensions = (finalWidth !== baseWidth) || (finalHeight !== baseHeight);
        
        // 2. Scale
        // Compare the Composer's calculated scale (context) against the Base state
        const baseScaleX = base.texture?.scaleX ?? 1;
        const baseScaleY = base.texture?.scaleY ?? 1;

        // Direct comparison (Assuming consistent data types from the Composer)
        const modifiesScale = (context.scaleX !== baseScaleX) || (context.scaleY !== baseScaleY);

        // 3. Apply Flags
        if (modifiesDimensions || modifiesScale) {
            finalData["flags.pf2e.linkToActorSize"] = false;
            finalData["flags.pf2e.autoscale"] = false;
        } else {
            // Restore the lock if values match the base state
            finalData["flags.pf2e.linkToActorSize"] = true;
            finalData["flags.pf2e.autoscale"] = true;
        }
    }
}