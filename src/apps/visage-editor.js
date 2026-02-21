/**
 * VISAGE EDITOR
 * -------------------------------------------------------------------
 * The central application for creating and modifying Visages.
 *
 * ARCHITECTURAL OVERVIEW:
 * This class uses a "Snapshot & Merge" strategy to handle the UI.
 * Because Handlebars re-renders the DOM frequently, we cannot rely
 * solely on the DOM to hold the state of the form.
 *
 * 1. _preservedData: Caches the full form state before every render.
 * 2. _prepareSaveData: The "Single Source of Truth". It gathers data
 * from active DOM inputs and merges it with the preserved memory.
 * 3. _updatePreview: A fast-update pipeline that bypasses Handlebars
 * to inject real-time DOM changes to the live stage.
 */

import { VisageData } from "../data/visage-data.js";
import { VisageUtilities } from "../utils/visage-utilities.js";
import { VisageDragDropManager } from "./helpers/visage-drag-drop.js";
import { VisageMediaController } from "./helpers/visage-media-controller.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

// ============================================================================
// MAIN APPLICATION: VISAGE EDITOR
// ============================================================================

export class VisageEditor extends HandlebarsApplicationMixin(ApplicationV2) {
    // ==========================================
    // 1. SETUP & CONFIGURATION
    // ==========================================

    constructor(options = {}) {
        super(options);

        // Core Identity
        this.visageId = options.visageId || null;
        this.actorId = options.actorId || null;
        this.tokenId = options.tokenId || null;
        this.isDirty = false;

        // Viewport & Sub-system State
        this._activeTab = "appearance";
        this._viewState = {
            scale: 1.0,
            x: 0,
            y: 0,
            isDragging: false,
            lastX: 0,
            lastY: 0,
        };
        this._dragDropManager = new VisageDragDropManager(this);
        this._mediaController = new VisageMediaController();

        // Data Persistence & Inspector State
        this._preservedData = null;
        this._effects = null;
        this._activeEffectId = null;
        this._editingLight = false;
        this._editingRing = false;

        // Automation Trackers
        this._automationData = null;
        this._activeConditionId = null;

        // Sub-Data Containers for hidden UI components
        this._lightData = null;
        this._ringData = null;
        this._delayData = 0;
    }

    get isLocal() {
        return !!this.actorId;
    }
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
            contentClasses: ["standard-form"],
        },
        position: { width: 960, height: "auto" },
        actions: {
            save: VisageEditor.prototype._onSave,
            toggleField: VisageEditor.prototype._onToggleField,
            openFilePicker: VisageEditor.prototype._onOpenFilePicker,
            resetSettings: VisageEditor.prototype._onResetSettings,
            zoomIn: VisageEditor.prototype._onZoomIn,
            zoomOut: VisageEditor.prototype._onZoomOut,
            resetZoom: VisageEditor.prototype._onResetZoom,
            toggleGrid: VisageEditor.prototype._onToggleGrid,
            addVisual: VisageEditor.prototype._onAddVisual,
            addAudio: VisageEditor.prototype._onAddAudio,
            editEffect: VisageEditor.prototype._onEditEffect,
            closeEffectInspector:
                VisageEditor.prototype._onCloseEffectInspector,
            deleteEffect: VisageEditor.prototype._onDeleteEffect,
            toggleEffect: VisageEditor.prototype._onToggleEffect,
            toggleLoop: VisageEditor.prototype._onToggleLoop,
            replayPreview: VisageEditor.prototype._onReplayPreview,
            openSequencerDatabase:
                VisageEditor.prototype._onOpenSequencerDatabase,
            toggleLight: VisageEditor.prototype._onToggleLight,
            editLight: VisageEditor.prototype._onEditLight,
            toggleRing: VisageEditor.prototype._onToggleRing,
            editRing: VisageEditor.prototype._onEditRing,
            toggleDelayDirection:
                VisageEditor.prototype._onToggleDelayDirection,
            toggleAutomation: VisageEditor.prototype._onToggleAutomation,
            toggleLogic: VisageEditor.prototype._onToggleLogic,
            addCondition: VisageEditor.prototype._onAddCondition,
            editCondition: VisageEditor.prototype._onEditCondition,
            deleteCondition: VisageEditor.prototype._onDeleteCondition,
            closeConditionInspector:
                VisageEditor.prototype._onCloseConditionInspector,
            openAttributePicker: VisageEditor.prototype._onOpenAttributePicker,
        },
    };

    static PARTS = {
        form: {
            template: "modules/visage/templates/visage-editor.hbs",
            scrollable: [".visage-editor-grid"],
        },
    };

    get title() {
        if (this.isLocal) {
            return this.visageId
                ? game.i18n.format("VISAGE.GlobalEditor.Title.Local", {
                      name: this._currentLabel || "Visage",
                  })
                : game.i18n.localize("VISAGE.GlobalEditor.TitleNew.Local");
        }
        return this.visageId
            ? game.i18n.format("VISAGE.GlobalEditor.TitleEdit", {
                  name: this._currentLabel || "Visage",
              })
            : game.i18n.localize("VISAGE.GlobalEditor.TitleNew.Global");
    }

    // ==========================================
    // 2. CORE LIFECYCLE (Foundry V2)
    // ==========================================

    async render(options) {
        if (this.rendered) this._preservedData = this._prepareSaveData();
        return super.render(options);
    }

    async close(options) {
        this._mediaController.stopAll();
        return super.close(options);
    }

    async _prepareContext(options) {
        // 1. Fetch & Initialize Base Data
        const baseData = this._getInitialData();
        if (!baseData) return this.close();

        let data = this._preservedData
            ? foundry.utils.mergeObject(baseData, this._preservedData, {
                  inplace: false,
              })
            : baseData;

        if (this._preservedData) {
            data.changes = foundry.utils.deepClone(this._preservedData.changes);
        }

        this._syncMemoryDefaults(data);

        // 2. Build Transformations
        const rawImg = data.changes?.texture?.src || "";
        const context = VisageData.toPresentation(data, {
            isWildcard: rawImg.includes("*"),
            isActive: false,
        });
        const inspectorData = this._buildInspectorContext();
        const stageData = this._buildStagePreviewContext(
            data.changes || {},
            context,
        );

        // 3. Collect Global Categories & Tags
        const allVisages = VisageData.globals;
        const categorySet = new Set();
        const tagSet = new Set();
        allVisages.forEach((v) => {
            if (v.category) categorySet.add(v.category);
            if (v.tags && Array.isArray(v.tags))
                v.tags.forEach((t) => tagSet.add(t));
        });

        // 4. Input Preparation Helpers
        const prep = (val, def) => ({
            value: val ?? def,
            active: val !== null && val !== undefined && val !== "",
        });
        const c = data.changes || {};

        // Format Condition Summaries
        if (this._automationData && this._automationData.conditions) {
            this._automationData.conditions.forEach((c) => {
                c.typeKey = `VISAGE.Editor.Triggers.Type${c.type.charAt(0).toUpperCase() + c.type.slice(1)}`;

                if (c.type === "attribute") {
                    const opMap = { lte: "<=", gte: ">=", eq: "==", neq: "!=" };
                    const modeStr = c.mode === "percent" ? "%" : "";
                    c.summary = `${c.path || "..."} ${opMap[c.operator] || ""} ${c.value || 0}${modeStr}`;
                } else if (c.type === "status") {
                    c.summary = `${c.statusId || "..."} (${c.operator === "active" ? "Applied" : "Removed"})`;
                } else if (c.type === "event") {
                    c.summary = `${c.eventId || "..."} (${c.operator === "active" ? "Active" : "Inactive"})`;
                } else if (c.type === "action") {
                    c.summary = `${c.actionType || "..."} (${c.outcome || "any"})`;
                }
            });
        }

        return {
            ...context,
            isEdit: !!this.visageId,
            isLocal: this.isLocal,
            isDirty: this.isDirty,
            isPublic: data.public ?? false,
            categories: Array.from(categorySet).sort(),
            allTags: Array.from(tagSet).sort(),
            tagsString: (data.tags || []).join(","),
            mode: data.mode || (this.isLocal ? "identity" : "overlay"),
            appId: this.id,
            tabs: {
                appearance: { active: this._activeTab === "appearance" },
                effects: { active: this._activeTab === "effects" },
                triggers: { active: this._activeTab === "triggers" },
            },
            img: prep(rawImg, ""),
            portrait: prep(c.portrait, ""),
            light: {
                ...this._lightData,
                localizedAnimation: this._getLocalizedLightAnim(),
            },
            lightAnimationOptions: this._getLightAnimationOptions(),
            ring: {
                ...this._ringData,
                ...VisageData.prepareRingContext(this._ringData),
                active: this._ringData.enabled,
            },
            inspector: inspectorData,
            automation: this._automationData,
            statusEffects: this._getStatusEffectOptions(),
            delay: {
                value: Math.abs(this._delayData) / 1000,
                direction: this._delayData >= 0 ? "after" : "before",
            },
            scale: {
                value: Math.round((c.scale ?? 1.0) * 100),
                active: c.scale != null,
            },
            anchor: {
                active:
                    c.texture?.anchorX != null || c.texture?.anchorY != null,
                x: c.texture?.anchorX ?? 0.5,
                y: c.texture?.anchorY ?? 0.5,
            },
            isFlippedX: { value: c.mirrorX, active: c.mirrorX != null },
            isFlippedY: { value: c.mirrorY, active: c.mirrorY != null },
            alpha: {
                value:
                    c.alpha !== undefined && c.alpha !== null
                        ? Math.round(c.alpha * 100)
                        : 100,
                active: c.alpha != null,
            },
            lockRotation: {
                value:
                    c.lockRotation === true
                        ? "true"
                        : c.lockRotation === false
                          ? "false"
                          : "",
                active: true,
            },
            width: prep(c.width, 1),
            height: prep(c.height, 1),
            disposition: prep(c.disposition, 0),
            nameOverride: prep(c.name, ""),
            hasSequencer: VisageUtilities.hasSequencer,
            preview: stageData,
        };
    }

    _onRender(context, options) {
        VisageUtilities.applyVisageTheme(this.element, this.isLocal);

        // Form Event Delegation
        const debouncedUpdate = foundry.utils.debounce(
            () => this._updatePreview(),
            50,
        );
        this.element.addEventListener("change", (e) => {
            this._markDirty();
            if (
                e.target.matches(
                    "select, input[type='text'], input[type='checkbox'], input[type='radio']",
                )
            )
                this._updatePreview();
        });

        // Setup Range Sliders
        this.element
            .querySelectorAll('input[type="range"]')
            .forEach((slider) => {
                slider.addEventListener("input", () => {
                    this._markDirty();
                    debouncedUpdate();
                });
                slider.addEventListener("dblclick", (ev) =>
                    this._resetSliderDefault(ev),
                );
            });

        // Bind Sub-systems
        this.element.addEventListener("input", () => this._markDirty());
        this._bindTagInput();
        this._dragDropManager.bind(this.element);

        // Text input debouncing
        let textTimer;
        this.element.addEventListener("input", (e) => {
            if (
                e.target.matches(
                    "input[type='text'], input[type='number'], color-picker, range-picker",
                )
            ) {
                clearTimeout(textTimer);
                textTimer = setTimeout(() => this._updatePreview(), 200);
            }
        });

        // Tabs & Viewport Init
        this.element.querySelectorAll(".visage-tabs .item").forEach((t) => {
            t.addEventListener("click", (e) =>
                this._activateTab(e.currentTarget.dataset.tab),
            );
        });
        if (this._activeTab) this._activateTab(this._activeTab);
        if (this._activeEffectId || this._editingLight || this._editingRing) {
            this.element
                .querySelector(".effects-tab-container")
                ?.classList.add("editing");
        }
        if (this._activeConditionId) {
            this.element
                .querySelector(".triggers-tab-container")
                ?.classList.add("editing");
        }

        this._updatePreview();
        this._bindStaticListeners();
        this._bindDynamicListeners();
        this._applyStageTransform();

        if (this._showGrid) {
            this.element
                .querySelector(".visage-live-preview-stage")
                ?.classList.add("show-grid");
            const btn = this.element.querySelector(
                '[data-action="toggleGrid"] i',
            );
            if (btn) btn.className = "visage-icon grid-off";
        }
    }

    // --- Private Context Builders ---

    _getInitialData() {
        if (this.visageId) {
            const data = this.isLocal
                ? VisageData.getLocal(this.actor).find(
                      (v) => v.id === this.visageId,
                  )
                : VisageData.getGlobal(this.visageId);
            if (data) this._currentLabel = data.label;
            return data;
        } else {
            this._currentLabel = "";
            if (this.isLocal) {
                const token =
                    canvas.tokens.get(this.tokenId) ||
                    this.actor.prototypeToken;
                const data = VisageData.getDefaultAsVisage(
                    token.document || token,
                );
                data.label = "New Visage";
                data.id = null;
                return data;
            } else {
                return {
                    label: game.i18n.localize(
                        "VISAGE.GlobalEditor.TitleNew.Global",
                    ),
                    category: "",
                    tags: [],
                    changes: {},
                    public: false,
                };
            }
        }
    }

    _syncMemoryDefaults(data) {
        const c = data.changes || {};

        // Effects Sync
        if (this._effects === null)
            this._effects = c.effects ? foundry.utils.deepClone(c.effects) : [];
        if (this._delayData === 0 && c.delay !== undefined)
            this._delayData = c.delay;

        // Light Data Sync
        if (this._lightData === null) {
            const defaultLight = {
                dim: 0,
                bright: 0,
                color: "#ffffff",
                alpha: 0.5,
                angle: 360,
                luminosity: 0.5,
                priority: 0,
                animation: { type: "", speed: 5, intensity: 5 },
            };
            this._lightData = c.light
                ? { active: !!this.visageId, ...defaultLight, ...c.light }
                : { active: false, ...defaultLight };
        }

        // Dynamic Ring Sync
        if (this._ringData === null) {
            const defaults = {
                enabled: false,
                colors: { ring: "#ffffff", background: "#000000" },
                subject: { texture: "", scale: 1.0 },
                effects: 0,
            };
            this._ringData = c.ring
                ? foundry.utils.mergeObject(defaults, c.ring, {
                      inplace: false,
                  })
                : defaults;
            if (c.ring) this._ringData.enabled = !!c.ring.enabled;
        }

        // Automation Sync
        if (this._automationData === null) {
            this._automationData = data.automation
                ? foundry.utils.deepClone(data.automation)
                : VisageData.getDefaultAutomation();
        }
    }

    _buildInspectorContext() {
        const formatEffect = (e) => ({
            ...e,
            icon:
                e.type === "audio" ? "visage-icon audio" : "visage-icon visual",
            metaLabel:
                e.type === "audio"
                    ? `Volume: ${Math.round((e.opacity ?? 1) * 100)}%`
                    : `${e.zOrder === "below" ? "Below" : "Above"} • ${Math.round((e.scale ?? 1) * 100)}%`,
        });

        const inspectorData = {
            hasEffects:
                this._effects.length > 0 ||
                this._lightData.active ||
                this._ringData.enabled,
            effectsAbove: this._effects
                .filter((e) => e.type === "visual" && e.zOrder === "above")
                .map(formatEffect),
            effectsBelow: this._effects
                .filter((e) => e.type === "visual" && e.zOrder === "below")
                .map(formatEffect),
            effectsAudio: this._effects
                .filter((e) => e.type === "audio")
                .map(formatEffect),
            type: null,
        };

        if (this._editingRing) inspectorData.type = "ring";
        else if (this._editingLight) {
            inspectorData.type = "light";
            foundry.utils.mergeObject(inspectorData, {
                dim: this._lightData.dim,
                bright: this._lightData.bright,
                color: this._lightData.color,
                alpha: this._lightData.alpha,
                animation: this._lightData.animation,
            });
        } else if (this._activeEffectId) {
            const effect = this._effects.find(
                (e) => e.id === this._activeEffectId,
            );
            if (effect) {
                foundry.utils.mergeObject(inspectorData, {
                    id: effect.id,
                    label: effect.label,
                    path: effect.path,
                    type: effect.type,
                    scale: Math.round((effect.scale ?? 1.0) * 100),
                    opacity: effect.opacity ?? 1.0,
                    rotation: effect.rotation ?? 0,
                    rotationRandom: effect.rotationRandom ?? false,
                    zOrder: effect.zOrder ?? "above",
                    blendMode: effect.blendMode || "normal",
                    loop: effect.loop ?? true,
                });
            }
        } else if (this._activeConditionId) {
            const condition = this._automationData.conditions.find(
                (c) => c.id === this._activeConditionId,
            );
            if (condition) {
                inspectorData.conditionId = condition.id;
                inspectorData.condition = condition;
            }
        }
        return inspectorData;
    }

    _buildStagePreviewContext(c, context) {
        const gridDist = canvas.scene?.grid?.distance || 5;
        const lMax = Math.max(
            this._lightData?.dim || 0,
            this._lightData?.bright || 0,
        );
        const sizeRatio = lMax > 0 ? (lMax * 2) / gridDist / (c.width || 1) : 1;
        const brightPct =
            lMax > 0 ? ((this._lightData?.bright || 0) / lMax) * 100 : 0;
        const speed = this._lightData.animation?.speed ?? 5;

        return {
            ...context.meta,
            img: context.resolvedPath,
            isVideo: context.isVideo,
            flipX: context.isFlippedX,
            flipY: context.isFlippedY,
            alpha: c.alpha ?? 1.0,
            hasLight: this._lightData.active,
            lightColor: this._lightData.color,
            lightAlpha: this._lightData.alpha ?? 0.5,
            lightDim: this._lightData.dim,
            lightBright: this._lightData.bright,
            lightSizePct: sizeRatio * 100,
            lightBrightPct: brightPct,
            lightAnimType: this._lightData.animation?.type || "",
            lightAnimDuration: Math.max(0.5, (11 - speed) * 0.35) + "s",
        };
    }

    // ==========================================
    // 3. STATE & DATA MANAGEMENT
    // ==========================================

    _prepareSaveData() {
        const formData = new foundry.applications.ux.FormDataExtended(
            this.element,
        ).object;

        // 1. Sync internal state from form
        this._syncStateFromForm(formData);

        // 2. Build final Changes Payload (Dropping unchecked intents)
        return this._buildChangesPayload(formData);
    }

    _syncStateFromForm(formData) {
        const getVal = (key, type = String) => {
            const val = foundry.utils.getProperty(formData, key);
            return val === "" || val === null || val === undefined
                ? null
                : type(val);
        };

        // Delay Sync
        const delayVal = getVal("delayValue", Number);
        if (delayVal !== null && !isNaN(delayVal))
            this._delayData =
                Math.round(delayVal * 1000) * (this._delayData >= 0 ? 1 : -1);

        // Light Sync
        if (this._editingLight) {
            [
                "dim",
                "bright",
                "alpha",
                "angle",
                "luminosity",
                "priority",
            ].forEach((k) => {
                const v = getVal(`light.${k}`, Number);
                if (v !== null) this._lightData[k] = v;
            });
            const color = getVal("light.color");
            if (color !== null) this._lightData.color = color;

            const animType = getVal("light.animation.type");
            if (animType !== null) {
                this._lightData.animation = this._lightData.animation || {};
                this._lightData.animation.type = animType;
                this._lightData.animation.speed =
                    getVal("light.animation.speed", Number) ?? 5;
                this._lightData.animation.intensity =
                    getVal("light.animation.intensity", Number) ?? 5;
            }
        }

        // Effect Sync
        const renderedEffectId = formData["inspector.effectId"];
        if (renderedEffectId) {
            const activeEffect = this._effects.find(
                (e) => e.id === renderedEffectId,
            );
            if (activeEffect) {
                activeEffect.label =
                    getVal("effectLabel") ?? activeEffect.label;
                activeEffect.path = getVal("effectPath") ?? activeEffect.path;

                if (activeEffect.type === "visual") {
                    const scaleVal = getVal("effectScale", Number);
                    if (scaleVal !== null && !isNaN(scaleVal))
                        activeEffect.scale = scaleVal / 100;

                    const opacityVal = getVal("effectOpacity", Number);
                    if (opacityVal !== null && !isNaN(opacityVal))
                        activeEffect.opacity = opacityVal;

                    activeEffect.blendMode =
                        getVal("effectBlendMode") ?? activeEffect.blendMode;

                    const rotationVal = getVal("effectRotation", Number);
                    if (rotationVal !== null && !isNaN(rotationVal))
                        activeEffect.rotation = rotationVal;

                    activeEffect.rotationRandom =
                        !!formData.effectRotationRandom;
                    activeEffect.zOrder =
                        getVal("effectZIndex") ?? activeEffect.zOrder;
                } else if (activeEffect.type === "audio") {
                    const volVal = getVal("effectVolume", Number);
                    if (volVal !== null && !isNaN(volVal))
                        activeEffect.opacity = volVal;
                }
            }
        }

        // Ring Sync
        if (this._editingRing && formData.ringColor !== undefined) {
            let effectsMask = 0;
            for (const [k, v] of Object.entries(formData)) {
                if (k.startsWith("effect_") && v === true)
                    effectsMask |= parseInt(k.split("_")[1]);
            }
            this._ringData.colors.ring = formData.ringColor;
            this._ringData.colors.background = formData.ringBackgroundColor;
            this._ringData.subject.texture = formData.ringSubjectTexture;
            this._ringData.subject.scale = formData.ringSubjectScale;
            this._ringData.effects = effectsMask;
        }

        // Automation Sync
        if (this._automationData) {
            this._automationData.enabled =
                formData["automation.enabled"] ?? false;

            const renderedConditionId = formData["inspector.conditionId"];
            if (renderedConditionId) {
                const cond = this._automationData.conditions.find(
                    (c) => c.id === renderedConditionId,
                );
                if (cond) {
                    if (cond.type === "attribute") {
                        cond.path = getVal("inspector.path") ?? cond.path;
                        cond.operator =
                            getVal("inspector.operator") ?? cond.operator;
                        cond.mode = getVal("inspector.mode") ?? cond.mode;
                        const val = getVal("inspector.value", Number);
                        if (val !== null && !isNaN(val)) cond.value = val;
                    } else if (cond.type === "status") {
                        cond.statusId =
                            getVal("inspector.statusId") ?? cond.statusId;
                        cond.operator =
                            getVal("inspector.operator") ?? cond.operator;
                    } else if (cond.type === "event") {
                        cond.eventId =
                            getVal("inspector.eventId") ?? cond.eventId;
                        cond.operator =
                            getVal("inspector.operator") ?? cond.operator;
                    } else if (cond.type === "action") {
                        cond.actionType =
                            getVal("inspector.actionType") ?? cond.actionType;
                        cond.outcome =
                            getVal("inspector.outcome") ?? cond.outcome;

                        cond.duration = cond.duration || {};
                        cond.duration.mode =
                            getVal("inspector.durationMode") ??
                            cond.duration.mode;
                        const dVal = getVal("inspector.durationValue", Number);
                        if (dVal !== null && !isNaN(dVal))
                            cond.duration.value = dVal;
                    }
                }
            }
        }
    }

    _buildChangesPayload(formData) {
        const getVal = (key, type = String) => {
            const val = foundry.utils.getProperty(formData, key);
            return val === "" || val === null || val === undefined
                ? null
                : type(val);
        };
        const changes = {};

        // A. Omit inactive token properties completely
        if (formData.nameOverride_active) changes.name = formData.nameOverride;
        if (formData.scale_active)
            changes.scale = getVal("scale", Number) / 100;
        if (formData.isFlippedX !== "")
            changes.mirrorX = formData.isFlippedX === "true";
        if (formData.isFlippedY !== "")
            changes.mirrorY = formData.isFlippedY === "true";
        if (formData.alpha_active)
            changes.alpha = getVal("alpha", Number) / 100;
        if (formData.width_active) changes.width = getVal("width", Number);
        if (formData.height_active) changes.height = getVal("height", Number);
        if (formData.lockRotation !== "")
            changes.lockRotation = formData.lockRotation === "true";
        if (formData.disposition_active)
            changes.disposition = getVal("disposition", Number);
        if (formData.portrait_active) changes.portrait = formData.portrait;

        if (formData.img_active || formData.anchor_active) {
            changes.texture = {};
            if (formData.img_active) changes.texture.src = formData.img;
            if (formData.anchor_active) {
                changes.texture.anchorX = parseFloat(formData.anchorX);
                changes.texture.anchorY = parseFloat(formData.anchorY);
            }
        }

        // B. Components always sent
        changes.light = this._lightData;
        changes.ring = this._ringData;
        changes.delay = this._delayData;
        changes.effects = this._effects.filter((e) => !e.disabled);

        return {
            id: this.visageId,
            label: formData.label,
            category: formData.category,
            tags: formData.tags
                ? formData.tags.split(",").filter((t) => t.trim())
                : [],
            mode: formData.mode,
            public: formData.public === "true",
            automation: this._automationData,
            changes: changes,
        };
    }

    async _onSave(event) {
        event.preventDefault();
        const payload = this._prepareSaveData();
        if (!payload.label)
            return ui.notifications.warn(
                game.i18n.localize("VISAGE.Notifications.LabelRequired"),
            );

        try {
            await VisageData.save(payload, this.isLocal ? this.actor : null);
            ui.notifications.info(
                game.i18n.format(
                    this.visageId
                        ? "VISAGE.Notifications.Updated"
                        : "VISAGE.Notifications.Created",
                    { name: payload.label },
                ),
            );
            this.close();
        } catch (err) {
            ui.notifications.error(
                game.i18n.localize("VISAGE.Notifications.SaveFailed"),
            );
            console.error(err);
        }
    }

    _markDirty() {
        if (!this.isDirty) {
            this.isDirty = true;
            this.element.querySelector(".visage-save")?.classList.add("dirty");
        }
    }

    _onResetSettings() {
        // Uncheck all intents
        this.element
            .querySelectorAll('input[type="checkbox"][name$="_active"]')
            .forEach((cb) => {
                cb.checked = false;
                this._onToggleField(null, cb);
            });

        // Clear Memory
        this._ringData = {
            enabled: false,
            colors: { ring: "#ffffff", background: "#000000" },
            subject: { texture: "", scale: 1.0 },
            effects: 0,
        };
        this._lightData.active = false;
        this._editingRing = false;
        this._editingLight = false;
        this._effects = [];
        this._activeEffectId = null;

        // Reset DOM Inputs
        this.element.querySelectorAll("select").forEach((s) => (s.value = ""));
        const alphaInput = this.element.querySelector('input[name="alpha"]');
        if (alphaInput) alphaInput.value = 100;

        this._markDirty();
        this._updatePreview();
        this.render();
        ui.notifications.info(
            game.i18n.localize("VISAGE.Notifications.SettingsReset"),
        );
    }

    // ==========================================
    // 4. ACTION HANDLERS (UI Interactions)
    // ==========================================

    _onToggleField(event, target) {
        const fieldName = target.dataset.target;
        const group = target.closest(".form-group");
        const inputs =
            fieldName === "anchor"
                ? group.querySelectorAll('[name="anchorX"], [name="anchorY"]')
                : group.querySelectorAll(`[name="${fieldName}"]`);

        inputs.forEach((input) => (input.disabled = !target.checked));
        const button = group.querySelector("button.file-picker-button");
        if (button) button.disabled = !target.checked;

        this._markDirty();
        this._updatePreview();
    }

    async _onOpenFilePicker(event, target) {
        const input =
            target.previousElementSibling?.tagName === "BUTTON"
                ? target.parentElement.querySelector("input")
                : target.previousElementSibling;
        let source = "data";
        const browseOptions = {};

        // Forge Support logic
        if (typeof ForgeVTT !== "undefined" && ForgeVTT.usingTheForge) {
            browseOptions.cookieKey = true;
            if (!window.ForgeAPI?.lastStatus) {
                try {
                    await window.ForgeAPI.status();
                } catch (e) {
                    /* Ignore */
                }
            }
            if (foundry.applications.apps.FilePicker.sources?.forgevtt)
                source = "forgevtt";
        }

        const fp = new foundry.applications.apps.FilePicker.implementation({
            type: "imagevideo",
            current: input.value,
            activeSource: source,
            browseOptions,
            callback: (path) => {
                input.value = path;
                this._markDirty();
                input.dispatchEvent(new Event("change", { bubbles: true }));
            },
        });
        fp.render(true);
    }

    _activateTab(tabName) {
        this._activeTab = tabName;
        this.element
            .querySelectorAll(".visage-tabs .item")
            .forEach((n) =>
                n.classList.toggle("active", n.dataset.tab === tabName),
            );
        this.element
            .querySelectorAll(".visage-tab-content .tab")
            .forEach((c) => {
                const isActive = c.dataset.tab === tabName;
                c.classList.toggle("active", isActive);
                if (isActive && tabName === "effects")
                    c.querySelector(".effects-tab-container")?.classList.remove(
                        "active",
                    );
            });
    }

    // -- Sub-Editors --
    _onToggleRing() {
        if (!this._ringData) return;
        this._ringData.enabled = !this._ringData.enabled;
        if (!this._ringData.enabled && this._editingRing) {
            this._editingRing = false;
            this._onCloseEffectInspector();
        } else {
            this._markDirty();
            this.render();
        }
    }
    _onEditRing() {
        this._editingRing = true;
        this._editingLight = false;
        this._activeEffectId = null;
        this.render();
    }
    _onToggleLight() {
        if (!this._lightData) return;
        this._lightData.active = !this._lightData.active;
        this._markDirty();
        this._updatePreview();
        this.render();
    }
    _onEditLight() {
        this._editingLight = true;
        this._editingRing = false;
        this._activeEffectId = null;
        this.render();
    }
    _onToggleDelayDirection(event, target) {
        const btns = this.element.querySelectorAll(
            ".delay-direction-toggle button",
        );
        btns.forEach((b) => b.classList.remove("active"));
        target.classList.add("active");
        const seconds =
            parseFloat(
                this.element.querySelector('range-picker[name="delayValue"]')
                    .value,
            ) || 0;
        this._delayData =
            Math.round(seconds * 1000) *
            (target.dataset.value === "after" ? 1 : -1);
        this._markDirty();
    }
    _onToggleAutomation(event, target) {
        if (!this._automationData) return;
        this._automationData.enabled = target.checked;
        this._markDirty();
        this.render();
    }
    _onToggleLogic(event, target) {
        this._automationData.logic = target.dataset.value;
        this._markDirty();
        this.render();
    }
    _onAddCondition(event, target) {
        const type = target.dataset.type;
        const newCondition = {
            id: foundry.utils.randomID(16),
            type: type,
        };

        if (type === "attribute") {
            Object.assign(newCondition, {
                path: "",
                operator: "lte",
                value: 0,
                mode: "percent",
            });
        } else if (type === "status") {
            Object.assign(newCondition, { statusId: "", operator: "active" });
        } else if (type === "event") {
            Object.assign(newCondition, {
                eventId: "combat",
                operator: "active",
            });
        } else if (type === "action") {
            // Action includes the transient duration latch block
            Object.assign(newCondition, {
                actionType: "attack",
                outcome: "any",
                duration: { mode: "time", value: 500 },
            });
        }

        this._automationData.conditions.push(newCondition);
        this._activeConditionId = newCondition.id;

        // Ensure UI focuses the inspector
        this.element
            .querySelector(".triggers-tab-container")
            ?.classList.add("editing");

        this._markDirty();
        this.render();
    }
    _onEditCondition(event, target) {
        this._activeConditionId = target.closest(".effect-card").dataset.id;
        this.render();
    }
    _onDeleteCondition(event, target) {
        event.stopPropagation(); // Prevent _onEditCondition from firing
        const id = target.closest(".effect-card").dataset.id;

        this._automationData.conditions =
            this._automationData.conditions.filter((c) => c.id !== id);
        if (this._activeConditionId === id) this._activeConditionId = null;

        this._markDirty();
        this.render();
    }
    async _onCloseConditionInspector() {
        this.element
            .querySelector(".triggers-tab-container")
            ?.classList.remove("editing");
        this._activeConditionId = null;
        await this.render();
    }
    _onOpenAttributePicker(event, target) {
        ui.notifications.info("Attribute Picker coming soon!");
        // This will be implemented in Milestone 5
    }

    // -- Effects & Audio --
    _onAddVisual() {
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
            disabled: false,
        };
        this._effects.push(newEffect);
        this._activeEffectId = newEffect.id;
        this._markDirty();
        this.render();
    }
    _onAddAudio() {
        const newEffect = {
            id: foundry.utils.randomID(16),
            type: "audio",
            label: "New Audio",
            path: "",
            opacity: 0.8,
            loop: true,
            disabled: false,
        };
        this._effects.push(newEffect);
        this._activeEffectId = newEffect.id;
        this._markDirty();
        this.render();
    }
    _onEditEffect(event, target) {
        this._activeEffectId = target.closest(".effect-card").dataset.id;
        this._editingLight = false;
        this._editingRing = false;
        this.render();
    }
    _onToggleEffect(event, target) {
        const effect = this._effects.find(
            (e) => e.id === target.closest(".effect-card").dataset.id,
        );
        if (effect) {
            effect.disabled = !effect.disabled;
            this._markDirty();
            this.render();
        }
    }
    _onToggleLoop(event, target) {
        const effect = this._effects.find(
            (e) => e.id === target.closest(".effect-card").dataset.id,
        );
        if (effect) {
            effect.loop = !(effect.loop ?? true);
            this._markDirty();
            this.render();
        }
    }
    async _onDeleteEffect(event, target) {
        const id = target.closest(".effect-card").dataset.id;
        const confirm = await foundry.applications.api.DialogV2.confirm({
            window: {
                title: game.i18n.localize("VISAGE.Dialog.Destroy.Title"),
            },
            content: `<p>${game.i18n.localize("VISAGE.Dialog.Destroy.Content")}</p>`,
            modal: true,
        });
        if (!confirm) return;

        this._effects = this._effects.filter((e) => e.id !== id);
        if (this._activeEffectId === id) this._activeEffectId = null;

        // Let Media Controller handle killing the sound explicitly if deleted
        if (this._mediaController.audioPreviews.has(id)) {
            this._mediaController._stopSound(
                this._mediaController.audioPreviews.get(id),
            );
            this._mediaController.audioPreviews.delete(id);
        }

        this._markDirty();
        this.render();
    }
    async _onCloseEffectInspector() {
        this.element
            .querySelector(".effects-tab-container")
            ?.classList.remove("editing");
        this._activeEffectId = null;
        this._editingLight = false;
        this._editingRing = false;
        await this.render();
    }
    _onReplayPreview(event, target) {
        target
            .querySelector("i")
            ?.animate(
                [
                    { transform: "rotate(0deg)" },
                    { transform: "rotate(360deg)" },
                ],
                { duration: 500 },
            );
        this._mediaController.stopAll();
        this._updatePreview();
    }
    _onOpenSequencerDatabase() {
        if (VisageUtilities.hasSequencer) {
            new Sequencer.DatabaseViewer().render(true);
            ui.notifications.info(
                game.i18n.localize(
                    "VISAGE.Editor.Effects.DatabaseInstructions",
                ),
            );
        } else
            ui.notifications.warn(
                game.i18n.localize("VISAGE.Editor.Effects.DependencyTitle"),
            );
    }

    // ==========================================
    // 5. LIVE PREVIEW & DOM INJECTION
    // ==========================================

    async _updatePreview() {
        const fullState = this._prepareSaveData();
        const changes = fullState.changes;

        // 1. Fast DOM Updates (Inspector Text)
        this._fastUpdateInspectorDOM(changes);

        // 2. Generate Template Data
        const previewData = await this._buildPreviewTemplateData(changes);

        // 3. Render and Inject HTML
        const html = await foundry.applications.handlebars.renderTemplate(
            "modules/visage/templates/parts/visage-preview.hbs",
            previewData,
        );
        this._injectPreviewHTML(
            html,
            previewData.imgTransform,
            previewData.ringTransform,
            previewData.originStyle,
            changes,
        );

        // 4. Update UI Badges & Audio
        this._updateUIBadges(
            VisageData.toPresentation(
                { changes },
                { isWildcard: previewData.resolvedPath?.includes("*") },
            ).meta,
            changes,
        );
        this._mediaController.syncAudio(this._effects || [], this.rendered);
    }

    _fastUpdateInspectorDOM(changes) {
        const el = this.element;
        if (changes.light) {
            this._lightData = { ...this._lightData, ...changes.light };
            const meta = el.querySelector(
                '.effect-card.pinned-light[data-action="editLight"] .effect-meta',
            );
            if (meta && this._lightData.active)
                meta.textContent = `${this._lightData.dim} / ${this._lightData.bright} • ${this._lightData.color}`;
        }

        if (this._activeEffectId && this._effects) {
            const activeEffect = this._effects.find(
                (e) => e.id === this._activeEffectId,
            );
            if (activeEffect) {
                const card = el.querySelector(
                    `.effect-card[data-id="${activeEffect.id}"]`,
                );
                if (card) {
                    const nameEl = card.querySelector(".effect-name");
                    if (nameEl) nameEl.textContent = activeEffect.label;
                    const metaEl = card.querySelector(".effect-meta");
                    if (metaEl) {
                        metaEl.textContent =
                            activeEffect.type === "audio"
                                ? `Volume: ${Math.round((activeEffect.opacity ?? 1) * 100)}%`
                                : `${activeEffect.zOrder === "below" ? "Below" : "Above"} • ${Math.round((activeEffect.scale ?? 1) * 100)}%`;
                    }
                }
            }
        }
    }

    async _buildPreviewTemplateData(changes) {
        // Transformations Math
        const ringEnabled = changes.ring && changes.ring.enabled;
        const globalScale = changes.scale || 1.0;
        const subjectScale =
            ringEnabled && changes.ring.subject?.texture
                ? parseFloat(changes.ring.subject.scale) || 1.0
                : 1.0;
        const flipX = !!changes.mirrorX;
        const flipY = !!changes.mirrorY;
        const anchorX = changes.texture?.anchorX ?? 0.5;
        const anchorY = changes.texture?.anchorY ?? 0.5;
        const translateX = anchorX * 100;
        const translateY = anchorY * 100;
        const imgScaleX = globalScale * subjectScale * (flipX ? -1 : 1);
        const imgScaleY = globalScale * subjectScale * (flipY ? -1 : 1);

        const originStyle = `${translateX}% ${translateY}%`;
        const imgTransform = `translate(-${translateX}%, -${translateY}%) scale(${imgScaleX}, ${imgScaleY})`;
        const ringTransform = `translate(-${translateX}%, -${translateY}%) scale(${globalScale * 0.75})`;

        // Visual Stack Sorting
        const activeVisuals = (this._effects || []).filter(
            (e) => !e.disabled && e.type === "visual" && e.path,
        );
        const effectsBelow = activeVisuals
            .filter((e) => e.zOrder === "below")
            .map((e) => this._mediaController.prepareEffectStyle(e));
        const effectsAbove = activeVisuals
            .filter((e) => e.zOrder === "above")
            .map((e) => this._mediaController.prepareEffectStyle(e));

        // Path Resolution
        const rawPath =
            ringEnabled && changes.ring?.subject?.texture
                ? changes.ring.subject.texture
                : changes.texture?.src || "";
        const resolved = await VisageUtilities.resolvePath(rawPath);
        const context = VisageData.toPresentation(
            { changes },
            { isWildcard: rawPath.includes("*") },
        );

        // Lighting Math
        const lData = changes.light || {};
        const lMax = Math.max(lData.dim || 0, lData.bright || 0);
        const sizeRatio =
            lMax > 0
                ? (lMax * 2) /
                  (canvas.scene?.grid?.distance || 5) /
                  (changes.width || 1)
                : 1;
        const brightPct = lMax > 0 ? ((lData.bright || 0) / lMax) * 100 : 0;

        return {
            resolvedPath: resolved || rawPath,
            name: changes.name,
            hasCheckerboard: true,
            alpha: changes.alpha ?? 1.0,
            isVideo: context.isVideo,
            hasRing: context.meta.hasRing,
            hasInvisibility: context.meta.hasInvisibility,
            hasPulse: context.meta.hasPulse,
            hasGradient: context.meta.hasGradient,
            hasWave: context.meta.hasWave,
            ringColor: context.meta.ringColor,
            ringBkg: context.meta.ringBkg,
            hasLight: lData.active,
            lightColor:
                lData.luminosity < 0 ? "#000000" : lData.color || "#ffffff",
            lightAlpha: Math.min(
                1,
                (lData.alpha ?? 0.5) * (Math.abs(lData.luminosity ?? 0.5) * 2),
            ),
            lightDim: lData.dim,
            lightBright: lData.bright,
            lightSizePct: sizeRatio * 100,
            lightBrightPct: brightPct,
            lightAngle: lData.angle ?? 360,
            lightRotation: flipY ? 0 : 180,
            lightAnimType: lData.animation?.type || "",
            lightAnimDuration:
                Math.max(0.5, (11 - (lData.animation?.speed ?? 5)) * 0.35) +
                "s",
            lightAnimIntensity: (lData.animation?.intensity ?? 5) / 10,
            forceFlipX: context.isFlippedX,
            forceFlipY: context.isFlippedY,
            wrapperClass: "visage-preview-content stage-mode",
            effectsBelow,
            effectsAbove,
            originStyle,
            imgTransform,
            ringTransform,
        };
    }

    _injectPreviewHTML(
        html,
        imgTransform,
        ringTransform,
        originStyle,
        changes,
    ) {
        const stage = this.element.querySelector(".visage-live-preview-stage");
        if (!stage) return;

        // Preserve native controls before replacing HTML
        const controls = stage.querySelector(".visage-zoom-controls");
        const hint = stage.querySelector(".visage-stage-hint");
        const overlay = stage.querySelector(".stage-overlay-name");

        stage.innerHTML = html;
        if (controls) stage.appendChild(controls);
        if (hint) stage.appendChild(hint);
        if (overlay) stage.appendChild(overlay);

        // Apply Transforms
        const newImg = stage.querySelector(
            ".visage-preview-img, .visage-preview-video, .fallback-icon",
        );
        if (newImg) {
            newImg.style.transform = imgTransform;
            newImg.style.transformOrigin = originStyle;
            newImg.style.left = "50%";
            newImg.style.top = "50%";
        }

        const ringEl = stage.querySelector(".visage-ring-preview");
        if (ringEl) {
            ringEl.style.width = "100%";
            ringEl.style.height = "100%";
            ringEl.style.transform = ringTransform;
            ringEl.style.transformOrigin = originStyle;
            ringEl.style.left = "50%";
            ringEl.style.top = "50%";
            ringEl.style.position = "absolute";
        }

        // Apply grid dimension variables
        const newContent = stage.querySelector(
            ".visage-preview-content.stage-mode",
        );
        if (newContent) {
            newContent.style.setProperty("--visage-dim-w", changes.width || 1);
            newContent.style.setProperty("--visage-dim-h", changes.height || 1);
        }

        this._applyStageTransform();
        this._bindDynamicListeners(); // Re-bind mouse events on new HTML
    }

    _updateUIBadges(meta, changes) {
        if (!meta || !meta.slots) return;
        const el = this.element;

        const updateSlot = (selector, slotData) => {
            const container = el.querySelector(selector);
            if (!container) return;
            container.classList.toggle("inactive", !slotData.active);
            const valueSpan = container.querySelector(".meta-value");
            if (valueSpan && slotData.val !== undefined)
                valueSpan.textContent = slotData.val;
        };

        updateSlot(".meta-item:has(.visage-icon.scale)", meta.slots.scale);
        updateSlot(".meta-item:has(.visage-icon.dimensions)", meta.slots.dim);
        updateSlot(".meta-item:has(.visage-icon.lock)", meta.slots.lock);
        updateSlot(
            ".meta-item:has(.visage-icon.wildcard)",
            meta.slots.wildcard,
        );

        const dispContainer = el.querySelector(".meta-item.disposition-item");
        if (dispContainer && meta.slots.disposition) {
            const textSpan = dispContainer.querySelector(
                ".visage-disposition-text",
            );
            if (textSpan) {
                textSpan.textContent = meta.slots.disposition.val;
                textSpan.className = "visage-disposition-text";
                if (meta.slots.disposition.class)
                    textSpan.classList.add(meta.slots.disposition.class);
            }
        }

        const updateMirrorBadge = (type, slotData) => {
            const container = el.querySelector(`.mirror-sub-slot.${type}`);
            if (container && slotData) {
                container.classList.toggle("inactive", !slotData.active);
                const img = container.querySelector("img");
                if (img) {
                    if (slotData.src) img.src = slotData.src;
                    if (slotData.cls !== undefined)
                        img.className = `visage-icon-nav ${slotData.cls}`;
                }
            }
        };

        updateMirrorBadge("horizontal", meta.slots.flipH);
        updateMirrorBadge("vertical", meta.slots.flipV);
    }

    // -- Viewport Controls --
    _applyStageTransform() {
        const content = this.element.querySelector(
            ".visage-preview-content.stage-mode",
        );
        if (content)
            content.style.transform = `translate(${this._viewState.x}px, ${this._viewState.y}px) scale(${this._viewState.scale})`;
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
        this._viewState.scale = 1.0;
        this._viewState.x = 0;
        this._viewState.y = 0;
        this._applyStageTransform();
    }
    _onToggleGrid(event, target) {
        this._showGrid = !this._showGrid;
        const stage = this.element.querySelector(".visage-live-preview-stage");
        if (stage) stage.classList.toggle("show-grid", this._showGrid);
        const icon = target.querySelector("i");
        if (icon)
            icon.className = this._showGrid
                ? "visage-icon grid-off"
                : "visage-icon grid-on";
    }

    // ==========================================
    // 6. ISOLATED SUB-SYSTEMS & BINDINGS
    // ==========================================

    _bindTagInput() {
        const container = this.element.querySelector(".visage-tag-container");
        if (!container) return;
        const input = container.querySelector(".visage-tag-input");
        const hidden = container.querySelector("input[name='tags']");
        const pillsDiv = container.querySelector(".visage-tag-pills");

        const update = () => {
            hidden.value = Array.from(
                pillsDiv.querySelectorAll(".visage-tag-pill"),
            )
                .map((p) => p.dataset.tag)
                .join(",");
            this._markDirty();
        };
        const add = (text) => {
            const clean = text.trim();
            if (
                !clean ||
                Array.from(pillsDiv.querySelectorAll(".visage-tag-pill"))
                    .map((p) => p.dataset.tag.toLowerCase())
                    .includes(clean.toLowerCase())
            )
                return;
            const pill = document.createElement("span");
            pill.className = "visage-tag-pill";
            pill.dataset.tag = clean;
            pill.innerHTML = `${clean} <i class="fas fa-times"></i>`;
            pill.querySelector("i").addEventListener("click", () => {
                pill.remove();
                update();
            });
            pillsDiv.appendChild(pill);
            update();
        };

        if (hidden.value) hidden.value.split(",").forEach(add);

        input.addEventListener("keydown", (ev) => {
            if (["Enter", ",", "Tab"].includes(ev.key)) {
                ev.preventDefault();
                add(input.value);
                input.value = "";
            } else if (ev.key === "Backspace" && !input.value) {
                pillsDiv.lastElementChild?.remove();
                update();
            }
        });
        input.addEventListener("blur", () => {
            if (input.value.trim()) {
                add(input.value);
                input.value = "";
            }
            container.classList.remove("focused");
        });
        container.addEventListener("click", (e) => {
            if (e.target === container || e.target === pillsDiv) input.focus();
        });
    }

    _bindStaticListeners() {
        const stage = this.element.querySelector(".visage-live-preview-stage");
        if (stage)
            stage.addEventListener(
                "wheel",
                (e) => {
                    e.preventDefault();
                    this._viewState.scale = Math.min(
                        Math.max(
                            this._viewState.scale - Math.sign(e.deltaY) * 0.1,
                            0.1,
                        ),
                        5.0,
                    );
                    this._applyStageTransform();
                },
                { passive: false },
            );
    }

    _bindDynamicListeners() {
        const content = this.element.querySelector(
            ".visage-preview-content.stage-mode",
        );
        if (!content) return;
        content.onmousedown = (e) => {
            if (e.button !== 0 && e.button !== 1) return;
            e.preventDefault();
            this._viewState.isDragging = true;
            this._viewState.lastX = e.clientX;
            this._viewState.lastY = e.clientY;
            content.style.cursor = "grabbing";
        };
        if (!this._dragBound) {
            window.addEventListener("mousemove", (e) => {
                if (!this._viewState.isDragging) return;
                this._viewState.x += e.clientX - this._viewState.lastX;
                this._viewState.y += e.clientY - this._viewState.lastY;
                this._viewState.lastX = e.clientX;
                this._viewState.lastY = e.clientY;
                this._applyStageTransform();
            });
            window.addEventListener("mouseup", () => {
                if (this._viewState.isDragging) {
                    this._viewState.isDragging = false;
                    const c = this.element.querySelector(
                        ".visage-preview-content.stage-mode",
                    );
                    if (c) c.style.cursor = "grab";
                }
            });
            this._dragBound = true;
        }
    }

    _resetSliderDefault(ev) {
        let def = 0;
        const name = ev.target.name;
        if (name.includes("scale")) def = 100;
        if (name.includes("alpha") || name.includes("luminosity")) def = 0.5;
        if (name.includes("speed") || name.includes("intensity")) def = 5;
        if (name.includes("angle")) def = 360;
        if (
            name.includes("Volume") ||
            name.includes("Opacity") ||
            name.includes("ringSubjectScale")
        )
            def = 1;
        ev.target.value = def;
        const display = ev.target.nextElementSibling;
        if (display && display.tagName === "OUTPUT") display.value = def;
        this._markDirty();
        this._updatePreview();
    }

    _getStatusEffectOptions() {
        // Read from core Foundry config, format, and localize
        const effects = CONFIG.statusEffects.map((s) => ({
            value: s.id,
            label: game.i18n.localize(s.name),
        }));

        // Sort alphabetically by the localized label for better UX
        effects.sort((a, b) => a.label.localeCompare(b.label));
        return effects;
    }

    _getLightAnimationOptions() {
        return {
            "": game.i18n.localize("VISAGE.LightAnim.None"),
            torch: game.i18n.localize("VISAGE.LightAnim.Torch"),
            pulse: game.i18n.localize("VISAGE.LightAnim.Pulse"),
            chroma: game.i18n.localize("VISAGE.LightAnim.Chroma"),
            wave: game.i18n.localize("VISAGE.LightAnim.Wave"),
            fog: game.i18n.localize("VISAGE.LightAnim.Fog"),
            sunburst: game.i18n.localize("VISAGE.LightAnim.Sunburst"),
            dome: game.i18n.localize("VISAGE.LightAnim.Dome"),
            emanation: game.i18n.localize("VISAGE.LightAnim.Emanation"),
            hexa: game.i18n.localize("VISAGE.LightAnim.Hexa"),
            ghost: game.i18n.localize("VISAGE.LightAnim.Ghost"),
            energy: game.i18n.localize("VISAGE.LightAnim.Energy"),
            hole: game.i18n.localize("VISAGE.LightAnim.Hole"),
            vortex: game.i18n.localize("VISAGE.LightAnim.Vortex"),
            witchwave: game.i18n.localize("VISAGE.LightAnim.Witchwave"),
            rainbowswirl: game.i18n.localize("VISAGE.LightAnim.RainbowSwirl"),
            radialrainbow: game.i18n.localize("VISAGE.LightAnim.RadialRainbow"),
            fairy: game.i18n.localize("VISAGE.LightAnim.Fairy"),
            grid: game.i18n.localize("VISAGE.LightAnim.Grid"),
            starlight: game.i18n.localize("VISAGE.LightAnim.Starlight"),
            revolving: game.i18n.localize("VISAGE.LightAnim.Revolving"),
            siren: game.i18n.localize("VISAGE.LightAnim.Siren"),
            smokepatch: game.i18n.localize("VISAGE.LightAnim.SmokePatch"),
        };
    }

    _getLocalizedLightAnim() {
        const animType = this._lightData?.animation?.type || "";
        const animKey = `VISAGE.LightAnim.${animType.charAt(0).toUpperCase() + animType.slice(1)}`;
        let localizedAnim =
            animType && game.i18n.has(animKey)
                ? game.i18n.localize(animKey)
                : animType;
        return localizedAnim.replace(" (*)", "");
    }
}
