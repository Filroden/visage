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
        
        this.visageId = options.visageId || null;
        this.actorId = options.actorId || null;
        this.tokenId = options.tokenId || null;
        this.isDirty = false;
        this._activeTab = "appearance";
        this._preservedData = null;
        this._viewState = {
            scale: 1.0,
            x: 0,
            y: 0,
            isDragging: false,
            lastX: 0,
            lastY: 0
        };

        this._effects = null;
        this._activeEffectId = null;
        this._audioPreviews = new Map();
        this._editingLight = false;
        this._lightData = null; // Stores { active, dim, bright, color, animation... }
        this._delayData = 0;    // Stores ms (positive = effects lead, negative = token leads)
    }

    get isLocal() { return !!this.actorId; }
    get actor() { return VisageUtilities.resolveTarget(this.options).actor; }

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
            toggleLoop: VisageEditor.prototype._onToggleLoop,
            replayPreview: VisageEditor.prototype._onReplayPreview,
            openSequencerDatabase: VisageEditor.prototype._onOpenSequencerDatabase,
            toggleLight: VisageEditor.prototype._onToggleLight,
            editLight: VisageEditor.prototype._onEditLight,
            toggleDelayDirection: VisageEditor.prototype._onToggleDelayDirection,
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
     * Initializes HTML5 drag and drop listeners for the effects management interface.
     * Handles both individual effect reordering and group-level drop logic.
     * @param {HTMLElement} html - The application element.
     * @private
     */
    _bindDragDrop(html) {
        let dragSource = null;

        // 1. Drag Start (Card)
        const cards = html.querySelectorAll('.effect-card');
        cards.forEach(card => {
            card.addEventListener('dragstart', (ev) => {
                dragSource = card;
                ev.dataTransfer.effectAllowed = "move";
                ev.dataTransfer.setData("text/plain", card.dataset.id);
                ev.dataTransfer.setData("type", card.dataset.type);
                card.classList.add('dragging');
            });

            card.addEventListener('dragend', (ev) => {
                card.classList.remove('dragging');
                dragSource = null;
                // Cleanup highlights
                html.querySelectorAll('.drag-over, .group-drag-over').forEach(el => {
                    el.classList.remove('drag-over', 'group-drag-over');
                });
            });
            
            // Allow dropping onto other cards (for reordering)
            card.addEventListener('dragenter', (ev) => ev.preventDefault());
            card.addEventListener('dragover', (ev) => {
                ev.preventDefault();
                // Only allow if types match (Visual <-> Visual, Audio <-> Audio)
                const sourceType = dragSource?.dataset.type;
                const targetType = card.dataset.type;
                
                // Allow Visuals to mix (above/below), but strictly separate Audio
                const isSourceVisual = sourceType === "visual";
                const isTargetVisual = targetType === "visual";
                
                if (isSourceVisual !== isTargetVisual) return;

                card.classList.add('drag-over');
            });
            card.addEventListener('dragleave', (ev) => {
                card.classList.remove('drag-over');
            });
            card.addEventListener('drop', (ev) => this._onDrop(ev, card.closest('.effect-group').dataset.group, card.dataset.id));
        });

        // 2. Drop Zones (Groups) - Handling drops into empty areas or at end of lists
        const groups = html.querySelectorAll('.effect-group');
        groups.forEach(group => {
            group.addEventListener('dragenter', (ev) => ev.preventDefault());
            group.addEventListener('dragover', (ev) => {
                ev.preventDefault();
                const sourceType = dragSource?.dataset.type;
                const targetGroup = group.dataset.group;

                // Type Safety Check
                if (sourceType === "audio" && targetGroup !== "audio") return;
                if (sourceType === "visual" && targetGroup === "audio") return;

                group.classList.add('group-drag-over');
            });
            group.addEventListener('dragleave', (ev) => {
                group.classList.remove('group-drag-over');
            });
            group.addEventListener('drop', (ev) => {
                // If we dropped on a card, the card's listener handles it (stopPropagation).
                // If we bubble up here, it means we dropped in the empty space/container.
                this._onDrop(ev, group.dataset.group, null); 
            });
        });
    }

    /**
     * Primary drop handler for effect reordering.
     * Performs index calculations and updates the internal `_effects` array 
     * based on the relative position of the drop target.
     * * @param {DragEvent} ev 
     * @param {string} targetGroup - The target group identifier ('above', 'below', or 'audio').
     * @param {string|null} targetId - ID of the card dropped onto, or null if dropped in a container.
     * @private
     */
    async _onDrop(ev, targetGroup, targetId) {
        ev.preventDefault();
        ev.stopPropagation();

        const draggedId = ev.dataTransfer.getData("text/plain");
        if (!draggedId || draggedId === targetId) return;

        // 1. Get Original Indices
        const draggedIndex = this._effects.findIndex(e => e.id === draggedId);
        const originalTargetIndex = targetId ? this._effects.findIndex(e => e.id === targetId) : -1;
        
        if (draggedIndex === -1) return;
        const draggedEffect = this._effects[draggedIndex];

        // 2. Intelligent Logic: Update Properties based on Target Group
        // We do this BEFORE moving, so the object has the correct state when re-inserted
        if (targetGroup === "above" && draggedEffect.type === "visual") {
            draggedEffect.zOrder = "above";
        } else if (targetGroup === "below" && draggedEffect.type === "visual") {
            draggedEffect.zOrder = "below";
        } else if (targetGroup === "audio" && draggedEffect.type !== "audio") {
            return;
        }

        // 3. Reorder Array
        // Remove from old position
        this._effects.splice(draggedIndex, 1);

        if (targetId) {
            // Case A: Dropped onto another card
            // We need to find the *new* index of the target (since the array shifted)
            const newTargetIndex = this._effects.findIndex(e => e.id === targetId);
            
            if (newTargetIndex !== -1) {
                // Directional Logic:
                // If we dragged an item from "above" (lower index) to "below" (higher index),
                // the logical expectation is to place it AFTER the target.
                // If we dragged "up", we place it BEFORE.
                
                if (draggedIndex < originalTargetIndex) {
                     // Moving Down: Insert AFTER the target
                     this._effects.splice(newTargetIndex + 1, 0, draggedEffect);
                } else {
                     // Moving Up: Insert BEFORE the target
                     this._effects.splice(newTargetIndex, 0, draggedEffect);
                }
            } else {
                this._effects.push(draggedEffect); // Fallback
            }
        } else {
            // Case B: Dropped into the container (Empty Space) -> Append to end of that group
            let insertIndex = this._effects.length; 
            
            if (targetGroup === "above" || targetGroup === "below") {
                // Find last visual effect of this specific zOrder
                const lastOfGroupIndex = this._effects.findLastIndex(e => e.type === "visual" && e.zOrder === targetGroup);
                if (lastOfGroupIndex !== -1) insertIndex = lastOfGroupIndex + 1;
            } else if (targetGroup === "audio") {
                const lastAudioIndex = this._effects.findLastIndex(e => e.type === "audio");
                if (lastAudioIndex !== -1) insertIndex = lastAudioIndex + 1;
            }
            
            this._effects.splice(insertIndex, 0, draggedEffect);
        }

        this._markDirty();
        this._updatePreview(); 
        await this.render();
    }

    /**
     * Extends ApplicationV2 render to capture current form state.
     * Utilizes a preservation strategy to ensure that transient UI states 
     * (like partial text input) are maintained during Handlebars partial updates.
     * @override
     */
    async render(options) {
        if (this.rendered) {
            this._preservedData = this._prepareSaveData();
        }
        return super.render(options);
    }

    /**
     * Prepares the template context by merging persistent data with transient form state.
     * Calculates UI-specific properties such as autocomplete sets and badge statuses.
     * @override
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
        if (this._effects === null) { this._effects = c.effects ? foundry.utils.deepClone(c.effects) : []; }

        // Initialize Light Memory
        if (this._lightData === null) {
            if (c.light) {
                this._lightData = { active: true, ...c.light };
            } else {
                // Default Light Template
                this._lightData = {
                    active: false,
                    dim: 0, bright: 0, color: "#ffffff", alpha: 0.5, 
                    angle: 360, luminosity: 0.5, priority: 0,
                    animation: { type: "", speed: 5, intensity: 5 }
                };
            }
        }

        // Initialize Delay Memory
        if (this._delayData === 0 && c.delay !== undefined) {
            this._delayData = c.delay;
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

        const lightAnimationOptions = {
            "": game.i18n.localize("VISAGE.LightAnim.None"),
            "torch": game.i18n.localize("VISAGE.LightAnim.Torch"),
            "pulse": game.i18n.localize("VISAGE.LightAnim.Pulse"),
            "chroma": game.i18n.localize("VISAGE.LightAnim.Chroma"),
            "wave": game.i18n.localize("VISAGE.LightAnim.Wave"),
            "fog": game.i18n.localize("VISAGE.LightAnim.Fog"),
            "sunburst": game.i18n.localize("VISAGE.LightAnim.Sunburst"),
            "dome": game.i18n.localize("VISAGE.LightAnim.Dome"),
            "emanation": game.i18n.localize("VISAGE.LightAnim.Emanation"),
            "hexa": game.i18n.localize("VISAGE.LightAnim.Hexa"),
            "ghost": game.i18n.localize("VISAGE.LightAnim.Ghost"),
            "energy": game.i18n.localize("VISAGE.LightAnim.Energy"),
            "hole": game.i18n.localize("VISAGE.LightAnim.Hole"),
            "vortex": game.i18n.localize("VISAGE.LightAnim.Vortex"),
            "witchwave": game.i18n.localize("VISAGE.LightAnim.Witchwave"),
            "rainbowswirl": game.i18n.localize("VISAGE.LightAnim.RainbowSwirl"),
            "radialrainbow": game.i18n.localize("VISAGE.LightAnim.RadialRainbow"),
            "fairy": game.i18n.localize("VISAGE.LightAnim.Fairy"),
            "grid": game.i18n.localize("VISAGE.LightAnim.Grid"),
            "starlight": game.i18n.localize("VISAGE.LightAnim.Starlight"),
            "revolving": game.i18n.localize("VISAGE.LightAnim.Revolving"),
            "siren": game.i18n.localize("VISAGE.LightAnim.Siren"),
            "smokepatch": game.i18n.localize("VISAGE.LightAnim.SmokePatch")
        };

        // Input Value conversions (0-1 -> 0-100)
        const alphaVal = (c.alpha !== undefined && c.alpha !== null) ? Math.round(c.alpha * 100) : 100;
        
        let lockVal = "";
        if (c.lockRotation === true) lockVal = "true";
        if (c.lockRotation === false) lockVal = "false";

        // Delay Logic (Convert MS to Seconds for UI)
        const delaySeconds = Math.abs(this._delayData) / 1000;
        const delayDirection = this._delayData >= 0 ? "after" : "before";

        // Effect Formatting
        const formatEffect = (e) => ({
            ...e,
            icon: e.type === "audio" ? "visage-icon audio" : "visage-icon visual",
            metaLabel: e.type === "audio" 
                ? `Volume: ${Math.round((e.opacity ?? 1) * 100)}%` 
                : `${e.zOrder === "below" ? "Below" : "Above"} • ${Math.round((e.scale ?? 1) * 100)}%`
        });

        // 1. Filter and Map into Groups
        const effectsAbove = this._effects.filter(e => e.type === "visual" && e.zOrder === "above").map(formatEffect);
        const effectsBelow = this._effects.filter(e => e.type === "visual" && e.zOrder === "below").map(formatEffect);
        const effectsAudio = this._effects.filter(e => e.type === "audio").map(formatEffect);

        // 2. Build Base Inspector Object with these Groups
        let inspectorData = {
            hasEffects: this._effects.length > 0 || this._lightData.active,
            effectsAbove: effectsAbove,
            effectsBelow: effectsBelow,
            effectsAudio: effectsAudio,
            type: null 
        };

        // 3. If an effect is selected, merge its editable properties into the inspector object
        if (this._editingLight) {
            inspectorData.type = "light";
            foundry.utils.mergeObject(inspectorData, {
                dim: this._lightData.dim,
                bright: this._lightData.bright,
                color: this._lightData.color,
                alpha: this._lightData.alpha,
                animation: this._lightData.animation
            });
        } else if (this._activeEffectId) {
            const effect = this._effects.find(e => e.id === this._activeEffectId);
            if (effect) {
                foundry.utils.mergeObject(inspectorData, {
                    id: effect.id,
                    label: effect.label,
                    path: effect.path,
                    scale: Math.round((effect.scale ?? 1.0) * 100),
                    opacity: effect.opacity ?? 1.0,
                    rotation: effect.rotation ?? 0,
                    rotationRandom: effect.rotationRandom ?? false,
                    zOrder: effect.zOrder ?? "above",
                    blendMode: effect.blendMode || "normal",
                    type: effect.type,
                    loop: effect.loop ?? true
                });
            }
        }

        // Light Geometry Calculation (For Scaled Preview)
        const gridDist = canvas.scene?.grid?.distance || 5; 
        const tokenWidthUnits = c.width || 1;
        const lDim = this._lightData?.dim || 0;
        const lBright = this._lightData?.bright || 0;
        const lMax = Math.max(lDim, lBright);
        const sizeRatio = lMax > 0 
            ? ((lMax * 2) / gridDist) / tokenWidthUnits 
            : 1;
        const brightPct = lMax > 0 ? (lBright / lMax) * 100 : 0;
        const animType = this._lightData.animation?.type || "";
        const speed = this._lightData.animation?.speed ?? 5;
        const animDuration = Math.max(0.5, (11 - speed) * 0.35) + "s";

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
            tabs: {
                appearance: { active: this._activeTab === "appearance", cssClass: this._activeTab === "appearance" ? "active" : "" },
                ring: { active: this._activeTab === "ring", cssClass: this._activeTab === "ring" ? "active" : "" },
                effects: { active: this._activeTab === "effects", cssClass: this._activeTab === "effects" ? "active" : "" }
            },
            img: prep(rawImg, ""),
            portrait: prep(c.portrait, ""),
            light: this._lightData,
            lightAnimationOptions: lightAnimationOptions,
            delay: { value: Math.abs(this._delayData) / 1000, direction: this._delayData >= 0 ? "after" : "before" },
            scale: { 
                value: (c.scale !== undefined && c.scale !== null) ? Math.round(c.scale * 100) : 100, 
                active: c.scale !== undefined && c.scale !== null 
            },
            isFlippedX: {  value: c.mirrorX, active: c.mirrorX !== undefined && c.mirrorX !== null },
            isFlippedY: {  value: c.mirrorY, active: c.mirrorY !== undefined && c.mirrorY !== null },
            alpha: { value: alphaVal, active: (c.alpha !== undefined && c.alpha !== null) },
            lockRotation: { value: lockVal, active: true },
            width: prep(c.width, 1),
            height: prep(c.height, 1),
            disposition: prep(c.disposition, 0),
            nameOverride: prep(c.name, ""),
            ring: { active: ringActive, ...ringContext },
            hasSequencer: VisageUtilities.hasSequencer,
            inspector: inspectorData,
            preview: {
                ...context.meta, 
                img: resolvedImg || rawImg, 
                isVideo: context.isVideo,
                flipX: context.isFlippedX,
                flipY: context.isFlippedY,
                tagList: data.tags || [],
                alpha: (c.alpha !== undefined && c.alpha !== null) ? c.alpha : 1.0 ,
                hasLight: this._lightData.active,
                lightColor: this._lightData.color,
                lightAlpha: this._lightData.alpha ?? 0.5,
                lightDim: this._lightData.dim,
                lightBright: this._lightData.bright,
                lightSizePct: sizeRatio * 100,
                lightBrightPct: brightPct,
                lightAnimType: animType,
                lightAnimDuration: animDuration
            }
        };
    }

    /**
     * Updates the Live Preview pane based on current form values.
     */
    async _updatePreview() {
        const formData = new foundry.applications.ux.FormDataExtended(this.element).object;
        const el = this.element;

        // Helper to safely get nested properties from formData
        // e.g. get("light.animation.speed")
        const get = (path) => foundry.utils.getProperty(formData, path);

        // 1. Sync Light Data
        // We now use 'get()' to retrieve the nested values correctly
        if (this._editingLight && this._lightData) {
            const dim = get("light.dim");
            const bright = get("light.bright");
            const color = get("light.color");
            const alpha = get("light.alpha");
            const animType = get("light.animation.type");
            const animSpeed = get("light.animation.speed");
            const animInt = get("light.animation.intensity");

            const angle = get("light.angle");
            const lumin = get("light.luminosity");
            const prio = get("light.priority");

            if (dim !== undefined) this._lightData.dim = parseFloat(dim) || 0;
            if (bright !== undefined) this._lightData.bright = parseFloat(bright) || 0;
            if (color !== undefined) this._lightData.color = color;
            if (alpha !== undefined) this._lightData.alpha = parseFloat(alpha);

            if (angle !== undefined) this._lightData.angle = parseInt(angle) || 360;

            if (lumin !== undefined) {
                const lVal = parseFloat(lumin);
                this._lightData.luminosity = isNaN(lVal) ? 0.5 : lVal;
            }
            
            if (prio !== undefined) this._lightData.priority = parseInt(prio) || 0;
            
            if (animType !== undefined) {
                if (!this._lightData.animation) this._lightData.animation = {};
                this._lightData.animation.type = animType;
                this._lightData.animation.speed = parseInt(animSpeed) || 5;
                this._lightData.animation.intensity = parseInt(animInt) || 5;
            }
            
            // Live update the Light Card text in the list
            const lightCard = el.querySelector('.effect-card.pinned-light');
            if (lightCard) {
                const meta = lightCard.querySelector('.effect-meta');
                if (meta) meta.textContent = `${this._lightData.dim} / ${this._lightData.bright} • ${this._lightData.color}`;
            }
        }

        // 2. Sync Delay Data
        // 'delayValue' is a top-level input, so we can access it directly or via get()
        const delayVal = get("delayValue");
        if (delayVal !== undefined) {
            const seconds = parseFloat(delayVal) || 0;
            const directionBtn = this.element.querySelector('.delay-btn[data-value="after"]');
            const direction = (directionBtn && directionBtn.classList.contains('active')) ? 1 : -1;
            this._delayData = Math.round(seconds * 1000) * direction;
            
            const display = el.querySelector('.delay-slider-wrapper .value-display');
            if (display) display.textContent = `${seconds}s`;
        }

        // 3. Sync Active Effect Data
        // Effects use flat names (e.g. "effectPath"), so direct access is fine, 
        // but get() works too for consistency.
        if (this._activeEffectId && this._effects) {
            const effectIndex = this._effects.findIndex(e => e.id === this._activeEffectId);
            if (effectIndex > -1) {
                const e = this._effects[effectIndex];
                
                const ePath = get("effectPath");
                const eLabel = get("effectLabel");
                const eLoop = get("effectLoop");

                if (ePath !== undefined) e.path = ePath;
                if (eLabel !== undefined) e.label = eLabel || "New Visual";
                if (eLoop !== undefined) e.loop = eLoop;
                
                if (e.type === "visual") {
                    const eScale = get("effectScale");
                    const eOpac = get("effectOpacity");
                    const eRot = get("effectRotation");
                    const eRotRand = get("effectRotationRandom");
                    const eZ = get("effectZIndex");
                    const eBlend = get("effectBlendMode");

                    if (eScale !== undefined) e.scale = (parseFloat(eScale) || 100) / 100;
                    if (eOpac !== undefined) e.opacity = parseFloat(eOpac) || 1.0;
                    if (eRot !== undefined) e.rotation = parseFloat(eRot) || 0;
                    if (eRotRand !== undefined) e.rotationRandom = eRotRand || false;
                    if (eZ !== undefined) e.zOrder = eZ;
                    if (eBlend !== undefined) e.blendMode = eBlend;
                }
                
                if (e.type === "audio") {
                     const eVol = get("effectVolume");
                     if (eVol !== undefined) e.opacity = parseFloat(eVol) || 0.8;
                }

                // Live DOM Update
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

        // Helper for safely extracting checkbox/value pairs
        const getVal = (key, type = String) => {
            const isActive = get(`${key}_active`);
            if (!isActive) return undefined;
            const raw = get(key);
            if (type === Number) return parseFloat(raw);
            if (type === Boolean) return !!raw;
            return (typeof raw === "string") ? raw.trim() : raw;
        };

        // 4. Extract Token Values
        const isScaleActive = get("scale_active");
        const isFlipXActive = get("isFlippedX") !== "";
        const isFlipYActive = get("isFlippedY") !== "";
        const imgSrc = getVal("img"); 

        const rawScale = isScaleActive ? (parseFloat(get("scale")) / 100) : 1.0;
        const flipX = isFlipXActive ? (get("isFlippedX") === "true") : false;
        const flipY = isFlipYActive ? (get("isFlippedY") === "true") : false;

        const isAlphaActive = get("alpha_active");
        const rawAlpha = isAlphaActive ? (parseFloat(get("alpha")) / 100) : 1.0;
        const lockVal = get("lockRotation");
        const rawLock = (lockVal === "true");

        const width = getVal("width", Number) || 1;
        const height = getVal("height", Number) || 1;

        // 5. Update Grid Variable
        const content = el.querySelector('.visage-preview-content.stage-mode');
        if (content) {
            content.style.setProperty('--visage-dim-w', width);
            content.style.setProperty('--visage-dim-h', height);
        }

        // 6. Build Texture
        let texture = {};
        if (imgSrc) texture.src = imgSrc;
        if (isScaleActive || isFlipXActive || isFlipYActive) {
            texture.scaleX = rawScale * (flipX ? -1 : 1);
            texture.scaleY = rawScale * (flipY ? -1 : 1);
        }
        if (Object.keys(texture).length === 0) texture = undefined;

        // 7. Build Ring
        let ring = null;
        if (get("ring.enabled")) {
            let effectsMask = 0;
            // Iterate all entries to find effect flags
            // Flatten first if needed, but manual check is safer for known keys
            const knownEffects = {
                "effect_2": 2, "effect_4": 4, "effect_8": 8, "effect_16": 16
            };
            for (const [key, mask] of Object.entries(knownEffects)) {
                if (get(key) === true) effectsMask |= mask;
            }
            
            ring = {
                enabled: true,
                colors: { ring: get("ringColor"), background: get("ringBackgroundColor") },
                subject: { texture: get("ringSubjectTexture"), scale: get("ringSubjectScale") },
                effects: effectsMask
            };
        }

        // 8. Prepare Visual Effects
        const activeVisuals = (this._effects || []).filter(e => !e.disabled && e.type === "visual" && e.path);
        const effectsBelow = activeVisuals.filter(e => e.zOrder === "below").map(e => this._prepareEffectStyle(e));
        const effectsAbove = activeVisuals.filter(e => e.zOrder === "above").map(e => this._prepareEffectStyle(e));

        // 9. Mock Data
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
            tags: (get("tags") || "").split(",").map(t => t.trim()).filter(t => t)
        };

        // 10. Resolve Paths
        const ringEnabled = get("ring.enabled");
        const subjectTexture = get("ringSubjectTexture");
        const mainImage = mockData.changes.texture?.src || "";
        const rawPath = (ringEnabled && subjectTexture) ? subjectTexture : mainImage;
        
        const resolved = await VisageUtilities.resolvePath(rawPath);
        const resolvedPath = resolved || rawPath;

        const context = VisageData.toPresentation(mockData, { isWildcard: rawPath.includes('*') });
        const meta = context.meta;

        // 11. Light Calculations
        const gridDist = canvas.scene?.grid?.distance || 5;
        const currentWidth = getVal("width", Number) || 1; 

        const lData = this._lightData || {};
        const lDim = lData.dim || 0;
        const lBright = lData.bright || 0;
        const lColor = lData.color || "#ffffff";
        const lAlpha = lData.alpha !== undefined ? lData.alpha : 0.5;
        const lAngle = lData.angle !== undefined ? lData.angle : 360;
        const lLumin = lData.luminosity !== undefined ? lData.luminosity : 0.5;
        const lAnim = lData.animation || {};
        
        const lMax = Math.max(lDim, lBright);
        const sizeRatio = lMax > 0 ? ((lMax * 2) / gridDist) / currentWidth : 1;
        const brightPct = lMax > 0 ? (lBright / lMax) * 100 : 0;
        
        // Luminosity color logic
        const isDarkness = lLumin < 0;
        const effectiveColor = isDarkness ? "#000000" : lColor;
        
        // Scaling Preview Intensity by Luminosity Magnitude
        const previewOpacity = lAlpha * (Math.abs(lLumin) * 2);

        // Rotation logic
        // If Flipped Y (North), offset by 0deg. If Default (South), offset by 180deg.
        const rotationOffset = flipY ? 0 : 180; 

        // Animation
        const animType = lAnim.type || "";
        const speed = lAnim.speed || 5;
        const intensity = lAnim.intensity || 5;
        
        const animDuration = Math.max(0.5, (11 - speed) * 0.35) + "s";
        const animIntensityVal = intensity / 10;

        // 12. Re-render Preview
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
            
            // Light Props (Uses Persistent Data)
            hasLight: lData.active,
            lightColor: effectiveColor,
            lightAlpha: Math.min(1, previewOpacity),
            lightDim: lDim,
            lightBright: lBright,
            lightSizePct: sizeRatio * 100,
            lightBrightPct: brightPct,
            
            // New V3.2 Preview Props
            lightAngle: lAngle,
            lightRotation: rotationOffset,
            lightAnimType: animType,
            lightAnimDuration: animDuration,
            lightAnimIntensity: animIntensityVal,
            
            effectsBelow: effectsBelow,
            effectsAbove: effectsAbove
        };
        
        const html = await foundry.applications.handlebars.renderTemplate("modules/visage/templates/parts/visage-preview.hbs", previewData);
        
        const stage = el.querySelector(".visage-live-preview-stage");
        if (stage) {
            const controls = stage.querySelector(".visage-zoom-controls");
            const hint = stage.querySelector(".visage-stage-hint");
            const overlay = stage.querySelector(".stage-overlay-name");
            
            stage.innerHTML = html;
            
            if (controls) stage.appendChild(controls);
            if (hint) stage.appendChild(hint);
            if (overlay) stage.appendChild(overlay);

            let visualScale = rawScale; 
            if (meta.hasRing && get("ringSubjectTexture")) visualScale = parseFloat(get("ringSubjectScale")) || 1.0;
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

        this._syncAudioPreviews();
        
        // Update UI Badges (Same as before)
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
     * Resolves effect paths from either the local file system or the Sequencer Database.
     * @param {string} rawPath - The path or database key to resolve.
     * @returns {string|null} The resolved file path.
     * @private
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
     * Recursively traverses Sequencer Database entries to find valid file paths.
     * @param {string} path - The database key path.
     * @param {number} [depth=0] - Recursion depth tracker.
     * @returns {Object|null}
     * @private
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
     * Derives CSS transformation and style strings for effect preview rendering.
     * @param {Object} effect - The effect data object.
     * @returns {Object}
     * @private
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

    /**
     * Manages the audio lifecycle for the effects editor.
     * Synchronizes playing sounds with the current buffer, handling 
     * volume updates and restart-on-change logic.
     * @private
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

                // Use the effect's loop setting (default to true)
                const isLoop = e.loop ?? true;

                // Store Promise immediately to prevent duplicate play calls
                const playPromise = foundry.audio.AudioHelper.play({
                    src: resolvedPath,
                    volume: vol,
                    loop: isLoop
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

    /**
     * Triggers the Foundry FilePicker for a specific input field.
     * @private
     */
    _onOpenFilePicker(event, target) {
        const input = target.previousElementSibling?.tagName === "BUTTON" 
            ? target.parentElement.querySelector("input") 
            : target.previousElementSibling;

        const fp = new foundry.applications.apps.FilePicker({
            type: "imagevideo",
            current: input.value,
            source: "data",
            callback: (path) => {
                input.value = path;
                this._markDirty();
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }
        });
        fp.browse();
    }

    /**
     * Toggles the enabled state of a specific property field group.
     * @private
     */
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

    /**
     * Adds a new Visual Effect to the Visage data.
     * @private
     */
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
            loop: true,
            disabled: false
        };
        
        this._effects.push(newEffect);
        this._activeEffectId = newEffect.id;
        this._markDirty();
        await this.render(); 
    }

    /**
     * Adds a new Audio Effect to the Visage data.
     * @private
     */
    async _onAddAudio(event, target) {
        const newEffect = {
            id: foundry.utils.randomID(16),
            type: "audio",
            label: "New Audio",
            path: "",
            opacity: 0.8,
            loop: true,
            disabled: false
        };
        
        this._effects.push(newEffect);
        this._activeEffectId = newEffect.id;
        this._markDirty();
        await this.render();
    }

    /**
     * Opens the Inspector pane for a specific effect.
     * @private
     */
    _onEditEffect(event, target) {
        const card = target.closest('.effect-card');
        this._activeEffectId = card.dataset.id;
        this._editingLight = false; // <--- SAFETY FIX
        this.render();
    }

    /**
     * Closes the Effect Inspector and returns to the effect list view.
     * @private
     */
    async _onCloseEffectInspector(event, target) {
        const container = this.element.querySelector('.effects-tab-container');
        if (container) container.classList.remove('editing');
        
        this._activeEffectId = null;
        this._editingLight = false; // <--- CRITICAL FIX
        
        await this.render();
    }

    /**
     * Deletes an effect from the current Visage.
     * @private
     */
    async _onDeleteEffect(event, target) {
        const card = target.closest('.effect-card');
        const id = card.dataset.id;
        
        const confirm = await foundry.applications.api.DialogV2.confirm({
            window: { title: game.i18n.localize("VISAGE.Dialog.Destroy.Title") },
            content: `<p>${game.i18n.localize("VISAGE.Dialog.Destroy.Content")}</p>`,
            modal: true
        });

        if (!confirm) return;

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

    /**
     * Toggles the disabled state of an effect without removing it.
     * @private
     */
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

    /**
     * Launches the Sequencer Database Viewer.
     * @private
     */
    _onOpenSequencerDatabase(event, target) {
        if (VisageUtilities.hasSequencer) {
            new Sequencer.DatabaseViewer().render(true);
            ui.notifications.info(game.i18n.localize("VISAGE.Editor.Effects.DatabaseInstructions"));
        } else {
            ui.notifications.warn(game.i18n.localize("VISAGE.Editor.Effects.DependencyTitle"));
        }
    }

    /**
     * Flags the editor state as containing unsaved changes and updates UI cues.
     * @private
     */
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
        
        // Slider Listeners (Debounced Input + Double-Click Reset)
        const debouncedSliderUpdate = foundry.utils.debounce(() => this._updatePreview(), 50);

        const sliders = this.element.querySelectorAll('input[type="range"]');
        sliders.forEach(slider => {
            // Live Update listener
            slider.addEventListener('input', () => debouncedSliderUpdate());
            
            // Reset listener
            slider.addEventListener('dblclick', (ev) => {
                let def = 0;
                const name = ev.target.name;
                
                // --- Step 1: General Defaults ---
                if (name.includes('scale')) def = 100;
                if (name.includes('alpha') || name.includes('luminosity')) def = 0.5;
                if (name.includes('speed') || name.includes('intensity')) def = 5;
                if (name.includes('angle')) def = 360;

                // --- Step 2: Specific Overrides ---
                // These run last, so they safely overwrite any from above.
                if (name.includes('Volume')) def = 1;
                if (name.includes('Opacity')) def = 1;
                if (name.includes('ringSubjectScale')) def = 1;
                
                ev.target.value = def;
                
                // Update display sibling
                const display = ev.target.nextElementSibling;
                if (display && display.tagName === 'OUTPUT') display.value = def;

                this._updatePreview();
            });
        });

        this.element.addEventListener("input", () => this._markDirty());
        this._bindTagInput();
        this._bindDragDrop(this.element);

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

        if (this._activeEffectId || this._editingLight) { 
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

    /**
     * Toggles the visibility of the alignment grid on the preview stage.
     * @private
     */
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

    /**
     * Binds permanent listeners for the preview stage (e.g., zoom wheel).
     * @private
     */
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

    /**
     * Binds listeners to the preview content that may be replaced during partial renders.
     * Handles pan/drag interaction logic.
     * @private
     */
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

    /**
     * Applies CSS transforms (Translate/Scale) to the preview content based on view state.
     * @private
     */
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

    /**
     * Resets the stage zoom and pan to default center.
     * Automatically adjusts scale to fit oversized visuals.
     * @private
     */
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
    
    /**
     * Manages UI tab switching logic.
     * @param {string} tabName 
     * @private
     */
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

    /**
     * Toggles the 'loop' property of an effect.
     * Updates the internal state and re-renders to reflect the active/inactive icon style.
     */
    _onToggleLoop(event, target) {
        const card = target.closest('.effect-card');
        const id = card.dataset.id;
        const effect = this._effects.find(e => e.id === id);
        
        if (effect) {
            // Toggle boolean (defaulting to true if undefined)
            effect.loop = !(effect.loop ?? true);
            this._markDirty();
            
            // Update the card UI directly (optional optimization) or just re-render
            this.render(); 
        }
    }

    /**
     * Re-triggers the Live Preview generation.
     * This effectively "replays" any One-Shot effects by destroying and recreating them.
     */
    _onReplayPreview(event, target) {
        // Optional: Animate the icon to give feedback
        const icon = target.querySelector('i');
        if (icon) {
            icon.animate([
                { transform: 'rotate(0deg)' },
                { transform: 'rotate(360deg)' }
            ], { duration: 500 });
        }

        // Force stop and clear all audio previews so they restart
        for (const [id, sound] of this._audioPreviews) {
            if (sound && typeof sound.stop === "function") sound.stop();
        }
        this._audioPreviews.clear();
        
        // Force update the preview stage
        this._updatePreview();
    }

    /**
     * Initializes the custom tag input component.
     * Handles pill creation, deletion, and synchronization with the hidden input field.
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

    /**
     * Resets all form fields and effects to their default state.
     * @private
     */
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
     * Extracts the current form state into a valid Visage payload.
     * Used for both Saving (Database) and Snapshotting (Re-render).
     * @returns {Object} The complete visage data object.
     */
    _prepareSaveData() {
        const formData = new foundry.applications.ux.FormDataExtended(this.element).object;
        
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
                portrait: formData.portrait_active ? formData.portrait : null,
                light: this._lightData.active ? this._lightData : null,
                delay: this._delayData,
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

    /**
     * Validates and persists the current Visage state to the database.
     * @private
     */
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

    _onToggleLight(event, target) {
        if (!this._lightData) return;
        this._lightData.active = !this._lightData.active;
        this._markDirty();
        this._updatePreview();
        this.render();
    }

    _onEditLight(event, target) {
        this._editingLight = true;
        this._activeEffectId = null; // Deselect any active effect
        this.render();
    }

    _onToggleDelayDirection(event, target) {
        const val = target.dataset.value;
        // Visual toggle update
        const btns = this.element.querySelectorAll('.delay-direction-toggle button');
        btns.forEach(b => b.classList.remove('active'));
        target.classList.add('active');
        
        // Update data immediately
        const secondsInput = this.element.querySelector('range-picker[name="delayValue"]');
        const seconds = parseFloat(secondsInput.value) || 0;
        const direction = val === "after" ? 1 : -1; // 'after' = Effects Lead (Positive)
        this._delayData = Math.round(seconds * 1000) * direction;
        
        this._markDirty();
    }
}