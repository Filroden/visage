/**
 * Bridges Visage layers with the Token Magic FX API.
 */
/**
 * Bridges Visage layers with the Token Magic FX API.
 */
export class VisageTokenMagic {
    static _galleryCache = null;

    static get isActive() {
        return game.modules.get("tokenmagic")?.active && typeof TokenMagic !== "undefined";
    }

    /**
     * Retrieves a formatted object of all available TMFX presets for the Editor dropdown.
     */
    static async getAvailablePresets() {
        if (!this.isActive) return { corePresets: [], galleryPresets: [] };

        const result = { corePresets: [], galleryPresets: [] };

        try {
            // 1. Fetch Core Presets
            const presets = TokenMagic.getPresets() || [];
            const formatted = [];
            for (const p of presets) {
                const name = typeof p === "string" ? p : p.name;
                if (name) {
                    const capitalized = name.charAt(0).toUpperCase() + name.slice(1);
                    formatted.push({ id: name, name: capitalized });
                }
            }
            formatted.sort((a, b) => a.name.localeCompare(b.name));
            result.corePresets = formatted;

            // 2. Fetch Gallery Presets
            if (!this._galleryCache) {
                const response = await fetch("https://assets.gallery.aedif.net/gallery.json");
                if (response.ok) {
                    const data = await response.json();
                    this._galleryCache = data.map((item) => ({
                        id: item.id,
                        name: `${item.title} (by ${item.author})`,
                    }));
                    this._galleryCache.sort((a, b) => a.name.localeCompare(b.name));
                }
            }
            result.galleryPresets = this._galleryCache || [];
        } catch (err) {
            console.warn("Visage | Failed to fetch TokenMagic presets or gallery", err);
        }

        return result;
    }

    /**
     * Resolves a TMFX preset string into a usable params array.
     * Automatically fetches Community Gallery payloads if an ID is provided.
     */
    static async _resolvePresetPayload(presetId) {
        if (/^[a-f0-9]{16}$/i.test(presetId)) {
            try {
                const response = await fetch(`https://assets.gallery.aedif.net/entries/${presetId}.json`);
                if (response.ok) {
                    const responseData = await response.json();

                    if (responseData?.data?.params) {
                        return responseData.data.params;
                    }
                }
            } catch (err) {
                console.error(`Visage | Failed to fetch TMFX Gallery payload for ${presetId}:`, err);
            }
        }
        return presetId;
    }

    /**
     * Applies a single TMFX preset (Used by Visage.apply to respect delays)
     */
    static async applyEffect(token, layerId, effect) {
        if (!this.isActive || !token) return;
        if (!effect.tmfxPreset && !effect.tmfxPayload) return;

        let rawParams = null;

        if (effect.tmfxPayload) {
            try {
                rawParams = JSON.parse(effect.tmfxPayload);
            } catch (err) {
                console.warn(`Visage | Dropping effect ${effect.id}: Invalid TMFX custom payload JSON.`, err);
                return;
            }
        } else if (effect.tmfxPreset) {
            const payload = await this._resolvePresetPayload(effect.tmfxPreset);
            rawParams = typeof payload === "string" ? TokenMagic.getPreset(payload) : payload;
        }

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
     * Removes all Token Magic FX associated with a specific Visage layer.
     * @param {Token} token - The target canvas Token.
     * @param {Object} layer - The Visage layer data to remove.
     */
    static async removeLayer(token, layer) {
        if (!this.isActive || !token || !layer) return;

        const effects = layer.changes?.effects || [];
        const tmfxEffects = effects.filter((e) => e.type === "tmfx" && (e.tmfxPreset || e.tmfxPayload));

        for (const effect of tmfxEffects) {
            await this._removeSingleTMFXEffect(token, layer.id, effect);
        }
    }

    /**
     * Safely determines the number of sub-filters for an effect and deletes them.
     * @private
     */
    static async _removeSingleTMFXEffect(token, layerId, effect) {
        let rawParams = null;

        if (effect.tmfxPayload) {
            try {
                rawParams = JSON.parse(effect.tmfxPayload);
            } catch (err) {
                console.warn(`Visage | Dropping effect ${effect.id}: Invalid TMFX custom payload JSON.`, err);
            }
        } else if (effect.tmfxPreset) {
            const payload = await this._resolvePresetPayload(effect.tmfxPreset);
            rawParams = typeof payload === "string" ? TokenMagic.getPreset(payload) : payload;
        }

        // SonarQube Fix: Unwind the nested ternary operator
        // Failsafe default is 10 (guarantees orphaned effects are cleansed if parsing fails)
        let count = 10;
        if (rawParams) {
            count = Array.isArray(rawParams) ? rawParams.length : 1;
        }

        for (let index = 0; index < count; index++) {
            await TokenMagic.deleteFilters(token, `visage-${layerId}-${effect.id}-${index}`);
        }
    }

    /**
     * Cleanses all Visage-owned filters from a token (Used by Revert)
     */
    static async revert(token) {
        if (!this.isActive || !token) return;

        const filters = token.document.getFlag("tokenmagic", "filters") || [];
        const filterArray = Array.isArray(filters) ? filters : Object.values(filters);

        for (const filter of filterArray) {
            const id = filter.filterId || filter.tmFilterId;
            if (id && typeof id === "string" && id.startsWith("visage-")) {
                await TokenMagic.deleteFilters(token, id);
            }
        }
    }
}
