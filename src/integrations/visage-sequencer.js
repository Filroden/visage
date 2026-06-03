import { VisageUtilities } from "../utils/visage-utilities.js";
import { VisageComposer } from "../core/visage-composer.js";

/**
 * Handles interactions with the Sequencer module to play and stop visual/audio effects on tokens.
 * Acts as a bridge between Visage data layers and the Sequencer/AudioHelper APIs.
 * @module visage
 */
export class VisageSequencer {
    /**
     * Map of active pending visual timeouts, keyed by `${tokenId}-${layerTag}`.
     * @type {Map<string, Array<number>>}
     * @private
     */
    static _activeVisualTimeouts = new Map();

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
        if (VisageUtilities.hasSequencer) {
            this._playVisualEffects(token, visuals, tag, offsetMS, anticipatedState, layer.id);
        }

        if (audios.length > 0) this._playAudioEffects(token, audios, tag, offsetMS);
    }

    /**
     * Builds and plays the visual Sequence for a layer using native timeouts.
     * @private
     */
    static _playVisualEffects(token, visuals, tag, offsetMS, anticipatedState, layerId) {
        if (visuals.length === 0) return;

        const tokenId = typeof token === "string" ? token : token?.id;
        const visualKey = `${tokenId}-${tag}`;
        const activeTimeouts = [];
        this._activeVisualTimeouts.set(visualKey, activeTimeouts);

        for (const effect of visuals) {
            const path = this._resolveEffectPath(effect.path);
            if (!path || typeof path !== "string") continue;

            const isLoop = effect.loop ?? true;
            const trueDelayMS = (effect.delay || 0) * 1000 + offsetMS;
            const effectScale = effect.scale ?? 1;

            const playTask = () => {
                if (token && !canvas.tokens.get(tokenId)) return;

                try {
                    const sequence = new Sequence();
                    const { anchorX, anchorY, scaleX, scaleY, mirrorX: flipX, mirrorY: flipY } = anticipatedState;
                    const bindRotation = effect.bindRotation ?? true;
                    const bindToSprite = effect.bindToSprite ?? true;

                    const tScaleX = Math.abs(scaleX ?? 1);
                    const tScaleY = Math.abs(scaleY ?? 1);

                    // 1. Local user offsets (Sequencer will natively flip these, so we pass them raw)
                    let userOffsetX = effect.offsetX ?? 0;
                    let userOffsetY = effect.offsetY ?? 0;

                    // 2. Global displacement (Pre-invert so Sequencer's native .mirrorX cancels out)
                    let globalOffsetX = 0;
                    let globalOffsetY = 0;

                    if (bindToSprite) {
                        globalOffsetX = (0.5 - anchorX) * tScaleX;
                        globalOffsetY = (0.5 - anchorY) * tScaleY;

                        if (flipX) globalOffsetX *= -1;
                        if (flipY) globalOffsetY *= -1;
                    }

                    const totalOffsetX = userOffsetX + globalOffsetX;
                    const totalOffsetY = userOffsetY + globalOffsetY;

                    const tWidth = anticipatedState?.width ?? token.document?.width ?? 1;
                    const tHeight = anticipatedState?.height ?? token.document?.height ?? 1;
                    const gridSize = canvas.grid?.size ?? 100;

                    const pixelOffsetX = totalOffsetX * tWidth * gridSize;
                    const pixelOffsetY = totalOffsetY * tHeight * gridSize;

                    const seqEffect = sequence
                        .effect()
                        .file(path)
                        .attachTo(token, {
                            bindRotation: bindRotation,
                        })
                        .scaleToObject(effectScale, { considerTokenScale: true })
                        .anchor({ x: 0.5, y: 0.5 })
                        .mirrorX(flipX)
                        .mirrorY(flipY)
                        .opacity(effect.opacity ?? 1)
                        .spriteRotation(effect.rotation ?? 0)
                        .belowTokens(effect.zOrder === "below")
                        .name(`${tag}|${effect.id}`)
                        .origin(layerId);

                    if (effect.tint) {
                        seqEffect.tint(effect.tint);
                    }

                    if (pixelOffsetX !== 0 || pixelOffsetY !== 0) {
                        seqEffect.spriteOffset({ x: pixelOffsetX, y: pixelOffsetY });
                    }

                    if (isLoop) seqEffect.duration(31536000000);
                    else seqEffect.missed(false);

                    sequence.play();
                } catch (err) {
                    console.error("Visage | Visual Effect Error:", err);
                }
            };

            if (trueDelayMS > 0) {
                const tid = setTimeout(playTask, trueDelayMS);
                activeTimeouts.push(tid);
            } else {
                playTask();
            }
        }
    }

    /**
     * Restores all active effects.
     */
    static async restore(token) {
        await this.revert(token);

        const stack = token.document.getFlag("visage", "activeStack") || [];
        const identityId = token.document.getFlag("visage", "identity");

        const baseLayer = stack.find((l) => l.id === identityId);
        if (baseLayer) {
            try {
                await this.apply(token, baseLayer, true, true);
            } catch (err) {
                console.warn("Visage | Restore Base Failed:", err);
            }
        }

        const masks = stack.filter((l) => l.id !== identityId);
        for (const mask of masks) {
            try {
                await this.apply(token, mask, false, true);
            } catch (err) {
                console.warn("Visage | Restore Mask Failed:", err);
            }
        }
    }

    static async remove(token, layerId, isBaseLayer = false) {
        const tag = isBaseLayer ? "visage-base" : `visage-mask-${layerId}`;
        const tokenId = typeof token === "string" ? token : token?.id;

        if (tokenId) {
            const visualKey = `${tokenId}-${tag}`;
            if (this._activeVisualTimeouts.has(visualKey)) {
                this._activeVisualTimeouts.get(visualKey).forEach(clearTimeout);
                this._activeVisualTimeouts.delete(visualKey);
            }
        }

        const tokenOnCanvas = token && canvas.tokens.get(tokenId);

        if (tokenOnCanvas && VisageUtilities.hasSequencer) {
            try {
                await Sequencer.EffectManager.endEffects({
                    object: token,
                    name: `${tag}*`,
                });
            } catch (err) {
                console.debug(`Visage | Silently ignoring error during Sequencer effect removal for ${tag}.`, err);
            }
        }

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

    static async revert(tokenOrId) {
        const token = typeof tokenOrId === "string" ? canvas.tokens.get(tokenOrId) : tokenOrId;
        const tokenId = typeof tokenOrId === "string" ? tokenOrId : tokenOrId?.id;

        if (VisageUtilities.hasSequencer) {
            await this._revertVisuals(token);
        }
        this._revertAudio(tokenId);
        await this._revertLegacyFlags(token);
    }

    static async _revertVisuals(token) {
        if (!token) return;
        const tokenId = token.id;

        for (const [key, timeouts] of this._activeVisualTimeouts) {
            if (key.startsWith(`${tokenId}-`)) {
                timeouts.forEach(clearTimeout);
                this._activeVisualTimeouts.delete(key);
            }
        }

        if (!canvas.tokens.get(tokenId)) return;

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

    static _revertAudio(tokenId) {
        if (!tokenId) return;
        for (const [key, instances] of this._activeSounds) {
            if (key.startsWith(`${tokenId}-`)) {
                for (const soundOrPromise of instances) {
                    this._stopAudioInstance(soundOrPromise);
                }
                this._activeSounds.delete(key);
            }
        }
    }

    static async _revertLegacyFlags(token) {
        if (token?.document?.flags?.sequencer) {
            try {
                await token.document.unsetFlag("sequencer", "effects");
            } catch (err) {
                console.debug("Visage | Silently ignoring error removing legacy Sequencer flags.", err);
            }
        }
    }

    static stopAllAudio() {
        for (const instances of this._activeSounds.values()) {
            instances.forEach((soundOrPromise) => {
                this._stopAudioInstance(soundOrPromise);
            });
        }
        this._activeSounds.clear();
    }

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
            }, 20);
        });
    }

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

            if (trueDelayMS > 0) {
                const tid = setTimeout(playTask, trueDelayMS);
                activeInstances.push({ isTimeout: true, id: tid });
            } else {
                playTask();
            }
        });
    }

    static _findAudioInstanceIndex(instances, playResult) {
        for (let i = 0; i < instances.length; i++) {
            if (instances[i] === playResult || instances[i].playResult === playResult) return i;
        }
        return -1;
    }

    static _removeFinishedAudio(soundKey, sound) {
        const latestInstances = this._activeSounds.get(soundKey);
        if (latestInstances) {
            const sIdx = latestInstances.indexOf(sound);
            if (sIdx > -1) latestInstances.splice(sIdx, 1);
        }
    }

    static _resolveEffectPath(rawPath) {
        if (!rawPath) return null;
        if (rawPath.includes("/")) return rawPath;

        if (!VisageUtilities.hasSequencer) {
            console.warn(`Visage | Audio/Visual key "${rawPath}" cannot be resolved because Sequencer is disabled.`);
            return null;
        }

        const entry = this._resolveSequencerRecursively(rawPath);
        if (entry) {
            const file = this._extractFileFromEntry(entry);
            if (file) return file;
        }
        console.warn(`Visage | Sequencer Database Key not found: "${rawPath}".`);
        return null;
    }

    static _extractFileFromEntry(entry) {
        let file = Array.isArray(entry) ? entry[Math.floor(Math.random() * entry.length)] : entry.file;
        if (Array.isArray(file)) {
            file = file[Math.floor(Math.random() * file.length)];
        }
        if (file && typeof file === "object" && file.file) {
            file = file.file;
        }
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
     * Seamlessly updates the physical matrix (anchor/flip/offset) of active Sequencer effects
     * without tearing them down, restarting loops, or interrupting audio.
     * @param {Token} token - The target token.
     * @param {string} layerId - The ID of the Visage layer to update.
     * @param {Object} anticipatedState - The resolved matrix state.
     */
    static refreshMatrix(token, layerId, anticipatedState) {
        if (!VisageUtilities.hasSequencer) return;

        const currentStack = token.document.getFlag("visage", "activeStack") || [];
        const layer = currentStack.find((l) => l.id === layerId);
        const visuals = layer?.changes?.effects || [];

        const activeEffects = Sequencer.EffectManager.getEffects({ object: token, origin: layerId });

        const { anchorX, anchorY, scaleX, scaleY, mirrorX: flipX, mirrorY: flipY, width, height } = anticipatedState;
        const tWidth = width ?? token.document?.width ?? 1;
        const tHeight = height ?? token.document?.height ?? 1;
        const tScaleX = Math.abs(scaleX ?? 1);
        const tScaleY = Math.abs(scaleY ?? 1);
        const gridSize = canvas.grid?.size ?? 100;

        for (const effect of activeEffects) {
            const nameParts = (effect.data?.name || effect.name || "").split("|");
            const effectId = nameParts.length === 2 ? nameParts[1] : null;

            const visageEffect = visuals.find((v) => v.id === effectId);
            const bindToSprite = visageEffect?.bindToSprite ?? true;

            let userOffsetX = visageEffect?.offsetX ?? 0;
            let userOffsetY = visageEffect?.offsetY ?? 0;

            let globalOffsetX = 0;
            let globalOffsetY = 0;

            if (bindToSprite) {
                globalOffsetX = (0.5 - anchorX) * tScaleX;
                globalOffsetY = (0.5 - anchorY) * tScaleY;

                if (flipX) globalOffsetX *= -1;
                if (flipY) globalOffsetY *= -1;
            }

            const totalOffsetX = userOffsetX + globalOffsetX;
            const totalOffsetY = userOffsetY + globalOffsetY;

            const pixelOffsetX = totalOffsetX * tWidth * gridSize;
            const pixelOffsetY = totalOffsetY * tHeight * gridSize;

            effect.update({
                anchor: { x: 0.5, y: 0.5 },
                mirrorX: flipX,
                mirrorY: flipY,
                spriteOffset: { x: pixelOffsetX, y: pixelOffsetY },
            });
        }
    }
}
