import { VisageUtilities } from "../utils/visage-utilities.js";
import { VisageComposer } from "../core/visage-composer.js";

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
    static async apply(token, layer, isBaseLayer = false, isRestore = false, anticipatedState = null) {
        if (!VisageUtilities.hasSequencer) return;

        const effects = layer.changes?.effects || [];
        const tag = isBaseLayer ? "visage-base" : `visage-mask-${layer.id}`;

        // 1. Clean Slate
        await this.remove(token, layer.id, isBaseLayer);

        if (layer.disabled || !effects.length) return;

        // 2. Filter Effects
        let visuals = effects.filter((e) => e.type === "visual" && !e.disabled);
        let audios = effects.filter((e) => e.type === "audio" && !e.disabled);

        if (isRestore) {
            visuals = visuals.filter((e) => (e.loop ?? true) === true);
            audios = audios.filter((e) => (e.loop ?? true) === true);
        }

        // 3. The Zero Anchor Math
        const allActive = [...visuals, ...audios];
        const minDelaySeconds = Math.min(0, ...allActive.map((e) => e.delay || 0));
        const offsetMS = Math.abs(minDelaySeconds) * 1000;

        // 4. Anticipated State Resolution
        if (!anticipatedState) {
            const stack = token.document?.getFlag("visage", "activeStack") || [];
            const originalState = token.document?.getFlag("visage", "originalState") || {};
            anticipatedState = VisageComposer.resolveTextureState(stack, originalState);
        }

        // 5. Fire Subsystems
        this._playVisualEffects(token, visuals, tag, offsetMS, anticipatedState, layer.id);
        if (audios.length > 0) this._playAudioEffects(token, audios, tag, offsetMS);
    }

    /**
     * Builds and plays the visual Sequence for a layer.
     * @private
     */
    static _playVisualEffects(token, visuals, tag, offsetMS, anticipatedState, layerId) {
        if (visuals.length === 0) return;

        try {
            const sequence = new Sequence();
            let hasVisuals = false;

            for (const effect of visuals) {
                const path = this._resolveEffectPath(effect.path);
                if (!path || typeof path !== "string") continue;

                const isLoop = effect.loop ?? true;
                const trueDelayMS = (effect.delay || 0) * 1000 + offsetMS;
                const effectScale = effect.scale ?? 1;

                // --- Dampen the anchor shift based on effect scale ---
                const anchorData = this._calculateDampenedAnchor(anticipatedState, effectScale);

                const seqEffect = sequence
                    .effect()
                    .file(path)
                    .attachTo(token)
                    .scaleToObject(effectScale, { considerTokenScale: true })
                    .anchor({ x: anchorData.x, y: anchorData.y })
                    .mirrorX(anchorData.flipX)
                    .mirrorY(anchorData.flipY)
                    .opacity(effect.opacity ?? 1)
                    .rotate(effect.rotation ?? 0)
                    .belowTokens(effect.zOrder === "below")
                    .delay(trueDelayMS)
                    .name(`${tag}|${effect.id}`)
                    .origin(layerId);

                if (isLoop) seqEffect.duration(31536000000);
                else seqEffect.missed(false);

                hasVisuals = true;
            }

            if (hasVisuals) sequence.play();
        } catch (err) {
            console.error("Visage | Visual Effect Error:", err);
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
        // Safety check: Only tell Sequencer to kill effects if the token is still on the canvas.
        // If the token was deleted, Sequencer automatically garbage-collects attached effects.
        const tokenOnCanvas = token && canvas.tokens.get(tokenId);

        if (tokenOnCanvas) {
            try {
                await Sequencer.EffectManager.endEffects({
                    object: token,
                    name: `${tag}*`,
                });
            } catch (err) {
                console.debug(`Visage | Silently ignoring error during Sequencer effect removal for ${tag}.`, err);
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
                            this._fadeAudio(item, item.volume, 0, fadeOut).then(() => item.stop());
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

        const token = typeof tokenOrId === "string" ? canvas.tokens.get(tokenOrId) : tokenOrId;
        const tokenId = typeof tokenOrId === "string" ? tokenOrId : tokenOrId?.id;

        await this._revertVisuals(token);
        this._revertAudio(tokenId);
        await this._revertLegacyFlags(token);
    }

    // ==========================================
    // REVERT HELPER METHODS
    // ==========================================

    /**
     * Clears all Sequencer visual effects for a token.
     * @private
     */
    static async _revertVisuals(token) {
        if (!token) return;

        // Safety check: Sequencer auto-cleans effects on deleted tokens.
        if (!canvas.tokens.get(token.id)) return;

        try {
            await Sequencer.EffectManager.endEffects({ object: token, name: "visage-base*" });

            const effects = Sequencer.EffectManager.getEffects({ object: token });
            const targets = effects.filter((e) => e.data.name?.startsWith("visage-mask-"));

            for (const effect of targets) {
                await Sequencer.EffectManager.endEffects({ object: token, name: effect.data.name });
            }
        } catch (err) {
            console.debug("Visage | Silently ignoring error during full Sequencer revert.", err);
        }
    }

    /**
     * Safely halts an individual audio instance or pending promise.
     * @private
     */
    static _stopAudioInstance(soundOrPromise) {
        if (soundOrPromise instanceof Promise) {
            soundOrPromise.then((s) => {
                if (s && typeof s.stop === "function") {
                    s.volume = 0;
                    s.stop();
                }
            });
        } else if (soundOrPromise && typeof soundOrPromise.stop === "function") {
            soundOrPromise.volume = 0;
            soundOrPromise.stop();
        }
    }

    /**
     * Cleans up all tracked active audio loops for a token.
     * @private
     */
    static _revertAudio(tokenId) {
        if (!tokenId) return;
        for (const [key, instances] of this._activeSounds) {
            if (key.startsWith(`${tokenId}-`)) {
                // Using a standard for loop avoids the arrow function nesting of .forEach()
                for (const soundOrPromise of instances) {
                    this._stopAudioInstance(soundOrPromise);
                }
                this._activeSounds.delete(key);
            }
        }
    }

    /**
     * Cleans up legacy flags from older versions of the module.
     * @private
     */
    static async _revertLegacyFlags(token) {
        if (token?.document?.flags?.sequencer) {
            try {
                await token.document.unsetFlag("sequencer", "effects");
            } catch (err) {
                console.debug("Visage | Silently ignoring error removing legacy Sequencer flags.", err);
            }
        }
    }

    /**
     * Instantly terminates all playing Visage audio.
     * Used during scene transitions to prevent cross-scene leaking.
     */
    static stopAllAudio() {
        for (const instances of this._activeSounds.values()) {
            instances.forEach((soundOrPromise) => {
                if (soundOrPromise instanceof Promise) {
                    soundOrPromise.then((s) => {
                        if (s && typeof s.stop === "function") {
                            s.volume = 0;
                            s.stop();
                        }
                    });
                } else if (soundOrPromise && typeof soundOrPromise.stop === "function") {
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
            const targetVol = Number.isFinite(effect.opacity) ? effect.opacity : 0.8;

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
                    if (!currentInstances || currentInstances !== activeInstances) {
                        if (sound) {
                            try {
                                sound.volume = 0;
                                sound.stop();
                            } catch (err) {
                                console.debug("Visage | Silently ignoring error stopping orphaned audio instance.", err);
                            }
                        }
                        return null;
                    }

                    if (sound) {
                        sound.visageFadeOut = fadeOutMS;
                        const idx = this._findAudioInstanceIndex(currentInstances, playResult);
                        if (idx > -1) currentInstances[idx] = sound;
                        if (fadeInMS > 0) this._fadeAudio(sound, 0, targetVol, fadeInMS);
                        if (!isLoop) {
                            sound.addEventListener("end", this._removeFinishedAudio.bind(this, soundKey, sound));
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
     * Locates a specific audio instance or its pending promise in the active instances array.
     * Replacing array.findIndex() removes an unnecessary nested arrow function.
     * @private
     */
    static _findAudioInstanceIndex(instances, playResult) {
        for (let i = 0; i < instances.length; i++) {
            if (instances[i] === playResult || instances[i].playResult === playResult) return i;
        }
        return -1;
    }

    /**
     * Cleans up an audio instance from the registry when it finishes playing.
     * @private
     */
    static _removeFinishedAudio(soundKey, sound) {
        const latestInstances = this._activeSounds.get(soundKey);
        if (latestInstances) {
            const sIdx = latestInstances.indexOf(sound);
            if (sIdx > -1) latestInstances.splice(sIdx, 1);
        }
    }

    /**
     * Resolves a raw path or Sequencer Database key into a usable file path.
     */
    static _resolveEffectPath(rawPath) {
        if (!rawPath) return null;

        // If it's already a direct file path, return it immediately
        if (rawPath.includes("/")) return rawPath;

        // Otherwise, attempt to resolve the database key
        const entry = this._resolveSequencerRecursively(rawPath);
        if (entry) {
            const file = this._extractFileFromEntry(entry);
            if (file) return file;
        }

        // Failsafe warning if the key is invalid or the content module is missing
        console.warn(`Visage | Sequencer Database Key not found: "${rawPath}". Have you enabled the required content module (e.g., JB2A or PSFX) in this world?`);
        return null;
    }

    /**
     * Unpacks a Sequencer database entry to find the underlying string file path.
     * @private
     */
    static _extractFileFromEntry(entry) {
        // 1. Unpack the base entry
        let file = Array.isArray(entry) ? entry[Math.floor(Math.random() * entry.length)] : entry.file;

        // 2. Unpack if the file itself is an array of variants
        if (Array.isArray(file)) {
            file = file[Math.floor(Math.random() * file.length)];
        }

        // 3. Unpack if the file is an object wrapper
        if (file && typeof file === "object" && file.file) {
            file = file.file;
        }

        // 4. Return if we successfully found a string path
        return typeof file === "string" ? file : null;
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
        } catch (err) {
            console.debug(`Visage | Sequencer path "${path}" has no children or failed to resolve.`, err);
        }
        return null;
    }

    /**
     * Seamlessly updates the physical matrix (anchor/flip) of active Sequencer effects
     * without tearing them down, restarting loops, or interrupting audio.
     * @param {Token} token - The target token.
     * @param {string} layerId - The ID of the Visage layer to update.
     * @param {Object} anticipatedState - The resolved matrix state.
     */
    static refreshMatrix(token, layerId, anticipatedState) {
        if (!VisageUtilities.hasSequencer) return;

        // Fetch the original layer data so we know the scales of the running effects
        const currentStack = token.document.getFlag("visage", "activeStack") || [];
        const layer = currentStack.find((l) => l.id === layerId);

        // Safely handle legacy stacks already on the canvas
        const visuals = layer?.changes?.effects || [];

        const activeEffects = Sequencer.EffectManager.getEffects({ object: token, origin: layerId });

        for (const effect of activeEffects) {
            // Extract the original effect ID from the custom name tag
            const nameParts = (effect.data?.name || effect.name || "").split("|");
            const effectId = nameParts.length === 2 ? nameParts[1] : null;

            // Look up the scale (default to 1.0 if something goes wrong)
            const visageEffect = visuals.find((v) => v.id === effectId);
            const effectScale = visageEffect?.scale ?? 1;

            // Apply the dampened formula via the single source of truth
            const anchorData = this._calculateDampenedAnchor(anticipatedState, effectScale);

            effect.update({
                anchor: { x: anchorData.x, y: anchorData.y },
                mirrorX: anchorData.flipX,
                mirrorY: anchorData.flipY,
            });
        }
    }

    /**
     * Calculates the dampened anchor points for Sequencer visual effects.
     * Compounds the effect scale with the token's texture scale to prevent
     * alignment breaking when the token art visually outgrows its bounding box.
     * @private
     */
    static _calculateDampenedAnchor(anticipatedState, effectScale = 1) {
        const { anchorX, anchorY, mirrorX: flipX, mirrorY: flipY } = anticipatedState;

        const seqAnchorX = flipX ? 1 - anchorX : anchorX;
        const seqAnchorY = flipY ? 1 - anchorY : anchorY;

        return {
            // The anchor dampening MUST only divide by the effect's internal scale.
            // The token's texture scale natively cancels out in the physical offset math.
            x: 0.5 - (0.5 - seqAnchorX) / effectScale,
            y: 0.5 - (0.5 - seqAnchorY) / effectScale,
            flipX,
            flipY,
        };
    }
}
