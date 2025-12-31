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

        // --- 1. PREPARE AUTOCOMPLETE DATA ---
        const allVisages = VisageGlobalData.all; 
        const categorySet = new Set();
        const tagSet = new Set();

        allVisages.forEach(v => {
            if (v.category) categorySet.add(v.category);
            if (v.tags && Array.isArray(v.tags)) {
                v.tags.forEach(t => tagSet.add(t));
            }
        });
        
        const categories = Array.from(categorySet).sort();
        const allTags = Array.from(tagSet).sort();

        const c = data.changes || {};

        // --- 2. EXTRACT DATA FROM UNIFIED MODEL ---
        // Extract Ring
        const ringActive = !!c.ring;
        const ringContext = Visage.prepareRingContext(c.ring);

        // Extract Scale & Flip from texture.scaleX/Y
        const tx = c.texture || {};
        const rawScaleX = tx.scaleX ?? 1.0;
        const rawScaleY = tx.scaleY ?? 1.0;
        
        // Logic: If scaleX is negative, it's flipped X. Magnitude is scale.
        // We use the 'scale' property in changes (legacy) as fallback or derive from texture
        const derivedScale = Math.abs(rawScaleX);
        const derivedFlipX = rawScaleX < 0;
        const derivedFlipY = rawScaleY < 0;
        
        // Determine if these fields should be "Active" in the UI
        // If texture object exists, we assume visual props are active
        const hasTexture = !!c.texture;
        
        const displayScale = Math.round(derivedScale * 100);

        let dimLabel = "-";
        let dimActive = false;
        if ((c.width && c.width !== 1) || (c.height && c.height !== 1)) {
            dimLabel = `${c.width || 1} x ${c.height || 1}`;
            dimActive = true;
        }

        let flipIcon = "fas fa-arrows-alt-h"; 
        let flipLabel = "-";
        let flipActive = false;
        if (derivedFlipX || derivedFlipY) {
            flipActive = true;
            if (derivedFlipX && !derivedFlipY) {
                flipIcon = "fas fa-arrow-left";
                flipLabel = game.i18n.localize("VISAGE.Mirror.Horizontal.Label");
            } else if (derivedFlipY && !derivedFlipX) {
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
            flipX: derivedFlipX,
            flipY: derivedFlipY,
            
            hasRing: !!ringActive,
            ringColor: ringContext.colors.ring,
            ringBkg: ringContext.colors.background,
            hasPulse: ringContext.hasPulse,
            hasGradient: ringContext.hasGradient,
            hasWave: ringContext.hasWave,
            hasInvisibility: ringContext.hasInvisibility,
            
            slots: {
                scale: { val: `${displayScale}%`, active: hasTexture },
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
            categories: categories,
            tags: (data.tags || []).join(", "), 
            allTags: allTags,
            img: prep(c.img, ""),
            // UI State Mapped from Unified Model
            scale: { value: displayScale, active: hasTexture },
            isFlippedX: { value: derivedFlipX, active: hasTexture && derivedFlipX }, 
            isFlippedY: { value: derivedFlipY, active: hasTexture && derivedFlipY },
            
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
     */
    async _updatePreview() {
        const formData = new foundry.applications.ux.FormDataExtended(this.element).object;
        const el = this.element;

        const scaleVal = formData.scale; 
        const displayScale = scaleVal ? Math.round(scaleVal) : 100;
        const scaleActive = formData.scale_active; 
        
        const w = formData.width;
        const h = formData.height;
        const wActive = formData.width_active;
        const hActive = formData.height_active;

        const isFlippedX = formData.isFlippedX === "true";
        const isFlippedY = formData.isFlippedY === "true";
        const flipXActive = formData.isFlippedX_active;
        const flipYActive = formData.isFlippedY_active;

        const disposition = (formData.disposition !== "" && formData.disposition !== null) ? parseInt(formData.disposition) : null;
        const nameOverride = formData.nameOverride || "";
        const label = formData.label || "";
        const tagsStr = formData.tags || "";
        
        const ringEnabled = formData["ring.enabled"]; 
        const ringColor = formData.ringColor || "#FFFFFF"; 
        const ringBkg = formData.ringBackgroundColor || "#000000";
        
        // --- 2. ASYNC RESOLUTION ---
        const rawImgPath = formData.img || "";
        const resolvedPath = await Visage.resolvePath(rawImgPath); 
        const isVideo = foundry.helpers.media.VideoHelper.hasVideoExtension(resolvedPath);
        
        let dimLabel = "-";
        let dimActive = false;
        if ((wActive && w && w != 1) || (hActive && h && h != 1)) {
            dimLabel = `${w || 1} x ${h || 1}`;
            dimActive = true;
        }

        let flipIcon = "fas fa-arrows-alt-h"; 
        let flipLabel = "-";
        let flipActive = false;
        
        if (isFlippedX || isFlippedY) {
            // In preview, we show it active if the checkboxes are checked, regardless of the 'active' toggle
            // to give immediate feedback, but visually gray it out if the toggle is off? 
            // Actually, keep logic simple:
            if (flipXActive || flipYActive) {
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
        }

        let dispClass = "none";
        let dispLabel = game.i18n.localize("VISAGE.Disposition.NoChange");
        const dispActive = formData.disposition_active;
        
        if (dispActive && disposition !== null && !isNaN(disposition)) {
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
            if (!dispActive) dispSlot.classList.add("inactive");
            else dispSlot.classList.remove("inactive");
        }

        const nameEl = el.querySelector(".token-name-label");
        if (nameEl) {
            nameEl.textContent = nameOverride;
            const nameActive = formData.nameOverride_active;
            nameEl.style.display = (nameActive && nameOverride) ? "block" : "none";
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
        
        // Media Update
        // Apply flip to transform
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
        this._updatePreview(); // Ensure toggles update preview state
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
        this._bindTagInput();
        this.element.addEventListener("change", () => {
            this._markDirty();
            this._updatePreview();
        });
        this.element.addEventListener("input", (event) => {
            this._markDirty();
            if (event.target.matches("input[type='text'], color-picker")) {
                 this._updatePreview();
            }
        });
        this._updatePreview();
    }

    _bindTagInput() {
        const container = this.element.querySelector(".visage-tag-container");
        if (!container) return;
        const input = container.querySelector(".visage-tag-input");
        const hidden = container.querySelector("input[name='tags']");
        const pillsDiv = container.querySelector(".visage-tag-pills");
        
        const updateHidden = () => {
            const tags = Array.from(pillsDiv.querySelectorAll(".visage-tag-pill"))
                .map(p => p.dataset.tag);
            hidden.value = tags.join(",");
            this._markDirty();
        };

        const addPill = (text) => {
            const clean = text.trim();
            if (!clean) return;
            const existing = Array.from(pillsDiv.querySelectorAll(".visage-tag-pill"))
                .map(p => p.dataset.tag.toLowerCase());
            if (existing.includes(clean.toLowerCase())) return;

            const pill = document.createElement("span");
            pill.className = "visage-tag-pill";
            pill.dataset.tag = clean;
            pill.innerHTML = `${clean} <i class="fas fa-times"></i>`;
            pill.querySelector("i").addEventListener("click", () => {
                pill.remove();
                updateHidden();
            });
            pillsDiv.appendChild(pill);
            updateHidden();
        };

        if (hidden.value) {
            hidden.value.split(",").forEach(t => addPill(t));
        }

        input.addEventListener("keydown", (ev) => {
            if (ev.key === "Enter" || ev.key === "," || ev.key === "Tab") {
                ev.preventDefault();
                addPill(input.value);
                input.value = "";
            } else if (ev.key === "Backspace" && !input.value) {
                const last = pillsDiv.lastElementChild;
                if (last) {
                    last.remove();
                    updateHidden();
                }
            }
        });
        
        input.addEventListener("focus", () => container.classList.add("focused"));
        input.addEventListener("blur", () => {
            if (input.value.trim()) {
                addPill(input.value);
                input.value = "";
            }
            container.classList.remove("focused");
        });
        container.addEventListener("click", (e) => {
            if(e.target === container || e.target === pillsDiv) input.focus();
        });
    }

    /**
     * Handles Save - REFACTORED TO USE UNIFIED MODEL
     */
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

        // --- PREPARE UNIFIED TEXTURE OBJECT ---
        // Scale and Flip now map to texture.scaleX / scaleY
        let texture = undefined;
        
        // We check if ANY visual property is active.
        // In Foundry, you cannot partially update scaleX (sign vs magnitude).
        // So if either Scale OR Flip is active, we write the texture object.
        const isScaleActive = formData.scale_active;
        const isFlipXActive = formData.isFlippedX_active;
        const isFlipYActive = formData.isFlippedY_active;

        if (isScaleActive || isFlipXActive || isFlipYActive) {
            // Get base values (default to standard if inactive)
            const rawScale = isScaleActive ? (parseFloat(formData.scale) / 100) : 1.0;
            const flipX = isFlipXActive ? (formData.isFlippedX === "true") : false;
            const flipY = isFlipYActive ? (formData.isFlippedY === "true") : false;
            
            texture = {
                scaleX: rawScale * (flipX ? -1 : 1),
                scaleY: rawScale * (flipY ? -1 : 1)
            };
        }

        const label = formData.label ? formData.label.trim() : game.i18n.localize("VISAGE.GlobalEditor.DefaultLabel");

        // Category Sanitisation
        let cleanCategory = "";
        if (formData.category) {
            cleanCategory = formData.category.trim().replace(
                /\w\S*/g,
                (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
            );
        }

        const payload = {
            label: label,
            category: cleanCategory,
            tags: formData.tags.split(",").map(t => t.trim()).filter(t => t),
            
            // --- THE UNIFIED CHANGES OBJECT ---
            changes: {
                name: getVal("nameOverride"),
                img: getVal("img"),
                texture: texture, // Now passed as nested object
                width: getVal("width", Number),
                height: getVal("height", Number),
                disposition: getVal("disposition", Number),
                ring: null 
            }
        };

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