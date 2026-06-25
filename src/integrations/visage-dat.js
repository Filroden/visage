/**
 * Integration layer for "Dylan's Animated Tokens" (DAT).
 * Ensures Visage correctly overrides DAT sprite sheets when active,
 * and restores them when Visage is removed.
 */
export class VisageDAT {
    static get isActive() {
        return game.modules.get("dylans-animated-tokens")?.active;
    }

    /**
     * Captures the active DAT flag so it can be saved in the Original State snapshot.
     */
    static extractState(document) {
        if (!this.isActive || !document?.flags?.["dylans-animated-tokens"]) return null;
        return foundry.utils.deepClone(document.flags["dylans-animated-tokens"]);
    }

    /**
     * Determines the update payload required to suppress or apply DAT flags.
     * @param {TokenDocument} document - The target token document.
     * @param {Object} activeVisageFlags - The flags (if any) provided by the active Visage.
     */
    static getUpdatePayload(document, activeVisageFlags = null) {
        const payload = {};
        if (!this.isActive) return payload;

        if (activeVisageFlags && Object.keys(activeVisageFlags).length > 0) {
            payload["flags.dylans-animated-tokens"] = activeVisageFlags;
        } else if (document?.flags?.["dylans-animated-tokens"]) {
            payload["flags.dylans-animated-tokens"] = new foundry.data.operators.ForcedDeletion();
        }

        return payload;
    }

    /**
     * Returns the payload required to restore the original DAT flag.
     */
    static getRestorePayload(originalState) {
        const payload = {};
        if (!this.isActive) return payload;

        if (originalState?.flags?.["dylans-animated-tokens"]) {
            payload["flags.dylans-animated-tokens"] = originalState.flags["dylans-animated-tokens"];
        }

        return payload;
    }

    /**
     * Replicates DAT's internal anchor calculation.
     * DAT natively calculates this inside the TokenConfig UI, so Visage
     * must manually compute it for programmatic applications.
     */
    static async getCalculatedAnchors(sheetsrc, sheetstyle, animationframes, scale = 1) {
        if (!sheetsrc) return { anchorX: 0.5, anchorY: 0.5 };

        // Hardcoded DAT styles that always center
        if (["pmd", "eight"].includes(sheetstyle)) {
            return { anchorX: 0.5, anchorY: 0.5 };
        }

        try {
            // Load the texture to get the raw pixel dimensions (cached by Foundry)
            const tex = await foundry.canvas.loadTexture(sheetsrc);
            if (!tex?.width || !tex.height) return { anchorX: 0.5, anchorY: 0.5 };

            const frames = animationframes || 4;
            let defaultRatio = 4 / frames;

            // Map DAT's specific style ratios
            switch (sheetstyle) {
                case "tdsm3":
                    defaultRatio = 4 / 28;
                    break;
                case "tdsm4":
                    defaultRatio = 3 / 20;
                    break;
                case "tdsmpc":
                    defaultRatio = 6 / 12;
                    break;
                case "tdsmte":
                    defaultRatio = 5 / 52;
                    break;
                case "tdsmtem":
                    defaultRatio = 3 / 8;
                    break;
            }

            // DAT's exact algebraic offset formula
            const I = (tex.height / tex.width) * defaultRatio;
            const b = 1.02 + 0.5 / (-I * Math.abs(scale));

            return {
                anchorX: 0.5,
                anchorY: Math.ceil(100 * b) / 100,
            };
        } catch (err) {
            console.warn(`Visage | Failed to calculate DAT anchor for ${sheetsrc}`, err);
            return { anchorX: 0.5, anchorY: 0.5 };
        }
    }
}
