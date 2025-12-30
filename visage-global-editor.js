/**
 * @file The Editor application for creating and modifying Global Visage entries.
 * @module visage
 */

import { Visage } from "./visage.js";
import { VisageGlobalData } from "./visage-global-data.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class VisageGlobalEditor extends HandlebarsApplicationMixin(ApplicationV2) {
    constructor(options = {}) {
        super(options);
        this.visageId = options.visageId || null;
        this.isDirty = false;
    }

    static DEFAULT_OPTIONS = {
        tag: "form",
        id: "visage-global-editor",
        classes: ["visage", "visage-global-editor", "visage-dark-theme"],
        window: {
            title: "VISAGE.GlobalEditor.TitleNew",
            icon: "visage-header-icon",
            resizable: true,
            minimizable: true,
            contentClasses: ["standard-form"]
        },
        position: {
            width: 960,
            height: "auto"
        },
        actions: {
            save: VisageGlobalEditor.prototype._onSave,
            toggleField: VisageGlobalEditor.prototype._onToggleField,
            openFilePicker: VisageGlobalEditor.prototype._onOpenFilePicker
        }
    };

    static PARTS = {
        form: {
            template: "modules/visage/templates/visage-global-editor.hbs",
            scrollable: [".visage-editor-grid"]
        }
    };

    get title() {
        return this.visageId 
            ? game.i18n.format("VISAGE.GlobalEditor.TitleEdit", { name: this._currentLabel || "Visage" })
            : game.i18n.localize("VISAGE.GlobalEditor.TitleNew");
    }

    async _prepareContext(options) {
        // --- 1. DATA RETRIEVAL ---
        let data;
        if (this.visageId) {
            data = VisageGlobalData.get(this.visageId);
            if (!data) return this.close();
            this._currentLabel = data.label;
        } else {
            data = {
                label: game.i18n.localize("VISAGE.GlobalEditor.TitleNew"),
                category: "",
                tags: [],
                changes: {} 
            };
            this._currentLabel = "";
        }

        const c = data.changes || {};

        // --- 2. RING CONTEXT ---
        const ringActive = !!c.ring;
        const ringContext = Visage.prepareRingContext(c.ring);

        // --- 3. PREPARE PREVIEW DATA ---
        
        // Scale: Convert 1.0 -> 100 for display
        const rawScale = c.scale ?? 1.0; 
        const displayScale = Math.round(rawScale * 100);
        const scaleActive = (rawScale !== 1.0);

        // Dimensions
        let dimLabel = "-";
        let dimActive = false;
        if ((c.width && c.width !== 1) || (c.height && c.height !== 1)) {
            dimLabel = `${c.width || 1} x ${c.height || 1}`;
            dimActive = true;
        }

        // Mirroring
        let flipIcon = "fas fa-arrows-alt-h"; 
        let flipLabel = "-";
        let flipActive = false;

        if (c.isFlippedX || c.isFlippedY) {
            flipActive = true;
            if (c.isFlippedX && !c.isFlippedY) {
                flipIcon = "fas fa-arrow-left";
                flipLabel = game.i18n.localize("VISAGE.Mirror.Horizontal.Label");
            } else if (c.isFlippedY && !c.isFlippedX) {
                flipIcon = "fas fa-arrow-down";
                flipLabel = game.i18n.localize("VISAGE.Mirror.Vertical.Label");
            } else {
                flipIcon = "fas fa-expand-arrows-alt";
                flipLabel = game.i18n.localize("VISAGE.Mirror.Label.Combined");
            }
        }

        // Disposition
        let dispositionClass = "none";
        let dispositionLabel = game.i18n.localize("VISAGE.Disposition.NoChange");
        
        if (c.disposition !== null && c.disposition !== undefined) {
             switch (c.disposition) {
                case 1: dispositionClass = "friendly"; dispositionLabel = game.i18n.localize("VISAGE.Disposition.Friendly"); break;
                case 0: dispositionClass = "neutral"; dispositionLabel = game.i18n.localize("VISAGE.Disposition.Neutral"); break;
                case -1: dispositionClass = "hostile"; dispositionLabel = game.i18n.localize("VISAGE.Disposition.Hostile"); break;
                case -2: dispositionClass = "secret"; dispositionLabel = game.i18n.localize("VISAGE.Disposition.Secret"); break;
            }
        }

        // Ring Preview Data
        const pRing = c.ring || {};
        const pEff = pRing.effects || 0;

        const previewData = {
            // Visuals
            img: c.img || "",
            isVideo: foundry.helpers.media.VideoHelper.hasVideoExtension(c.img || ""),
            flipX: c.isFlippedX === true,
            flipY: c.isFlippedY === true,
            
            // Ring Visuals
            hasRing: !!ringActive,
            ringColor: pRing.colors?.ring || "#FFFFFF",
            ringBkg: pRing.colors?.background || "#000000",
            hasPulse: (pEff & 2) !== 0,
            hasGradient: (pEff & 4) !== 0,
            hasWave: (pEff & 8) !== 0,
            hasInvisibility: (pEff & 16) !== 0,
            
            // Metadata Slots
            slots: {
                scale: { val: `${displayScale}%`, active: scaleActive },
                dim: { val: dimLabel, active: dimActive },
                flip: { icon: flipIcon, val: flipLabel, active: flipActive },
                disposition: { class: dispositionClass, val: dispositionLabel }
            },
            
            // Name: Using the token name override (c.name)
            name: c.name || "",
            tagList: data.tags || [] 
        };

        // --- 4. PREPARE FORM INPUTS ---
        const prep = (val, def) => ({
            value: val ?? def,
            active: val !== null && val !== undefined
        });
        const prepFlip = (val) => ({
            value: val ?? null
        });

        return {
            isEdit: !!this.visageId,            
            label: data.label,
            category: data.category,
            tags: (data.tags || []).join(", "), 
            
            // Form Inputs
            img: prep(c.img, ""),
            // Important: Input needs the percentage (e.g. 100), not the raw 1.0
            scale: { value: displayScale, active: c.scale !== null && c.scale !== undefined },
            isFlippedX: prepFlip(c.isFlippedX),
            isFlippedY: prepFlip(c.isFlippedY),
            nameOverride: prep(c.name, ""),
            disposition: prep(c.disposition, 0),
            width: prep(c.width, 1),
            height: prep(c.height, 1),

            // Ring Inputs
            ring: {
                active: ringActive,
                ...ringContext
            },

            preview: previewData
        };
    }

    /**
     * Updates the live preview DOM based on current form state.
     * ASYNC: Resolves wildcards using Visage.resolvePath before rendering.
     */
    async _updatePreview() {
        const formData = new foundry.applications.ux.FormDataExtended(this.element).object;
        const el = this.element;

        // --- 1. EXTRACT DATA ---
        
        // Scale
        const scaleVal = formData.scale; 
        const displayScale = scaleVal ? Math.round(scaleVal) : 100;
        const scaleActive = displayScale !== 100;
        
        // Dimensions
        const w = formData.width;
        const h = formData.height;
        
        // Flip
        const isFlippedX = formData.isFlippedX === "true";
        const isFlippedY = formData.isFlippedY === "true";
        
        // Disposition
        const disposition = (formData.disposition !== "" && formData.disposition !== null) 
            ? parseInt(formData.disposition) 
            : null;

        // Name & Identity
        const nameOverride = formData.nameOverride || "";
        const label = formData.label || "";
        const tagsStr = formData.tags || "";

        // Ring Data
        const ringEnabled = formData["ring.enabled"]; 
        const ringColor = formData.ringColor || "#FFFFFF"; 
        const ringBkg = formData.ringBackgroundColor || "#000000";
        
        // --- 2. ASYNC RESOLUTION ---
        
        // Use existing helper to resolve wildcards (e.g. "goblin*.png" -> "goblin_01.png")
        const rawImgPath = formData.img || "";
        const resolvedPath = await Visage.resolvePath(rawImgPath);

        // Determine Media Type based on the RESOLVED path (so .webm works even inside a wildcard)
        const isVideo = foundry.helpers.media.VideoHelper.hasVideoExtension(resolvedPath);
        
        // --- 3. CALCULATE SLOTS ---
        
        // Dims
        let dimLabel = "-";
        let dimActive = false;
        if ((w && w != 1) || (h && h != 1)) {
            dimLabel = `${w || 1} x ${h || 1}`;
            dimActive = true;
        }

        // Flip
        let flipIcon = "fas fa-arrows-alt-h"; 
        let flipLabel = "-";
        let flipActive = false;
        if (isFlippedX || isFlippedY) {
            flipActive = true;
            if (isFlippedX && !isFlippedY) {
                flipIcon = "fas fa-arrow-left";
                flipLabel = game.i18n.localize("VISAGE.Mirror.Horizontal.Label");
            } else if (isFlippedY && !isFlippedX) {
                flipIcon = "fas fa-arrow-down";
                flipLabel = game.i18n.localize("VISAGE.Mirror.Vertical.Label");
            } else {
                flipIcon = "fas fa-expand-arrows-alt";
                flipLabel = game.i18n.localize("VISAGE.Mirror.Label.Combined");
            }
        }

        // Disposition
        let dispClass = "none";
        let dispLabel = game.i18n.localize("VISAGE.Disposition.NoChange");
        if (disposition !== null && !isNaN(disposition)) {
            switch (disposition) {
                case 1: dispClass = "friendly"; dispLabel = game.i18n.localize("VISAGE.Disposition.Friendly"); break;
                case 0: dispClass = "neutral"; dispLabel = game.i18n.localize("VISAGE.Disposition.Neutral"); break;
                case -1: dispClass = "hostile"; dispLabel = game.i18n.localize("VISAGE.Disposition.Hostile"); break;
                case -2: dispClass = "secret"; dispLabel = game.i18n.localize("VISAGE.Disposition.Secret"); break;
            }
        }

        // --- 4. DOM UPDATE ---
        
        const updateSlot = (cls, val, active, icon) => {
            const slot = el.querySelector(`.card-zone-left .${cls}`);
            if (!slot) return;
            slot.querySelector(".slot-value").textContent = val;
            if (active) slot.classList.remove("inactive");
            else slot.classList.add("inactive");
            if (icon) slot.querySelector("i").className = icon;
        };

        updateSlot("scale-slot", `${displayScale}%`, scaleActive);
        updateSlot("dim-slot", dimLabel, dimActive);
        updateSlot("flip-slot", flipLabel, flipActive, flipIcon);

        const dispSlot = el.querySelector(".card-zone-left .disposition-slot .visage-disposition-chip");
        if (dispSlot) {
            dispSlot.textContent = dispLabel;
            dispSlot.className = `visage-disposition-chip ${dispClass}`;
        }

        // Name Display
        const nameEl = el.querySelector(".token-name-label");
        if (nameEl) {
            nameEl.textContent = nameOverride;
            nameEl.style.display = nameOverride ? "block" : "none";
        }

        // Footer Title & Tags
        const titleEl = el.querySelector(".card-title");
        if (titleEl) titleEl.textContent = label || game.i18n.localize("VISAGE.GlobalEditor.TitleNew");

        const tagsEl = el.querySelector(".card-tags");
        if (tagsEl) {
            tagsEl.innerHTML = "";
            const arr = tagsStr.split(",").map(t => t.trim()).filter(t => t);
            arr.forEach(t => {
                const span = document.createElement("span");
                span.className = "tag";
                span.textContent = t;
                tagsEl.appendChild(span);
            });
        }

        // --- 5. VISUAL UPDATE (Ring & Media) ---
        
        const ringEl = el.querySelector(".visage-ring-preview");
        if (ringEl) {
            ringEl.style.display = ringEnabled ? "block" : "none";
            
            if (ringEnabled) {
                ringEl.style.setProperty("--ring-color", ringColor);
                ringEl.style.setProperty("--ring-bkg", ringBkg);
                
                const toggle = (k, c) => {
                    // Checkboxes return true in FormDataExtended
                    if (formData[`effect_${k}`] === true) ringEl.classList.add(c);
                    else ringEl.classList.remove(c);
                };
                toggle("2", "pulse");
                toggle("4", "gradient");
                toggle("8", "wave");
                
                const content = el.querySelector(".visage-preview-content");
                if (content) {
                    if (formData["effect_16"] === true) content.classList.add("invisible");
                    else content.classList.remove("invisible");
                }
            }
        }
        
        // Media Update - Using the RESOLVED path
        const transform = `scale(${isFlippedX ? -1 : 1}, ${isFlippedY ? -1 : 1})`;

        const vidEl = el.querySelector(".visage-preview-video");
        const imgEl = el.querySelector(".visage-preview-img");
        const iconEl = el.querySelector(".fallback-icon");

        if (!resolvedPath) {
            if (vidEl) vidEl.style.display = "none";
            if (imgEl) imgEl.style.display = "none";
            if (iconEl) {
                iconEl.style.display = "block";
                iconEl.className = "visage-icon-mask fallback-icon";
            }
        } else if (isVideo) {
            if (vidEl) {
                vidEl.src = resolvedPath;
                vidEl.style.display = "block";
                vidEl.style.transform = transform;
            }
            if (imgEl) imgEl.style.display = "none";
            if (iconEl) iconEl.style.display = "none";
        } else {
            if (vidEl) vidEl.style.display = "none";
            if (imgEl) {
                imgEl.src = resolvedPath;
                imgEl.style.display = "block";
                imgEl.style.transform = transform;
            }
            if (iconEl) iconEl.style.display = "none";
        }
    }

    _onToggleField(event, target) {
        const fieldName = target.dataset.target;
        const group = target.closest('.form-group');
        const input = group.querySelector(`[name="${fieldName}"]`);
        
        if (input) {
            input.disabled = !target.checked;
            const button = group.querySelector('button.file-picker-button');
            if (button) button.disabled = !target.checked;
        }
        this._markDirty();
    }

    _onOpenFilePicker(event, target) {
        const input = target.previousElementSibling;
        const fp = new FilePicker({
            type: "imagevideo",
            current: input.value,
            callback: (path) => {
                input.value = path;
                this._markDirty();
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }
        });
        fp.browse();
    }

    _markDirty() {
        if (!this.isDirty) {
            this.isDirty = true;
            const btn = this.element.querySelector(".visage-save");
            if (btn) btn.classList.add("dirty");
        }
    }

    _onRender(context, options) {
        this.element.addEventListener("change", () => this._markDirty());
        this.element.addEventListener("input", () => this._markDirty());

        // Attach generic change listener for preview updates
        this.element.addEventListener("change", () => {
            this._markDirty();
            this._updatePreview(); // Trigger Live Update
        });
        
        // Attach input listener for smooth color/text updates
        this.element.addEventListener("input", (event) => {
            this._markDirty();
            // Only update preview on input for specific fields to avoid lag
            if (event.target.matches("input[type='text'], color-picker")) {
                 this._updatePreview();
            }
        });
        
        // Run once to ensure sync
        this._updatePreview();
    }

    async _onSave(event, target) {
        event.preventDefault();
        const formData = new foundry.applications.ux.FormDataExtended(this.element).object;

        const getVal = (key, type = String) => {
            // Check for the "active" checkbox using the naming convention from HBS
            // e.g. "nameOverride_active"
            const isActive = formData[`${key}_active`];
            if (!isActive) return null;
            
            const raw = formData[key];
            if (type === Number) return parseFloat(raw);
            if (type === Boolean) return !!raw;
            return raw;
        };

        // Scale Logic
        let finalScale = null;
        if (formData.scale_active) {
            finalScale = parseFloat(formData.scale) / 100;
        }

        const label = formData.label ? formData.label.trim() : game.i18n.localize("VISAGE.GlobalEditor.DefaultLabel");

        const getFlipVal = (key) => {
            const val = formData[key];
            if (val === "true") return true;
            if (val === "false") return false;
            return null;
        };

        const payload = {
            label: label,
            category: formData.category,
            tags: formData.tags.split(",").map(t => t.trim()).filter(t => t),
            
            changes: {
                name: getVal("nameOverride"),
                img: getVal("img"),
                scale: finalScale,
                isFlippedX: getFlipVal("isFlippedX"),
                isFlippedY: getFlipVal("isFlippedY"),
                width: getVal("width", Number),
                height: getVal("height", Number),
                disposition: getVal("disposition", Number),
                ring: null 
            }
        };

        // FIX: Check "ring.enabled" (matches HTML name), not "ring_active"
        if (formData["ring.enabled"]) {
            let effectsMask = 0;
            // Iterate over formData to find effects
            for (const [k, v] of Object.entries(formData)) {
                if (k.startsWith("effect_") && v === true) {
                    effectsMask |= parseInt(k.split("_")[1]);
                }
            }

            payload.changes.ring = {
                enabled: true,
                colors: {
                    // Match HTML names: ringColor, ringBackgroundColor
                    ring: formData.ringColor,
                    background: formData.ringBackgroundColor
                },
                subject: {
                    texture: formData.ringSubjectTexture,
                    scale: formData.ringSubjectScale
                },
                effects: effectsMask
            };
        }

        try {
            if (this.visageId) {
                await VisageGlobalData.update(this.visageId, payload);
                ui.notifications.info(game.i18n.format("VISAGE.Notifications.Updated", { name: payload.label }));
            } else {
                await VisageGlobalData.create(payload);
                ui.notifications.info(game.i18n.format("VISAGE.Notifications.Created", { name: payload.label }));
            }
            this.close();
        } catch (err) {
            ui.notifications.error(game.i18n.localize("VISAGE.Notifications.SaveFailed"));
            console.error(err);
        }
    }
}