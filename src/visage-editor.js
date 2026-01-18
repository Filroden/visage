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
        
        // State tracking for Tabs
        this._activeTab = "appearance";
        
        // Dynamic Icon: Domino Mask for Global, Face Mask for Local
        this.options.window.icon = !this.isLocal ? "visage-icon-domino" : "visage-icon-mask";

        // Viewport State for Stage
        this._viewState = {
            scale: 1.0,
            x: 0,
            y: 0,
            isDragging: false,
            lastX: 0,
            lastY: 0
        };
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
        // NOTE: "tabs" config is not supported in ApplicationV2, handled manually in _onRender
        position: { width: 960, height: "auto" },
        actions: {
            save: VisageEditor.prototype._onSave,
            toggleField: VisageEditor.prototype._onToggleField,
            openFilePicker: VisageEditor.prototype._onOpenFilePicker,
            resetSettings: VisageEditor.prototype._onResetSettings,
            zoomIn: VisageEditor.prototype._onZoomIn,
            zoomOut: VisageEditor.prototype._onZoomOut,
            resetZoom: VisageEditor.prototype._onResetZoom,
            toggleGrid: VisageEditor.prototype._onToggleGrid
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

        // PREPARE ALPHA: Convert 0-1 float to 0-100 integer for input
        const alphaVal = (c.alpha !== undefined && c.alpha !== null) ? Math.round(c.alpha * 100) : 100;
        
        // PREPARE LOCK: Convert boolean/null to string for <select>
        let lockVal = "";
        if (c.lockRotation === true) lockVal = "true";
        if (c.lockRotation === false) lockVal = "false";

        return {
            ...context, 
            isEdit: !!this.visageId,
            isLocal: this.isLocal,
            categories: Array.from(categorySet).sort(),
            allTags: Array.from(tagSet).sort(),
            tagsString: (data.tags || []).join(","), 
            
            img: prep(rawImg, ""),
            
            // ATOMIC PROPERTIES
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

            alpha: {
                value: alphaVal,
                active: (c.alpha !== undefined && c.alpha !== null)
            },
            lockRotation: {
                value: lockVal,
                active: true // Always active as a select
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
                tagList: data.tags || [],
                alpha: (c.alpha !== undefined && c.alpha !== null) ? c.alpha : 1.0 // for initial render
            }
        };
    }

    /**
     * Updates the Live Preview pane based on current form values.
     */
    async _updatePreview() {
        const formData = new foundry.applications.ux.FormDataExtended(this.element).object;
        const el = this.element;

        // Helper to extract values only if their "active" checkbox is checked
        const getVal = (key, type = String) => {
            const isActive = formData[`${key}_active`];
            if (!isActive) return undefined;
            const raw = formData[key];
            if (type === Number) return parseFloat(raw);
            if (type === Boolean) return !!raw;
            return (typeof raw === "string") ? raw.trim() : raw;
        };

        // 1. Extract & Calculate Values
        const isScaleActive = formData.scale_active;
        const isFlipXActive = formData.isFlippedX !== "";
        const isFlipYActive = formData.isFlippedY !== "";
        const imgSrc = getVal("img"); 

        const rawScale = isScaleActive ? (parseFloat(formData.scale) / 100) : 1.0;
        const flipX = isFlipXActive ? (formData.isFlippedX === "true") : false;
        const flipY = isFlipYActive ? (formData.isFlippedY === "true") : false;

        const isAlphaActive = formData.alpha_active;
        const rawAlpha = isAlphaActive ? (parseFloat(formData.alpha) / 100) : 1.0;
        
        const lockVal = formData.lockRotation;
        const rawLock = (lockVal === "true");

        // NEW: Extract Dimensions for Grid (Default to 1 if inactive/unset)
        const width = getVal("width", Number) || 1;
        const height = getVal("height", Number) || 1;

        // 2. Pass Dimensions to CSS for the Grid Overlay
        const content = el.querySelector('.visage-preview-content.stage-mode');
        if (content) {
            content.style.setProperty('--visage-dim-w', width);
            content.style.setProperty('--visage-dim-h', height);
        }

        // 3. Build Texture Object (Baked fallback for preview rendering)
        let texture = {};
        if (imgSrc) {
            texture.src = imgSrc;
        }
        if (isScaleActive || isFlipXActive || isFlipYActive) {
            texture.scaleX = rawScale * (flipX ? -1 : 1);
            texture.scaleY = rawScale * (flipY ? -1 : 1);
        }
        if (Object.keys(texture).length === 0) texture = undefined;

        // 4. Build Ring Data
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

        // 5. Construct Mock Data (Including Atomic Intents)
        const mockData = {
            changes: {
                name: getVal("nameOverride"),
                texture: texture, 
                
                // ATOMIC INTENTS
                scale: isScaleActive ? rawScale : null,
                mirrorX: isFlipXActive ? flipX : null,
                mirrorY: isFlipYActive ? flipY : null,
                
                alpha: isAlphaActive ? rawAlpha : null,
                lockRotation: (lockVal !== "") ? rawLock : null,
                
                width: getVal("width", Number),
                height: getVal("height", Number),
                disposition: getVal("disposition", Number),
                ring: ring
            },
            tags: (formData.tags || "").split(",").map(t => t.trim()).filter(t => t)
        };

        // 6. Resolve Image Paths
        const ringEnabled = formData["ring.enabled"];
        const subjectTexture = formData.ringSubjectTexture;
        const mainImage = mockData.changes.texture?.src || "";
        const rawPath = (ringEnabled && subjectTexture) ? subjectTexture : mainImage;
        const resolved = await VisageUtilities.resolvePath(rawPath);
        const resolvedPath = resolved || rawPath;

        // 7. Generate Presentation Context
        const context = VisageData.toPresentation(mockData, {
            isWildcard: rawPath.includes('*')
        });

        const meta = context.meta;

        // 8. Update UI Slots (Badges)
        const findItem = (iconClass) => {
            const icon = el.querySelector(`.metadata-grid i.${iconClass}`) || el.querySelector(`.metadata-grid img[src*="${iconClass}"]`);
            return icon ? icon.closest('.meta-item') : null;
        };

        // Scale
        const scaleItem = findItem('scale'); 
        if (scaleItem && meta.slots.scale) {
            scaleItem.querySelector('.meta-value').textContent = meta.slots.scale.val;
            if(meta.slots.scale.active) scaleItem.classList.remove('inactive'); else scaleItem.classList.add('inactive');
        }

        // Dimensions
        const dimItem = findItem('dimensions');
        if (dimItem && meta.slots.dim) {
            dimItem.querySelector('.meta-value').textContent = meta.slots.dim.val;
            if(meta.slots.dim.active) dimItem.classList.remove('inactive'); else dimItem.classList.add('inactive');
        }

        // Lock
        const lockItem = findItem('lock'); 
        if (lockItem && meta.slots.lock) {
            lockItem.querySelector('.meta-value').textContent = meta.slots.lock.val;
            if(meta.slots.lock.active) lockItem.classList.remove('inactive'); else lockItem.classList.add('inactive');
        }

        // Wildcard
        const wildItem = findItem('wildcard');
        if (wildItem && meta.slots.wildcard) {
            wildItem.querySelector('.meta-value').textContent = meta.slots.wildcard.val;
            if(meta.slots.wildcard.active) wildItem.classList.remove('inactive'); else wildItem.classList.add('inactive');
        }

        // Disposition
        const dispItem = el.querySelector('.disposition-item');
        if (dispItem && meta.slots.disposition) {
            const valSpan = dispItem.querySelector('.visage-disposition-text');
            if (valSpan) {
                valSpan.textContent = meta.slots.disposition.val;
                valSpan.className = `visage-disposition-text ${meta.slots.disposition.class}`;
            }
        }

        // Mirroring (Split Logic)
        const updateMirrorSlot = (type, slotData) => {
            const slot = el.querySelector(`.mirror-sub-slot.${type}`);
            if (!slot) return;
            const img = slot.querySelector('img');
            
            if (slotData.active) slot.classList.remove('inactive');
            else slot.classList.add('inactive');

            if (img) {
                img.classList.remove('visage-rotate-0', 'visage-rotate-90', 'visage-rotate-180', 'visage-rotate-270');
                img.classList.add(slotData.cls);
            }
        };

        if (meta.slots.flipH) updateMirrorSlot('horizontal', meta.slots.flipH);
        if (meta.slots.flipV) updateMirrorSlot('vertical', meta.slots.flipV);

        // 9. Update Name Label
        const nameEl = el.querySelector(".token-name-label");
        if (nameEl) {
            nameEl.textContent = mockData.changes.name || "";
            nameEl.style.display = mockData.changes.name ? "block" : "none";
            nameEl.style.opacity = formData.nameOverride_active ? "1" : "0.5";
        }

        // 10. Update Dynamic Ring Visuals
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
                const previewContent = el.querySelector(".visage-preview-content");
                if (previewContent) {
                     if (meta.hasInvisibility) previewContent.classList.add("invisible");
                     else previewContent.classList.remove("invisible");
                }
            }
        }

        // 11. Update Opacity Visual
        const previewContainer = el.querySelector(".visage-preview-content > div");
        if (previewContainer) {
            previewContainer.style.opacity = isAlphaActive ? rawAlpha : 1.0;
        }

        // 12. Update Main Visual (Image/Video)
        // A. Determine Scale Magnitude
        let visualScale = rawScale; 
        if (meta.hasRing && formData.ringSubjectTexture) {
             visualScale = parseFloat(formData.ringSubjectScale) || 1.0;
        }

        // Cache the visual scale for the Zoom logic
        this._currentVisualScale = visualScale;

        // B. Combine Magnitude with Direction (Mirroring)
        const scaleX = visualScale * (context.isFlippedX ? -1 : 1);
        const scaleY = visualScale * (context.isFlippedY ? -1 : 1);
        const transform = `scale(${scaleX}, ${scaleY})`;

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
                vidEl.style.transform = transform; // Apply Scaled Transform
            }
            if (imgEl) imgEl.style.display = "none";
            if (iconEl) iconEl.style.display = "none";
        } else {
            if (vidEl) vidEl.style.display = "none";
            if (imgEl) {
                imgEl.src = resolvedPath;
                imgEl.style.display = "block";
                imgEl.style.transform = transform; // Apply Scaled Transform
            }
            if (iconEl) iconEl.style.display = "none";
        }

        // 13. Update Title & Tags
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
        const inputs = group.querySelectorAll(`[name="${fieldName}"]`); 
        inputs.forEach(input => input.disabled = !target.checked);
        
        const button = group.querySelector('button.file-picker-button');
        if (button) button.disabled = !target.checked;
        
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
            if (event.target.matches("input[type='text'], input[type='number'], color-picker")) {
                 clearTimeout(debounceTimer);
                 debounceTimer = setTimeout(() => {
                     this._updatePreview();
                 }, 500); 
            }
        });

        // --- TAB HANDLING ---
        const tabs = this.element.querySelectorAll(".visage-tabs .item");
        tabs.forEach(t => {
            t.addEventListener("click", (e) => {
                const target = e.currentTarget.dataset.tab;
                this._activateTab(target);
            });
        });
        
        // Restore active tab if set (persists across re-renders)
        if (this._activeTab) this._activateTab(this._activeTab);
        
        this._updatePreview();

        // Bind Stage Interactions
        this._bindStageInteractions();
        
        // Apply current transform (persists across re-renders)
        this._applyStageTransform();
        this._updatePreview();

        // Restore Grid State if it was active
        if (this._showGrid) {
            const stage = this.element.querySelector('.visage-live-preview-stage');
            const btn = this.element.querySelector('[data-action="toggleGrid"] i');
            if (stage) stage.classList.add('show-grid');
            if (btn) {
                btn.classList.remove('grid-on');
                btn.classList.add('grid-off');
            }
        }
    }

    /* -------------------------------------------- */
    /* Stage Interaction Methods                   */
    /* -------------------------------------------- */

    _onToggleGrid(event, target) {
        this._showGrid = !this._showGrid;
        const stage = this.element.querySelector('.visage-live-preview-stage');
        const icon = target.querySelector('i');

        if (stage) stage.classList.toggle('show-grid', this._showGrid);
        
        if (icon) {
            if (this._showGrid) {
                // Grid is ON -> Show "Off" icon
                icon.classList.remove('grid-on');
                icon.classList.add('grid-off');
            } else {
                // Grid is OFF -> Show "On" icon
                icon.classList.remove('grid-off');
                icon.classList.add('grid-on');
            }
        }
    }

    _bindStageInteractions() {
        const stage = this.element.querySelector('.visage-live-preview-stage');
        const content = this.element.querySelector('.visage-preview-content.stage-mode');
        if (!stage || !content) return;

        // 1. Mouse Wheel Zoom
        stage.addEventListener('wheel', (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? 0.9 : 1.1;
            this._viewState.scale = Math.min(Math.max(this._viewState.scale * delta, 0.1), 5.0);
            this._applyStageTransform();
        });

        // 2. Drag to Pan
        content.addEventListener('mousedown', (e) => {
            // Only left or middle mouse
            if (e.button !== 0 && e.button !== 1) return;
            e.preventDefault(); // Prevent native drag
            this._viewState.isDragging = true;
            this._viewState.lastX = e.clientX;
            this._viewState.lastY = e.clientY;
            content.style.cursor = 'grabbing';
        });

        window.addEventListener('mousemove', (e) => {
            if (!this._viewState.isDragging) return;
            const dx = e.clientX - this._viewState.lastX;
            const dy = e.clientY - this._viewState.lastY;
            
            this._viewState.x += dx;
            this._viewState.y += dy;
            this._viewState.lastX = e.clientX;
            this._viewState.lastY = e.clientY;
            
            this._applyStageTransform();
        });

        const stopDrag = () => {
            if (this._viewState.isDragging) {
                this._viewState.isDragging = false;
                if (content) content.style.cursor = 'grab';
            }
        };

        window.addEventListener('mouseup', stopDrag);
        // We don't bind mouseleave generally because dragging often goes outside the window
    }

    _applyStageTransform() {
        const content = this.element.querySelector('.visage-preview-content.stage-mode');
        if (content) {
            content.style.transform = `translate(${this._viewState.x}px, ${this._viewState.y}px) scale(${this._viewState.scale})`;
        }
    }

    _onZoomIn() {
        this._viewState.scale = Math.min(this._viewState.scale + 0.25, 5.0);
        this._applyStageTransform();
    }

    _onZoomOut() {
        this._viewState.scale = Math.max(this._viewState.scale - 0.25, 0.1);
        this._applyStageTransform();
    }

    _onResetZoom() {
        // Default to 1.0
        let targetScale = 1.0;

        // Smart Reset: If the visual content is larger than the stage (Scale > 1.0),
        // zoom out so the whole image fits.
        if (this._currentVisualScale && this._currentVisualScale > 1.0) {
            targetScale = 1.0 / this._currentVisualScale;
        }

        this._viewState.scale = targetScale;
        this._viewState.x = 0;
        this._viewState.y = 0;
        this._applyStageTransform();
    }

    /**
     * Manually switches the active tab by toggling CSS classes.
     * @param {string} tabName - The data-tab value to activate.
     */
    _activateTab(tabName) {
        this._activeTab = tabName;
        
        // Update Nav Items
        const navItems = this.element.querySelectorAll(".visage-tabs .item");
        navItems.forEach(n => {
            if (n.dataset.tab === tabName) n.classList.add("active");
            else n.classList.remove("active");
        });

        // Update Content Areas
        const contentItems = this.element.querySelectorAll(".visage-tab-content .tab");
        contentItems.forEach(c => {
            if (c.dataset.tab === tabName) c.classList.add("active");
            else c.classList.remove("active");
        });
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
        
        // Reset Opacity
        const alphaInput = this.element.querySelector('input[name="alpha"]');
        if (alphaInput) alphaInput.value = 100;
        
        const lockInput = this.element.querySelector('input[name="lockRotation"]');
        if (lockInput) lockInput.checked = false;

        this._markDirty();
        this._updatePreview();
        ui.notifications.info(game.i18n.localize("VISAGE.Notifications.SettingsReset"));
    }

    /**
     * Handles form submission.
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

        // 2. Prepare Atomic Values
        const isScaleActive = formData.scale_active;
        const isFlipXActive = formData.isFlippedX !== "";
        const isFlipYActive = formData.isFlippedY !== "";

        const rawScale = isScaleActive ? (parseFloat(formData.scale) / 100) : 1.0;
        const flipX = isFlipXActive ? (formData.isFlippedX === "true") : false;
        const flipY = isFlipYActive ? (formData.isFlippedY === "true") : false;

        const isAlphaActive = formData.alpha_active;
        const rawAlpha = isAlphaActive 
            ? (Math.min(Math.max(parseFloat(formData.alpha), 0), 100) / 100) 
            : 1.0;
        
        const lockVal = formData.lockRotation;
        const rawLock = (lockVal === "true");

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

                alpha: isAlphaActive ? rawAlpha : null,
                lockRotation: (lockVal !== "") ? rawLock : null,
                
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