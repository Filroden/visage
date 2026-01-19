import { VisageUtilities } from "./visage-utilities.js";

/**
 * Handles interactions with the Sequencer module to play/stop effects on tokens.
 */
export class VisageSequencer {

    static _activeSounds = new Map();

    /**
     * Applies effects for a given layer.
     */
    static async apply(token, layer, isBaseLayer = false) {
        if (!VisageUtilities.hasSequencer) return;
        
        const effects = layer.changes?.effects || [];
        if (!effects.length) return;

        const tag = isBaseLayer ? "visage-base" : `visage-mask-${layer.id}`;

        await this.remove(token, layer.id, isBaseLayer);

        const visuals = effects.filter(e => e.type === "visual" && !e.disabled);
        const audios = effects.filter(e => e.type === "audio" && !e.disabled);

        if (visuals.length > 0) {
            try {
                const sequence = new Sequence();
                let hasVisuals = false;
                
                for (const effect of visuals) {
                    const path = this._resolveEffectPath(effect.path);
                    if (!path) continue;

                    sequence.effect()
                        .file(path)
                        .attachTo(token)
                        .scaleToObject(effect.scale ?? 1.0)
                        .opacity(effect.opacity ?? 1.0)
                        .rotate(effect.rotation ?? 0)
                        .belowTokens(effect.zOrder === "below")
                        .persist()
                        .name(tag)
                        .origin(layer.id);
                    
                    hasVisuals = true;
                }
                if (hasVisuals) sequence.play();
            } catch (err) {
                console.error("Visage | Visual Effect Error:", err);
            }
        }

        if (audios.length > 0) {
            this._playAudioEffects(token, audios, tag).catch(err => {
                console.warn("Visage | Audio Playback Error:", err);
            });
        }
    }

    /**
     * FULL RESTORE
     */
    static async restore(token) {
        if (!VisageUtilities.hasSequencer) return;

        // SAFETY: Do not attempt restore if Database is not loaded.
        // This prevents wiping the token if Sequencer is lagging.
        try {
            // Check for DB entries (V2/V3 compatibility)
            const db = Sequencer.Database.entries;
            const size = db ? (db.size || Object.keys(db).length) : 0;
            if (!db || size === 0) {
                // Console warning removed to reduce noise; silent fail is safer here as retry logic handles it
                return;
            }
        } catch(e) { return; }

        await this.revert(token);

        const stack = token.document.getFlag("visage", "activeStack") || [];
        const identityId = token.document.getFlag("visage", "identity");

        const baseLayer = stack.find(l => l.id === identityId);
        if (baseLayer) {
            try { await this.apply(token, baseLayer, true); } 
            catch (err) { console.warn("Visage | Restore Base Failed:", err); }
        }

        const masks = stack.filter(l => l.id !== identityId);
        for (const mask of masks) {
            try { await this.apply(token, mask, false); } 
            catch (err) { console.warn("Visage | Restore Mask Failed:", err); }
        }
    }

    static async _playAudioEffects(token, audios, tag) {
        const soundKey = `${token.id}-${tag}`;
        const activeInstances = [];
        this._activeSounds.set(soundKey, activeInstances);

        const playPromises = audios.map(async (effect) => {
            const path = this._resolveEffectPath(effect.path);
            if (!path || typeof path !== "string") return;

            try {
                const vol = Number.isFinite(effect.opacity) ? effect.opacity : 0.8;
                
                const sound = await foundry.audio.AudioHelper.play({
                    src: path,
                    volume: vol,
                    loop: true
                }, false);

                if (sound) {
                    activeInstances.push(sound);
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

    static async remove(token, layerId, isBaseLayer = false) {
        const tag = isBaseLayer ? "visage-base" : `visage-mask-${layerId}`;

        if (VisageUtilities.hasSequencer) {
            try {
                await Sequencer.EffectManager.endEffects({ object: token, name: tag });
            } catch(e) { /* Ignore */ }
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

    static async revert(token) {
        if (!VisageUtilities.hasSequencer) return;

        if (token.document.flags.sequencer) {
            await token.document.unsetFlag("sequencer", "effects");
        }

        for (const [key, sounds] of this._activeSounds) {
            if (key.startsWith(`${token.id}-`)) {
                sounds.forEach(sound => sound.stop());
            }
            this._activeSounds.delete(key);
        }
    }

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
        } catch(e) { /* Ignore */ }
        return null;
    }
}