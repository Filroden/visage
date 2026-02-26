/**
 * VISAGE MEDIA CONTROLLER
 * -------------------------------------------------------------------
 * A specialized helper class responsible for resolving asset paths,
 * formatting visual effect styles, and managing audio lifecycles for
 * the Visage live preview stage.
 * * ARCHITECTURAL OVERVIEW:
 * 1. Path Resolution: Evaluates user input to determine if it is a standard
 * file path or a 'Sequencer' database key, recursively resolving the latter.
 * 2. Visual Formatting: Translates visual effect data into inline CSS
 * transformations for the preview DOM.
 * 3. Audio Lifecycle: Maintains a map of active Audio instances, ensuring
 * that volume changes sync in real-time and orphaned sounds are
 * immediately destroyed to prevent memory leaks and audio overlap.
 */

import { VisageUtilities } from "../../utils/visage-utilities.js";

/**
 * Handles Sequencer Database resolution, path cleaning, and Audio Preview lifecycles.
 */
export class VisageMediaController {
    constructor() {
        this.audioPreviews = new Map();
    }

    /** Core resolution logic to turn user input into file paths or module keys. */
    resolvePath(rawPath) {
        if (!rawPath) return null;
        const isDbKey = VisageUtilities.hasSequencer && !rawPath.includes("/");
        if (isDbKey) {
            const entry = this._resolveSequencerRecursively(rawPath);
            if (entry) {
                let file = Array.isArray(entry)
                    ? entry[Math.floor(Math.random() * entry.length)]
                    : entry.file || entry;
                if (Array.isArray(file))
                    file = file[Math.floor(Math.random() * file.length)];
                if (file && typeof file === "object" && file.file)
                    file = file.file;
                if (typeof file === "string") return file;
            }
            return null;
        }
        return rawPath;
    }

    _resolveSequencerRecursively(path, depth = 0) {
        if (depth > 10) return null;
        let entry = Sequencer.Database.getEntry(path);
        if (entry && (Array.isArray(entry) || entry.file)) return entry;
        try {
            const children = Sequencer.Database.getEntriesUnder(path);
            if (children?.length > 0) {
                const randomKey =
                    children[Math.floor(Math.random() * children.length)];
                return this._resolveSequencerRecursively(randomKey, depth + 1);
            }
        } catch (e) {
            /* Ignore */
        }
        return null;
    }

    /** Prepares inline CSS for a visual effect on the preview stage. */
    prepareEffectStyle(effect) {
        const resolvedPath = this.resolvePath(effect.path);
        return {
            ...effect,
            resolvedPath,
            isVideo: resolvedPath
                ? VisageUtilities.isVideo(resolvedPath)
                : false,
            style: `transform: translate(-50%, -50%) scale(${effect.scale}) rotate(${effect.rotation}deg); opacity: ${effect.opacity}; mix-blend-mode: ${effect.blendMode || "normal"}; filter: ${effect.tint ? `drop-shadow(0 0 0 ${effect.tint})` : "none"};`,
        };
    }

    /** Manages audio playback, tracking active instances and pruning orphans. */
    syncAudio(effects, isRendered) {
        const activeEffects = effects.filter(
            (e) => !e.disabled && e.type === "audio" && e.path,
        );
        const activeIds = new Set(activeEffects.map((e) => e.id));

        // Kill orphaned sounds
        for (const [id, sound] of this.audioPreviews) {
            if (!activeIds.has(id)) {
                this._stopSound(sound);
                this.audioPreviews.delete(id);
            }
        }

        // Play or update active sounds
        activeEffects.forEach((e) => {
            const vol = e.opacity ?? 0.8;
            if (this.audioPreviews.has(e.id)) {
                const sound = this.audioPreviews.get(e.id);
                if (sound instanceof Promise) return; // Still loading
                if (sound.volume !== vol) sound.volume = vol;
                if (sound._visageSrc !== e.path) {
                    this._stopSound(sound);
                    this.audioPreviews.delete(e.id);
                } else return;
            }

            if (!this.audioPreviews.has(e.id)) {
                const resolvedPath = this.resolvePath(e.path);
                if (!resolvedPath) return;

                const playResult = foundry.audio.AudioHelper.play(
                    { src: resolvedPath, volume: vol, loop: e.loop ?? true },
                    false,
                );
                const handleSoundLoad = (sound) => {
                    if (
                        !effects.find((fx) => fx.id === e.id && !fx.disabled) ||
                        !sound ||
                        !isRendered
                    ) {
                        this._stopSound(sound);
                        this.audioPreviews.delete(e.id);
                        return null;
                    }
                    sound._visageSrc = e.path;
                    this.audioPreviews.set(e.id, sound);
                    return sound;
                };

                if (playResult instanceof Promise) {
                    this.audioPreviews.set(e.id, playResult);
                    playResult.then(handleSoundLoad);
                } else handleSoundLoad(playResult);
            }
        });
    }

    stopAll() {
        for (const [id, sound] of this.audioPreviews) {
            this._stopSound(sound);
        }
        this.audioPreviews.clear();
    }

    _stopSound(sound) {
        if (!sound) return;
        if (sound instanceof Promise) {
            sound.then((s) => {
                if (s) {
                    try {
                        s.volume = 0;
                        if (s.stop) s.stop();
                    } catch (e) {
                        /* Ignore */
                    }
                }
            });
        } else {
            try {
                sound.volume = 0;
                if (sound.stop) sound.stop();
            } catch (e) {
                /* Ignore */
            }
        }
    }
}
