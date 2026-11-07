/**
 * Integration layer for "Tokenizer 2".
 *
 * Opens Tokenizer 2's editor from the Visage Editor without an actor, and turns what was saved
 * there into Visage settings. Visage only calls Tokenizer 2's public API (openEditorStandalone);
 * it stores none of Tokenizer 2's own data, so Visages made this way keep working when the
 * module is disabled or removed (the saved images are ordinary files).
 *
 * openEditorStandalone resolves when Tokenizer 2's editor closes, with everything saved during
 * that session merged into one result:
 *   { tokenPath?, avatarPath?, prototypeToken?, avatarUpdate?, layerStack?, avatarLayerStack? }
 * It resolves null when nothing was saved, or when another Tokenizer 2 editor was busy and could
 * not be closed. prototypeToken is a flat update object ("prototypeToken.ring.enabled": true),
 * exactly what Tokenizer 2 would write to an actor's prototype token after the same save.
 *
 * Only the image paths and the canvas settings from that update are used. Tokenizer 2's own
 * records (the layer stacks and the "tokenizer-2.oversizedScale" flag) are ignored, because
 * they only matter to Tokenizer 2 and would make Visage data depend on its internal format.
 */

const MODULE_ID = "tokenizer-2";

/** Prefix of every key in the result's prototypeToken update. */
const PATCH_PREFIX = "prototypeToken.";

/** Token texture scale of a design that is not oversized. */
const BASE_SCALE = 1;

export class VisageTokenizer {
    /** Tokenizer 2's public API, or null while the module is inactive. */
    static get api() {
        const module = game.modules.get(MODULE_ID);
        if (!module?.active) return null;
        return module.api ?? globalThis.Tokenizer2 ?? null;
    }

    /**
     * True when Tokenizer 2's standalone editor can be opened. The API method is tested
     * directly, rather than a version number, so a release that renames or removes it simply
     * hides the Visage buttons.
     */
    static get isActive() {
        return typeof this.api?.openEditorStandalone === "function";
    }

    /**
     * True when the current user should be offered the Tokenizer buttons. Only Game Masters are:
     * Tokenizer 2 holds a player's save until a GM approves it, so a player's Visage field would
     * be left empty with no clear reason.
     */
    static get isAvailable() {
        return game.user.isGM && this.isActive;
    }

    /**
     * A file name that cannot match an earlier save. Tokenizer 2 overwrites a file of the same
     * name without warning, which would replace art that other Visages or tokens still use, and
     * an image overwritten in place can show its old version until the browser cache refreshes.
     * The date and time make every save a new file. Tokenizer 2 adds its own prefix (by default
     * "Token." or "Avatar.") and the GM can still change the name in its save dialog.
     *
     * @param {string} [label] - The Visage's label.
     * @returns {string} For example "Wolf-20261107-143205".
     */
    static uniqueName(label) {
        const base = label?.trim() || game.i18n.localize("VISAGE.Tokenizer.DefaultName");
        return `${base}-${timestamp(new Date())}`;
    }

    /**
     * Whether a path can be loaded into Tokenizer 2 as its starting image. Tokenizer 2 loads
     * still images only, and a wildcard path names no single file.
     *
     * @param {string} [path]
     * @returns {boolean}
     */
    static canSeed(path) {
        if (!path || path.includes("*")) return false;
        return !foundry.helpers.media.VideoHelper.hasVideoExtension(path);
    }

    /**
     * Opens Tokenizer 2's editor without an actor.
     *
     * No ring mode or oversize is passed in. A Visage's Scale is how big the token is on the
     * canvas, which is not the same as Tokenizer 2's oversize (art breaking out of the frame), and
     * the starting image is a flat file that cannot bring back an earlier layered design. Those
     * choices are left to Tokenizer 2's defaults and to the GM inside its editor.
     *
     * @param {object} options
     * @param {string} [options.label] - The Visage's label, the base of the file name.
     * @param {string} [options.sourceImage] - The path to start from, if it can be loaded.
     * @param {Actor|null} [options.actor] - The actor of a local Visage. Its type and owner pick
     *   Tokenizer 2's PC or NPC save folder; without it, Tokenizer 2 uses the PC folder.
     * @returns {Promise<object|null>} Tokenizer 2's result, or null.
     */
    static async open({ label, sourceImage, actor = null } = {}) {
        const api = this.api;
        if (!api) return null;

        const options = { name: this.uniqueName(label), userId: game.user.id };
        if (this.canSeed(sourceImage)) options.sourceImage = sourceImage;
        if (actor) {
            options.type = actor.type;
            options.hasPlayerOwner = actor.hasPlayerOwner;
            options.disposition = actor.prototypeToken?.disposition;
        }

        try {
            return (await api.openEditorStandalone(options)) ?? null;
        } catch (err) {
            console.error("Visage | Tokenizer 2 failed to open.", err);
            return null;
        }
    }

    /**
     * Reduces Tokenizer 2's result to the settings Visage uses.
     *
     * @param {object|null} result - What open() resolved with.
     * @returns {{tokenPath: string|null, avatarPath: string|null, scale: number|null, ring: object|null}|null}
     *   Null when no image was saved.
     */
    static readResult(result) {
        const tokenPath = cleanPath(result?.tokenPath);
        const avatarPath = cleanPath(result?.avatarPath);
        if (!tokenPath && !avatarPath) return null;

        const patch = result.prototypeToken ?? {};
        const read = (key) => patch[`${PATCH_PREFIX}${key}`];

        return {
            tokenPath,
            avatarPath,
            scale: readScale(read("texture.scaleX")),
            ring: readRing(read),
        };
    }

    /**
     * Writes a read result into the Visage Editor's captured changes and ring data. Whatever was
     * saved in Tokenizer 2 replaces what the Visage had, because the GM chose those settings
     * there; anything not saved is left alone.
     *
     * @param {object} read - From readResult.
     * @param {object} changes - The Visage changes to update (from the editor's form capture).
     * @param {object} ringData - The editor's ring data, updated in place.
     */
    static applyResult(read, changes, ringData) {
        applyImages(read, changes);
        if (!read.tokenPath) return;

        // Scale and ring describe the token, so they only change when a token image was saved
        if (read.scale !== null) changes.scale = read.scale;
        applyRing(read, ringData);
    }
}

/**
 * A date and time in the user's own time zone, as "YYYYMMDD-HHmmss", for a file name.
 *
 * @param {Date} date
 * @returns {string}
 */
function timestamp(date) {
    const pad = (value) => String(value).padStart(2, "0");
    const day = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
    return `${day}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/**
 * A saved path without a query string. Tokenizer 2's paths are normally clean, but the copies it
 * writes into token data carry a cache-busting "?v=" that must not end up stored in a Visage.
 *
 * @param {string} [path]
 * @returns {string|null}
 */
function cleanPath(path) {
    if (typeof path !== "string" || !path) return null;
    return path.split("?")[0];
}

/**
 * The token scale from the result, only for an oversized design. Tokenizer 2 draws an oversized
 * design's frame smaller inside the image, leaving room for art to break out, and relies on the
 * token's texture scale to bring the frame back to grid size. A scale of 1 is ignored, so a
 * Scale the user set on the Visage for another reason is kept.
 *
 * @param {*} scaleX
 * @returns {number|null}
 */
function readScale(scaleX) {
    const scale = Number(scaleX);
    return Number.isFinite(scale) && scale > BASE_SCALE ? scale : null;
}

/**
 * The dynamic ring settings from the result, or null when the token was saved without the
 * dynamic ring. Tokenizer 2 leaves out a colour that is white, so a missing colour stays null.
 *
 * @param {function(string): *} read - Reads one key of the prototypeToken update.
 * @returns {{subjectScale: number, ringColor: string|null, backgroundColor: string|null}|null}
 */
function readRing(read) {
    if (read("ring.enabled") !== true) return null;
    const subjectScale = Number(read("ring.subject.scale"));
    return {
        subjectScale: Number.isFinite(subjectScale) && subjectScale > 0 ? subjectScale : BASE_SCALE,
        ringColor: read("ring.colors.ring") || null,
        backgroundColor: read("ring.colors.background") || null,
    };
}

/**
 * Fills the Token image and Portrait with the saved paths. Setting a value ticks the field,
 * because the editor ticks every property that has one.
 *
 * @param {object} read
 * @param {object} changes
 */
function applyImages(read, changes) {
    if (read.tokenPath) {
        changes.texture = changes.texture || {};
        changes.texture.src = read.tokenPath;
    }
    if (read.avatarPath) changes.portrait = read.avatarPath;
}

/**
 * Sets up the Dynamic Ring to match a token save.
 *
 * With the ring: the ring is switched on and its subject set to the saved image. Foundry would
 * fall back to the token image for an empty subject, but an older subject already on the Visage
 * would otherwise win, so the subject is always set. The subject scale and the colours that
 * were chosen are copied; a white colour (left out by Tokenizer 2) keeps the Visage's own.
 *
 * Without the ring: a Visage whose ring is switched on would keep showing the ring and its old
 * subject over the new image, so the ring is switched off. Its settings are kept, as with the
 * editor's own ring switch. Tokenizer 2 does the same when it saves to a placed token.
 *
 * @param {object} read
 * @param {object} ringData
 */
function applyRing(read, ringData) {
    if (!read.ring) {
        ringData.enabled = false;
        return;
    }

    ringData.enabled = true;
    ringData.subject = { ...ringData.subject, texture: read.tokenPath, scale: read.ring.subjectScale };
    ringData.colors = {
        ...ringData.colors,
        ...(read.ring.ringColor && { ring: read.ring.ringColor }),
        ...(read.ring.backgroundColor && { background: read.ring.backgroundColor }),
    };
}
