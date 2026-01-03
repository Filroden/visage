/**
 * @file The Editor application for creating and modifying Visage entries.
 * Handles the form logic, live preview updates, and data persistence.
 * @module visage
 */

import { Visage } from "./visage.js";
import { VisageData } from "./visage-data.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Application class for editing Visage/Mask data.
 * Supports both Local (Actor-specific) and Global (World-setting) modes.
 */
export class VisageEditor extends HandlebarsApplicationMixin(ApplicationV2) {
    
    /**
     * @param {Object} options - Application options.
     * @param {string|null} [options.visageId=null] - The ID of the visage to edit. If null, creates a new one.
     * @param {string|null} [options.actorId=null] - The ID of the actor (if local mode).
     * @param {string|null} [options.tokenId=null] - The ID of the token (if triggered from a specific token).
     */
    constructor(options = {}) {
        super(options);
        this.visageId = options.visageId || null;
        this.actorId = options.actorId || null;
        this.tokenId = options.tokenId || null;
        this.isDirty = false;

        // Set icon based on mode: Domino for Global, Mask for Local
        this.options.window.icon = !this.isLocal ? "visage-icon-domino" : "visage-header-icon";
    }

    /**
     * Determines if we are editing a Local Visage (Actor flag) or Global Mask (World setting).
     * @type {boolean}
     */
    get isLocal() { return !!this.actorId; }

    /**
     * Retrieves the target Actor document.
     * Handles both real Actors and synthetic Token Actors.
     * @type {Actor|null}
     */
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
            icon: "visage-icon-mask", 
            resizable: true,
            minimizable: true,
            contentClasses: ["standard-form"]
        },
        position: { width: 960, height: "auto" },
        actions: {
            save: VisageEditor.prototype._onSave,
            toggleField: VisageEditor.prototype._onToggleField,
            openFilePicker: VisageEditor.prototype._onOpenFilePicker,
            resetSettings: VisageEditor.prototype._onResetSettings
        }
    };

    static PARTS = {
        form: {
            template: "modules/visage/templates/visage-editor.hbs",
            scrollable: [".visage-editor-grid"]
        }
    };

    /** @override */
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
     * Prepares the data context for the Handlebars template.
     * Fetches existing data, resolves wildcards, and generates the preview state.
     * @override
     */
    async _prepareContext(options) {
        let data;

        // 1. Fetch Data (Edit Mode vs Create Mode)
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
            // New Entry Defaults
            if (this.isLocal) {
                // If local, try to pre-fill with current token appearance
                const token = canvas.tokens.get(this.tokenId) || this.actor.prototypeToken;
                const tokenDoc = token.document || token; 
                data = VisageData.getDefaultAsVisage(tokenDoc);
                data.label = "New Visage"; 
                data.id = null;
            } else {
                data = {
                    label: game.i18n.localize("VISAGE.GlobalEditor.TitleNew.Global"),
                    category: "",
                    tags: [],
                    changes: {} 
                };
            }
            this._currentLabel = "";
        }

        // 2. Resolve Image Path (Async)
        const rawImg = data.changes.img || data.changes.texture?.src || "";
        const resolvedImg = await Visage.resolvePath(rawImg);

        // 3. Generate Presentation Context (Metadata, Icons, Badges)
        const context = VisageData.toPresentation(data, {
            isVideo: foundry.helpers.media.VideoHelper.hasVideoExtension(resolvedImg),
            isWildcard: rawImg.includes('*'),
            isActive: false
        });

        // 4. Gather Auto-Complete Options (Categories/Tags) from existing globals
        const allVisages = VisageData.globals; 
        const categorySet = new Set();
        const tagSet = new Set();
        allVisages.forEach(v => {
            if (v.category) categorySet.add(v.category);
            if (v.tags && Array.isArray(v.tags)) v.tags.forEach(t => tagSet.add(t));
        });

        const c = data.changes || {};

        // Helper to format values for input fields
        const prep = (val, def) => {
            const isDefined = val !== null && val !== undefined;
            const isNotEmpty = typeof val === "string" ? val !== "" : true;
            return { 
                value: val ?? def, 
                active: isDefined && isNotEmpty
            };
        };

        const ringActive = !!(c.ring && c.ring.enabled);
        const ringContext = VisageData.prepareRingContext(c.ring); 

        return {
            ...context, 
            isEdit: !!this.visageId,
            isLocal: this.isLocal,
            categories: Array.from(categorySet).sort(),
            allTags: Array.from(tagSet).sort(),
            tagsString: (data.tags || []).join(","), 
            
            // Form Values
            img: prep(rawImg, ""),
            scale: { 
                value: Math.round(context.scale * 100), 
                active: c.texture?.scaleX !== undefined 
            },
            isFlippedX: { value: context.isFlippedX, active: c.texture?.scaleX !== undefined && context.isFlippedX },
            isFlippedY: { value: context.isFlippedY, active: c.texture?.scaleX !== undefined && context.isFlippedY },
            width: prep(c.width, 1),
            height: prep(c.height, 1),
            disposition: prep(c.disposition, 0),
            nameOverride: prep(c.name, ""),

            ring: {
                active: ringActive,
                ...ringContext
            },

            // Preview Card Data
            preview: {
                ...context.meta, 
                img: resolvedImg, 
                isVideo: context.isVideo,
                flipX: context.isFlippedX,
                flipY: context.isFlippedY,
                tagList: data.tags || []
            }
        };
    }

    /**
     * Live Preview Logic.
     * Updates the preview card DOM directly based on current form values without a full re-render.
     * This provides immediate feedback for scale, color, and text changes.
     * @private
     */
    async _updatePreview() {
        const formData = new foundry.applications.ux.FormDataExtended(this.element).object;
        const el = this.element;

        // Helper to get active values only
        const getVal = (key, type = String) => {
            const isActive = formData[`${key}_active`];
            if (!isActive) return undefined;
            const raw = formData[key];
            if (type === Number) return parseFloat(raw);
            if (type === Boolean) return !!raw;
            return raw;
        };

        // 1. Calculate Texture Transforms
        const isScaleActive = formData.scale_active;
        const isFlipXActive = formData.isFlippedX !== "";
        const isFlipYActive = formData.isFlippedY !== "";

        let texture = undefined;
        if (isScaleActive || isFlipXActive || isFlipYActive) {
            const rawScale = isScaleActive ? (parseFloat(formData.scale) / 100) : 1.0;
            const flipX = isFlipXActive ? (formData.isFlippedX === "true") : false;
            const flipY = isFlipYActive ? (formData.isFlippedY === "true") : false;
            texture = {
                scaleX: rawScale * (flipX ? -1 : 1),
                scaleY: rawScale * (flipY ? -1 : 1)
            };
        }

        // 2. Reconstruct Ring Data (Bitmask)
        let ring = null;
        if (formData["ring.enabled"]) {
            let effectsMask = 0;
            for (const [k, v] of Object.entries(formData)) {
                if (k.startsWith("effect_") && v === true) effectsMask |= parseInt(k.split("_")[1]);
            }
            ring = {
                enabled: true,
                colors: { ring: formData.ringColor, background: formData.ringBackgroundColor },
                subject: { texture: formData.ringSubjectTexture, scale: formData.ringSubjectScale },
                effects: effectsMask
            };
        }

        // 3. Create Mock Data Object
        const mockData = {
            changes: {
                name: getVal("nameOverride"),
                img: getVal("img"),
                texture: texture,
                width: getVal("width", Number),
                height: getVal("height", Number),
                disposition: getVal("disposition", Number),
                ring: ring
            },
            tags: (formData.tags || "").split(",").map(t => t.trim()).filter(t => t)
        };

        // 4. Resolve Path & Generate Context
        const rawPath = mockData.changes.img || "";
        const resolvedPath = await Visage.resolvePath(rawPath);

        const context = VisageData.toPresentation(mockData, {
            isVideo: foundry.helpers.media.VideoHelper.hasVideoExtension(resolvedPath),
            isWildcard: rawPath.includes('*')
        });

        const meta = context.meta;

        // 5. Update DOM Elements
        const updateSlot = (cls, val, active, icon) => {
            const slot = el.querySelector(`.card-zone-left .${cls}`);
            if (!slot) return;
            slot.querySelector(".slot-value").textContent = val;
            if (active) slot.classList.remove("inactive");
            else slot.classList.add("inactive");
            if (icon) slot.querySelector("i").className = icon;
        };

        updateSlot("scale-slot", meta.slots.scale.val, meta.slots.scale.active);
        updateSlot("dim-slot", meta.slots.dim.val, meta.slots.dim.active);
        updateSlot("flip-slot", meta.slots.flip.val, meta.slots.flip.active, meta.slots.flip.icon);

        // Update Disposition Chip
        const dispSlot = el.querySelector(".card-zone-left .disposition-slot .visage-disposition-chip");
        if (dispSlot) {
            dispSlot.textContent = meta.slots.disposition.val;
            dispSlot.className = `visage-disposition-chip ${meta.slots.disposition.class}`;
            if (mockData.changes.disposition === undefined) dispSlot.classList.add("inactive");
            else dispSlot.classList.remove("inactive");
        }

        // Update Name Label
        const nameEl = el.querySelector(".token-name-label");
        if (nameEl) {
            nameEl.textContent = mockData.changes.name || "";
            nameEl.style.display = mockData.changes.name ? "block" : "none";
            nameEl.style.opacity = formData.nameOverride_active ? "1" : "0.5";
        }

        // Update Dynamic Ring Styles
        const ringEl = el.querySelector(".visage-ring-preview");
        if (ringEl) {
            ringEl.style.display = meta.hasRing ? "block" : "none";
            if (meta.hasRing) {
                ringEl.style.setProperty("--ring-color", meta.ringColor);
                ringEl.style.setProperty("--ring-bkg", meta.ringBkg);
                const toggle = (cls, active) => {
                    if (active) ringEl.classList.add(cls); else ringEl.classList.remove(cls);
                };
                toggle("pulse", meta.hasPulse);
                toggle("gradient", meta.hasGradient);
                toggle("wave", meta.hasWave);
                const content = el.querySelector(".visage-preview-content");
                if (content) {
                     if (meta.hasInvisibility) content.classList.add("invisible");
                     else content.classList.remove("invisible");
                }
            }
        }

        // Update Image/Video Source & Transform
        const transform = `scale(${context.isFlippedX ? -1 : 1}, ${context.isFlippedY ? -1 : 1})`;
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
        } else if (context.isVideo) {
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

        // Update Title & Tags
        const titleEl = el.querySelector(".card-title");
        if (titleEl) titleEl.textContent = formData.label || game.i18n.localize("VISAGE.GlobalEditor.TitleNew");
        
        const tagsEl = el.querySelector(".card-tags");
        if (tagsEl) {
            tagsEl.innerHTML = "";
            mockData.tags.forEach(t => {
                const span = document.createElement("span");
                span.className = "tag";
                span.textContent = t;
                tagsEl.appendChild(span);
            });
        }
    }

    _onOpenFilePicker(event, target) {
        const input = target.previousElementSibling;
        const fp = new foundry.applications.apps.FilePicker({
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

    /**
     * Enables or disables form fields based on their associated "Active" checkbox.
     * Also triggers a preview update.
     */
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

    _markDirty() {
        if (!this.isDirty) {
            this.isDirty = true;
            const btn = this.element.querySelector(".visage-save");
            if (btn) btn.classList.add("dirty");
        }
    }

    _onRender(context, options) {
        // Handle RTL support
        const rtlLanguages = ["ar", "he", "fa", "ur"];
        if (rtlLanguages.includes(game.i18n.lang)) {
            this.element.setAttribute("dir", "rtl");
            this.element.classList.add("rtl");
        }

        // Apply Theme classes (Local vs Global)
        if (this.isLocal) {
            this.element.classList.add("visage-theme-local");
            this.element.classList.remove("visage-theme-global");
        } else {
            this.element.classList.add("visage-theme-global");
            this.element.classList.remove("visage-theme-local");
        }

        // Attach listeners for live preview
        this.element.addEventListener("change", () => this._markDirty());
        this.element.addEventListener("input", () => this._markDirty());
        this._bindTagInput();
        
        this.element.addEventListener("change", () => {
            this._markDirty();
            this._updatePreview();
        });
        
        // Debounce text inputs slightly if needed, but direct input event is usually fine for local preview
        this.element.addEventListener("input", (event) => {
            this._markDirty();
            if (event.target.matches("input[type='text'], color-picker")) {
                 this._updatePreview();
            }
        });
        
        this._updatePreview();
    }

    /**
     * Initializes the custom Tag Pill input component.
     * Handles adding, removing, and synchronizing tags with the hidden input field.
     * @private
     */
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
            this._updatePreview();
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

    _onResetSettings(event, target) {
        const checkboxes = this.element.querySelectorAll('input[type="checkbox"][name$="_active"]');
        checkboxes.forEach(cb => {
            cb.checked = false;
            this._onToggleField(null, cb); 
        });

        const ringCheck = this.element.querySelector('input[name="ring.enabled"]');
        if (ringCheck) ringCheck.checked = false;

        const selects = this.element.querySelectorAll('select');
        selects.forEach(s => s.value = "");

        this._markDirty();
        this._updatePreview();
        ui.notifications.info(game.i18n.localize("VISAGE.Notifications.SettingsReset"));
    }

    /**
     * Handles form submission.
     * Constructs the data payload, including bitwise ring effects, and saves via VisageData.
     */
    async _onSave(event, target) {
        event.preventDefault();
        const formData = new foundry.applications.ux.FormDataExtended(this.element).object;

        // Helper to extract values only if their "Active" checkbox is checked
        const getVal = (key, type = String) => {
            const isActive = formData[`${key}_active`];
            if (!isActive) return null;
            const raw = formData[key];
            if (type === Number) return parseFloat(raw);
            if (type === Boolean) return !!raw;
            return raw;
        };

        let texture = undefined;
        let flipX = undefined;
        let flipY = undefined;

        const isScaleActive = formData.scale_active;
        const isFlipXActive = formData.isFlippedX !== "";
        const isFlipYActive = formData.isFlippedY !== "";

        if (isScaleActive) {
            const rawScale = parseFloat(formData.scale) / 100;
            texture = { 
                scaleX: rawScale, 
                scaleY: rawScale 
            };
        }

        if (isFlipXActive && formData.isFlippedX === "true") flipX = true;
        if (isFlipYActive && formData.isFlippedY === "true") flipY = true;

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
                flipX: flipX,
                flipY: flipY,
                width: getVal("width", Number),
                height: getVal("height", Number),
                disposition: getVal("disposition", Number),
                ring: null 
            }
        };

        // Construct Ring Data (Bitmask)
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