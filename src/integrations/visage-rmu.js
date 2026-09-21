/**
 * Integration layer for "Lighting and Vision for RMU" (LVRMU).
 * Ensures Visage correctly overrides RMU lighting rules when applying visual masks,
 * and safely restores them when Visage is removed.
 */
export class VisageRMU {
    static get isActive() {
        return game.modules.get("rmu-lighting-vision")?.active;
    }

    /**
     * Captures the active LVRMU flags so they can be saved in the Original State snapshot.
     */
    static extractState(document) {
        if (!this.isActive || !document?.flags?.["rmu-lighting-vision"]) return null;
        return foundry.utils.deepClone(document.flags["rmu-lighting-vision"]);
    }

    /**
     * Determines the update payload required to suppress or apply LVRMU flags.
     */
    static getUpdatePayload(document, activeVisageFlags = null) {
        const payload = {};
        if (!this.isActive) return payload;

        if (activeVisageFlags && Object.keys(activeVisageFlags).length > 0) {
            payload["flags.rmu-lighting-vision"] = activeVisageFlags;
        }

        return payload;
    }

    /**
     * Returns the payload required to restore the original LVRMU flags.
     */
    static getRestorePayload(originalState) {
        const payload = {};
        if (!this.isActive) return payload;

        if (originalState?.flags?.["rmu-lighting-vision"]) {
            payload["flags.rmu-lighting-vision"] = originalState.flags["rmu-lighting-vision"];
        }

        return payload;
    }
}
