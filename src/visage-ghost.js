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

import { MODULE_ID } from "./visage-constants.js";

/**
 * Intercepts the Token Config application render to inject original state data.
 * This function locates the HTML form and programmatically sets input values to match
 * the clean "Original State" stored in the token's flags.
 * @param {TokenConfig} app - The Token Configuration application instance.
 * @param {jQuery} html - The jQuery object representing the rendered window.
 * @param {Object} data - The data object used to render the template.
 */
export function handleGhostEdit(app, html, data) {
    const doc = app.document;
    
    // 1. Safety Checks
    // Only proceed if this token is actually under Visage control and has a snapshot.
    if (!doc || !doc.flags?.[MODULE_ID]) return;
    
    const originalState = doc.flags[MODULE_ID].originalState;
    if (!originalState) return; 

    // 2. UI Notification
    // Warn the user that they are editing the *base* token, not the visible mask.
    if (!app._visageWarned) {
        ui.notifications.warn("VISAGE.Warnings.GhostEdit", { localize: true, permanent: false });
        app._visageWarned = true;
    }

    // 3. Find the Form Element (Robust Search)
    // Supports both jQuery and native DOM, and varies based on system/module overrides.
    let root = app.element;
    if (root instanceof jQuery) root = root[0];

    let form = null;
    if (root?.tagName === "FORM") form = root;
    else if (root?.querySelector) form = root.querySelector("form");

    if (!form) {
        let htmlRoot = (html instanceof jQuery) ? html[0] : html;
        if (htmlRoot?.tagName === "FORM") form = htmlRoot;
        else if (htmlRoot?.querySelector) form = htmlRoot.querySelector("form");
    }

    if (!form) {
        // Silent fail is acceptable here if the UI is non-standard or cannot be resolved.
        return;
    }

    // 4. Invisibly Swap Form Values
    // Flatten the original state object to map easily to form input names (e.g., "texture.src")
    // NOTE: This includes light.* keys because extractVisualState (visage-utilities.js) now includes the light object.
    const flatData = foundry.utils.flattenObject(originalState);

    /**
     * Helper to set an input's value and trigger change events so Foundry detects the update.
     * Handles standard inputs as well as custom Foundry V12+ elements.
     * @param {string} name - The `name` attribute of the input.
     * @param {any} value - The value to set.
     */
    const setInput = (name, value) => {
        const input = form.querySelector(`[name="${name}"]`);
        if (!input) return;

        // --- SPECIAL CASE: Multi-Checkbox (Ring Effects) ---
        // Foundry's <multi-checkbox> custom element expects an array of keys.
        // However, the stored data might be a bitmask number (integer).
        if (input.tagName === "MULTI-CHECKBOX") {
            let arrayValue = value;
            
            // If we have a bitmask number, decode it back to keys
            if (name === "ring.effects" && typeof value === "number") {
                const effectsMap = CONFIG.Token?.ring?.effects || {
                    "RING_PULSE": 2, "RING_GRADIENT": 4, "BKG_WAVE": 8, "INVISIBILITY": 16
                };
                arrayValue = [];
                for (const [key, bit] of Object.entries(effectsMap)) {
                    if ((value & bit) !== 0) arrayValue.push(key);
                }
            } else if (!Array.isArray(value)) {
                arrayValue = [value];
            }

            // Only update if different to avoid infinite loops/reactivity issues
            if (JSON.stringify(input.value) !== JSON.stringify(arrayValue)) {
                input.value = arrayValue;
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }
            return;
        }

        // --- Standard Inputs ---
        if (input.type === "checkbox") {
            if (input.checked !== !!value) {
                input.checked = !!value;
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }
        } 
        else if (input.tagName === "COLOR-PICKER") {
            input.value = value; 
            // Color pickers sometimes need an explicit input event to update their swatch
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
        }
        else {
            if (input.value != value) {
                input.value = value;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
                
                // Handle <range-picker> custom elements (Foundry V11+)
                if (input.tagName === "RANGE-PICKER") {
                    const rangeInput = input.querySelector('input[type="range"]');
                    const numberInput = input.querySelector('input[type="number"]');
                    if (rangeInput) rangeInput.value = value;
                    if (numberInput) numberInput.value = value;
                }
                // Update legacy range slider text display
                else if (input.type === "range") {
                    const rangeDisplay = input.nextElementSibling;
                    if (rangeDisplay && rangeDisplay.classList.contains("range-value")) {
                        rangeDisplay.textContent = value;
                    }
                }
            }
        }
        
        // --- Image Previews ---
        // Manually update the <img> tag so the user *sees* the original image, not just the file path text.
        if (name === "texture.src" || name === "img") {
            const group = input.closest(".form-group") || input.closest(".form-group-stacked");
            const preview = group?.querySelector("img");
            if (preview) preview.src = value;
            const thumb = group?.querySelector(".file-picker-image");
            if (thumb && thumb !== preview) thumb.src = value;
        }
    };

    // A. Standard Restore Loop
    for (const [key, value] of Object.entries(flatData)) {
        // Skip internal flags and ID to prevent corruption or overwriting system data
        if (key.startsWith("flags") || key === "_id") continue;
        setInput(key, value);
    }
    
    // B. SPECIAL HANDLING: Mirror & Scale & Anchors
    // Token Config uses virtual inputs 'mirrorX', 'mirrorY', and 'scale' 
    // which don't strictly exist in the data model (they are derived from texture.scaleX/Y).
    // We must manually derive and set these to ensure the UI controls match the data.
    const tex = originalState.texture || {};
    const scaleX = tex.scaleX ?? 1;
    const scaleY = tex.scaleY ?? 1;

    // 1. Derive UI Values
    const isMirrorX = scaleX < 0;
    const isMirrorY = scaleY < 0;
    const absScale = Math.abs(scaleX); // Assuming uniform scaling for the main slider
    const anchorX = tex.anchorX ?? 0.5;
    const anchorY = tex.anchorY ?? 0.5;

    // 2. Inject into UI
    setInput("mirrorX", isMirrorX);
    setInput("mirrorY", isMirrorY);
    setInput("scale", absScale); 
    setInput("texture.anchorX", anchorX);
    setInput("texture.anchorY", anchorY);
}