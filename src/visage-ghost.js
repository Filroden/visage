/**
 * @file Handles "Ghost Edit" protection for Token Config.
 * Invisibly intercepts the configuration window to display the underlying
 * default token data instead of the active Visage mask.
 * @module visage
 */

import { Visage } from "./visage.js";

export function handleGhostEdit(app, html, data) {
    const doc = app.document;
    
    // 1. Safety Checks
    if (!doc || !doc.flags?.[Visage.MODULE_ID]) return;
    
    const originalState = doc.flags[Visage.MODULE_ID].originalState;
    if (!originalState) return; 

    // 2. UI Notification
    if (!app._visageWarned) {
        ui.notifications.warn("VISAGE.Warnings.GhostEdit", { localize: true, permanent: false });
        app._visageWarned = true;
    }

    // 3. Find the Form (Robust)
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
        console.warn("Visage | Ghost Edit: Could not find <form> element in Token Config.");
        return;
    }

    // 4. Invisibly Swap Form Values
    const flatData = foundry.utils.flattenObject(originalState);

    const setInput = (name, value) => {
        const input = form.querySelector(`[name="${name}"]`);
        if (!input) return;

        // --- SPECIAL: Multi-Checkbox (Ring Effects) ---
        if (input.tagName === "MULTI-CHECKBOX") {
            let arrayValue = value;
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
        }
        else {
            if (input.value != value) {
                input.value = value;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
                
                // Handle Range Sliders specifically
                if (input.tagName === "RANGE-PICKER") {
                    // range-picker often needs its internal input updated manually if value setter doesn't propagate
                    const rangeInput = input.querySelector('input[type="range"]');
                    const numberInput = input.querySelector('input[type="number"]');
                    if (rangeInput) rangeInput.value = value;
                    if (numberInput) numberInput.value = value;
                }
                else if (input.type === "range") {
                    const rangeDisplay = input.nextElementSibling;
                    if (rangeDisplay && rangeDisplay.classList.contains("range-value")) {
                        rangeDisplay.textContent = value;
                    }
                }
            }
        }
        
        // Handle Image Previews
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
        if (key.startsWith("flags") || key === "_id") continue;
        setInput(key, value);
    }
    
    // B. SPECIAL HANDLING: Mirror & Scale
    // Token Config uses 'mirrorX', 'mirrorY', and 'scale' inputs which don't exist in originalState.
    // We must derive them from texture.scaleX / texture.scaleY.
    const tex = originalState.texture || {};
    const scaleX = tex.scaleX ?? 1;
    const scaleY = tex.scaleY ?? 1;

    // 1. Calculate the UI values
    const isMirrorX = scaleX < 0;
    const isMirrorY = scaleY < 0;
    const absScale = Math.abs(scaleX); // Assuming uniform scaling for the slider

    // 2. Force them into the UI
    setInput("mirrorX", isMirrorX);
    setInput("mirrorY", isMirrorY);
    setInput("scale", absScale); // This targets the <range-picker name="scale">
}