/**
 * @file The Editor application for creating and modifying Visage entries (Global or Local).
 * @module visage
 */

import { Visage } from "./visage.js";
import { VisageData } from "./visage-data.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class VisageEditor extends HandlebarsApplicationMixin(ApplicationV2) {
    constructor(options = {}) {
        super(options);
        this.visageId = options.visageId || null;
        this.actorId = options.actorId || null;
        this.tokenId = options.tokenId || null;
        this.isDirty = false;
    }

    get isLocal() { return !!this.actorId; }

    get actor() {
        if (this.tokenId) {
            const token = canvas.tokens.get(this.tokenId);
            if (token?.actor) return token.actor;
            const scene = game.scenes.current; 
            const doc = scene?.tokens.get(this.tokenId);
            if(doc?.actor) return doc.actor;
        }
        if (this.actorId) return game.actors.get(this.actorId);
        return null;
    }

    static DEFAULT_OPTIONS = {
        tag: "form",
        id: "visage-editor",
        classes: ["visage", "visage-editor", "visage-dark-theme"],
        window: {
            title: "VISAGE.GlobalEditor.TitleNew.Global",
            icon: "visage-header-icon",
            resizable: true,
            minimizable: true,
            contentClasses: ["standard-form"]
        },
        position: { width: 960, height: "auto" },
        actions: {
            save: VisageEditor.prototype._onSave,
            toggleField: VisageEditor.prototype._onToggleField,
            openFilePicker: VisageEditor.prototype._onOpenFilePicker
        }
    };

    static PARTS = {
        form: {
            template: "modules/visage/templates/visage-editor.hbs",
            scrollable: [".visage-editor-grid"]
        }
    };

    get title() {
        if (this.isLocal) {
            return this.visageId 
                ? game.i18n.format("VISAGE.GlobalEditor.Title.Local", { name: this._currentLabel || "Visage" })
                : game.i18n.localize("VISAGE.GlobalEditor.TitleNew.Local");
        }
        return this.visageId 
            ? game.i18n.format("VISAGE.GlobalEditor.TitleEdit", { name: this._currentLabel || "Visage" })
            : game.i18n.localize("VISAGE.GlobalEditor.TitleNew.Global");
    }

    /**
     * Helper: Fetch default values for "Create New Local" (Snapshot).
     * FIX: Now reads exclusively from token.document to avoid PIXI/Pixel issues.
     */
    _getActorDefaults() {
        const actor = this.actor;
        if (!actor) return {};

        // 1. Try Token Document (Best for specific token instances)
        if (this.tokenId) {
            const token = canvas.tokens.get(this.tokenId) || game.scenes.current?.tokens.get(this.tokenId);
            if (token) {
                // IMPORTANT: Use .document to get Data, not the Placeable (which has pixels/PIXI objects)
                const doc = token.document;
                const texture = doc.texture || {};
                
                return {
                    name: doc.name,
                    img: texture.src, // File path string
                    scaleX: texture.scaleX ?? 1.0,
                    scaleY: texture.scaleY ?? 1.0,
                    width: doc.width, // Grid units (e.g. 2)
                    height: doc.height, // Grid units (e.g. 2)
                    disposition: doc.disposition,
                    // doc.ring is the data object, safe to clone
                    ring: doc.ring ? foundry.utils.deepClone(doc.ring) : {} 
                };
            }
        }

        // 2. Fallback: Prototype Token (Sidebar Actor)
        const proto = actor.prototypeToken;
        return {
            name: proto.name,
            img: proto.texture.src,
            scaleX: proto.texture.scaleX ?? 1.0,
            scaleY: proto.texture.scaleY ?? 1.0,
            width: proto.width,
            height: proto.height,
            disposition: proto.disposition,
            ring: proto.ring ? foundry.utils.deepClone(proto.ring) : {}
        };
    }

    async _prepareContext(options) {
        let data;

        if (this.visageId) {
            if (this.isLocal) {
                const visages = VisageData.getLocal(this.actor);
                data = visages.find(v => v.id === this.visageId);
                if (!data) return this.close();
            } else {
                data = VisageData.getGlobal(this.visageId);
                if (!data) return this.close();
            }
            this._currentLabel = data.label;
        } else {
            // CREATE NEW
            data = {
                label: this.isLocal ? "New Visage" : game.i18n.localize("VISAGE.GlobalEditor.TitleNew.Global"),
                category: "",
                tags: [],
                changes: {} 
            };
            
            // If Local, PRE-FILL with Token Defaults (Snapshot)
            if (this.isLocal) {
                const defaults = this._getActorDefaults();
                data.changes = {
                    name: defaults.name,
                    img: defaults.img,
                    texture: {
                        scaleX: defaults.scaleX,
                        scaleY: defaults.scaleY
                    },
                    width: defaults.width,
                    height: defaults.height,
                    disposition: defaults.disposition,
                    ring: defaults.ring
                };
            }
            this._currentLabel = "";
        }

        // ... [Rest of method remains unchanged] ...
        // (Autocomplete, Model Extraction, Preview Prep)
        // I am omitting the unchanged code block for brevity, 
        // assuming you will keep the existing logic from the previous file.
        
        const allVisages = VisageData.globals; 
        const categorySet = new Set();
        const tagSet = new Set();

        allVisages.forEach(v => {
            if (v.category) categorySet.add(v.category);
            if (v.tags && Array.isArray(v.tags)) v.tags.forEach(t => tagSet.add(t));
        });
        
        const categories = Array.from(categorySet).sort();
        const allTags = Array.from(tagSet).sort();

        const c = data.changes || {};

        const ringActive = !!(c.ring && c.ring.enabled);
        const ringContext = Visage.prepareRingContext(c.ring);

        const tx = c.texture || {};
        const rawScaleX = tx.scaleX ?? 1.0;
        const rawScaleY = tx.scaleY ?? 1.0;
        
        const derivedScale = Math.abs(rawScaleX);
        const derivedFlipX = rawScaleX < 0;
        const derivedFlipY = rawScaleY < 0;
        
        const isNew = !this.visageId;
        const hasTexture = !!c.texture || (isNew && this.isLocal);
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

        const rawImg = c.img || "";
        const resolvedImg = await Visage.resolvePath(rawImg);

        const previewData = {
            img: resolvedImg, 
            isVideo: foundry.helpers.media.VideoHelper.hasVideoExtension(resolvedImg),
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

        return {
            isEdit: !!this.visageId,
            isLocal: this.isLocal,
            label: data.label,
            category: data.category,
            categories: categories,
            tags: (data.tags || []).join(", "), 
            allTags: allTags,
            img: prep(c.img, ""),
            scale: { value: displayScale, active: hasTexture },
            isFlippedX: { value: derivedFlipX, active: hasTexture && derivedFlipX }, 
            isFlippedY: { value: derivedFlipY, active: hasTexture && derivedFlipY },
            nameOverride: prep(c.name, ""),
            disposition: prep(c.disposition, 0),
            width: prep(c.width, 1),
            height: prep(c.height, 1),
            ring: { active: ringActive, ...ringContext },
            preview: previewData
        };
    }

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
        const flipXActive = formData.isFlippedX !== "";
        const flipYActive = formData.isFlippedY !== "";

        const disposition = (formData.disposition !== "" && formData.disposition !== null) ? parseInt(formData.disposition) : null;
        const nameOverride = formData.nameOverride || "";
        const label = formData.label || "";
        const tagsStr = formData.tags || "";
        
        const ringEnabled = formData["ring.enabled"]; 
        const ringColor = formData.ringColor || "#FFFFFF"; 
        const ringBkg = formData.ringBackgroundColor || "#000000";
        
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
            nameEl.style.display = nameOverride ? "block" : "none";
            if (!formData.nameOverride_active) nameEl.style.opacity = "0.5"; 
            else nameEl.style.opacity = "1";
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
        this._updatePreview(); 
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
        if (this.isLocal) {
            this.element.classList.add("visage-theme-local");
            this.element.classList.remove("visage-theme-global");
        } else {
            this.element.classList.add("visage-theme-global");
            this.element.classList.remove("visage-theme-local");
        }

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

        let texture = undefined;
        const isScaleActive = formData.scale_active;
        const isFlipXActive = formData.isFlippedX !== "";
        const isFlipYActive = formData.isFlippedY !== "";

        if (isScaleActive || isFlipXActive || isFlipYActive) {
            const rawScale = isScaleActive ? (parseFloat(formData.scale) / 100) : 1.0;
            const flipX = isFlipXActive ? (formData.isFlippedX === "true") : false;
            const flipY = isFlipYActive ? (formData.isFlippedY === "true") : false;
            
            texture = {
                scaleX: rawScale * (flipX ? -1 : 1),
                scaleY: rawScale * (flipY ? -1 : 1)
            };
        }

        const label = formData.label ? formData.label.trim() : game.i18n.localize("VISAGE.GlobalEditor.DefaultLabel");

        let cleanCategory = "";
        if (formData.category) {
            cleanCategory = formData.category.trim().replace(
                /\w\S*/g,
                (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
            );
        }

        const payload = {
            id: this.visageId || foundry.utils.randomID(16),
            label: label,
            category: cleanCategory,
            tags: formData.tags.split(",").map(t => t.trim()).filter(t => t),
            
            changes: {
                name: getVal("nameOverride"),
                img: getVal("img"),
                texture: texture, 
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
            await VisageData.save(payload, this.actor);
            if (this.visageId) ui.notifications.info(game.i18n.format("VISAGE.Notifications.Updated", { name: payload.label }));
            else ui.notifications.info(game.i18n.format("VISAGE.Notifications.Created", { name: payload.label }));
            this.close();
        } catch (err) {
            ui.notifications.error(game.i18n.localize("VISAGE.Notifications.SaveFailed"));
            console.error(err);
        }
    }
}