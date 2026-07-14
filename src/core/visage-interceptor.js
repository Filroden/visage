import { MODULE_ID } from "./visage-constants.js";
import { VisageComposer } from "./visage-composer.js";
import { VisageDataModel } from "../data/visage-data-model.js";

/**
 * Intercepts and intelligently routes third-party token modifications.
 * Ensures external geometric changes are passed through to the background
 * snapshot while maintaining Visage's active visual authority.
 */
export class VisageInterceptor {
    /**
     * Hook handler for preUpdateToken.
     * Evaluates incoming changes and routes whitelisted properties into the
     * background snapshot before calculating a new visual composite.
     */
    static handlePreUpdate(tokenDoc, changes, options, userId) {
        if (options.visageUpdate) return;
        if (game.user.id !== userId) return;

        const flags = tokenDoc.flags?.[MODULE_ID] || {};
        const activeStack = flags.activeStack || flags.stack || [];

        if (activeStack.length === 0) return;

        const originalState = flags.originalState;
        if (!originalState) return;

        const flatChanges = foundry.utils.flattenObject(changes);
        const interceptedData = this._extractWhitelistedData(flatChanges, originalState);

        // Early return if no valid, differing data was intercepted
        if (foundry.utils.isEmpty(interceptedData)) return;

        this._shuntAndCompute(changes, interceptedData, originalState, activeStack);
    }

    /**
     * Isolates whitelisted properties from the incoming changes and verifies
     * they actually differ from the current background snapshot.
     * @private
     */
    static _extractWhitelistedData(flatChanges, originalState) {
        const intercepted = {};
        const flatOriginal = foundry.utils.flattenObject(originalState);

        for (const key of Object.keys(flatChanges)) {
            const isControlled = VisageDataModel.CONTROLLED_KEYS.some((controlled) => key === controlled || key.startsWith(`${controlled}.`));

            if (isControlled && flatChanges[key] !== flatOriginal[key]) {
                intercepted[key] = flatChanges[key];
            }
        }

        return intercepted;
    }

    /**
     * Merges the intercepted data into the background state and computes the final visual output.
     * @private
     */
    static _shuntAndCompute(originalChanges, interceptedData, originalState, activeStack) {
        // 1. Shunt: Safely update the background snapshot with the third-party baseline
        const updatedState = foundry.utils.mergeObject(foundry.utils.deepClone(originalState), foundry.utils.expandObject(interceptedData));

        // 2. Compute: Calculate the new visual composite synchronously
        const compositeState = VisageComposer._calculateCompositeState(updatedState, activeStack);
        const finalData = VisageComposer._reconstructFinalData(compositeState);
        const flatFinalData = foundry.utils.flattenObject(finalData);

        // 3. Overwrite: Re-inject the computed values back into the in-flight hook payload
        for (const key of Object.keys(interceptedData)) {
            if (flatFinalData[key] !== undefined) {
                originalChanges[key] = flatFinalData[key];
            }
        }

        // 4. Persistence: Ensure the new baseline is saved to the database silently
        originalChanges[`flags.${MODULE_ID}.originalState`] = updatedState;
    }
}
