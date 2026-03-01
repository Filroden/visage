import { VisageUtilities } from "../utils/visage-utilities.js";

/**
 * Handles interactions with the Sequencer module to play and stop visual/audio effects on tokens.
 * Acts as a bridge between Visage data layers and the Sequencer/AudioHelper APIs.
 * @module visage
 */
export class VisageSequencer {
    /**
     * Map of active audio instances, keyed by `${tokenId}-${layerTag}`.
     * Used to track and stop looping audio effects when masks are removed.
     * @type {Map<string, Array<Sound|Promise>>}
     * @private
     */
    static _activeSounds = new Map();

    /**
     * Applies all visual and audio effects defined in a Visage Layer to a token.
     * Uses "Infinite Duration" strategy to avoid Persistence crashes on refresh.
     * @param {Token} token
     * @param {Object} layer
     * @param {boolean} isBaseLayer
     * @param {boolean} isRestore - If true, non-looping (one-shot) effects are skipped.
     */
    static async apply(token, layer, isBaseLayer = false, isRestore = false) {
        if (!VisageUtilities.hasSequencer) return;

        const effects = layer.changes?.effects || [];
        const tag = isBaseLayer ? "visage-base" : `visage-mask-${layer.id}`;

        // 1. Clean Slate
        await this.remove(token, layer.id, isBaseLayer);

        if (layer.disabled || !effects.length) return;

        let visuals = effects.filter((e) => e.type === "visual" && !e.disabled);
        let audios = effects.filter((e) => e.type === "audio" && !e.disabled);

        if (isRestore) {
            visuals = visuals.filter((e) => (e.loop ?? true) === true);
            audios = audios.filter((e) => (e.loop ?? true) === true);
        }

        // --- THE ZERO ANCHOR MATH ---
        // Find the most negative delay across all active effects. If none are negative, offset is 0.
        const allActive = [...visuals, ...audios];
        const minDelaySeconds = Math.min(
            0,
            ...allActive.map((e) => e.delay || 0),
        );
        const offsetMS = Math.abs(minDelaySeconds) * 1000;

        // --- A. VISUALS (Sequencer) ---
        if (visuals.length > 0) {
            try {
                const sequence = new Sequence();
                let hasVisuals = false;

                for (const effect of visuals) {
                    const path = this._resolveEffectPath(effect.path);
                    if (!path || typeof path !== "string") continue;

                    const isLoop = effect.loop ?? true;
                    // Apply the true start time
                    const trueDelayMS = (effect.delay || 0) * 1000 + offsetMS;

                    let seqEffect = sequence
                        .effect()
                        .file(path)
                        .attachTo(token)
                        .scaleToObject(effect.scale ?? 1.0)
                        .opacity(effect.opacity ?? 1.0)
                        .rotate(effect.rotation ?? 0)
                        .belowTokens(effect.zOrder === "below")
                        .delay(trueDelayMS) // <-- FIXED: True relative delay
                        .name(tag)
                        .origin(layer.id);

                    if (isLoop) {
                        seqEffect.duration(31536000000);
                    } else {
                        seqEffect.missed(false);
                    }
                    hasVisuals = true;
                }

                if (hasVisuals) sequence.play();
            } catch (err) {
                console.error("Visage | Visual Effect Error:", err);
            }
        }

        // --- B. AUDIO (AudioHelper) ---
        if (audios.length > 0) {
            // Pass the calculated offset down to the audio processor
            this._playAudioEffects(token, audios, tag, offsetMS);
        }
    }

    /**
     * Restores all active effects.
     * Called on scene load or when a token is generated.
     */
    static async restore(token) {
        if (!VisageUtilities.hasSequencer) return;

        // 1. Wipe current effects to prevent duplication
        await this.revert(token);

        const stack = token.document.getFlag("visage", "activeStack") || [];
        const identityId = token.document.getFlag("visage", "identity");

        // 2. Re-Apply Base Identity (Pass isRestore = true)
        const baseLayer = stack.find((l) => l.id === identityId);
        if (baseLayer) {
            try {
                await this.apply(token, baseLayer, true, true);
            } catch (err) {
                console.warn("Visage | Restore Base Failed:", err);
            }
        }

        // 3. Re-Apply Overlays (Masks) (Pass isRestore = true)
        const masks = stack.filter((l) => l.id !== identityId);
        for (const mask of masks) {
            try {
                await this.apply(token, mask, false, true);
            } catch (err) {
                console.warn("Visage | Restore Mask Failed:", err);
            }
        }
    }

    /**
     * Removes effects associated with a specific layer ID from a token.
     */
    static async remove(token, layerId, isBaseLayer = false) {
        if (!VisageUtilities.hasSequencer) return;

        const tag = isBaseLayer ? "visage-base" : `visage-mask-${layerId}`;
        const tokenId = typeof token === "string" ? token : token?.id;

        // 1. Kill Visuals
        if (token) {
            try {
                await Sequencer.EffectManager.endEffects({
                    object: token,
                    name: tag,
                });
            } catch (e) {
                /* Ignore */
            }
        }

        // 2. Kill Audio (Safely resolve any still-loading promises and handle fades)
        if (tokenId) {
            const soundKey = `${tokenId}-${tag}`;
            if (this._activeSounds.has(soundKey)) {
                const instances = this._activeSounds.get(soundKey);
                instances.forEach((item) => {
                    if (item.isTimeout) {
                        clearTimeout(item.id);
                    } else if (item.isPromise) {
                        item.playResult.then((s) => {
                            if (s && typeof s.stop === "function") {
                                s.volume = 0;
                                s.stop();
                            }
                        });
                    } else if (item && typeof item.stop === "function") {
                        const fadeOut = item.visageFadeOut || 0;
                        if (fadeOut > 0 && item.playing) {
                            this._fadeAudio(item, item.volume, 0, fadeOut).then(
                                () => item.stop(),
                            );
                        } else {
                            item.volume = 0;
                            item.stop();
                        }
                    }
                });
                this._activeSounds.delete(soundKey);
            }
        }
    }

    /**
     * Completely wipes all Visage-related effects from a token.
     */
    static async revert(tokenOrId) {
        if (!VisageUtilities.hasSequencer) return;

        const token =
            typeof tokenOrId === "string"
                ? canvas.tokens.get(tokenOrId)
                : tokenOrId;
        const tokenId =
            typeof tokenOrId === "string" ? tokenOrId : tokenOrId?.id;

        // 1. Kill Visuals
        if (token) {
            try {
                await Sequencer.EffectManager.endEffects({
                    object: token,
                    name: "visage-base",
                });
                const effects = Sequencer.EffectManager.getEffects({
                    object: token,
                });
                const targets = effects.filter(
                    (e) =>
                        e.data.name && e.data.name.startsWith("visage-mask-"),
                );
                for (const effect of targets) {
                    await Sequencer.EffectManager.endEffects({
                        object: token,
                        name: effect.data.name,
                    });
                }
            } catch (e) {
                /* Ignore */
            }
        }

        // 2. Kill Audio
        if (tokenId) {
            for (const [key, instances] of this._activeSounds) {
                if (key.startsWith(`${tokenId}-`)) {
                    instances.forEach((soundOrPromise) => {
                        if (soundOrPromise instanceof Promise) {
                            soundOrPromise.then((s) => {
                                if (s && typeof s.stop === "function") {
                                    s.volume = 0;
                                    s.stop();
                                }
                            });
                        } else if (
                            soundOrPromise &&
                            typeof soundOrPromise.stop === "function"
                        ) {
                            soundOrPromise.volume = 0;
                            soundOrPromise.stop();
                        }
                    });
                    this._activeSounds.delete(key);
                }
            }
        }

        // 3. Legacy Cleanup
        if (token && token.document && token.document.flags.sequencer) {
            try {
                await token.document.unsetFlag("sequencer", "effects");
            } catch (e) {
                /* Ignore */
            }
        }
    }

    /**
     * Instantly terminates all playing Visage audio.
     * Used during scene transitions to prevent cross-scene leaking.
     */
    static stopAllAudio() {
        for (const [key, instances] of this._activeSounds) {
            instances.forEach((soundOrPromise) => {
                if (soundOrPromise instanceof Promise) {
                    soundOrPromise.then((s) => {
                        if (s && typeof s.stop === "function") {
                            s.volume = 0;
                            s.stop();
                        }
                    });
                } else if (
                    soundOrPromise &&
                    typeof soundOrPromise.stop === "function"
                ) {
                    soundOrPromise.volume = 0;
                    soundOrPromise.stop();
                }
            });
        }
        this._activeSounds.clear();
    }

    /**
     * Helper to gradually shift an audio's volume.
     */
    static _fadeAudio(sound, startVol, endVol, durationMS) {
        return new Promise((resolve) => {
            if (!sound || durationMS <= 0) {
                if (sound) sound.volume = endVol;
                return resolve();
            }
            let startTime = Date.now();
            const interval = setInterval(() => {
                const elapsed = Date.now() - startTime;
                let progress = elapsed / durationMS;
                if (progress >= 1) {
                    progress = 1;
                    clearInterval(interval);
                }
                sound.volume = startVol + (endVol - startVol) * progress;
                if (progress === 1) resolve();
            }, 20); // 50fps smooth fade
        });
    }

    /**
     * Internal helper to play audio effects via AudioHelper.
     */
    static _playAudioEffects(token, audios, tag, offsetMS = 0) {
        const tokenId = typeof token === "string" ? token : token?.id;
        if (!tokenId) return;

        const soundKey = `${tokenId}-${tag}`;
        const activeInstances = [];
        this._activeSounds.set(soundKey, activeInstances);

        audios.forEach((effect) => {
            const path = this._resolveEffectPath(effect.path);
            if (!path || typeof path !== "string") return;

            const isLoop = effect.loop ?? true;
            const targetVol = Number.isFinite(effect.opacity)
                ? effect.opacity
                : 0.8;

            // Calculate true start time
            const trueDelayMS = (effect.delay || 0) * 1000 + offsetMS;

            const fadeInMS = effect.fadeIn || 0;
            const fadeOutMS = effect.fadeOut || 0;

            const playTask = () => {
                const playResult = foundry.audio.AudioHelper.play(
                    {
                        src: path,
                        volume: fadeInMS > 0 ? 0 : targetVol,
                        loop: isLoop,
                    },
                    false,
                );

                const handleSoundLoad = (sound) => {
                    const currentInstances = this._activeSounds.get(soundKey);
                    if (
                        !currentInstances ||
                        currentInstances !== activeInstances
                    ) {
                        if (sound) {
                            try {
                                sound.volume = 0;
                                sound.stop();
                            } catch (err) {
                                /* Ignore */
                            }
                        }
                        return null;
                    }

                    if (sound) {
                        sound.visageFadeOut = fadeOutMS;
                        const idx = currentInstances.findIndex(
                            (i) =>
                                i === playResult || i.playResult === playResult,
                        );
                        if (idx > -1) currentInstances[idx] = sound;

                        if (fadeInMS > 0)
                            this._fadeAudio(sound, 0, targetVol, fadeInMS);

                        if (!isLoop) {
                            sound.addEventListener("end", () => {
                                const latestInstances =
                                    this._activeSounds.get(soundKey);
                                if (latestInstances) {
                                    const sIdx = latestInstances.indexOf(sound);
                                    if (sIdx > -1)
                                        latestInstances.splice(sIdx, 1);
                                }
                            });
                        }
                    }
                    return sound;
                };

                if (playResult instanceof Promise) {
                    activeInstances.push({ isPromise: true, playResult });
                    playResult.then(handleSoundLoad);
                } else {
                    activeInstances.push(playResult);
                    handleSoundLoad(playResult);
                }
            };

            // Respect True Start Delay
            if (trueDelayMS > 0) {
                const tid = setTimeout(playTask, trueDelayMS);
                activeInstances.push({ isTimeout: true, id: tid });
            } else {
                playTask();
            }
        });
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
                if (Array.isArray(entry))
                    file = entry[Math.floor(Math.random() * entry.length)];
                else {
                    file = entry.file;
                    if (Array.isArray(file))
                        file = file[Math.floor(Math.random() * file.length)];
                }
                if (file && typeof file === "object" && file.file)
                    file = file.file;
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
                const randomKey =
                    children[Math.floor(Math.random() * children.length)];
                return this._resolveSequencerRecursively(randomKey, depth + 1);
            }
        } catch (e) {
            /* The path might not have children; ignore and return null */
        }
        return null;
    }
}
