/**
 * Bridges Visage layers with the Token Magic FX API.
 */
export class VisageTokenMagic {
    static get isActive() {
        return game.modules.get("tokenmagic")?.active && typeof TokenMagic !== "undefined";
    }

    /**
     * Retrieves a formatted object of all available TMFX presets for the Editor dropdown.
     */
    static getAvailablePresets() {
        if (!this.isActive) return {};

        try {
            const presets = TokenMagic.getPresets() || [];
            const formatted = [];

            // Extract and capitalise
            for (const p of presets) {
                const name = typeof p === "string" ? p : p.name;
                if (name) {
                    const capitalized = name.charAt(0).toUpperCase() + name.slice(1);
                    formatted.push({ raw: name, label: capitalized });
                }
            }

            // Sort alphabetically
            formatted.sort((a, b) => a.label.localeCompare(b.label));

            // Convert to Foundry SelectOptions format: { "rawValue": "Label" }
            const options = {};
            for (const item of formatted) {
                options[item.raw] = item.label;
            }
            return options;
        } catch (e) {
            console.warn("Visage | Failed to fetch TokenMagic presets", e);
            return {};
        }
    }

    /**
     * Applies a single TMFX preset (Used by Visage.apply to respect delays)
     */
    static async applyEffect(token, layerId, effect) {
        if (!this.isActive || !token || !effect.tmfxPreset) return;

        const rawParams = TokenMagic.getPreset(effect.tmfxPreset);
        if (!rawParams) return;

        const paramArray = foundry.utils.deepClone(Array.isArray(rawParams) ? rawParams : [rawParams]);

        // The Hijack: Force a unique ID for every sub-filter in the preset
        paramArray.forEach((p, index) => {
            p.filterId = `visage-${layerId}-${effect.id}-${index}`;
        });

        await TokenMagic.addUpdateFilters(token, paramArray);
    }

    /**
     * Applies all TMFX presets in a layer instantly (Used by toggles)
     */
    static async applyLayer(token, layer) {
        if (!this.isActive || !token) return;
        const tmfxEffects = (layer.changes?.effects || []).filter((e) => e.type === "tmfx" && !e.disabled);
        for (const effect of tmfxEffects) {
            await this.applyEffect(token, layer.id, effect);
        }
    }

    /**
     * Removes all TMFX filters owned by a specific Visage Layer.
     */
    static async removeLayer(token, layer) {
        if (!this.isActive || !token) return;

        const tmfxEffects = (layer.changes?.effects || []).filter((e) => e.type === "tmfx");
        for (const effect of tmfxEffects) {
            if (!effect.tmfxPreset) continue;

            const rawParams = TokenMagic.getPreset(effect.tmfxPreset);
            if (!rawParams) continue;
            const paramArray = Array.isArray(rawParams) ? rawParams : [rawParams];

            // Delete every hijacked sub-filter by its specific index
            for (let index = 0; index < paramArray.length; index++) {
                await TokenMagic.deleteFilters(token, `visage-${layer.id}-${effect.id}-${index}`);
            }
        }
    }

    /**
     * Cleanses all Visage-owned filters from a token (Used by Revert)
     */
    static async revert(token) {
        if (!this.isActive || !token) return;

        // TMFX stores active filters natively in the document flags
        const flags = token.document.getFlag("tokenmagic", "filters") || [];
        for (const flag of flags) {
            const tmFilters = flag.tmFilters || [];
            for (const tmf of tmFilters) {
                if (tmf.filterId && tmf.filterId.startsWith("visage-")) {
                    await TokenMagic.deleteFilters(token, tmf.filterId);
                }
            }
        }
    }
}
