/**
 * VISAGE TOKEN COPY
 * -------------------------------------------------------------------
 * Copies a token's appearance into the Visage Editor, and clears it again. These back the
 * editor's "Copy from token" and "Clear" buttons, which work on one layer (Token appearance,
 * Dynamic Ring, Light Source) or one Token appearance section at a time. The Light Source copy
 * includes the Lighting and Vision for RMU settings when that module is active.
 *
 * New Visages start with nothing ticked, so they only change what the user chooses. A Visage
 * that copied every property at creation would keep forcing those values even after the token's
 * own appearance changed, so copying is a deliberate action per layer or section.
 *
 * The token is read as it looks right now (VisageData.getCurrentAsVisage), including the changes
 * of any Visages applied to it, so a copy matches what the user sees on the canvas. Selecting a
 * different token between copies takes each section from a different token.
 */

import { VisageData } from "../../data/visage-data.js";
import { VisageRMU } from "../../integrations/visage-rmu.js";

/** The Token appearance sections that have a copy button, and the properties each one copies. */
export const TOKEN_COPY_SECTIONS = Object.freeze({
    identity: ["name", "textureSrc", "portrait", "dat"],
    size: ["width", "height", "depth", "fit", "scale", "anchor"],
    presentation: ["alpha", "disposition", "mirror", "lockRotation"],
});

/** Every property the Token appearance copy button copies. */
const ALL_TOKEN_PROPERTIES = Object.values(TOKEN_COPY_SECTIONS).flat();

/**
 * Every property the Token appearance clear button clears. The transition is included even
 * though it is never copied (a token has no transition of its own to copy).
 */
const ALL_CLEARABLE_PROPERTIES = [...ALL_TOKEN_PROPERTIES, "animateTransition"];

/** Flag scope of Dylan's Animated Tokens, whose settings belong to the token's identity. */
const DAT_FLAG_SCOPE = "dylans-animated-tokens";

/** Flag scope of Lighting and Vision for RMU, whose settings belong to the token's light. */
const RMU_FLAG_SCOPE = "rmu-lighting-vision";

/** RMU light settings of a token that has none of its own (no base illumination, no modifiers). */
const RMU_DEFAULTS = Object.freeze({ baseIllumination: "-1", isMagical: false, isUtter: false, isConstant: false });

/**
 * Writes one copied property into a Visage's changes. Each writer takes the token's appearance
 * (the changes of VisageData.getDefaultAsVisage) and the Visage changes to update.
 *
 * Mirroring is copied as mirrorX and mirrorY, derived from the sign of the token's texture
 * scale, because that is how Visages store it (the composer applies mirroring from mirrorX and
 * mirrorY, and scale from the unsigned scale).
 */
const PROPERTY_WRITERS = {
    name: (source, target) => (target.name = source.name ?? null),
    textureSrc: (source, target) => (texture(target).src = source.texture?.src ?? null),
    portrait: (source, target) => (target.portrait = source.portrait ?? null),
    dat: (source, target) => {
        const dat = source.flags?.[DAT_FLAG_SCOPE];
        if (!dat) return;
        target.flags = target.flags || {};
        target.flags[DAT_FLAG_SCOPE] = foundry.utils.deepClone(dat);
    },
    width: (source, target) => (target.width = source.width ?? 1),
    height: (source, target) => (target.height = source.height ?? 1),
    depth: (source, target) => (target.depth = source.depth ?? 1),
    fit: (source, target) => (texture(target).fit = source.texture?.fit ?? "contain"),
    scale: (source, target) => (target.scale = source.scale ?? 1),
    anchor: (source, target) => {
        texture(target).anchorX = source.texture?.anchorX ?? 0.5;
        texture(target).anchorY = source.texture?.anchorY ?? 0.5;
    },
    alpha: (source, target) => (target.alpha = source.alpha ?? 1),
    disposition: (source, target) => (target.disposition = source.disposition ?? 0),
    mirror: (source, target) => {
        target.mirrorX = (source.texture?.scaleX ?? 1) < 0;
        target.mirrorY = (source.texture?.scaleY ?? 1) < 0;
    },
    lockRotation: (source, target) => (target.lockRotation = source.lockRotation ?? false),
};

/**
 * Clears one property from a Visage's changes. A property set to null is unticked in the editor,
 * which leaves it to the token and any other Visages applied to it.
 */
const PROPERTY_CLEARERS = {
    name: (target) => (target.name = null),
    textureSrc: (target) => (texture(target).src = null),
    portrait: (target) => (target.portrait = null),
    dat: (target) => delete target.flags?.[DAT_FLAG_SCOPE],
    width: (target) => (target.width = null),
    height: (target) => (target.height = null),
    depth: (target) => (target.depth = null),
    fit: (target) => (texture(target).fit = null),
    scale: (target) => (target.scale = null),
    anchor: (target) => {
        texture(target).anchorX = null;
        texture(target).anchorY = null;
    },
    alpha: (target) => (target.alpha = null),
    disposition: (target) => (target.disposition = null),
    mirror: (target) => {
        target.mirrorX = null;
        target.mirrorY = null;
    },
    lockRotation: (target) => (target.lockRotation = null),
    animateTransition: (target) => (target.animateTransition = null),
};

/** The texture object of a Visage's changes, created if missing. */
function texture(changes) {
    changes.texture = changes.texture || {};
    return changes.texture;
}

export class VisageTokenCopy {
    /**
     * How the token looks right now, as the changes of a Visage that would recreate it.
     *
     * @param {TokenDocument} tokenDoc - The token to read.
     * @returns {object|null}
     */
    static readToken(tokenDoc) {
        return VisageData.getCurrentAsVisage(tokenDoc)?.changes ?? null;
    }

    /**
     * Copies the token's appearance into a Visage's changes, either all of it or one section.
     * Copied properties become set (ticked) because the editor ticks every property that has a
     * value.
     *
     * @param {object} source - The token's appearance (from readToken).
     * @param {object} target - The Visage changes to update.
     * @param {string|null} [section=null] - A key of TOKEN_COPY_SECTIONS, or null for all.
     */
    static copyAppearance(source, target, section = null) {
        const properties = section ? (TOKEN_COPY_SECTIONS[section] ?? []) : ALL_TOKEN_PROPERTIES;
        for (const property of properties) PROPERTY_WRITERS[property](source, target);
    }

    /**
     * Clears a Visage's Token appearance changes, either all of them or one section, so those
     * properties are unticked.
     *
     * @param {object} target - The Visage changes to update.
     * @param {string|null} [section=null] - A key of TOKEN_COPY_SECTIONS, or null for all.
     */
    static clearAppearance(target, section = null) {
        const properties = section ? (TOKEN_COPY_SECTIONS[section] ?? []) : ALL_CLEARABLE_PROPERTIES;
        for (const property of properties) PROPERTY_CLEARERS[property](target);
    }

    /**
     * Copies the token's Dynamic Ring settings into the editor's ring data. Whether the ring is
     * switched on is left as it is, so copying never switches a layer on by itself.
     *
     * @param {object} source - The token's appearance (from readToken).
     * @param {object} ringData - The editor's ring data, updated in place.
     */
    static copyRing(source, ringData) {
        const ring = source.ring ?? {};
        ringData.colors = {
            ring: ring.colors?.ring ?? ringData.colors?.ring ?? null,
            background: ring.colors?.background ?? ringData.colors?.background ?? null,
        };
        ringData.subject = {
            texture: ring.subject?.texture ?? "",
            scale: ring.subject?.scale ?? 1,
        };
        ringData.effects = ring.effects ?? 0;
    }

    /**
     * Copies the token's light into the editor's light data. Whether the light is switched on
     * is left as it is, for the same reason as the ring.
     *
     * @param {object} source - The token's appearance (from readToken).
     * @param {object} lightData - The editor's light data, updated in place.
     */
    static copyLight(source, lightData) {
        const light = source.light ?? {};
        const keys = ["dim", "bright", "alpha", "angle", "luminosity", "priority"];
        for (const key of keys) {
            if (light[key] !== undefined && light[key] !== null) lightData[key] = light[key];
        }
        if (light.color) lightData.color = light.color;

        const animation = light.animation ?? {};
        lightData.animation = {
            type: animation.type ?? "",
            speed: animation.speed ?? lightData.animation?.speed ?? 5,
            intensity: animation.intensity ?? lightData.animation?.intensity ?? 5,
        };
    }

    /**
     * Copies the token's Lighting and Vision for RMU settings (base illumination and the magical,
     * utter and constant modifiers) into the editor's RMU data, alongside the light. A token
     * without RMU settings copies as "none", so the copy always matches the token. Nothing is
     * copied while the module is inactive, because its settings cannot be read then.
     *
     * @param {object} source - The token's appearance (from readToken).
     * @param {object} rmuData - The editor's RMU data, updated in place.
     */
    static copyRmu(source, rmuData) {
        if (!VisageRMU.isActive || !rmuData) return;
        const rmu = source.flags?.[RMU_FLAG_SCOPE] ?? {};

        // The editor's select compares base illumination as a string
        rmuData.baseIllumination = String(rmu.baseIllumination ?? RMU_DEFAULTS.baseIllumination);
        rmuData.isMagical = !!rmu.isMagical;
        rmuData.isUtter = !!rmu.isUtter;
        rmuData.isConstant = !!rmu.isConstant;
    }
}
