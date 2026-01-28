import { Visage } from "./visage.js";
import { VisageData } from "./visage-data.js";
import { VisageUtilities } from "./visage-utilities.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The main editor application for creating and modifying Visages.
 * Handles the logic for toggling fields (Intent), live preview updates,
 * effect management (Visuals/Audio), and constructing the final data payload.
 */
export class VisageEditor extends HandlebarsApplicationMixin(ApplicationV2) {
    
    constructor(options = {}) {
        super(options);
        
        this.visageId = options.visageId || null;
        this.actorId = options.actorId || null;
        this.tokenId = options.tokenId || null;
        this.isDirty = false;
        
        this._activeTab = "appearance";
        this._preservedData = null;

        // Viewport State (Pan/Zoom)
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

        // v3.2: Light & Transition State Buffers
        this._light = null; 
        this._delay = 0;
    }

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

            // v3.2: Light & Transition Actions
            toggleLight: VisageEditor.prototype._onToggleLight,
            toggleTransitionDirection: VisageEditor.prototype._onToggleTransitionDirection
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

    /* -------------------------------------------- */
    /* Drag & Drop (Complete v3.1 Logic)           */
    /* -------------------------------------------- */

    _bindDragDrop(html) {
        let dragSource = null;

        // 1. Drag Start (Card)
        const cards = html.querySelectorAll('.effect-card');
        cards.forEach(card => {
            // v3.2: Prevent dragging pinned cards (Light Source)
            if (card.classList.contains('pinned')) return;

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
                html.querySelectorAll('.drag-over, .group-drag-over').forEach(el => {
                    el.classList.remove('drag-over', 'group-drag-over');
                });
            });
            
            card.addEventListener('dragenter', (ev) => ev.preventDefault());
            card.addEventListener('dragover', (ev) => {
                ev.preventDefault();
                const sourceType = dragSource?.dataset.type;
                const targetType = card.dataset.type;
                
                // Allow Visuals to mix (above/below), but separate Audio
                const isSourceVisual = sourceType === "visual";
                const isTargetVisual = targetType === "visual";
                
                if (isSourceVisual !== isTargetVisual) {
                    if (sourceType !== "visual" || targetType !== "visual") return;
                }

                card.classList.add('drag-over');
            });
            card.addEventListener('dragleave', (ev) => {
                card.classList.remove('drag-over');
            });
            card.addEventListener('drop', (ev) => this._onDrop(ev, card.closest('.effect-group').dataset.group, card.dataset.id));
        });

        // 2. Drop Zones (Groups)
        const groups = html.querySelectorAll('.effect-group');
        groups.forEach(group => {
            group.addEventListener('dragenter', (ev) => ev.preventDefault());
            group.addEventListener('dragover', (ev) => {
                ev.preventDefault();
                const sourceType = dragSource?.dataset.type;
                const targetGroup = group.dataset.group;

                if (sourceType === "audio" && targetGroup !== "audio") return;
                if (sourceType === "visual" && targetGroup === "audio") return;

                group.classList.add('group-drag-over');
            });
            group.addEventListener('dragleave', (ev) => {
                group.classList.remove('group-drag-over');
            });
            group.addEventListener('drop', (ev) => {
                this._onDrop(ev, group.dataset.group, null); 
            });
        });
    }

    async _onDrop(ev, targetGroup, targetId) {
        ev.preventDefault();
        ev.stopPropagation();

        const draggedId = ev.dataTransfer.getData("text/plain");
        if (!draggedId || draggedId === targetId) return;

        const draggedIndex = this._effects.findIndex(e => e.id === draggedId);
        const originalTargetIndex = targetId ? this._effects.findIndex(e => e.id === targetId) : -1;
        
        if (draggedIndex === -1) return;
        const draggedEffect = this._effects[draggedIndex];

        // Update Z-Order based on drop group
        if (targetGroup === "above" && draggedEffect.type === "visual") {
            draggedEffect.zOrder = "above";
        } else if (targetGroup === "below" && draggedEffect.type === "visual") {
            draggedEffect.zOrder = "below";
        } else if (targetGroup === "audio" && draggedEffect.type !== "audio") {
            return;
        }

        // Reorder
        this._effects.splice(draggedIndex, 1);

        if (targetId) {
            const newTargetIndex = this._effects.findIndex(e => e.id === targetId);
            if (newTargetIndex !== -1) {
                // If dragging downwards, the indices shift
                if (draggedIndex < originalTargetIndex) {
                     this._effects.splice(newTargetIndex + 1, 0, draggedEffect);
                } else {
                     this._effects.splice(newTargetIndex, 0, draggedEffect);
                }
            } else {
                this._effects.push(draggedEffect);
            }
        } else {
            // Append to group logic
            let insertIndex = this._effects.length; 
            if (targetGroup === "above" || targetGroup === "below") {
                const lastOfGroupIndex = this._effects.findLastIndex(e => e.type === "visual" && e.zOrder === targetGroup);
                if (lastOfGroupIndex !== -1) insertIndex = lastOfGroupIndex + 1;
            } else if (targetGroup === "audio") {
                const lastAudioIndex = this._effects.findLastIndex(e => e.type === "audio");
                if (lastAudioIndex !== -1) insertIndex = lastAudioIndex + 1;
            }
            // Clamp
            if (insertIndex > this._effects.length) insertIndex = this._effects.length;
            this._effects.splice(insertIndex, 0, draggedEffect);
        }

        this._markDirty();
        this._updatePreview(); 
        await this.render();
    }

    /* -------------------------------------------- */
    /* Context Preparation                         */
    /* -------------------------------------------- */

    async render(options) {
        if (this.rendered) {
            this._preservedData = this._prepareSaveData();
        }
        return super.render(options);
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

        if (this._preservedData) {
            data = foundry.utils.mergeObject(data, this._preservedData, { inplace: false });
        }

        let currentMode = data.mode;
        if (!currentMode) currentMode = this.isLocal ? "identity" : "overlay";

        const c = data.changes || {};
        
        // Initialize Buffers (v3.2 additions)
        if (this._effects === null) this._effects = c.effects ? foundry.utils.deepClone(c.effects) : [];
        if (this._light === null) this._light = c.light ? foundry.utils.deepClone(c.light) : {};
        if (this._delay === undefined || this._delay === null) this._delay = data.delay || 0;

        const rawImg = c.texture?.src || "";
        const resolvedImg = await VisageUtilities.resolvePath(rawImg);

        const context = VisageData.toPresentation(data, {
            isWildcard: rawImg.includes('*'),
            isActive: false
        });

        // Tag & Category Compilation
        const allVisages = VisageData.globals; 
        const categorySet = new Set();
        const tagSet = new Set();
        allVisages.forEach(v => {
            if (v.category) categorySet.add(v.category);
            if (v.tags && Array.isArray(v.tags)) v.tags.forEach(t => tagSet.add(t));
        });

        const prep = (val, def) => ({ 
            value: val ?? def, 
            active: (val !== null && val !== undefined && val !== "") 
        });

        const ringActive = !!(c.ring && c.ring.enabled);
        const ringContext = VisageData.prepareRingContext(c.ring); 

        // v3.2: Light Source Summary String
        const hasLight = (this._light.dim > 0 || this._light.bright > 0);
        let lightSummary = game.i18n.localize("VISAGE.Light.NoLight");
        if (hasLight) {
            lightSummary = `${this._light.dim || 0} / ${this._light.bright || 0}`;
            if (this._light.animation?.type) lightSummary += ` • ${this._light.animation.type}`;
        }

        const formatEffect = (e) => ({
            ...e,
            icon: e.type === "audio" ? "visage-icon audio" : "visage-icon visual",
            metaLabel: e.type === "audio" 
                ? `Volume: ${Math.round((e.opacity ?? 1) * 100)}%` 
                : `${e.zOrder === "below" ? "Below" : "Above"} • ${Math.round((e.scale ?? 1) * 100)}%`
        });

        const effectsAbove = this._effects.filter(e => e.type === "visual" && e.zOrder === "above").map(formatEffect);
        const effectsBelow = this._effects.filter(e => e.type === "visual" && e.zOrder === "below").map(formatEffect);
        const effectsAudio = this._effects.filter(e => e.type === "audio").map(formatEffect);

        let inspectorData = {
            hasEffects: this._effects.length > 0 || hasLight,
            effectsAbove, effectsBelow, effectsAudio,
            // v3.2 Light Data for Inspector
            light: {
                active: hasLight,
                summary: lightSummary,
                dim: this._light.dim || 0,
                bright: this._light.bright || 0,
                color: this._light.color || "#ffffff",
                alpha: this._light.alpha ?? 0.5,
                animation: this._light.animation || { type: "", speed: 5, intensity: 5 }
            }
        };

        // Determine which inspector to show
        if (this._activeEffectId === "light-source") {
            inspectorData.type = "light";
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
            portrait: prep(c.portrait, ""), // v3.2: Portrait Field
            
            scale: { value: (c.scale !== undefined && c.scale !== null) ? Math.round(c.scale * 100) : 100, active: c.scale !== undefined && c.scale !== null },
            isFlippedX: { value: c.mirrorX, active: c.mirrorX !== undefined && c.mirrorX !== null },
            isFlippedY: { value: c.mirrorY, active: c.mirrorY !== undefined && c.mirrorY !== null },
            alpha: { value: (c.alpha !== undefined && c.alpha !== null) ? Math.round(c.alpha * 100) : 100, active: (c.alpha !== undefined && c.alpha !== null) },
            lockRotation: { value: (c.lockRotation === true ? "true" : c.lockRotation === false ? "false" : ""), active: true },
            
            width: prep(c.width, 1),
            height: prep(c.height, 1),
            disposition: prep(c.disposition, 0),
            nameOverride: prep(c.name, ""),

            ring: { active: ringActive, ...ringContext },
            
            // v3.2: Transition Data
            transition: {
                delay: Math.abs(this._delay),
                isEffectsLead: this._delay >= 0
            },

            hasSequencer: VisageUtilities.hasSequencer,
            inspector: inspectorData,

            preview: {
                ...context.meta, 
                img: resolvedImg || rawImg, 
                isVideo: context.isVideo,
                flipX: context.isFlippedX,
                flipY: context.isFlippedY,
                tagList: data.tags || [],
                alpha: (c.alpha !== undefined && c.alpha !== null) ? c.alpha : 1.0,
                
                // v3.2: Light Preview Props
                hasLight: hasLight,
                lightColor: this._light.color || "#ffffff",
                lightAnimation: this._light.animation?.type || ""
            }
        };
    }

    /* -------------------------------------------- */
    /* Live Preview Logic                          */
    /* -------------------------------------------- */

    async _updatePreview() {
        const formData = new foundry.applications.ux.FormDataExtended(this.element).object;
        const el = this.element;

        // 1. Sync Active Inspector Data (Effects OR Light)
        if (this._activeEffectId === "light-source") {
            // v3.2: Light Logic
            if (formData.lightDim !== undefined) this._light.dim = parseFloat(formData.lightDim) || 0;
            if (formData.lightBright !== undefined) this._light.bright = parseFloat(formData.lightBright) || 0;
            if (formData.lightColor !== undefined) this._light.color = formData.lightColor;
            if (formData.lightAlpha !== undefined) this._light.alpha = parseFloat(formData.lightAlpha);
            
            this._light.animation = this._light.animation || {};
            if (formData.lightAnimationType !== undefined) this._light.animation.type = formData.lightAnimationType;
            if (formData.lightAnimationSpeed !== undefined) this._light.animation.speed = parseFloat(formData.lightAnimationSpeed);
            if (formData.lightAnimationIntensity !== undefined) this._light.animation.intensity = parseFloat(formData.lightAnimationIntensity);

            // Update Pinned Card UI
            const card = el.querySelector(`.light-source-card`);
            if (card) {
                const meta = card.querySelector(".effect-meta");
                const hasLight = (this._light.dim > 0 || this._light.bright > 0);
                let lightSummary = game.i18n.localize("VISAGE.Light.NoLight");
                if (hasLight) {
                    lightSummary = `${this._light.dim} / ${this._light.bright}`;
                    if (this._light.animation.type) lightSummary += ` • ${this._light.animation.type}`;
                }
                if (meta) meta.textContent = lightSummary;
            }

        } else if (this._activeEffectId && this._effects) {
            const effectIndex = this._effects.findIndex(e => e.id === this._activeEffectId);
            if (effectIndex > -1) {
                const e = this._effects[effectIndex];
                if (formData.effectPath !== undefined) e.path = formData.effectPath;
                if (formData.effectLabel !== undefined) e.label = formData.effectLabel || "New Visual";
                if (formData.effectLoop !== undefined) e.loop = formData.effectLoop;
                
                if (e.type === "visual") {
                    if (formData.effectScale !== undefined) e.scale = (parseFloat(formData.effectScale) || 100) / 100;
                    if (formData.effectOpacity !== undefined) e.opacity = parseFloat(formData.effectOpacity) || 1.0;
                    if (formData.effectRotation !== undefined) e.rotation = parseFloat(formData.effectRotation) || 0;
                    if (formData.effectRotationRandom !== undefined) e.rotationRandom = formData.effectRotationRandom || false;
                    if (formData.effectZIndex !== undefined) e.zOrder = formData.effectZIndex;
                    if (formData.effectBlendMode !== undefined) e.blendMode = formData.effectBlendMode;
                } else if (e.type === "audio") {
                     if (formData.effectVolume !== undefined) e.opacity = parseFloat(formData.effectVolume) || 0.8;
                }

                // Update Card UI
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

        // v3.2: Sync Transition Data
        if (formData.transitionDelay !== undefined) {
            const rawDelay = parseInt(formData.transitionDelay) || 0;
            const isEffectsLead = formData.transitionDirection;
            this._delay = isEffectsLead ? rawDelay : -rawDelay;
            const label = el.querySelector('.transition-slider label');
            if (label) label.textContent = `${game.i18n.localize("VISAGE.Transition.Delay")} (${rawDelay}ms)`;
        }

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

        const rawScale = isScaleActive ? (parseFloat(formData.scale) / 100) : 1.0;
        const flipX = isFlipXActive ? (formData.isFlippedX === "true") : false;
        const flipY = isFlipYActive ? (formData.isFlippedY === "true") : false;
        const isAlphaActive = formData.alpha_active;
        const rawAlpha = isAlphaActive ? (parseFloat(formData.alpha) / 100) : 1.0;
        
        const width = getVal("width", Number) || 1;
        const height = getVal("height", Number) || 1;

        // 3. Update Grid Dimensions
        const content = el.querySelector('.visage-preview-content.stage-mode');
        if (content) {
            content.style.setProperty('--visage-dim-w', width);
            content.style.setProperty('--visage-dim-h', height);
        }

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

        const activeVisuals = (this._effects || []).filter(e => !e.disabled && e.type === "visual" && e.path);
        const effectsBelow = activeVisuals.filter(e => e.zOrder === "below").map(e => this._prepareEffectStyle(e));
        const effectsAbove = activeVisuals.filter(e => e.zOrder === "above").map(e => this._prepareEffectStyle(e));

        const rawPath = (ring && ring.subject.texture) ? ring.subject.texture : (imgSrc || "");
        const resolved = await VisageUtilities.resolvePath(rawPath);
        const resolvedPath = resolved || rawPath;

        // v3.2: Light Params for Preview
        const lightDim = this._light.dim || 0;
        const lightBright = this._light.bright || 0;
        const hasLight = lightDim > 0 || lightBright > 0;

        const previewData = {
            resolvedPath: resolvedPath,
            name: getVal("nameOverride"),
            hasCheckerboard: true,
            alpha: rawAlpha, 
            hasRing: !!ring,
            hasPulse: ring ? (ring.effects & 2) !== 0 : false,
            hasGradient: ring ? (ring.effects & 4) !== 0 : false,
            hasWave: ring ? (ring.effects & 8) !== 0 : false,
            hasInvisibility: ring ? (ring.effects & 16) !== 0 : false,
            ringColor: ring?.colors?.ring,
            ringBkg: ring?.colors?.background,
            forceFlipX: flipX,
            forceFlipY: flipY,
            wrapperClass: "visage-preview-content stage-mode",
            
            // v3.2: Light Preview Props
            hasLight: hasLight,
            lightColor: this._light.color || "#ffffff",
            lightAnimation: this._light.animation?.type || "",

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

            // Re-apply Transforms based on flips/scale
            let visualScale = rawScale; 
            if (ring && formData.ringSubjectScale) {
                 visualScale = parseFloat(formData.ringSubjectScale) || 1.0;
            }
            this._currentVisualScale = visualScale; 

            const scaleX = visualScale * (flipX ? -1 : 1);
            const scaleY = visualScale * (flipY ? -1 : 1);
            const transform = `scale(${scaleX}, ${scaleY})`;

            const newImg = stage.querySelector(".visage-preview-img");
            if (newImg) newImg.style.transform = transform;

            this._applyStageTransform();
            this._bindDynamicListeners();
            
            const newContent = stage.querySelector('.visage-preview-content.stage-mode');
            if (newContent) {
                newContent.style.setProperty('--visage-dim-w', width);
                newContent.style.setProperty('--visage-dim-h', height);
            }
        }

        this._syncAudioPreviews();
    }

    _resolveEffectPath(rawPath) {
        if (!rawPath) return null;
        const isDbKey = VisageUtilities.hasSequencer && !rawPath.includes("/");
        if (isDbKey) {
            const entry = this._resolveSequencerRecursively(rawPath);
            if (entry) {
                let file;
                if (Array.isArray(entry)) file = entry[Math.floor(Math.random() * entry.length)];
                else {
                    file = entry.file;
                    if (Array.isArray(file)) file = file[Math.floor(Math.random() * file.length)];
                }
                if (file && typeof file === "object" && file.file) file = file.file;
                if (typeof file === "string") return file;
            }
            return null;
        }
        return rawPath;
    }

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
        } catch(e) {}
        return null;
    }

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
                z-index: ${effect.zOrder === "below" ? 1 : 10};
            `
        };
    }

    _syncAudioPreviews() {
        const activeAudioEffects = (this._effects || []).filter(e => !e.disabled && e.type === "audio" && e.path);
        const activeIds = new Set(activeAudioEffects.map(e => e.id));

        for (const [id, sound] of this._audioPreviews) {
            if (!activeIds.has(id)) {
                if (sound && typeof sound.stop === "function") sound.stop();
                this._audioPreviews.delete(id);
            }
        }

        activeAudioEffects.forEach(e => {
            const vol = e.opacity ?? 0.8;
            if (this._audioPreviews.has(e.id)) {
                const sound = this._audioPreviews.get(e.id);
                if (sound instanceof Promise) return;
                if (sound.volume !== vol) sound.volume = vol;
                if (sound._visageSrc !== e.path) {
                    sound.stop();
                    this._audioPreviews.delete(e.id);
                } else return;
            }

            if (!this._audioPreviews.has(e.id)) {
                const resolvedPath = this._resolveEffectPath(e.path);
                if (!resolvedPath) return; 
                const playPromise = foundry.audio.AudioHelper.play({
                    src: resolvedPath, volume: vol, loop: e.loop ?? true
                }, false).then(sound => {
                    const currentEffect = (this._effects || []).find(fx => fx.id === e.id);
                    if (!currentEffect || currentEffect.disabled || !sound) {
                        if (sound) sound.stop();
                        this._audioPreviews.delete(e.id);
                        return;
                    }
                    sound._visageSrc = e.path;
                    this._audioPreviews.set(e.id, sound);
                    return sound;
                });
                this._audioPreviews.set(e.id, playPromise);
            }
        });
    }

    async close(options) {
        for (const [id, sound] of this._audioPreviews) {
            if (sound && typeof sound.stop === "function") sound.stop();
        }
        this._audioPreviews.clear();
        return super.close(options);
    }

    _onOpenFilePicker(event, target) {
        const input = target.previousElementSibling?.tagName === "BUTTON" 
            ? target.parentElement.querySelector("input") 
            : target.previousElementSibling;

        const FilePickerClass = foundry.applications?.apps?.FilePicker;

        const fp = new FilePickerClass({
            type: "imagevideo",
            current: input.value,
            callback: (path) => {
                input.value = path;
                this._markDirty();
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }
        });
        fp.render(true);
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

    async _onAddVisual(event, target) {
        this._effects.push({
            id: foundry.utils.randomID(16), type: "visual", label: "New Visual",
            path: "", scale: 1.0, opacity: 1.0, rotation: 0, rotationRandom: false,
            zOrder: "above", loop: true, disabled: false
        });
        this._markDirty();
        await this.render(); 
    }

    async _onAddAudio(event, target) {
        this._effects.push({
            id: foundry.utils.randomID(16), type: "audio", label: "New Audio",
            path: "", opacity: 0.8, loop: true, disabled: false
        });
        this._markDirty();
        await this.render();
    }

    _onEditEffect(event, target) {
        const card = target.closest('.effect-card');
        this._activeEffectId = card.dataset.id;
        this.render();
    }

    async _onCloseEffectInspector(event, target) {
        const container = this.element.querySelector('.effects-tab-container');
        if(container) container.classList.remove('editing');
        this._activeEffectId = null;
        await this.render();
    }

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

    // v3.2: Light Toggle Logic
    _onToggleLight(event, target) {
        event.stopPropagation();
        const hasLight = (this._light.dim > 0 || this._light.bright > 0);
        
        if (hasLight) {
            this._light._cachedDim = this._light.dim;
            this._light._cachedBright = this._light.bright;
            this._light.dim = 0;
            this._light.bright = 0;
        } else {
            this._light.dim = this._light._cachedDim || 20;
            this._light.bright = this._light._cachedBright || 10;
        }
        
        this._markDirty();
        this._updatePreview();
        this.render();
    }

    // v3.2: Transition Logic
    _onToggleTransitionDirection(event, target) {
        this._markDirty();
        this._updatePreview(); 
    }

    _onOpenSequencerDatabase(event, target) {
        if (VisageUtilities.hasSequencer) {
            new Sequencer.DatabaseViewer(true).render(true);
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
            if (event.target.matches("select, input[type='text'], input[type='checkbox']")) {
                this._updatePreview();
            }
        });
        this.element.addEventListener("input", () => this._markDirty());
        this._bindTagInput();
        this._bindDragDrop(this.element);
        
        let debounceTimer;
        this.element.addEventListener("input", (event) => {
            this._markDirty();
            if (event.target.matches("input[type='text'], input[type='number'], color-picker, range-picker")) {
                 clearTimeout(debounceTimer);
                 debounceTimer = setTimeout(() => { this._updatePreview(); }, 200); 
            }
        });

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
    }

    _onToggleGrid(event, target) {
        const stage = this.element.querySelector('.visage-live-preview-stage');
        if (stage) stage.classList.toggle('show-grid');
    }

    _bindStaticListeners() {
        const stage = this.element.querySelector('.visage-live-preview-stage');
        if (!stage) return;
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
        content.onmousedown = (e) => { 
            if (e.button !== 0) return;
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

    _onZoomIn() { this._viewState.scale = Math.min(this._viewState.scale + 0.25, 5.0); this._applyStageTransform(); }
    _onZoomOut() { this._viewState.scale = Math.max(this._viewState.scale - 0.25, 0.1); this._applyStageTransform(); }
    _onResetZoom() { 
        this._viewState = { scale: 1.0, x: 0, y: 0 }; 
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
            }
        });
    }

    _onToggleLoop(event, target) {
        const card = target.closest('.effect-card');
        const id = card.dataset.id;
        const effect = this._effects.find(e => e.id === id);
        if (effect) {
            effect.loop = !(effect.loop ?? true);
            this._markDirty();
            this.render(); 
        }
    }

    _onReplayPreview(event, target) {
        for (const [id, sound] of this._audioPreviews) {
            if (sound && typeof sound.stop === "function") sound.stop();
        }
        this._audioPreviews.clear();
        this._updatePreview();
    }

    _bindTagInput() {
        const container = this.element.querySelector(".visage-tag-container");
        if (!container) return;
        const input = container.querySelector(".visage-tag-input");
        const hidden = container.querySelector("input[name='tags']");
        const pillsDiv = container.querySelector(".visage-tag-pills");
        
        const updateHidden = () => {
            const tags = Array.from(pillsDiv.querySelectorAll(".visage-tag-pill")).map(p => p.dataset.tag);
            hidden.value = tags.join(",");
            this._markDirty();
        };

        const addPill = (text) => {
            const clean = text.trim();
            if (!clean) return;
            const existing = Array.from(pillsDiv.querySelectorAll(".visage-tag-pill")).map(p => p.dataset.tag.toLowerCase());
            if (existing.includes(clean.toLowerCase())) return;

            const pill = document.createElement("span");
            pill.className = "visage-tag-pill";
            pill.dataset.tag = clean;
            pill.innerHTML = `${clean} <i class="visage-icon close"></i>`;
            pill.querySelector("i").addEventListener("click", () => {
                pill.remove();
                updateHidden();
            });
            pillsDiv.appendChild(pill);
            updateHidden();
        };

        if (hidden.value) hidden.value.split(",").forEach(t => addPill(t));

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
    }

    _onResetSettings(event, target) {
        const checkboxes = this.element.querySelectorAll('input[type="checkbox"][name$="_active"]');
        checkboxes.forEach(cb => { cb.checked = false; this._onToggleField(null, cb); });
        const ringCheck = this.element.querySelector('input[name="ring.enabled"]');
        if (ringCheck) ringCheck.checked = false;
        
        this._effects = [];
        this._activeEffectId = null;
        this._light.dim = 0; 
        this._light.bright = 0;

        this._markDirty();
        this._updatePreview();
        ui.notifications.info(game.i18n.localize("VISAGE.Notifications.SettingsReset"));
    }

    _prepareSaveData() {
        const formData = new foundry.applications.ux.FormDataExtended(this.element).object;
        
        const getVal = (key, type = String) => {
            const val = foundry.utils.getProperty(formData, key);
            if (val === "" || val === null || val === undefined) return null;
            return type(val);
        };

        const changes = {
            name: formData.nameOverride_active ? formData.nameOverride : null,
            texture: {
                src: formData.img_active ? formData.img : null,
                scaleX: null, scaleY: null 
            },
            scale: formData.scale_active ? getVal("scale", Number) / 100 : null,
            mirrorX: formData.isFlippedX === "" ? null : (formData.isFlippedX === "true"),
            mirrorY: formData.isFlippedY === "" ? null : (formData.isFlippedY === "true"),
            alpha: formData.alpha_active ? getVal("alpha", Number) / 100 : null,
            width: formData.width_active ? getVal("width", Number) : null,
            height: formData.height_active ? getVal("height", Number) : null,
            lockRotation: formData.lockRotation === "" ? null : (formData.lockRotation === "true"),
            disposition: formData.disposition_active ? getVal("disposition", Number) : null,
            ring: null,
            effects: foundry.utils.deepClone(this._effects),
            // v3.2 Properties
            light: null,
            portrait: null
        };

        // Ring
        if (formData["ring.enabled"]) {
            let effectsMask = 0;
            for (const [k, v] of Object.entries(formData)) {
                if (k.startsWith("effect_") && v === true) effectsMask |= parseInt(k.split("_")[1]);
            }
            changes.ring = {
                enabled: true,
                colors: { ring: formData.ringColor, background: formData.ringBackgroundColor },
                subject: { texture: formData.ringSubjectTexture, scale: formData.ringSubjectScale },
                effects: effectsMask
            };
        } else {
            changes.ring = { enabled: false };
        }

        // v3.2 Light
        if (this._light.dim > 0 || this._light.bright > 0) {
            changes.light = foundry.utils.deepClone(this._light);
            delete changes.light._cachedDim;
            delete changes.light._cachedBright;
        }

        // v3.2 Portrait
        if (formData.portrait_active && formData.portrait) {
            changes.portrait = formData.portrait;
        }

        return {
            id: this.visageId, 
            label: formData.label,
            category: formData.category,
            tags: formData.tags ? formData.tags.split(",").filter(t => t.trim()) : [],
            mode: formData.mode,
            delay: this._delay, // v3.2
            changes: changes
        };
    }

    async _onSave(event, target) {
        event.preventDefault();
        const payload = this._prepareSaveData();
        if (!payload.label) return ui.notifications.warn(game.i18n.localize("VISAGE.Notifications.LabelRequired"));

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