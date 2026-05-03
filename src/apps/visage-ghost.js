/**
 * @file Handles "Ghost Edit" protection for the Token Configuration window.
 * * **Purpose:**
 * When a token has a Visage applied, its visual data (img, scale, etc.) is temporarily overridden.
 * If a user opens the Token Config, they normally see this *modified* data. Saving the form would
 * accidentally overwrite the token's "true" default state with the temporary Visage data.
 * * This module intercepts the Token Config render, retrieves the "Original State" snapshot
 * from the flags, and silently populates the form fields with the *original* data.
 * This ensures that edits made by the user are applied to the base token, not the active mask.
 * @module visage
 */

import { MODULE_ID } from "../core/visage-constants.js";

/**
 * Intercepts the Token Config application render to inject original state data.
 * This function locates the HTML form and programmatically sets input values to match
 * the clean "Original State" stored in the token's flags.
 * @param {TokenConfig} app - The Token Configuration application instance.
 * @param {jQuery} html - The jQuery object representing the rendered window.
 * @param {Object} data - The data object used to render the template.
 */
export function handleGhostEdit(app, html, _data) {
    const doc = app.document;
    if (!doc?.flags?.[MODULE_ID]) return;
    if (app.constructor.name.includes("Mass") || app.options?.id?.includes("mass")) return;

    const originalState = doc.flags[MODULE_ID].originalState;
    if (!originalState) return;

    // 1. UI Notification
    if (!app._visageWarned) {
        ui.notifications.warn("VISAGE.Warnings.GhostEdit", { localize: true });
        app._visageWarned = true;
    }

    const form = _resolveFormElement(app, html);
    if (!form) return;

    // 2. Flatten and Inject Standard Values
    const flatData = foundry.utils.flattenObject(originalState);
    for (const [key, value] of Object.entries(flatData)) {
        if (key.startsWith("flags") || key === "_id") continue;
        _setInput(form, key, value);
    }

    // 3. Inject Derived UI Values
    const tex = originalState.texture || {};
    const scaleX = tex.scaleX ?? 1;
    _setInput(form, "mirrorX", scaleX < 0);
    _setInput(form, "mirrorY", (tex.scaleY ?? 1) < 0);
    _setInput(form, "scale", Math.abs(scaleX));
    _setInput(form, "texture.anchorX", tex.anchorX ?? 0.5);
    _setInput(form, "texture.anchorY", tex.anchorY ?? 0.5);
}

/**
 * Helper to set an input's value and trigger change events.
 * Handles standard inputs as well as custom Foundry V12+ elements.
 * @private
 */
function _setInput(form, name, value) {
    const input = form.querySelector(`[name="${name}"]`);
    if (!input) return;

    // 1. Special Case: Multi-Checkbox (Ring Effects)
    if (input.tagName === "MULTI-CHECKBOX") {
        _setMultiCheckbox(input, name, value);
        return;
    }

    // 2. Special Case: Color Picker
    if (input.tagName === "COLOR-PICKER") {
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        return;
    }

    // 3. Special Case: Checkbox
    if (input.type === "checkbox") {
        if (input.checked !== !!value) {
            input.checked = !!value;
            input.dispatchEvent(new Event("change", { bubbles: true }));
        }
        return;
    }

    // 4. Standard Inputs & Range Pickers
    if (input.value != value) {
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        _updateUIFeedback(input, name, value);
    }
}

/** @private */
function _setMultiCheckbox(input, name, value) {
    let arrayValue = value;
    if (name === "ring.effects" && typeof value === "number") {
        const effectsMap = CONFIG.Token?.ring?.effects || {
            RING_PULSE: 2,
            RING_GRADIENT: 4,
            BKG_WAVE: 8,
            INVISIBILITY: 16,
        };
        arrayValue = [];
        for (const [key, bit] of Object.entries(effectsMap)) {
            if ((value & bit) !== 0) arrayValue.push(key);
        }
    } else if (!Array.isArray(value)) {
        arrayValue = [value];
    }

    if (JSON.stringify(input.value) !== JSON.stringify(arrayValue)) {
        input.value = arrayValue;
        input.dispatchEvent(new Event("change", { bubbles: true }));
    }
}

/** @private */
function _updateUIFeedback(input, name, value) {
    // Handle <range-picker> elements
    if (input.tagName === "RANGE-PICKER") {
        const range = input.querySelector('input[type="range"]');
        const num = input.querySelector('input[type="number"]');
        if (range) range.value = value;
        if (num) num.value = value;
    }
    // Handle legacy range sliders
    else if (input.type === "range") {
        const display = input.nextElementSibling;
        if (display?.classList.contains("range-value")) display.textContent = value;
    }

    // Handle Image Previews
    if (name === "texture.src" || name === "img") {
        const group = input.closest(".form-group") || input.closest(".form-group-stacked");
        const preview = group?.querySelector("img");
        if (preview) preview.src = value;
        const thumb = group?.querySelector(".file-picker-image");
        if (thumb && thumb !== preview) thumb.src = value;
    }
}

/** @private */
function _resolveFormElement(app, html) {
    let root = app.element instanceof jQuery ? app.element[0] : app.element;
    let form = root?.tagName === "FORM" ? root : root?.querySelector("form");
    if (form) return form;

    let htmlRoot = html instanceof jQuery ? html[0] : html;
    return htmlRoot?.tagName === "FORM" ? htmlRoot : htmlRoot?.querySelector("form");
}
