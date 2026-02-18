import { VisageData } from "./visage-data.js";
import { VisageUtilities } from "./visage-utilities.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class VisageEditor extends HandlebarsApplicationMixin(ApplicationV2) {
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
            lastY: 0,
        };

        this._effects = null;
        this._activeEffectId = null;
        this._audioPreviews = new Map();

        this._editingLight = false;
        this._editingRing = false;

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

    _bindDragDrop(html) {
        let dragSource = null;
        const cards = html.querySelectorAll(".effect-card");
        cards.forEach((card) => {
            if (
                card.classList.contains("pinned-light") ||
                card.dataset.action === "editRing"
            )
                return;
            card.addEventListener("dragstart", (ev) => {
                dragSource = card;
                ev.dataTransfer.effectAllowed = "move";
                ev.dataTransfer.setData("text/plain", card.dataset.id);
                ev.dataTransfer.setData("type", card.dataset.type);
                card.classList.add("dragging");
            });
            card.addEventListener("dragend", (ev) => {
                card.classList.remove("dragging");
                dragSource = null;
                html.querySelectorAll(".drag-over, .group-drag-over").forEach(
                    (el) => {
                        el.classList.remove("drag-over", "group-drag-over");
                    },
                );
            });
            card.addEventListener("dragenter", (ev) => ev.preventDefault());
            card.addEventListener("dragover", (ev) => {
                ev.preventDefault();
                const sourceType = dragSource?.dataset.type;
                const targetType = card.dataset.type;
                if (sourceType === "visual" && targetType === "visual")
                    card.classList.add("drag-over");
            });
            card.addEventListener("dragleave", (ev) => {
                card.classList.remove("drag-over");
            });
            card.addEventListener("drop", (ev) =>
                this._onDrop(
                    ev,
                    card.closest(".effect-group").dataset.group,
                    card.dataset.id,
                ),
            );
        });

        const groups = html.querySelectorAll(".effect-group");
        groups.forEach((group) => {
            if (
                group.dataset.group === "light" ||
                group.dataset.group === "ring"
            )
                return;
            group.addEventListener("dragenter", (ev) => ev.preventDefault());
            group.addEventListener("dragover", (ev) => {
                ev.preventDefault();
                const sourceType = dragSource?.dataset.type;
                const targetGroup = group.dataset.group;
                if (sourceType === "audio" && targetGroup !== "audio") return;
                if (sourceType === "visual" && targetGroup === "audio") return;
                group.classList.add("group-drag-over");
            });
            group.addEventListener("dragleave", (ev) => {
                group.classList.remove("group-drag-over");
            });
            group.addEventListener("drop", (ev) => {
                this._onDrop(ev, group.dataset.group, null);
            });
        });
    }

    async _onDrop(ev, targetGroup, targetId) {
        ev.preventDefault();
        ev.stopPropagation();

        const draggedId = ev.dataTransfer.getData("text/plain");
        if (!draggedId || draggedId === targetId) return;

        const draggedIndex = this._effects.findIndex((e) => e.id === draggedId);
        if (draggedIndex === -1) return;
        const draggedEffect = this._effects[draggedIndex];

        if (targetGroup === "above" && draggedEffect.type === "visual") {
            draggedEffect.zOrder = "above";
        } else if (targetGroup === "below" && draggedEffect.type === "visual") {
            draggedEffect.zOrder = "below";
        } else if (targetGroup === "audio" && draggedEffect.type !== "audio") {
            return;
        }

        this._effects.splice(draggedIndex, 1);

        if (targetId) {
            const originalTargetIndex = this._effects.findIndex(
                (e) => e.id === targetId,
            );
            this._effects.splice(originalTargetIndex, 0, draggedEffect);
        } else {
            let insertIndex = this._effects.length;
            if (targetGroup === "above" || targetGroup === "below") {
                const lastOfGroupIndex = this._effects.findLastIndex(
                    (e) => e.type === "visual" && e.zOrder === targetGroup,
                );
                if (lastOfGroupIndex !== -1) insertIndex = lastOfGroupIndex + 1;
            } else if (targetGroup === "audio") {
                const lastAudioIndex = this._effects.findLastIndex(
                    (e) => e.type === "audio",
                );
                if (lastAudioIndex !== -1) insertIndex = lastAudioIndex + 1;
            }
            this._effects.splice(insertIndex, 0, draggedEffect);
        }

        this._markDirty();
        this._updatePreview();
        await this.render();
    }

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
                data = visages.find((v) => v.id === this.visageId);
                if (!data) return this.close();
            } else {
                data = VisageData.getGlobal(this.visageId);
                if (!data) return this.close();
            }
            this._currentLabel = data.label;
        } else {
            if (this.isLocal) {
                const token =
                    canvas.tokens.get(this.tokenId) ||
                    this.actor.prototypeToken;
                const tokenDoc = token.document || token;
                data = VisageData.getDefaultAsVisage(tokenDoc);
                data.label = "New Visage";
                data.id = null;
            } else {
                data = {
                    label: game.i18n.localize(
                        "VISAGE.GlobalEditor.TitleNew.Global",
                    ),
                    category: "",
                    tags: [],
                    changes: {},
                    public: false,
                };
            }
            this._currentLabel = "";
        }

        if (this._preservedData) {
            data = foundry.utils.mergeObject(data, this._preservedData, {
                inplace: false,
            });
        }

        let currentMode = data.mode || (this.isLocal ? "identity" : "overlay");
        const isPublic = data.public ?? false;
        const c = data.changes || {};

        if (this._effects === null) {
            this._effects = c.effects ? foundry.utils.deepClone(c.effects) : [];
        }

        if (this._lightData === null) {
            if (c.light) {
                this._lightData = { active: true, ...c.light };
            } else {
                this._lightData = {
                    active: false,
                    dim: 0,
                    bright: 0,
                    color: "#ffffff",
                    alpha: 0.5,
                    angle: 360,
                    luminosity: 0.5,
                    priority: 0,
                    animation: { type: "", speed: 5, intensity: 5 },
                };
            }
        }

        // Initialize Ring Data Memory
        if (this._ringData === null) {
            const defaults = {
                enabled: false,
                colors: { ring: "#ffffff", background: "#000000" },
                subject: { texture: "", scale: 1.0 },
                effects: 0,
            };

            if (c.ring) {
                this._ringData = foundry.utils.mergeObject(defaults, c.ring, {
                    inplace: false,
                });
                this._ringData.enabled = !!c.ring.enabled;
            } else {
                this._ringData = defaults;
            }
        }

        if (this._delayData === 0 && c.delay !== undefined) {
            this._delayData = c.delay;
        }

        const rawImg = c.texture?.src || "";
        const resolvedImg = await VisageUtilities.resolvePath(rawImg);

        const context = VisageData.toPresentation(data, {
            isWildcard: rawImg.includes("*"),
            isActive: false,
        });

        const allVisages = VisageData.globals;
        const categorySet = new Set();
        const tagSet = new Set();
        allVisages.forEach((v) => {
            if (v.category) categorySet.add(v.category);
            if (v.tags && Array.isArray(v.tags))
                v.tags.forEach((t) => tagSet.add(t));
        });

        const prep = (val, def) => ({
            value: val ?? def,
            active:
                val !== null &&
                val !== undefined &&
                (typeof val !== "string" || val !== ""),
        });

        // -- Ring Context --
        const ringContext = VisageData.prepareRingContext(this._ringData);

        const lightAnimationOptions = this._getLightAnimationOptions();

        const formatEffect = (e) => ({
            ...e,
            icon:
                e.type === "audio" ? "visage-icon audio" : "visage-icon visual",
            metaLabel:
                e.type === "audio"
                    ? `Volume: ${Math.round((e.opacity ?? 1) * 100)}%`
                    : `${e.zOrder === "below" ? "Below" : "Above"} • ${Math.round((e.scale ?? 1) * 100)}%`,
        });

        const effectsAbove = this._effects
            .filter((e) => e.type === "visual" && e.zOrder === "above")
            .map(formatEffect);
        const effectsBelow = this._effects
            .filter((e) => e.type === "visual" && e.zOrder === "below")
            .map(formatEffect);
        const effectsAudio = this._effects
            .filter((e) => e.type === "audio")
            .map(formatEffect);

        let inspectorData = {
            hasEffects:
                this._effects.length > 0 ||
                this._lightData.active ||
                this._ringData.enabled,
            effectsAbove,
            effectsBelow,
            effectsAudio,
            type: null,
        };

        if (this._editingRing) {
            inspectorData.type = "ring";
        } else if (this._editingLight) {
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
                    scale: Math.round((effect.scale ?? 1.0) * 100),
                    opacity: effect.opacity ?? 1.0,
                    rotation: effect.rotation ?? 0,
                    rotationRandom: effect.rotationRandom ?? false,
                    zOrder: effect.zOrder ?? "above",
                    blendMode: effect.blendMode || "normal",
                    type: effect.type,
                    loop: effect.loop ?? true,
                });
            }
        }

        const gridDist = canvas.scene?.grid?.distance || 5;
        const tokenWidthUnits = c.width || 1;
        const lMax = Math.max(
            this._lightData?.dim || 0,
            this._lightData?.bright || 0,
        );
        const sizeRatio =
            lMax > 0 ? (lMax * 2) / gridDist / tokenWidthUnits : 1;
        const brightPct =
            lMax > 0 ? ((this._lightData?.bright || 0) / lMax) * 100 : 0;

        const animType = this._lightData.animation?.type || "";
        const animKey = `VISAGE.LightAnim.${animType.charAt(0).toUpperCase() + animType.slice(1)}`;
        let localizedAnim =
            animType && game.i18n.has(animKey)
                ? game.i18n.localize(animKey)
                : animType;
        if (localizedAnim.endsWith(" (*)"))
            localizedAnim = localizedAnim.replace(" (*)", "");
        const speed = this._lightData.animation?.speed ?? 5;
        const animDuration = Math.max(0.5, (11 - speed) * 0.35) + "s";

        const anchorXVal = c.texture?.anchorX ?? 0.5;
        const anchorYVal = c.texture?.anchorY ?? 0.5;
        const isAnchorActive =
            c.texture?.anchorX != null || c.texture?.anchorY != null;
        const alphaVal =
            c.alpha !== undefined && c.alpha !== null
                ? Math.round(c.alpha * 100)
                : 100;
        const delaySeconds = Math.abs(this._delayData) / 1000;
        const delayDirection = this._delayData >= 0 ? "after" : "before";

        return {
            ...context,
            isEdit: !!this.visageId,
            isLocal: this.isLocal,
            isDirty: this.isDirty,
            isPublic: isPublic,
            categories: Array.from(categorySet).sort(),
            allTags: Array.from(tagSet).sort(),
            tagsString: (data.tags || []).join(","),
            mode: currentMode,
            appId: this.id,
            tabs: {
                appearance: { active: this._activeTab === "appearance" },
                effects: { active: this._activeTab === "effects" },
                triggers: { active: this._activeTab === "triggers" },
            },
            img: prep(rawImg, ""),
            portrait: prep(c.portrait, ""),
            light: { ...this._lightData, localizedAnimation: localizedAnim },
            lightAnimationOptions,

            // FIX: Apply _ringData FIRST, then overwrite with ringContext.
            // This ensures ringContext.effects (Array) overwrites _ringData.effects (Int),
            // making the checkboxes visible again.
            ring: {
                ...this._ringData,
                ...ringContext,
                active: this._ringData.enabled,
            },

            inspector: inspectorData,
            delay: { value: delaySeconds, direction: delayDirection },
            scale: {
                value: Math.round((c.scale ?? 1.0) * 100),
                active: c.scale != null,
            },
            anchor: { active: isAnchorActive, x: anchorXVal, y: anchorYVal },
            isFlippedX: { value: c.mirrorX, active: c.mirrorX != null },
            isFlippedY: { value: c.mirrorY, active: c.mirrorY != null },
            alpha: { value: alphaVal, active: c.alpha != null },
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
            preview: {
                ...context.meta,
                img: resolvedImg || rawImg,
                isVideo: context.isVideo,
                flipX: context.isFlippedX,
                flipY: context.isFlippedY,
                tagList: data.tags || [],
                alpha: c.alpha ?? 1.0,
                hasLight: this._lightData.active,
                lightColor: this._lightData.color,
                lightAlpha: this._lightData.alpha ?? 0.5,
                lightDim: this._lightData.dim,
                lightBright: this._lightData.bright,
                lightSizePct: sizeRatio * 100,
                lightBrightPct: brightPct,
                lightAnimType: animType,
                lightAnimDuration: animDuration,
            },
        };
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

    async _updatePreview() {
        const fullState = this._prepareSaveData();
        const changes = fullState.changes;
        const el = this.element;

        const get = (path) => foundry.utils.getProperty(fullState, path);

        if (changes.light) {
            this._lightData = { ...this._lightData, ...changes.light };
            const lightCard = el.querySelector(
                '.effect-card.pinned-light[data-action="editLight"]',
            );
            if (lightCard) {
                const meta = lightCard.querySelector(".effect-meta");
                if (meta && this._lightData.active) {
                    meta.textContent = `${this._lightData.dim} / ${this._lightData.bright} • ${this._lightData.color}`;
                }
            }
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
                        const metaLabel =
                            activeEffect.type === "audio"
                                ? `Volume: ${Math.round((activeEffect.opacity ?? 1) * 100)}%`
                                : `${activeEffect.zOrder === "below" ? "Below" : "Above"} • ${Math.round((activeEffect.scale ?? 1) * 100)}%`;
                        metaEl.textContent = metaLabel;
                    }
                }
            }
        }

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
        const ringScaleTotal = globalScale * 0.75;

        const originStyle = `${translateX}% ${translateY}%`;
        const imgTransform = `translate(-${translateX}%, -${translateY}%) scale(${imgScaleX}, ${imgScaleY})`;
        const ringTransform = `translate(-${translateX}%, -${translateY}%) scale(${ringScaleTotal})`;

        const activeVisuals = (this._effects || []).filter(
            (e) => !e.disabled && e.type === "visual" && e.path,
        );
        const effectsBelow = activeVisuals
            .filter((e) => e.zOrder === "below")
            .map((e) => this._prepareEffectStyle(e));
        const effectsAbove = activeVisuals
            .filter((e) => e.zOrder === "above")
            .map((e) => this._prepareEffectStyle(e));

        const subjectTexture = changes.ring?.subject?.texture;
        const mainImage = changes.texture?.src || "";
        const rawPath =
            ringEnabled && subjectTexture ? subjectTexture : mainImage;
        const resolved = await VisageUtilities.resolvePath(rawPath);

        const context = VisageData.toPresentation(
            { changes: changes },
            { isWildcard: rawPath.includes("*") },
        );
        const meta = context.meta;

        const lData = changes.light || {};
        const lMax = Math.max(lData.dim || 0, lData.bright || 0);
        const gridDist = canvas.scene?.grid?.distance || 5;
        const sizeRatio =
            lMax > 0 ? (lMax * 2) / gridDist / (changes.width || 1) : 1;
        const brightPct = lMax > 0 ? ((lData.bright || 0) / lMax) * 100 : 0;

        const previewData = {
            resolvedPath: resolved || rawPath,
            name: changes.name,
            hasCheckerboard: true,
            alpha: changes.alpha ?? 1.0,
            isVideo: context.isVideo,
            hasRing: meta.hasRing,
            hasInvisibility: meta.hasInvisibility,
            hasPulse: meta.hasPulse,
            hasGradient: meta.hasGradient,
            hasWave: meta.hasWave,
            ringColor: meta.ringColor,
            ringBkg: meta.ringBkg,
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
        };

        const html = await foundry.applications.handlebars.renderTemplate(
            "modules/visage/templates/parts/visage-preview.hbs",
            previewData,
        );

        const stage = el.querySelector(".visage-live-preview-stage");
        if (stage) {
            const controls = stage.querySelector(".visage-zoom-controls");
            const hint = stage.querySelector(".visage-stage-hint");
            const overlay = stage.querySelector(".stage-overlay-name");

            stage.innerHTML = html;

            if (controls) stage.appendChild(controls);
            if (hint) stage.appendChild(hint);
            if (overlay) stage.appendChild(overlay);

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

            this._applyStageTransform();
            this._bindDynamicListeners();

            const newContent = stage.querySelector(
                ".visage-preview-content.stage-mode",
            );
            if (newContent) {
                newContent.style.setProperty(
                    "--visage-dim-w",
                    changes.width || 1,
                );
                newContent.style.setProperty(
                    "--visage-dim-h",
                    changes.height || 1,
                );
            }
        }

        this._syncAudioPreviews();
        this._updateUIBadges(meta, changes);
    }

    _onToggleRing(event, target) {
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

    _onEditRing(event, target) {
        this._editingRing = true;
        this._editingLight = false;
        this._activeEffectId = null;
        this.render();
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
        this._editingRing = false;
        this._activeEffectId = null;
        this.render();
    }

    _onEditEffect(event, target) {
        const card = target.closest(".effect-card");
        this._activeEffectId = card.dataset.id;
        this._editingLight = false;
        this._editingRing = false;
        this.render();
    }

    async _onCloseEffectInspector(event, target) {
        const container = this.element.querySelector(".effects-tab-container");
        if (container) container.classList.remove("editing");
        this._activeEffectId = null;
        this._editingLight = false;
        this._editingRing = false;
        await this.render();
    }

    _onResetSettings(event, target) {
        const checkboxes = this.element.querySelectorAll(
            'input[type="checkbox"][name$="_active"]',
        );
        checkboxes.forEach((cb) => {
            cb.checked = false;
            this._onToggleField(null, cb);
        });

        if (this._ringData) {
            this._ringData = {
                enabled: false,
                colors: { ring: "#ffffff", background: "#000000" },
                subject: { texture: "", scale: 1.0 },
                effects: 0,
            };
        }
        if (this._lightData) this._lightData.active = false;
        this._editingRing = false;
        this._editingLight = false;

        const selects = this.element.querySelectorAll("select");
        selects.forEach((s) => (s.value = ""));
        const alphaInput = this.element.querySelector('input[name="alpha"]');
        if (alphaInput) alphaInput.value = 100;

        this._effects = [];
        this._activeEffectId = null;

        this._markDirty();
        this._updatePreview();
        this.render();
        ui.notifications.info(
            game.i18n.localize("VISAGE.Notifications.SettingsReset"),
        );
    }

    _onToggleField(event, target) {
        const fieldName = target.dataset.target;
        const group = target.closest(".form-group");

        let inputs;
        if (fieldName === "anchor") {
            inputs = group.querySelectorAll(
                '[name="anchorX"], [name="anchorY"]',
            );
        } else {
            inputs = group.querySelectorAll(`[name="${fieldName}"]`);
        }

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

    _syncAudioPreviews() {
        const activeAudioEffects = (this._effects || []).filter(
            (e) => !e.disabled && e.type === "audio" && e.path,
        );
        const activeIds = new Set(activeAudioEffects.map((e) => e.id));

        for (const [id, sound] of this._audioPreviews) {
            if (!activeIds.has(id)) {
                if (sound && typeof sound.stop === "function") sound.stop();
                this._audioPreviews.delete(id);
            }
        }

        activeAudioEffects.forEach((e) => {
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

                const playPromise = foundry.audio.AudioHelper.play(
                    {
                        src: resolvedPath,
                        volume: vol,
                        loop: e.loop ?? true,
                    },
                    false,
                ).then((sound) => {
                    const currentEffect = (this._effects || []).find(
                        (fx) => fx.id === e.id,
                    );
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

    _prepareSaveData() {
        const formData = new foundry.applications.ux.FormDataExtended(
            this.element,
        ).object;
        const getVal = (key, type = String) => {
            const val = foundry.utils.getProperty(formData, key);
            if (val === "" || val === null || val === undefined) return null;
            return type(val);
        };

        const payload = {
            id: this.visageId,
            label: formData.label,
            category: formData.category,
            tags: formData.tags
                ? formData.tags.split(",").filter((t) => t.trim())
                : [],
            mode: formData.mode,
            public: formData.public === "true",
            changes: {
                name: formData.nameOverride_active
                    ? formData.nameOverride
                    : null,
                texture: {
                    src: formData.img_active ? formData.img : null,
                    scaleX: null,
                    scaleY: null,
                    anchorX: formData.anchor_active
                        ? parseFloat(formData.anchorX)
                        : null,
                    anchorY: formData.anchor_active
                        ? parseFloat(formData.anchorY)
                        : null,
                },
                scale: formData.scale_active
                    ? getVal("scale", Number) / 100
                    : null,
                mirrorX:
                    formData.isFlippedX === ""
                        ? null
                        : formData.isFlippedX === "true",
                mirrorY:
                    formData.isFlippedY === ""
                        ? null
                        : formData.isFlippedY === "true",
                alpha: formData.alpha_active
                    ? getVal("alpha", Number) / 100
                    : null,
                rotation: null,
                tint: null,
                width: formData.width_active ? getVal("width", Number) : null,
                height: formData.height_active
                    ? getVal("height", Number)
                    : null,
                lockRotation:
                    formData.lockRotation === ""
                        ? null
                        : formData.lockRotation === "true",
                disposition: formData.disposition_active
                    ? getVal("disposition", Number)
                    : null,
                portrait: formData.portrait_active ? formData.portrait : null,
                light: this._lightData.active ? this._lightData : null,
                delay: this._delayData,
                effects: this._effects,
                ring: null,
            },
        };

        // FIX: Start with internal memory state (Source of Truth)
        let newRing = foundry.utils.deepClone(this._ringData);

        // FIX: Only overwrite if we are currently editing AND the fields actually exist in the form.
        // This prevents the "null overwrite" when opening the inspector for the first time.
        if (this._editingRing && formData.ringColor !== undefined) {
            let effectsMask = 0;
            for (const [k, v] of Object.entries(formData)) {
                if (k.startsWith("effect_") && v === true) {
                    effectsMask |= parseInt(k.split("_")[1]);
                }
            }
            newRing.colors.ring = formData.ringColor;
            newRing.colors.background = formData.ringBackgroundColor;
            newRing.subject.texture = formData.ringSubjectTexture;
            newRing.subject.scale = formData.ringSubjectScale;
            newRing.effects = effectsMask;

            // Persist DOM changes to memory
            this._ringData = newRing;
        }

        payload.changes.ring = newRing;

        return payload;
    }

    async _onSave(event, target) {
        event.preventDefault();

        const payload = this._prepareSaveData();

        if (!payload.label) {
            return ui.notifications.warn(
                game.i18n.localize("VISAGE.Notifications.LabelRequired"),
            );
        }

        try {
            await VisageData.save(payload, this.isLocal ? this.actor : null);
            if (this.visageId)
                ui.notifications.info(
                    game.i18n.format("VISAGE.Notifications.Updated", {
                        name: payload.label,
                    }),
                );
            else
                ui.notifications.info(
                    game.i18n.format("VISAGE.Notifications.Created", {
                        name: payload.label,
                    }),
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
            const btn = this.element.querySelector(".visage-save");
            if (btn) btn.classList.add("dirty");
        }
    }

    _resolveEffectPath(rawPath) {
        if (!rawPath) return null;
        const isDbKey = VisageUtilities.hasSequencer && !rawPath.includes("/");
        if (isDbKey) {
            const entry = this._resolveSequencerRecursively(rawPath);
            if (entry) {
                let file = Array.isArray(entry)
                    ? entry[Math.floor(Math.random() * entry.length)]
                    : entry.file
                      ? entry.file
                      : entry;
                if (Array.isArray(file))
                    file = file[Math.floor(Math.random() * file.length)];
                if (file && typeof file === "object" && file.file)
                    file = file.file;
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
                const randomKey =
                    children[Math.floor(Math.random() * children.length)];
                return this._resolveSequencerRecursively(randomKey, depth + 1);
            }
        } catch (e) {
            /* Ignore errors, likely due to invalid path */
        }
        return null;
    }

    _prepareEffectStyle(effect) {
        const resolvedPath = this._resolveEffectPath(effect.path);
        const isVideo = resolvedPath
            ? VisageUtilities.isVideo(resolvedPath)
            : false;
        return {
            ...effect,
            resolvedPath,
            isVideo,
            style: `transform: translate(-50%, -50%) scale(${effect.scale}) rotate(${effect.rotation}deg); opacity: ${effect.opacity}; mix-blend-mode: ${effect.blendMode || "normal"}; filter: ${effect.tint ? `drop-shadow(0 0 0 ${effect.tint})` : "none"};`,
        };
    }

    _onToggleDelayDirection(event, target) {
        const val = target.dataset.value;
        const btns = this.element.querySelectorAll(
            ".delay-direction-toggle button",
        );
        btns.forEach((b) => b.classList.remove("active"));
        target.classList.add("active");
        const secondsInput = this.element.querySelector(
            'range-picker[name="delayValue"]',
        );
        const seconds = parseFloat(secondsInput.value) || 0;
        const direction = val === "after" ? 1 : -1;
        this._delayData = Math.round(seconds * 1000) * direction;
        this._markDirty();
    }

    _onRender(context, options) {
        VisageUtilities.applyVisageTheme(this.element, this.isLocal);

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

        this.element
            .querySelectorAll('input[type="range"]')
            .forEach((slider) => {
                slider.addEventListener("input", () => {
                    this._markDirty();
                    debouncedUpdate();
                });
                slider.addEventListener("dblclick", (ev) => {
                    let def = 0;
                    const name = ev.target.name;
                    if (name.includes("scale")) def = 100;
                    if (name.includes("alpha") || name.includes("luminosity"))
                        def = 0.5;
                    if (name.includes("speed") || name.includes("intensity"))
                        def = 5;
                    if (name.includes("angle")) def = 360;
                    if (
                        name.includes("Volume") ||
                        name.includes("Opacity") ||
                        name.includes("ringSubjectScale")
                    )
                        def = 1;
                    ev.target.value = def;
                    const display = ev.target.nextElementSibling;
                    if (display && display.tagName === "OUTPUT")
                        display.value = def;
                    this._markDirty();
                    this._updatePreview();
                });
            });

        this.element.addEventListener("input", () => this._markDirty());
        this._bindTagInput();
        this._bindDragDrop(this.element);

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
            if (btn) {
                btn.classList.remove("grid-on");
                btn.classList.add("grid-off");
            }
        }
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

    _bindTagInput() {
        const container = this.element.querySelector(".visage-tag-container");
        if (!container) return;
        const input = container.querySelector(".visage-tag-input");
        const hidden = container.querySelector("input[name='tags']");
        const pillsDiv = container.querySelector(".visage-tag-pills");

        const update = () => {
            const tags = Array.from(
                pillsDiv.querySelectorAll(".visage-tag-pill"),
            ).map((p) => p.dataset.tag);
            hidden.value = tags.join(",");
            this._markDirty();
        };
        const add = (text) => {
            const clean = text.trim();
            if (!clean) return;
            const existing = Array.from(
                pillsDiv.querySelectorAll(".visage-tag-pill"),
            ).map((p) => p.dataset.tag.toLowerCase());
            if (existing.includes(clean.toLowerCase())) return;
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

        if (hidden.value) hidden.value.split(",").forEach((t) => add(t));

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
        input.addEventListener("focus", () =>
            container.classList.add("focused"),
        );
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
        if (!stage) return;
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
        const icon = target.querySelector("i");
        if (stage) stage.classList.toggle("show-grid", this._showGrid);
        if (icon) {
            icon.className = this._showGrid
                ? "visage-icon grid-off"
                : "visage-icon grid-on";
        }
    }

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

    _onToggleLoop(event, target) {
        const card = target.closest(".effect-card");
        const effect = this._effects.find((e) => e.id === card.dataset.id);
        if (effect) {
            effect.loop = !(effect.loop ?? true);
            this._markDirty();
            this.render();
        }
    }

    _onToggleEffect(event, target) {
        const card = target.closest(".effect-card");
        const effect = this._effects.find((e) => e.id === card.dataset.id);
        if (effect) {
            effect.disabled = !effect.disabled;
            this._markDirty();
            this.render();
        }
    }

    async _onDeleteEffect(event, target) {
        const card = target.closest(".effect-card");
        const id = card.dataset.id;
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
        if (this._audioPreviews.has(id)) {
            const sound = this._audioPreviews.get(id);
            if (sound && typeof sound.stop === "function") sound.stop();
            this._audioPreviews.delete(id);
        }
        this._markDirty();
        this.render();
    }

    _onReplayPreview(event, target) {
        const icon = target.querySelector("i");
        if (icon)
            icon.animate(
                [
                    { transform: "rotate(0deg)" },
                    { transform: "rotate(360deg)" },
                ],
                { duration: 500 },
            );
        for (const [id, sound] of this._audioPreviews) {
            if (sound && typeof sound.stop === "function") sound.stop();
        }
        this._audioPreviews.clear();
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
        } else {
            ui.notifications.warn(
                game.i18n.localize("VISAGE.Editor.Effects.DependencyTitle"),
            );
        }
    }

    _updateUIBadges(meta, changes) {
        if (!meta || !meta.slots) return;
        const el = this.element;

        const updateSlot = (selector, slotData) => {
            const container = el.querySelector(selector);
            if (!container) return;
            if (slotData.active) container.classList.remove("inactive");
            else container.classList.add("inactive");
            const valueSpan = container.querySelector(".meta-value");
            if (valueSpan && slotData.val !== undefined) {
                valueSpan.textContent = slotData.val;
            }
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
                if (meta.slots.disposition.class) {
                    textSpan.classList.add(meta.slots.disposition.class);
                }
            }
        }

        const updateMirrorBadge = (type, slotData) => {
            const container = el.querySelector(`.mirror-sub-slot.${type}`);
            if (container && slotData) {
                container.classList.toggle("inactive", !slotData.active);
                const img = container.querySelector("img");
                if (img) {
                    if (slotData.src) img.src = slotData.src;
                    if (slotData.cls !== undefined) {
                        img.className = `visage-icon-nav ${slotData.cls}`;
                    }
                }
            }
        };

        updateMirrorBadge("horizontal", meta.slots.flipH);
        updateMirrorBadge("vertical", meta.slots.flipV);
    }

    async close(options) {
        for (const [id, sound] of this._audioPreviews) {
            if (sound && typeof sound.stop === "function") sound.stop();
        }
        this._audioPreviews.clear();
        return super.close(options);
    }
}
