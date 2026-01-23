import { Visage } from "./visage.js";
import { VisageData } from "./visage-data.js";
import { VisageUtilities } from "./visage-utilities.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The main editor application for creating and modifying Visages.
 * Handles the logic for toggling fields (Intent), live preview updates,
 * effect management (Visuals/Audio), and constructing the final data payload.
 * * * **Architecture Note:**
 * This application uses a "Snapshot" strategy (`_preservedData`) to persist unsaved 
 * form input across re-renders (e.g., when adding an effect row re-renders the DOM).
 */
export class VisageEditor extends HandlebarsApplicationMixin(ApplicationV2) {
    
    /**
     * @param {Object} options - Editor options.
     * @param {string} [options.visageId] - ID of the visage to edit. If null, creates new.
     * @param {string} [options.actorId] - ID of the actor (if editing a Local Visage).
     * @param {string} [options.tokenId] - ID of the token (context for extracting defaults).
     */
    constructor(options = {}) {
        super(options);
        
        /** @type {string|null} The ID of the Visage being edited. Null implies creation mode. */
        this.visageId = options.visageId || null;
        
        /** @type {string|null} The Actor ID for local scoping. */
        this.actorId = options.actorId || null;
        
        /** @type {string|null} The Token ID for context. */
        this.tokenId = options.tokenId || null;
        
        /** @type {boolean} Tracks if unsaved changes exist. */
        this.isDirty = false;
        
        // State tracking for UI Tabs (Appearance, Ring, Effects)
        this._activeTab = "appearance";

        // Internal state buffer to hold form data between re-renders
        this._preservedData = null;

        /** * Viewport State for the Live Preview Stage.
         * Controls zoom and pan transformations.
         */
        this._viewState = {
            scale: 1.0,
            x: 0,
            y: 0,
            isDragging: false,
            lastX: 0,
            lastY: 0
        };

        /** @type {Array<Object>|null} Local memory buffer for effect data. Populated in _prepareContext. */
        this._effects = null;       

        /** @type {string|null} The ID of the effect currently being edited in the Inspector pane. */
        this._activeEffectId = null;
        
        /** * Audio Preview State.
         * Maps Effect IDs to active Sound instances (or Promises thereof) to manage playback lifecycle.
         * @type {Map<string, Sound|Promise>}
         */
        this._audioPreviews = new Map(); 
    }

    /**
     * @returns {boolean} True if editing a Local Visage (Actor-specific), False for Global (World).
     */
    get isLocal() { return !!this.actorId; }

    /**
     * @returns {Actor|null} The resolved Actor document, if applicable.
     */
    get actor() {
        return VisageUtilities.resolveTarget(this.options).actor;
    }

    static DEFAULT_OPTIONS = {
        tag: "form",
        id: "visage-editor",
        classes: ["visage", "visage-editor", "visage-dark-theme"],
        window: {
            title: "VISAGE.GlobalEditor.TitleNew.Global",
            icon: "visage-icon-domino", 
            resizable: true,
            minimizable: true,
            contentClasses: ["standard-form"]
        },
        position: { width: 960, height: "auto" },
        actions: {
            // Core Persistence
            save: VisageEditor.prototype._onSave,
            toggleField: VisageEditor.prototype._onToggleField,
            openFilePicker: VisageEditor.prototype._onOpenFilePicker,
            resetSettings: VisageEditor.prototype._onResetSettings,
            
            // Stage / Viewport Controls
            zoomIn: VisageEditor.prototype._onZoomIn,
            zoomOut: VisageEditor.prototype._onZoomOut,
            resetZoom: VisageEditor.prototype._onResetZoom,
            toggleGrid: VisageEditor.prototype._onToggleGrid,
            
            // Effects Management
            addVisual: VisageEditor.prototype._onAddVisual,
            addAudio: VisageEditor.prototype._onAddAudio,
            editEffect: VisageEditor.prototype._onEditEffect,
            closeEffectInspector: VisageEditor.prototype._onCloseEffectInspector,
            deleteEffect: VisageEditor.prototype._onDeleteEffect,
            toggleEffect: VisageEditor.prototype._onToggleEffect,
            openSequencerDatabase: VisageEditor.prototype._onOpenSequencerDatabase
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
     * Override render to snapshot the form state before Foundry wipes the DOM.
     * This ensures typed text isn't lost when we re-render to show a new effect row.
     */
    async render(options) {
        if (this.rendered) {
            this._preservedData = this._prepareSaveData();
        }
        return super.render(options);
    }

    /**
     * Prepares the data context for the Handlebars template.
     * Merges Source Data (Database) with Preserved Data (Unsaved Input) to create the UI state.
     */
    async _prepareContext(options) {
        let data;
        
        // A. Resolve Source Data
        if (this.visageId) {
            // EDIT MODE: Fetch existing data from World Settings or Actor Flags
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
            // CREATE MODE: Generate a fresh skeleton
            if (this.isLocal) {
                // For Local, try to pre-fill with the token's current look
                const token = canvas.tokens.get(this.tokenId) || this.actor.prototypeToken;
                const tokenDoc = token.document || token; 
                data = VisageData.getDefaultAsVisage(tokenDoc);
                data.label = "New Visage"; 
                data.id = null;
            } else {
                // For Global, start blank
                data = {
                    label: game.i18n.localize("VISAGE.GlobalEditor.TitleNew.Global"),
                    category: "",
                    tags: [],
                    changes: {} 
                };
            }
            this._currentLabel = "";
        }

        // Merge unsaved inputs on top of the source data
        if (this._preservedData) {
            data = foundry.utils.mergeObject(data, this._preservedData, { inplace: false });
        }

        // Determine Mode Default (Local=Identity, Global=Overlay)
        let currentMode = data.mode;
        if (!currentMode) {
            currentMode = this.isLocal ? "identity" : "overlay";
        }

        // B. Extract Raw Data
        const c = data.changes || {};
        
        // Initialize Local Effects Memory (Once)
        // We clone this array to detach it from the database until saved.
        if (this._effects === null) {
            this._effects = c.effects ? foundry.utils.deepClone(c.effects) : [];
        }

        const rawImg = c.texture?.src || "";
        const resolvedImg = await VisageUtilities.resolvePath(rawImg);

        // C. Generate Preview Context
        // Formats the data for the "Card" view used in the stage preview.
        const context = VisageData.toPresentation(data, {
            isWildcard: rawImg.includes('*'),
            isActive: false
        });

        // D. Prepare Autocomplete Lists (Categories/Tags)
        const allVisages = VisageData.globals; 
        const categorySet = new Set();
        const tagSet = new Set();
        allVisages.forEach(v => {
            if (v.category) categorySet.add(v.category);
            if (v.tags && Array.isArray(v.tags)) v.tags.forEach(t => tagSet.add(t));
        });

        // Helper: Format values for UI Inputs (value + active state)
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

        // Input Value conversions (0-1 -> 0-100)
        const alphaVal = (c.alpha !== undefined && c.alpha !== null) ? Math.round(c.alpha * 100) : 100;
        
        let lockVal = "";
        if (c.lockRotation === true) lockVal = "true";
        if (c.lockRotation === false) lockVal = "false";

        // Prepare Active Effect Data for Inspector Pane
        let activeEffectData = {};
        if (this._activeEffectId) {
            const effect = this._effects.find(e => e.id === this._activeEffectId);
            if (effect) {
                activeEffectData = {
                    id: effect.id,
                    label: effect.label,
                    path: effect.path,
                    scale: Math.round((effect.scale ?? 1.0) * 100),
                    opacity: effect.opacity ?? 1.0,
                    rotation: effect.rotation ?? 0,
                    rotationRandom: effect.rotationRandom ?? false,
                    zOrder: effect.zOrder ?? "above",
                    blendMode: effect.blendMode || "normal",
                    type: effect.type
                };
            }
        }

        // Process Effects Stack for List View
        const effectsStack = this._effects.map(e => {
            return {
                ...e,
                icon: e.type === "audio" ? "visage-icon audio" : "visage-icon visual",
                metaLabel: e.type === "audio" 
                    ? `Volume: ${Math.round((e.opacity ?? 1) * 100)}%` 
                    : `${e.zOrder === "below" ? "Below" : "Above"} • ${Math.round((e.scale ?? 1) * 100)}%`
            };
        });

        return {
            ...context, 
            isEdit: !!this.visageId,
            isLocal: this.isLocal,
            isDirty: this.isDirty,
            categories: Array.from(categorySet).sort(),
            allTags: Array.from(tagSet).sort(),
            tagsString: (data.tags || []).join(","), 
            
            mode: currentMode,
            appId: this.id,

            // Tab State (Active class management)
            tabs: {
                appearance: { active: this._activeTab === "appearance", cssClass: this._activeTab === "appearance" ? "active" : "" },
                ring: { active: this._activeTab === "ring", cssClass: this._activeTab === "ring" ? "active" : "" },
                effects: { active: this._activeTab === "effects", cssClass: this._activeTab === "effects" ? "active" : "" }
            },

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
            alpha: { value: alphaVal, active: (c.alpha !== undefined && c.alpha !== null) },
            lockRotation: { value: lockVal, active: true },
            width: prep(c.width, 1),
            height: prep(c.height, 1),
            disposition: prep(c.disposition, 0),
            nameOverride: prep(c.name, ""),

            ring: { active: ringActive, ...ringContext },
            
            // EFFECTS DATA
            hasSequencer: VisageUtilities.hasSequencer,
            effects: effectsStack,
            inspector: activeEffectData,

            preview: {
                ...context.meta, 
                img: resolvedImg || rawImg, 
                isVideo: context.isVideo,
                flipX: context.isFlippedX,
                flipY: context.isFlippedY,
                tagList: data.tags || [],
                alpha: (c.alpha !== undefined && c.alpha !== null) ? c.alpha : 1.0 
            }
        };
    }

    /**
     * Updates the Live Preview pane based on current form values.
     * * **Process:**
     * 1. Extracts current form data.
     * 2. Syncs "Active Effect" changes back to the main effects array in memory.
     * 3. Calculates a "Mock" Visage object representing the current state.
     * 4. Renders the `visage-preview.hbs` template and injects it into the stage.
     * 5. Applies CSS transforms (Zoom/Pan).
     * 6. Updates metadata badges (Scale, Flip, Lock, etc.).
     */
    async _updatePreview() {
        const formData = new foundry.applications.ux.FormDataExtended(this.element).object;
        const el = this.element;

        // 1. Sync Active Effect Data from Form to Memory
        // This ensures that typing in the inspector updates the internal effect object immediately.
        if (this._activeEffectId && this._effects) {
            const effectIndex = this._effects.findIndex(e => e.id === this._activeEffectId);
            if (effectIndex > -1) {
                const e = this._effects[effectIndex];
                
                // Map Form Fields to Effect Properties
                if (formData.effectPath !== undefined) e.path = formData.effectPath;
                if (formData.effectLabel !== undefined) e.label = formData.effectLabel || "New Visual";
                
                if (e.type === "visual") {
                    if (formData.effectScale !== undefined) e.scale = (parseFloat(formData.effectScale) || 100) / 100;
                    if (formData.effectOpacity !== undefined) e.opacity = parseFloat(formData.effectOpacity) || 1.0;
                    if (formData.effectRotation !== undefined) e.rotation = parseFloat(formData.effectRotation) || 0;
                    if (formData.effectRotationRandom !== undefined) e.rotationRandom = formData.effectRotationRandom || false;
                    if (formData.effectZIndex !== undefined) e.zOrder = formData.effectZIndex;
                    if (formData.effectBlendMode !== undefined) e.blendMode = formData.effectBlendMode;
                }
                
                if (e.type === "audio") {
                     if (formData.effectVolume !== undefined) e.opacity = parseFloat(formData.effectVolume) || 0.8;
                }

                // Live DOM Update for Sidebar List Item (avoid full re-render)
                const card = el.querySelector(`.effect-card[data-id="${e.id}"]`);
                if (card) {
                    const nameEl = card.querySelector(".effect-name");
                    if (nameEl) nameEl.textContent = e.label;
                    
                    const metaEl = card.querySelector(".effect-meta");
                    if (metaEl) {
                        const metaLabel = e.type === "audio" 
                            ? `Volume: ${Math.round((e.opacity ?? 1) * 100)}%` 
                            : `${e.zOrder === "below" ? "Below" : "Above"} • ${Math.round((e.scale ?? 1) * 100)}%`;
                        metaEl.textContent = metaLabel;
                    }
                }
            }
        }

        // Helper for safely extracting values based on checkbox state
        const getVal = (key, type = String) => {
            const isActive = formData[`${key}_active`];
            if (!isActive) return undefined;
            const raw = formData[key];
            if (type === Number) return parseFloat(raw);
            if (type === Boolean) return !!raw;
            return (typeof raw === "string") ? raw.trim() : raw;
        };

        // 2. Extract & Calculate Token Values
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

        const width = getVal("width", Number) || 1;
        const height = getVal("height", Number) || 1;

        // 3. Update Grid Dimensions Variable
        const content = el.querySelector('.visage-preview-content.stage-mode');
        if (content) {
            content.style.setProperty('--visage-dim-w', width);
            content.style.setProperty('--visage-dim-h', height);
        }

        // 4. Build Texture Object
        let texture = {};
        if (imgSrc) {
            texture.src = imgSrc;
        }
        if (isScaleActive || isFlipXActive || isFlipYActive) {
            texture.scaleX = rawScale * (flipX ? -1 : 1);
            texture.scaleY = rawScale * (flipY ? -1 : 1);
        }
        if (Object.keys(texture).length === 0) texture = undefined;

        // 5. Build Ring Object
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

        // 6. Prepare Visual Effects (Styles & Paths)
        const activeVisuals = (this._effects || []).filter(e => !e.disabled && e.type === "visual" && e.path);
        const effectsBelow = activeVisuals.filter(e => e.zOrder === "below").map(e => this._prepareEffectStyle(e));
        const effectsAbove = activeVisuals.filter(e => e.zOrder === "above").map(e => this._prepareEffectStyle(e));

        // 7. Construct Mock Data for Presentation
        const mockData = {
            changes: {
                name: getVal("nameOverride"),
                texture: texture, 
                scale: isScaleActive ? rawScale : null,
                mirrorX: isFlipXActive ? flipX : null,
                mirrorY: isFlipYActive ? flipY : null,
                alpha: isAlphaActive ? rawAlpha : null,
                lockRotation: (lockVal !== "") ? rawLock : null,
                width: getVal("width", Number),
                height: getVal("height", Number),
                disposition: getVal("disposition", Number),
                ring: ring,
                effects: this._effects
            },
            tags: (formData.tags || "").split(",").map(t => t.trim()).filter(t => t)
        };

        // 8. Resolve Image Paths
        const ringEnabled = formData["ring.enabled"];
        const subjectTexture = formData.ringSubjectTexture;
        const mainImage = mockData.changes.texture?.src || "";
        const rawPath = (ringEnabled && subjectTexture) ? subjectTexture : mainImage;
        
        const resolved = await VisageUtilities.resolvePath(rawPath);
        const resolvedPath = resolved || rawPath;

        // 9. Generate Presentation Context (Meta badges)
        const context = VisageData.toPresentation(mockData, {
            isWildcard: rawPath.includes('*')
        });

        const meta = context.meta;

        // 10. RE-RENDER PREVIEW TEMPLATE
        const previewData = {
            resolvedPath: resolved || rawPath,
            name: mockData.changes.name,
            hasCheckerboard: true,
            alpha: rawAlpha, 
            isVideo: context.isVideo,
            hasRing: meta.hasRing,
            hasInvisibility: meta.hasInvisibility,
            hasPulse: meta.hasPulse,
            hasGradient: meta.hasGradient,
            hasWave: meta.hasWave,
            ringColor: meta.ringColor,
            ringBkg: meta.ringBkg,
            forceFlipX: context.isFlippedX,
            forceFlipY: context.isFlippedY,
            wrapperClass: "visage-preview-content stage-mode",
            
            effectsBelow: effectsBelow,
            effectsAbove: effectsAbove
        };
        
        const html = await foundry.applications.handlebars.renderTemplate("modules/visage/templates/parts/visage-preview.hbs", previewData);
        
        const stage = el.querySelector(".visage-live-preview-stage");
        if (stage) {
            // Preserve UI controls while replacing content
            const controls = stage.querySelector(".visage-zoom-controls");
            const hint = stage.querySelector(".visage-stage-hint");
            const overlay = stage.querySelector(".stage-overlay-name");
            
            stage.innerHTML = html;
            
            if (controls) stage.appendChild(controls);
            if (hint) stage.appendChild(hint);
            if (overlay) stage.appendChild(overlay);

            // Calculate Stage Transform (Scale + Flip)
            let visualScale = rawScale; 
            if (meta.hasRing && formData.ringSubjectTexture) {
                 visualScale = parseFloat(formData.ringSubjectScale) || 1.0;
            }
            this._currentVisualScale = visualScale; 

            const scaleX = visualScale * (context.isFlippedX ? -1 : 1);
            const scaleY = visualScale * (context.isFlippedY ? -1 : 1);
            const transform = `scale(${scaleX}, ${scaleY})`;

            const newImg = stage.querySelector(".visage-preview-img");
            const newVid = stage.querySelector(".visage-preview-video");
            
            if (newImg) newImg.style.transform = transform;
            if (newVid) newVid.style.transform = transform;

            this._applyStageTransform();
            this._bindDynamicListeners();
            
            const newContent = stage.querySelector('.visage-preview-content.stage-mode');
            if (newContent) {
                newContent.style.setProperty('--visage-dim-w', width);
                newContent.style.setProperty('--visage-dim-h', height);
            }
        }

        // 11. Sync Audio Previews (Starts/Stops playback)
        this._syncAudioPreviews();

        // 12. Update UI Slots (Badges)
        const findItem = (iconClass) => {
            const icon = el.querySelector(`.metadata-grid i.${iconClass}`) || el.querySelector(`.metadata-grid img[src*="${iconClass}"]`);
            return icon ? icon.closest('.meta-item') : null;
        };

        const scaleItem = findItem('scale'); 
        if (scaleItem && meta.slots.scale) {
            scaleItem.querySelector('.meta-value').textContent = meta.slots.scale.val;
            if(meta.slots.scale.active) scaleItem.classList.remove('inactive'); else scaleItem.classList.add('inactive');
        }

        const dimItem = findItem('dimensions');
        if (dimItem && meta.slots.dim) {
            dimItem.querySelector('.meta-value').textContent = meta.slots.dim.val;
            if(meta.slots.dim.active) dimItem.classList.remove('inactive'); else dimItem.classList.add('inactive');
        }

        const lockItem = findItem('lock'); 
        if (lockItem && meta.slots.lock) {
            lockItem.querySelector('.meta-value').textContent = meta.slots.lock.val;
            if(meta.slots.lock.active) lockItem.classList.remove('inactive'); else lockItem.classList.add('inactive');
        }

        const wildItem = findItem('wildcard');
        if (wildItem && meta.slots.wildcard) {
            wildItem.querySelector('.meta-value').textContent = meta.slots.wildcard.val;
            if(meta.slots.wildcard.active) wildItem.classList.remove('inactive'); else wildItem.classList.add('inactive');
        }

        const dispItem = el.querySelector('.disposition-item');
        if (dispItem && meta.slots.disposition) {
            const valSpan = dispItem.querySelector('.visage-disposition-text');
            if (valSpan) {
                valSpan.textContent = meta.slots.disposition.val;
                valSpan.className = `visage-disposition-text ${meta.slots.disposition.class}`;
            }
        }

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

        // Update Labels
        const nameEl = el.querySelector(".token-name-label");
        if (nameEl) {
            nameEl.textContent = mockData.changes.name || "";
            nameEl.style.display = mockData.changes.name ? "block" : "none";
            nameEl.style.opacity = formData.nameOverride_active ? "1" : "0.5";
        }

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

    /**
     * UNIFIED PATH RESOLVER
     * Handles both Sequencer Database Keys (recursive) and standard File Paths.
     * @param {string} rawPath - The input string (file path or DB key).
     * @returns {string|null} The resolved file path.
     */
    _resolveEffectPath(rawPath) {
        if (!rawPath) return null;

        // 1. Check if it's a Sequencer Database Key (no slash)
        const isDbKey = VisageUtilities.hasSequencer && !rawPath.includes("/");

        if (isDbKey) {
            // Recursive lookup for deep folders
            const entry = this._resolveSequencerRecursively(rawPath);

            if (entry) {
                let file;
                // Handle Array (Randomized)
                if (Array.isArray(entry)) {
                     file = entry[Math.floor(Math.random() * entry.length)];
                } 
                // Handle Object
                else {
                    file = entry.file;
                    if (Array.isArray(file)) {
                        file = file[Math.floor(Math.random() * file.length)];
                    }
                }

                // Handle Object structure inside file (Range/Geometry special cases)
                if (file && typeof file === "object" && file.file) {
                    file = file.file;
                }
                
                if (typeof file === "string") return file;
            }
            // If failed to resolve DB key, return null to avoid 404s
            return null;
        }

        // 2. Return raw path if it's a normal file path
        return rawPath;
    }

    /**
     * Recursive helper for finding files within nested Sequencer Database folders.
     */
    _resolveSequencerRecursively(path, depth = 0) {
        if (depth > 10) return null;

        let entry = Sequencer.Database.getEntry(path);
        if (entry) {
            if (Array.isArray(entry) || entry.file) return entry;
        }

        try {
            const children = Sequencer.Database.getEntriesUnder(path);
            if (children && children.length > 0) {
                const randomKey = children[Math.floor(Math.random() * children.length)];
                return this._resolveSequencerRecursively(randomKey, depth + 1);
            }
        } catch(e) { /* Ignore */ }

        return null;
    }

    /**
     * Calculates CSS styles for rendering visual effects in the preview stage.
     */
    _prepareEffectStyle(effect) {
        const resolvedPath = this._resolveEffectPath(effect.path);
        let isVideo = false;

        if (resolvedPath) {
            const ext = resolvedPath.split('.').pop().toLowerCase();
            isVideo = ["webm", "mp4", "m4v"].includes(ext);
        }

        return {
            ...effect,
            resolvedPath: resolvedPath,
            isVideo: isVideo,
            style: `
                transform: translate(-50%, -50%) scale(${effect.scale}) rotate(${effect.rotation}deg);
                opacity: ${effect.opacity};
                mix-blend-mode: ${effect.blendMode || 'normal'};
                filter: ${effect.tint ? `drop-shadow(0 0 0 ${effect.tint})` : 'none'};
            `
        };
    }

    /* -------------------------------------------- */
    /* Audio Preview Logic                          */
    /* -------------------------------------------- */

    /**
     * Manages the lifecycle of audio previews.
     * Ensures only currently active/enabled sounds are playing, handling restarts on change.
     * Uses Promise tracking to prevent race conditions during rapid updates.
     */
    _syncAudioPreviews() {
        const activeAudioEffects = (this._effects || []).filter(e => !e.disabled && e.type === "audio" && e.path);
        const activeIds = new Set(activeAudioEffects.map(e => e.id));

        // 1. Clean up removed/disabled sounds
        for (const [id, sound] of this._audioPreviews) {
            if (!activeIds.has(id)) {
                if (sound instanceof Promise) {
                    // It's loading. The 'then' block will handle stopping it via the activeIds check.
                } else if (sound && typeof sound.stop === "function") {
                    sound.stop();
                }
                this._audioPreviews.delete(id);
            }
        }

        // 2. Update or Create active sounds
        activeAudioEffects.forEach(e => {
            const vol = e.opacity ?? 0.8;
            
            // A. Update Existing Playing Sound
            if (this._audioPreviews.has(e.id)) {
                const sound = this._audioPreviews.get(e.id);
                
                // Skip if it's still a Promise (loading)
                if (sound instanceof Promise) return;

                // Update Volume on the fly
                if (sound.volume !== vol) {
                    sound.volume = vol;
                }
                
                // If path changed, stop and restart
                if (sound._visageSrc !== e.path) {
                    sound.stop();
                    this._audioPreviews.delete(e.id);
                    // Fall through to Creation block
                } else {
                    return; // Everything is fine
                }
            }

            // B. Create New Sound
            if (!this._audioPreviews.has(e.id)) {
                const resolvedPath = this._resolveEffectPath(e.path);
                
                if (!resolvedPath) return; 

                // Store Promise immediately to prevent duplicate play calls
                const playPromise = foundry.audio.AudioHelper.play({
                    src: resolvedPath,
                    volume: vol,
                    loop: true
                }, false).then(sound => {
                    // Race Condition Check: Ensure it wasn't deleted while loading
                    const currentEffect = (this._effects || []).find(fx => fx.id === e.id);
                    const isStillActive = currentEffect && !currentEffect.disabled;

                    if (!isStillActive || !sound) {
                        if (sound) sound.stop();
                        this._audioPreviews.delete(e.id);
                        return;
                    }

                    // Success
                    sound._visageSrc = e.path;
                    this._audioPreviews.set(e.id, sound);
                    return sound;
                });

                this._audioPreviews.set(e.id, playPromise);
            }
        });
    }

    async close(options) {
        // Force stop all sounds on close
        for (const [id, sound] of this._audioPreviews) {
            if (sound && typeof sound.stop === "function") sound.stop();
        }
        this._audioPreviews.clear();
        return super.close(options);
    }

    /* -------------------------------------------- */
    /* UI Interactions                             */
    /* -------------------------------------------- */

    _onOpenFilePicker(event, target) {
        const input = target.previousElementSibling?.tagName === "BUTTON" 
            ? target.parentElement.querySelector("input") 
            : target.previousElementSibling;
            
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

    /* -------------------------------------------- */
    /* Effects List Management                     */
    /* -------------------------------------------- */

    async _onAddVisual(event, target) {
        const newEffect = {
            id: foundry.utils.randomID(16),
            type: "visual",
            label: "New Visual",
            path: "",
            scale: 1.0,
            opacity: 1.0,
            rotation: 0,
            rotationRandom: false,
            zOrder: "above",
            disabled: false
        };
        
        this._effects.push(newEffect);
        this._activeEffectId = newEffect.id;
        this._markDirty();
        await this.render(); 
    }

    async _onAddAudio(event, target) {
        const newEffect = {
            id: foundry.utils.randomID(16),
            type: "audio",
            label: "New Audio",
            path: "",
            opacity: 0.8,
            disabled: false
        };
        
        this._effects.push(newEffect);
        this._activeEffectId = newEffect.id;
        this._markDirty();
        await this.render();
    }

    _onEditEffect(event, target) {
        const card = target.closest('.effect-card');
        this._activeEffectId = card.dataset.id;
        this.render();
    }

    _onCloseEffectInspector(event, target) {
        const container = this.element.querySelector('.effects-tab-container');
        if(container) container.classList.remove('editing');
        this._activeEffectId = null;
    }

    _onDeleteEffect(event, target) {
        const card = target.closest('.effect-card');
        const id = card.dataset.id;
        
        this._effects = this._effects.filter(e => e.id !== id);
        if (this._activeEffectId === id) this._activeEffectId = null;
        
        // Stop audio if it was an audio effect
        if (this._audioPreviews.has(id)) {
            const sound = this._audioPreviews.get(id);
            if (sound && typeof sound.stop === "function") sound.stop();
            this._audioPreviews.delete(id);
        }

        this._markDirty();
        this.render();
    }

    _onToggleEffect(event, target) {
        const card = target.closest('.effect-card');
        const id = card.dataset.id;
        const effect = this._effects.find(e => e.id === id);
        
        if (effect) {
            effect.disabled = !effect.disabled;
            this._markDirty();
            this.render(); 
        }
    }

    _onOpenSequencerDatabase(event, target) {
        if (VisageUtilities.hasSequencer) {
            new Sequencer.DatabaseViewer().render(true);
            ui.notifications.info(game.i18n.localize("VISAGE.Editor.Effects.DatabaseInstructions"));
        } else {
            ui.notifications.warn(game.i18n.localize("VISAGE.Editor.Effects.DependencyTitle"));
        }
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

        this.element.addEventListener("change", (event) => {
            this._markDirty();
            
            // Trigger preview update immediately for Select/File picker/checkbox elements
            if (event.target.matches("select") || 
                event.target.matches("input[type='text']") || 
                event.target.matches("input[type='checkbox']")) {
                
                this._updatePreview();
            }
        });
        
        this.element.addEventListener("input", () => this._markDirty());
        this._bindTagInput();
        
        // Debounce text inputs to avoid rapid Preview re-renders
        let debounceTimer;
        this.element.addEventListener("input", (event) => {
            this._markDirty();
            if (event.target.matches("input[type='text'], input[type='number'], color-picker, range-picker")) {
                 clearTimeout(debounceTimer);
                 debounceTimer = setTimeout(() => {
                     this._updatePreview();
                 }, 200); 
            }
        });

        // Tab Navigation
        const tabs = this.element.querySelectorAll(".visage-tabs .item");
        tabs.forEach(t => {
            t.addEventListener("click", (e) => {
                const target = e.currentTarget.dataset.tab;
                this._activateTab(target);
            });
        });
        
        if (this._activeTab) this._activateTab(this._activeTab);

        if (this._activeEffectId) {
            const container = this.element.querySelector('.effects-tab-container');
            if (container) container.classList.add('editing');
        }
        
        this._updatePreview();
        this._bindStaticListeners();
        this._bindDynamicListeners();
        this._applyStageTransform();

        // Grid Toggle State Check
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
                icon.classList.remove('grid-on');
                icon.classList.add('grid-off');
            } else {
                icon.classList.remove('grid-off');
                icon.classList.add('grid-on');
            }
        }
    }

    _bindStaticListeners() {
        const stage = this.element.querySelector('.visage-live-preview-stage');
        if (!stage) return;

        // Zoom via Wheel
        stage.addEventListener('wheel', (e) => {
            e.preventDefault();
            const direction = Math.sign(e.deltaY);
            const step = 0.1;
            let newScale = this._viewState.scale - (direction * step);
            this._viewState.scale = Math.min(Math.max(newScale, 0.1), 5.0);
            this._applyStageTransform();
        }, { passive: false });
    }

    _bindDynamicListeners() {
        const content = this.element.querySelector('.visage-preview-content.stage-mode');
        if (!content) return;

        // Pan Drag Logic
        content.onmousedown = (e) => { 
            if (e.button !== 0 && e.button !== 1) return;
            e.preventDefault(); 
            this._viewState.isDragging = true;
            this._viewState.lastX = e.clientX;
            this._viewState.lastY = e.clientY;
            content.style.cursor = 'grabbing';
        };

        if (!this._dragBound) {
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

            window.addEventListener('mouseup', () => {
                if (this._viewState.isDragging) {
                    this._viewState.isDragging = false;
                    const c = this.element.querySelector('.visage-preview-content.stage-mode');
                    if (c) c.style.cursor = 'grab';
                }
            });
            this._dragBound = true;
        }
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
        // Calculate appropriate scale to fit image
        let targetScale = 1.0;
        if (this._currentVisualScale && this._currentVisualScale > 1.0) {
            targetScale = 1.0 / this._currentVisualScale;
        }
        this._viewState.scale = targetScale;
        this._viewState.x = 0;
        this._viewState.y = 0;
        this._applyStageTransform();
    }
    
    _activateTab(tabName) {
        this._activeTab = tabName;
        const navItems = this.element.querySelectorAll(".visage-tabs .item");
        navItems.forEach(n => {
            if (n.dataset.tab === tabName) n.classList.add("active");
            else n.classList.remove("active");
        });
        const contentItems = this.element.querySelectorAll(".visage-tab-content .tab");
        contentItems.forEach(c => {
            if (c.dataset.tab === tabName) c.classList.add("active");
            else c.classList.remove("active");
            
            if (tabName === "effects" && c.dataset.tab === "effects") {
                 c.querySelector(".effects-tab-container")?.classList.add("active");
            } else if (c.dataset.tab === "effects") {
                 c.querySelector(".effects-tab-container")?.classList.remove("active");
            }
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
        
        const alphaInput = this.element.querySelector('input[name="alpha"]');
        if (alphaInput) alphaInput.value = 100;
        
        const lockInput = this.element.querySelector('input[name="lockRotation"]');
        if (lockInput) lockInput.checked = false;

        this._effects = [];
        this._activeEffectId = null;

        this._markDirty();
        this._updatePreview();
        ui.notifications.info(game.i18n.localize("VISAGE.Notifications.SettingsReset"));
    }

/**
     * Extracts form data using Foundry's standard utility.
     * Automatically handles checkboxes, radio groups, and dot-notation expansion.
     */
    _getFormData() {
        return new foundry.applications.ux.FormDataExtended(this.element).object;
    }

    /**
     * Extracts the current form state into a valid Visage payload.
     * Used for both Saving (Database) and Snapshotting (Re-render).
     * @returns {Object} The complete visage data object.
     */
    _prepareSaveData() {
        const formData = this._getFormData();
        
        // Helper to safely parse numbers
        const getVal = (key, type = String) => {
            const val = foundry.utils.getProperty(formData, key);
            if (val === "" || val === null || val === undefined) return null;
            return type(val);
        };

        const payload = {
            id: this.visageId, 
            label: formData.label,
            category: formData.category,
            tags: formData.tags ? formData.tags.split(",").filter(t => t.trim()) : [],
            mode: formData.mode,
            changes: {
                name: formData.nameOverride_active ? formData.nameOverride : null,
                texture: {
                    src: formData.img_active ? formData.img : null,
                    scaleX: null, 
                    scaleY: null 
                },
                scale: formData.scale_active ? getVal("scale", Number) / 100 : null,
                mirrorX: formData.isFlippedX === "" ? null : (formData.isFlippedX === "true"),
                mirrorY: formData.isFlippedY === "" ? null : (formData.isFlippedY === "true"),
                alpha: formData.alpha_active ? getVal("alpha", Number) / 100 : null,
                rotation: null, 
                tint: null,
                width: formData.width_active ? getVal("width", Number) : null,
                height: formData.height_active ? getVal("height", Number) : null,
                lockRotation: formData.lockRotation === "" ? null : (formData.lockRotation === "true"),
                disposition: formData.disposition_active ? getVal("disposition", Number) : null,
                ring: null,
                effects: this._effects // Use the memory state for effects
            }
        };

        // Construct Ring Data
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

        return payload;
    }

    async _onSave(event, target) {
        event.preventDefault();
        
        const payload = this._prepareSaveData();

        // Validation
        if (!payload.label) {
            return ui.notifications.warn(game.i18n.localize("VISAGE.Notifications.LabelRequired"));
        }

        try {
            await VisageData.save(payload, this.isLocal ? this.actor : null);
            if (this.visageId) ui.notifications.info(game.i18n.format("VISAGE.Notifications.Updated", { name: payload.label }));
            else ui.notifications.info(game.i18n.format("VISAGE.Notifications.Created", { name: payload.label }));
            this.close();
        } catch (err) {
            ui.notifications.error(game.i18n.localize("VISAGE.Notifications.SaveFailed"));
            console.error(err);
        }
    }
}