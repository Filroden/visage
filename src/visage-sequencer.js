import { VisageUtilities } from "./visage-utilities.js";

/**
 * Handles interactions with the Sequencer module to play and stop visual/audio effects on tokens.
 * Acts as a bridge between Visage data layers and the Sequencer/AudioHelper APIs.
 * @module visage
 */
export class VisageSequencer {

    /**
     * Map of active audio instances, keyed by `${tokenId}-${layerTag}`.
     * Used to track and stop looping audio effects when masks are removed.
     * @type {Map<string, Array<Sound>>}
     * @private
     */
    static _activeSounds = new Map();

    /**
     * Applies all visual and audio effects defined in a Visage Layer to a token.
     * * Handles proper cleanup of existing effects on that layer before applying new ones.
     * * Differentiates between 'Base' (Identity) and 'Mask' layers for naming conventions.
     * @param {Token} token - The target token object.
     * @param {Object} layer - The runtime layer object containing effect definitions.
     * @param {boolean} [isBaseLayer=false] - Whether this layer represents the token's identity (base).
     */
    static async apply(token, layer, isBaseLayer = false) {
        if (!VisageUtilities.hasSequencer) return;
        
        const effects = layer.changes?.effects || [];
        if (!effects.length) return;

        const tag = isBaseLayer ? "visage-base" : `visage-mask-${layer.id}`;

        // Ensure clean slate for this specific layer ID to prevent stacking duplicates
        await this.remove(token, layer.id, isBaseLayer);

        const visuals = effects.filter(e => e.type === "visual" && !e.disabled);
        const audios = effects.filter(e => e.type === "audio" && !e.disabled);

        // A. VISUALS (Sequencer)
        if (visuals.length > 0) {
            try {
                const sequence = new Sequence();
                let hasVisuals = false;
                
                for (const effect of visuals) {
                    const path = this._resolveEffectPath(effect.path);
                    if (!path || typeof path !== "string") continue;

                    sequence.effect()
                        .file(path)
                        .attachTo(token)
                        .scaleToObject(effect.scale ?? 1.0)
                        .opacity(effect.opacity ?? 1.0)
                        .rotate(effect.rotation ?? 0)
                        .belowTokens(effect.zOrder === "below")
                        
                        // Lifecycle Strategy:
                        // We intentionally avoid .persist() to prevent Sequencer from writing 
                        // potentially corruptible state data to the token's flags.
                        // Instead, we use an effectively infinite duration (~1 year) and manage
                        // the restoration lifecycle manually via Visage.restore().
                        .duration(31536000000) 
                        
                        // Explicitly set volume to 0 for visuals to prevent potential 
                        // null volume crashes in certain Sequencer versions.
                        .volume(0) 
                        
                        .name(tag)
                        .origin(layer.id);
                    
                    hasVisuals = true;
                }
                if (hasVisuals) sequence.play();
            } catch (err) {
                console.error("Visage | Visual Effect Error:", err);
            }
        }

        // B. AUDIO (AudioHelper)
        if (audios.length > 0) {
            this._playAudioEffects(token, audios, tag).catch(err => {
                console.warn("Visage | Audio Playback Error:", err);
            });
        }
    }

    /**
     * Restores all active effects for a token based on its current Visage stack.
     * Called on scene load or token creation to re-initialize effects.
     * @param {Token} token - The target token.
     */
    static async restore(token) {
        if (!VisageUtilities.hasSequencer) return;

        try {
            // Safety Check: Ensure the Sequencer Database is actually populated
            // before attempting restoration to avoid "Effect not found" errors on load.
            const db = Sequencer.Database.entries;
            const size = db ? (db.size || Object.keys(db).length) : 0;
            if (!db || size === 0) return;
        } catch(e) { return; }

        // Wipe current effects to prevent duplication during the restore process
        await this.revert(token);

        const stack = token.document.getFlag("visage", "activeStack") || [];
        const identityId = token.document.getFlag("visage", "identity");

        // 1. Restore Base Identity
        const baseLayer = stack.find(l => l.id === identityId);
        if (baseLayer) {
            try { await this.apply(token, baseLayer, true); } 
            catch (err) { console.warn("Visage | Restore Base Failed:", err); }
        }

        // 2. Restore Overlays (Masks)
        const masks = stack.filter(l => l.id !== identityId);
        for (const mask of masks) {
            try { await this.apply(token, mask, false); } 
            catch (err) { console.warn("Visage | Restore Mask Failed:", err); }
        }
    }

    /**
     * Internal helper to play looping audio effects.
     * Tracks the resulting sound instances in `_activeSounds` for later removal.
     * @private
     */
    static async _playAudioEffects(token, audios, tag) {
        const soundKey = `${token.id}-${tag}`;
        const activeInstances = [];
        this._activeSounds.set(soundKey, activeInstances);

        const playPromises = audios.map(async (effect) => {
            const path = this._resolveEffectPath(effect.path);
            if (!path || typeof path !== "string") return;

            try {
                const vol = Number.isFinite(effect.opacity) ? effect.opacity : 0.8;
                
                // Use core AudioHelper for reliable looping audio
                const sound = await foundry.audio.AudioHelper.play({
                    src: path,
                    volume: vol,
                    loop: true
                }, false);

                if (sound) {
                    activeInstances.push(sound);
                    // Edge Case: If the mask was removed *while* the audio was loading, stop it immediately.
                    if (!this._activeSounds.has(soundKey)) {
                        sound.stop();
                    }
                }
            } catch (err) {
                console.warn(`Visage | Audio Playback Failed: ${path}`, err);
            }
        });

        await Promise.all(playPromises);
    }

    /**
     * Removes effects associated with a specific layer ID from a token.
     * Stops both Sequencer visuals and AudioHelper sounds.
     * @param {Token} token - The target token.
     * @param {string} layerId - The ID of the layer being removed.
     * @param {boolean} [isBaseLayer=false] - Whether this is the base identity.
     */
    static async remove(token, layerId, isBaseLayer = false) {
        const tag = isBaseLayer ? "visage-base" : `visage-mask-${layerId}`;

        if (VisageUtilities.hasSequencer) {
            try {
                // Sequencer can target effects by name even if they aren't persisted
                await Sequencer.EffectManager.endEffects({ object: token, name: tag });
            } catch(e) { /* Ignore sequencer errors on removal */ }
        }

        const soundKey = `${token.id}-${tag}`;
        if (this._activeSounds.has(soundKey)) {
            const sounds = this._activeSounds.get(soundKey);
            sounds.forEach(sound => {
                if (sound && typeof sound.stop === "function") sound.stop();
            });
            this._activeSounds.delete(soundKey);
        }
    }

    /**
     * Completely wipes all Visage-related effects from a token.
     * Also cleans up any "Zombie" flags left over from legacy Sequencer persistence.
     * @param {Token} token - The target token.
     */
    static async revert(token) {
        if (!VisageUtilities.hasSequencer) return;

        // Legacy Cleanup: Force unset of Sequencer flags if they exist.
        // This fixes issues where tokens might get stuck with an effect even after Visage is removed.
        if (token.document.flags.sequencer) {
            await token.document.unsetFlag("sequencer", "effects");
        }

        // 1. Kill Base Layer
        await Sequencer.EffectManager.endEffects({ object: token, name: "visage-base" });
        
        // 2. Kill all Overlay Layers (Masks)
        const effects = Sequencer.EffectManager.getEffects({ object: token });
        const targets = effects.filter(e => e.data.name && e.data.name.startsWith("visage-mask-"));
        for (const effect of targets) {
            await Sequencer.EffectManager.endEffects({ object: token, name: effect.data.name });
        }

        // 3. Kill all Audio
        for (const [key, sounds] of this._activeSounds) {
            if (key.startsWith(`${token.id}-`)) {
                sounds.forEach(sound => sound.stop());
            }
            this._activeSounds.delete(key);
        }
    }

    /**
     * Resolves a raw path or Sequencer Database key into a usable file path.
     * If the key points to a collection, picks a random file from that collection.
     * @param {string} rawPath - The input path or DB key (e.g., "jb2a.magic_signs...").
     * @returns {string|null} The resolved file path.
     * @private
     */
    static _resolveEffectPath(rawPath) {
        if (!rawPath) return null;
        
        // If it doesn't look like a file path (no slashes), assume it's a DB Key
        const isDbKey = !rawPath.includes("/"); 

        if (isDbKey) {
            const entry = this._resolveSequencerRecursively(rawPath);
            if (entry) {
                let file;
                // Handle JB2A/Sequencer structure variations (Array vs Object with .file)
                if (Array.isArray(entry)) file = entry[Math.floor(Math.random() * entry.length)];
                else {
                    file = entry.file;
                    if (Array.isArray(file)) file = file[Math.floor(Math.random() * file.length)];
                }
                
                if (file && typeof file === "object" && file.file) file = file.file;
                if (typeof file === "string") return file;
            }
            return null;
        }
        return rawPath;
    }

    /**
     * Recursively traverses the Sequencer Database to find a valid file entry.
     * Useful when a user selects a broad category (e.g., "jb2a.fire") instead of a specific file.
     * @param {string} path - The DB key to resolve.
     * @param {number} [depth=0] - Recursion depth guard.
     * @returns {Object|Array|null} The found database entry.
     * @private
     */
    static _resolveSequencerRecursively(path, depth = 0) {
        if (depth > 10) return null; // Prevent infinite recursion

        // Direct Hit
        if (Sequencer.Database.entryExists(path)) {
            const entry = Sequencer.Database.getEntry(path);
            if (Array.isArray(entry) || entry.file) return entry;
        }

        // Recursion: Pick a random child if this is a folder
        try {
            const children = Sequencer.Database.getEntriesUnder(path);
            if (children && children.length > 0) {
                const randomKey = children[Math.floor(Math.random() * children.length)];
                return this._resolveSequencerRecursively(randomKey, depth + 1);
            }
        } catch(e) { /* Ignore lookup errors */ }
        return null;
    }
}