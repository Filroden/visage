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
     * Uses "Infinite Duration" strategy to avoid Persistence crashes on refresh.
     */
    static async apply(token, layer, isBaseLayer = false) {
        if (!VisageUtilities.hasSequencer) return;
        
        const effects = layer.changes?.effects || [];
        if (!effects.length) return;

        const tag = isBaseLayer ? "visage-base" : `visage-mask-${layer.id}`;

        // 1. Clean Slate
        await this.remove(token, layer.id, isBaseLayer);

        const visuals = effects.filter(e => e.type === "visual" && !e.disabled);
        const audios = effects.filter(e => e.type === "audio" && !e.disabled);

        // --- A. VISUALS (Sequencer: Infinite Duration) ---
        if (visuals.length > 0) {
            try {
                const sequence = new Sequence();
                let hasVisuals = false;
                
                for (const effect of visuals) {
                    const path = this._resolveEffectPath(effect.path);
                    if (!path || typeof path !== "string") continue;

                    const isLoop = effect.loop ?? true;

                    let seqEffect = sequence.effect()
                        .file(path)
                        .attachTo(token)
                        .scaleToObject(effect.scale ?? 1.0)
                        .opacity(effect.opacity ?? 1.0)
                        .rotate(effect.rotation ?? 0)
                        .belowTokens(effect.zOrder === "below")
                        .name(tag)
                        .origin(layer.id);

                    if (isLoop) {
                        // Infinite Duration (~1 year)
                        seqEffect.duration(31536000000); 
                    } else {
                        seqEffect.missed(false); // Play Once
                    }
                    hasVisuals = true;
                }

                if (hasVisuals) sequence.play();
            } catch (err) {
                console.error("Visage | Visual Effect Error:", err);
            }
        }

        // --- B. AUDIO (AudioHelper: Manual) ---
        if (audios.length > 0) {
            this._playAudioEffects(token, audios, tag).catch(err => {
                console.warn("Visage | Audio Playback Error:", err);
            });
        }
    }

    /**
     * Restores all active effects.
     * Called on scene load. We removed the strict DB check to ensure this always runs.
     */
    static async restore(token) {
        if (!VisageUtilities.hasSequencer) return;

        // 1. Wipe current effects to prevent duplication
        await this.revert(token);

        const stack = token.document.getFlag("visage", "activeStack") || [];
        const identityId = token.document.getFlag("visage", "identity");

        // 2. Re-Apply Base Identity
        const baseLayer = stack.find(l => l.id === identityId);
        if (baseLayer) {
            try { await this.apply(token, baseLayer, true); } 
            catch (err) { console.warn("Visage | Restore Base Failed:", err); }
        }

        // 3. Re-Apply Overlays (Masks)
        const masks = stack.filter(l => l.id !== identityId);
        for (const mask of masks) {
            try { await this.apply(token, mask, false); } 
            catch (err) { console.warn("Visage | Restore Mask Failed:", err); }
        }
    }

    /**
     * Removes effects associated with a specific layer ID from a token.
     */
    static async remove(token, layerId, isBaseLayer = false) {
        if (!VisageUtilities.hasSequencer) return;

        const tag = isBaseLayer ? "visage-base" : `visage-mask-${layerId}`;

        // 1. Kill Visuals
        try {
            await Sequencer.EffectManager.endEffects({ object: token, name: tag });
        } catch(e) { /* Ignore */ }

        // 2. Kill Audio
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
     */
    static async revert(token) {
        if (!VisageUtilities.hasSequencer) return;

        // 1. Kill Visuals
        await Sequencer.EffectManager.endEffects({ object: token, name: "visage-base" });
        const effects = Sequencer.EffectManager.getEffects({ object: token });
        const targets = effects.filter(e => e.data.name && e.data.name.startsWith("visage-mask-"));
        for (const effect of targets) {
            await Sequencer.EffectManager.endEffects({ object: token, name: effect.data.name });
        }
        
        // 2. Kill Audio
        for (const [key, sounds] of this._activeSounds) {
            if (key.startsWith(`${token.id}-`)) {
                sounds.forEach(sound => sound.stop());
            }
            this._activeSounds.delete(key);
        }

        // 3. Legacy Cleanup (To fix the "Volume" crash)
        // Actively strip bad flags to self-heal the token.
        if (token.document.flags.sequencer) {
            await token.document.unsetFlag("sequencer", "effects");
        }
    }

    /**
     * Internal helper to play audio effects via AudioHelper.
     * Manually handles Loops and One-Shot cleanup.
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
                const isLoop = effect.loop ?? true;
                const targetVol = Number.isFinite(effect.opacity) ? effect.opacity : 0.8;
                
                const sound = await foundry.audio.AudioHelper.play({
                    src: path,
                    volume: targetVol,
                    loop: isLoop
                }, false);

                if (sound) {
                    activeInstances.push(sound);

                    if (!isLoop) {
                        sound.addEventListener("end", () => {
                            const currentParams = this._activeSounds.get(soundKey);
                            if (currentParams) {
                                const idx = currentParams.indexOf(sound);
                                if (idx > -1) currentParams.splice(idx, 1);
                                // Note: Leave the empty array to prevent race conditions
                            }
                        });
                    }
                }
            } catch (err) {
                console.warn(`Visage | Audio Playback Failed: ${path}`, err);
            }
        });

        await Promise.all(playPromises);
    }

    /**
     * Resolves a raw path or Sequencer Database key into a usable file path.
     */
    static _resolveEffectPath(rawPath) {
        if (!rawPath) return null;
        const isDbKey = !rawPath.includes("/"); 
        if (isDbKey) {
            const entry = this._resolveSequencerRecursively(rawPath);
            if (entry) {
                let file;
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

    static _resolveSequencerRecursively(path, depth = 0) {
        if (depth > 10) return null;
        if (Sequencer.Database.entryExists(path)) {
            const entry = Sequencer.Database.getEntry(path);
            if (Array.isArray(entry) || entry.file) return entry;
        }
        try {
            const children = Sequencer.Database.getEntriesUnder(path);
            if (children && children.length > 0) {
                const randomKey = children[Math.floor(Math.random() * children.length)];
                return this._resolveSequencerRecursively(randomKey, depth + 1);
            }
        } catch(e) { }
        return null;
    }
}