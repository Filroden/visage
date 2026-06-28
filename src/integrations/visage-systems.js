/**
 * @file Handles system-specific logic and overrides.
 * Keeps the core VisageComposer agnostic by isolating system quirks here.
 * @module visage
 */

import { MODULE_ID } from "../core/visage-constants.js";

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
        const baseWidth = base.width ?? 1;
        const baseHeight = base.height ?? 1;

        const finalWidth = finalData.width ?? baseWidth;
        const finalHeight = finalData.height ?? baseHeight;

        const modifiesDimensions = finalWidth !== baseWidth || finalHeight !== baseHeight;

        // 2. Scale
        const baseScaleX = base.texture?.scaleX ?? 1;
        const baseScaleY = base.texture?.scaleY ?? 1;

        // Use a floating-point tolerance to prevent JS math discrepancies
        const modifiesScale = Math.abs(context.scaleX - baseScaleX) > 0.001 || Math.abs(context.scaleY - baseScaleY) > 0.001;

        // 3. Apply Flags
        if (modifiesDimensions || modifiesScale) {
            finalData["flags.pf2e.linkToActorSize"] = false;
            finalData["flags.pf2e.autoscale"] = false;
        } else if (base.flags?.pf2e) {
            if (base.flags.pf2e.linkToActorSize !== undefined) {
                finalData["flags.pf2e.linkToActorSize"] = base.flags.pf2e.linkToActorSize;
            }
            if (base.flags.pf2e.autoscale !== undefined) {
                finalData["flags.pf2e.autoscale"] = base.flags.pf2e.autoscale;
            }
        }
    }
}
