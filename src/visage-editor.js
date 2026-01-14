/**
 * @file Defines the VisageEditor application.
 * A dual-purpose form for creating and editing both Local Visages (on Actors)
 * and Global Masks (in World Settings). Features a live WYSIWYG preview.
 * @module visage
 */

import { Visage } from "./visage.js";
import { VisageData } from "./visage-data.js";
import { VisageUtilities } from "./visage-utilities.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The main editor application.
 * Handles the logic for toggling fields (Intent), live preview updates,
 * and constructing the final data payload for persistence.
 */
export class VisageEditor extends HandlebarsApplicationMixin(ApplicationV2) {
    
    /**
     * @param {Object} options - Editor options.
     * @param {string} [options.visageId] - ID of the visage to edit. If null, creates new.
     * @param {string} [options.actorId] - ID of the actor (for Local Visages).
     * @param {string} [options.tokenId] - ID of the token (context for defaults).
     */
    constructor(options = {}) {
        super(options);
        this.visageId = options.visageId || null;
        this.actorId = options.actorId || null;
        this.tokenId = options.tokenId || null;
        this.isDirty = false;
        
        // Dynamic Icon: Domino Mask for Global, Face Mask for Local
        this.options.window.icon = !this.isLocal ? "visage-icon-domino" : "visage-header-icon";
    }

    /**
     * Returns true if we are editing a Local Visage on a specific Actor.
     * Returns false if we are editing a Global Mask in the World Library.
     */
    get isLocal() { return !!this.actorId; }

    get actor() {
        return VisageUtilities.resolveTarget(this.options).actor;
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
     * Prepares the Handlebars context.
     * Fetches existing data (if editing) or sets defaults (if creating).
     * Resolves atomic properties (Scale vs Mirror) for the UI controls.
     */
    async _prepareContext(options) {
        let data;
        
        // A. Resolve Source Data
        if (this.visageId) {
            // EDIT MODE
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
            // CREATE MODE
            if (this.isLocal) {
                // Pre-fill with current token state for convenience
                const token = canvas.tokens.get(this.tokenId) || this.actor.prototypeToken;
                const tokenDoc = token.document || token; 
                data = VisageData.getDefaultAsVisage(tokenDoc);
                data.label = "New Visage"; 
                data.id = null;
            } else {
                // Blank slate for Global Masks
                data = {
                    label: game.i18n.localize("VISAGE.GlobalEditor.TitleNew.Global"),
                    category: "",
                    tags: [],
                    changes: {} 
                };
            }
            this._currentLabel = "";
        }

        // B. Extract Raw Data
        const c = data.changes || {};
        const rawImg = c.texture?.src || "";
        const resolvedImg = await VisageUtilities.resolvePath(rawImg);

        // C. Generate Preview Context
        const context = VisageData.toPresentation(data, {
            isWildcard: rawImg.includes('*'),
            isActive: false
        });

        // D. Prepare Autocomplete Lists
        const allVisages = VisageData.globals; 
        const categorySet = new Set();
        const tagSet = new Set();
        allVisages.forEach(v => {
            if (v.category) categorySet.add(v.category);
            if (v.tags && Array.isArray(v.tags)) v.tags.forEach(t => tagSet.add(t));
        });

        // Helper: Format values for UI Inputs
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
            
            img: prep(rawImg, ""),
            
            // ATOMIC PROPERTIES
            // We expose these directly to the UI controls.
            // If the property exists in the data, the checkbox is 'active'.
            scale: { 
                value: (c.scale !== undefined && c.scale !== null) ? Math.round(c.scale * 100) : 100, 
                active: c.scale !== undefined && c.scale !== null 
            },
            isFlippedX: { 
                value: c.mirrorX, 
                active: c.mirrorX !== undefined && c.mirrorX !== null 
            },
            isFlippedY: { 
                value: c.mirrorY, 
                active: c.mirrorY !== undefined && c.mirrorY !== null 
            },

            width: prep(c.width, 1),
            height: prep(c.height, 1),
            disposition: prep(c.disposition, 0),
            nameOverride: prep(c.name, ""),

            ring: {
                active: ringActive,
                ...ringContext
            },

            preview: {
                ...context.meta, 
                img: resolvedImg || rawImg, 
                isVideo: context.isVideo,
                flipX: context.isFlippedX,
                flipY: context.isFlippedY,
                tagList: data.tags || []
            }
        };
    }

    /**
     * Updates the Live Preview pane based on current form values.
     * This method constructs a "Mock Visage Data" object representing the
     * user's current settings and feeds it into `VisageData.toPresentation`.
     * This ensures the preview matches exactly what the token will look like.
     */
    async _updatePreview() {
        const formData = new foundry.applications.ux.FormDataExtended(this.element).object;
        const el = this.element;

        const getVal = (key, type = String) => {
            const isActive = formData[`${key}_active`];
            if (!isActive) return undefined;
            const raw = formData[key];
            if (type === Number) return parseFloat(raw);
            if (type === Boolean) return !!raw;
            return (typeof raw === "string") ? raw.trim() : raw;
        };

        const isScaleActive = formData.scale_active;
        const isFlipXActive = formData.isFlippedX !== "";
        const isFlipYActive = formData.isFlippedY !== "";
        const imgSrc = getVal("img"); 

        // 1. Calculate Derived Values
        const rawScale = isScaleActive ? (parseFloat(formData.scale) / 100) : 1.0;
        const flipX = isFlipXActive ? (formData.isFlippedX === "true") : false;
        const flipY = isFlipYActive ? (formData.isFlippedY === "true") : false;

        let texture = {};
        if (imgSrc) {
            texture.src = imgSrc;
        }

        // 2. Populate Texture (Baked Fallback for visual preview rendering)
        // While the data model is atomic, the visual renderer often expects standard structure.
        if (isScaleActive || isFlipXActive || isFlipYActive) {
            texture.scaleX = rawScale * (flipX ? -1 : 1);
            texture.scaleY = rawScale * (flipY ? -1 : 1);
        }
        if (Object.keys(texture).length === 0) texture = undefined;

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

        // 3. Construct Mock Data (Including Atomic Intents)
        // We pass 'scale', 'mirrorX', etc. explicitly so toPresentation() knows 
        // these are active intents and not just defaults.
        const mockData = {
            changes: {
                name: getVal("nameOverride"),
                texture: texture, 
                
                // ATOMIC INTENTS
                scale: isScaleActive ? rawScale : null,
                mirrorX: isFlipXActive ? flipX : null,
                mirrorY: isFlipYActive ? flipY : null,
                
                width: getVal("width", Number),
                height: getVal("height", Number),
                disposition: getVal("disposition", Number),
                ring: ring
            },
            tags: (formData.tags || "").split(",").map(t => t.trim()).filter(t => t)
        };

        const ringEnabled = formData["ring.enabled"];
        const subjectTexture = formData.ringSubjectTexture;
        
        const mainImage = mockData.changes.texture?.src || "";
        const rawPath = (ringEnabled && subjectTexture) ? subjectTexture : mainImage;
        
        const resolved = await VisageUtilities.resolvePath(rawPath);
        const resolvedPath = resolved || rawPath;

        // 4. Generate Presentation Context
        const context = VisageData.toPresentation(mockData, {
            isWildcard: rawPath.includes('*')
        });

        const meta = context.meta;

        // 5. Update UI Slots (Badges)
        // Uses the calculated meta data to update the card badges dynamically.
        const updateSlot = (cls, data) => {
            const slot = el.querySelector(`.card-zone-left .${cls}`);
            if (!slot) return;
            
            slot.querySelector(".slot-value").textContent = data.val;
            
            if (data.active) slot.classList.remove("inactive");
            else slot.classList.add("inactive");

            const img = slot.querySelector("img");
            if (img) {
                img.src = data.src;
                // Reset rotation classes
                img.classList.remove("visage-rotate-0", "visage-rotate-90", "visage-rotate-180", "visage-rotate-270");
                img.classList.add(data.cls);
            }
        };

        updateSlot("scale-slot", meta.slots.scale);
        updateSlot("dim-slot", meta.slots.dim);
        updateSlot("flip-h-slot", meta.slots.flipH);
        updateSlot("flip-v-slot", meta.slots.flipV);
        updateSlot("wildcard-slot", meta.slots.wildcard);

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

        // Update Dynamic Ring Visuals
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

        // Update Main Visual (Image/Video)
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
        VisageUtilities.applyVisageTheme(this.element, this.isLocal);

        this.element.addEventListener("change", () => this._markDirty());
        this.element.addEventListener("input", () => this._markDirty());
        this._bindTagInput();
        
        this.element.addEventListener("change", () => {
            this._markDirty();
            this._updatePreview();
        });
        
        let debounceTimer;
        this.element.addEventListener("input", (event) => {
            this._markDirty();
            if (event.target.matches("input[type='text'], color-picker")) {
                 clearTimeout(debounceTimer);
                 debounceTimer = setTimeout(() => {
                     this._updatePreview();
                 }, 500); 
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
     * Constructs the final data payload, distinguishing between "inherited" (null) values
     * and "overridden" (intent) values based on checkbox states.
     */
    async _onSave(event, target) {
        event.preventDefault();
        const formData = new foundry.applications.ux.FormDataExtended(this.element).object;

        const getVal = (key, type = String) => {
            const isActive = formData[`${key}_active`];
            if (!isActive) return null; // If inactive, saving null enables inheritance
            const raw = formData[key];
            if (type === Number) return parseFloat(raw);
            if (type === Boolean) return !!raw;
            return (typeof raw === "string") ? raw.trim() : raw;
        };

        // 1. Prepare Texture (Source Only)
        let texture = {};
        const imgSrc = getVal("img");
        if (imgSrc) {
            texture.src = imgSrc;
        }
        if (Object.keys(texture).length === 0) texture = undefined;

        // 2. Prepare Atomic Values (Scoped correctly)
        // These are critical for the decoupled v2.2 schema
        const isScaleActive = formData.scale_active;
        const isFlipXActive = formData.isFlippedX !== "";
        const isFlipYActive = formData.isFlippedY !== "";

        const rawScale = isScaleActive ? (parseFloat(formData.scale) / 100) : 1.0;
        const flipX = isFlipXActive ? (formData.isFlippedX === "true") : false;
        const flipY = isFlipYActive ? (formData.isFlippedY === "true") : false;

        // 3. Prepare Metadata
        const label = formData.label ? formData.label.trim() : game.i18n.localize("VISAGE.GlobalEditor.DefaultLabel");
        let cleanCategory = "";
        if (formData.category) {
            cleanCategory = formData.category.trim().replace(
                /\w\S*/g,
                (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
            );
        }

        // 4. Construct Payload
        const payload = {
            id: this.visageId || foundry.utils.randomID(16),
            label: label,
            category: cleanCategory,
            tags: formData.tags.split(",").map(t => t.trim()).filter(t => t),
            
            changes: {
                name: getVal("nameOverride"),
                // Atomic Properties: if inactive, save as null to allow inheritance
                scale: isScaleActive ? rawScale : null,
                mirrorX: isFlipXActive ? flipX : null,
                mirrorY: isFlipYActive ? flipY : null,
                
                texture: texture,
                width: getVal("width", Number),
                height: getVal("height", Number),
                disposition: getVal("disposition", Number),
                ring: null 
            }
        };

        // 5. Add Ring Configuration
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
        } else {
            payload.changes.ring = { enabled: false };
        }

        // 6. Save via Data Controller
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