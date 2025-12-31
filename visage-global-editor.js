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

        // --- 1. PREPARE CATEGORIES (Autocomplete) ---
        // Fetch all existing visages to build the unique category list
        const allVisages = VisageGlobalData.all; 
        const categorySet = new Set();
        allVisages.forEach(v => {
            if (v.category) categorySet.add(v.category);
        });
        // Sort alphabetically for the dropdown
        const categories = Array.from(categorySet).sort();

        const c = data.changes || {};

        // --- 2. HELPER: Ring Context ---
        const ringActive = !!c.ring;
        const ringContext = Visage.prepareRingContext(c.ring);

        // ... (Scale, Dims, Flip, Disposition Logic - NO CHANGES) ...
        const rawScale = c.scale ?? 1.0; 
        const displayScale = Math.round(rawScale * 100);
        const scaleActive = (rawScale !== 1.0);

        let dimLabel = "-";
        let dimActive = false;
        if ((c.width && c.width !== 1) || (c.height && c.height !== 1)) {
            dimLabel = `${c.width || 1} x ${c.height || 1}`;
            dimActive = true;
        }

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

        // PREVIEW OBJECT
        const previewData = {
            img: c.img || "",
            isVideo: foundry.helpers.media.VideoHelper.hasVideoExtension(c.img || ""),
            flipX: c.isFlippedX === true,
            flipY: c.isFlippedY === true,
            
            hasRing: !!ringActive,
            ringColor: ringContext.colors.ring,
            ringBkg: ringContext.colors.background,
            hasPulse: ringContext.hasPulse,
            hasGradient: ringContext.hasGradient,
            hasWave: ringContext.hasWave,
            hasInvisibility: ringContext.hasInvisibility,
            
            slots: {
                scale: { val: `${displayScale}%`, active: scaleActive },
                dim: { val: dimLabel, active: dimActive },
                flip: { icon: flipIcon, val: flipLabel, active: flipActive },
                disposition: { class: dispositionClass, val: dispositionLabel }
            },
            name: c.name || "",
            tagList: data.tags || [] 
        };

        const prep = (val, def) => ({ value: val ?? def, active: val !== null && val !== undefined });
        const prepFlip = (val) => ({ value: val ?? null });

        return {
            isEdit: !!this.visageId,            
            label: data.label,
            category: data.category,
            categories: categories, // PASSING THE LIST TO TEMPLATE
            tags: (data.tags || []).join(", "), 
            
            img: prep(c.img, ""),
            scale: { value: displayScale, active: c.scale !== null && c.scale !== undefined },
            isFlippedX: prepFlip(c.isFlippedX),
            isFlippedY: prepFlip(c.isFlippedY),
            nameOverride: prep(c.name, ""),
            disposition: prep(c.disposition, 0),
            width: prep(c.width, 1),
            height: prep(c.height, 1),
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

        // ... (Extraction logic same as before) ...
        const scaleVal = formData.scale; 
        const displayScale = scaleVal ? Math.round(scaleVal) : 100;
        const scaleActive = displayScale !== 100;
        
        const w = formData.width;
        const h = formData.height;
        const isFlippedX = formData.isFlippedX === "true";
        const isFlippedY = formData.isFlippedY === "true";
        const disposition = (formData.disposition !== "" && formData.disposition !== null) ? parseInt(formData.disposition) : null;
        const nameOverride = formData.nameOverride || "";
        const label = formData.label || "";
        const tagsStr = formData.tags || "";
        const ringEnabled = formData["ring.enabled"]; 
        const ringColor = formData.ringColor || "#FFFFFF"; 
        const ringBkg = formData.ringBackgroundColor || "#000000";
        
        // --- 2. ASYNC RESOLUTION (USE HELPER) ---
        const rawImgPath = formData.img || "";
        // Resolves * -> random file
        const resolvedPath = await Visage.resolvePath(rawImgPath); 
        const isVideo = foundry.helpers.media.VideoHelper.hasVideoExtension(resolvedPath);
        
        // ... (Calculate slots logic same as before) ...
        let dimLabel = "-";
        let dimActive = false;
        if ((w && w != 1) || (h && h != 1)) {
            dimLabel = `${w || 1} x ${h || 1}`;
            dimActive = true;
        }

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

        // --- DOM UPDATE ---
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

        const nameEl = el.querySelector(".token-name-label");
        if (nameEl) {
            nameEl.textContent = nameOverride;
            nameEl.style.display = nameOverride ? "block" : "none";
        }

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

        // Visual Updates
        const ringEl = el.querySelector(".visage-ring-preview");
        if (ringEl) {
            ringEl.style.display = ringEnabled ? "block" : "none";
            if (ringEnabled) {
                ringEl.style.setProperty("--ring-color", ringColor);
                ringEl.style.setProperty("--ring-bkg", ringBkg);
                const toggle = (k, c) => {
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
        
        // Media Update (Using Resolved Path)
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
            const isActive = formData[`${key}_active`];
            if (!isActive) return null;
            
            const raw = formData[key];
            if (type === Number) return parseFloat(raw);
            if (type === Boolean) return !!raw;
            return raw;
        };

        let finalScale = null;
        if (formData.scale_active) {
            finalScale = parseFloat(formData.scale) / 100;
        }

        const label = formData.label ? formData.label.trim() : game.i18n.localize("VISAGE.GlobalEditor.DefaultLabel");

        // --- CATEGORY SANITISATION ---
        // 1. Trim whitespace
        // 2. Enforce Title Case (e.g. "bosses" -> "Bosses") to prevent duplicates
        let cleanCategory = "";
        if (formData.category) {
            cleanCategory = formData.category.trim().replace(
                /\w\S*/g,
                (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
            );
        }

        const getFlipVal = (key) => {
            const val = formData[key];
            if (val === "true") return true;
            if (val === "false") return false;
            return null;
        };

        const payload = {
            label: label,
            category: cleanCategory, // Use sanitised version
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

        // Ring Logic (No changes needed here, assuming previous fix applied)
        if (formData["ring.enabled"]) {
            let effectsMask = 0;
            for (const [k, v] of Object.entries(formData)) {
                if (k.startsWith("effect_") && v === true) {
                    effectsMask |= parseInt(k.split("_")[1]);
                }
            }

            payload.changes.ring = {
                enabled: true,
                colors: {
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