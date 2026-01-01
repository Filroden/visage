/**
 * @file Defines the VisageSelector application.
 * @module visage
 */

import { Visage } from "./visage.js";
import { VisageConfigApp } from "./visage-config.js";
import { VisageComposer } from "./visage-composer.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class VisageSelector extends HandlebarsApplicationMixin(ApplicationV2) {
    
    constructor(options = {}) {
        super(options);
        this.actorId = options.actorId;
        this.tokenId = options.tokenId;
        this.sceneId = options.sceneId;

        this._dispositionMap = {
            [-2]: { name: game.i18n.localize("VISAGE.Disposition.Secret"),   class: "secret"   },
            [-1]: { name: game.i18n.localize("VISAGE.Disposition.Hostile"),  class: "hostile"  },
            [0]:  { name: game.i18n.localize("VISAGE.Disposition.Neutral"),  class: "neutral"  },
            [1]:  { name: game.i18n.localize("VISAGE.Disposition.Friendly"), class: "friendly" }
        };
    }

    /** @override */
    static DEFAULT_OPTIONS = {
        tag: "div",
        id: "visage-selector",
        classes: ["visage", "visage-selector-app", "borderless"],
        position: { width: "auto", height: "auto" },
        window: { frame: false, positioned: true },
        actions: {
            selectVisage: VisageSelector.prototype._onSelectVisage,
            openConfig: VisageSelector.prototype._onOpenConfig,
            revertGlobal: VisageSelector.prototype._onRevertGlobal,
            removeLayer: VisageSelector.prototype._onRemoveLayer // Ensure this is mapped!
        }
    };

    /** @override */
    static PARTS = {
        form: {
            template: "modules/visage/templates/visage-selector.hbs",
            scrollable: [".visage-selector-grid-wrapper"] 
        }
    };

    async _onRevertGlobal(event, target) {
        const token = canvas.tokens.get(this.tokenId);
        if (!token) return;
        await VisageComposer.compose(token, []);
    }

    async _prepareContext(options) {
        const token = canvas.tokens.get(this.tokenId);
        if (!token || !token.actor) return { forms: [] };
        
        const actor = token.actor; 
        const ns = Visage.DATA_NAMESPACE;
        let defaults = actor.flags?.[ns]?.[this.tokenId]?.defaults;

        if (!defaults) return { forms: [] };

        const currentFormKey = actor.flags?.[ns]?.[this.tokenId]?.currentFormKey || "default";
        const forms = {};

        const defScaleRaw = defaults.scale ?? 1.0;
        const defScale = Math.abs(defScaleRaw);
        const defFlipX = defaults.isFlippedX ?? (defScaleRaw < 0);
        const defFlipY = defaults.isFlippedY ?? false;

        const getSmartData = (scale, width, height, isFlippedX, isFlippedY) => {
            const absScale = Math.abs(scale);
            const isScaleDefault = absScale === 1.0;
            const scaleLabel = isScaleDefault ? "" : `${Math.round(absScale * 100)}%`;
            const safeW = width || 1;
            const safeH = height || 1;
            const isSizeDefault = safeW === 1 && safeH === 1;
            const sizeLabel = isSizeDefault ? "" : `${safeW}x${safeH}`;
            const matchesDefault = (isFlippedX === defFlipX) && (isFlippedY === defFlipY);
            const showFlipBadge = !matchesDefault;
            const showDataChip = (scaleLabel !== "") || (sizeLabel !== "");
            return { scaleLabel, sizeLabel, showFlipBadge, showDataChip };
        };
        
        // --- 2. Prepare "Default" Visage ---
        {
            const defaultPath = defaults.token || "";
            const defWidth = defaults.width ?? 1; 
            const defHeight = defaults.height ?? 1;
            const smartData = getSmartData(defScale, defWidth, defHeight, defFlipX, defFlipY);
            const ringCtx = Visage.prepareRingContext(defaults.ring);

            forms["default"] = {
                key: "default",
                name: defaults.name || game.i18n.localize("VISAGE.Selector.Default"),
                path: defaultPath,
                isActive: currentFormKey === "default",
                isDefault: true,
                scale: defScale,
                isFlippedX: defFlipX,
                isFlippedY: defFlipY,
                forceFlipX: defFlipX,
                forceFlipY: defFlipY,
                showDataChip: smartData.showDataChip,
                showFlipBadge: smartData.showFlipBadge,
                sizeLabel: smartData.sizeLabel,
                scaleLabel: smartData.scaleLabel,
                isWildcard: defaultPath.includes('*'),
                showDispositionChip: false,
                isVideo: foundry.helpers.media.VideoHelper.hasVideoExtension(defaultPath),
                hasRing: ringCtx.enabled,
                ringColor: ringCtx.colors.ring,
                ringBkg: ringCtx.colors.background,
                hasPulse: ringCtx.hasPulse,
                hasGradient: ringCtx.hasGradient,
                hasWave: ringCtx.hasWave,
                hasInvisibility: ringCtx.hasInvisibility
            };
        }
        
        // --- 3. Process Alternate Visages ---
        const normalizedData = Visage.getVisages(actor);

        for (const data of normalizedData) {
            const isActive = data.id === currentFormKey;
            const c = data.changes; 
            const dispositionInfo = (c.disposition !== null) ? this._dispositionMap[c.disposition] : null;

            const scaleX = c.texture?.scaleX ?? 1.0;
            const scaleY = c.texture?.scaleY ?? 1.0;
            const absScale = Math.abs(scaleX);
            const isFlippedX = scaleX < 0;
            const isFlippedY = scaleY < 0;

            const smartData = getSmartData(absScale, c.width, c.height, isFlippedX, isFlippedY);
            const ringCtx = Visage.prepareRingContext(c.ring);

            forms[data.id] = {
                key: data.id,
                name: data.label,
                path: c.img, 
                scale: absScale,
                isActive: isActive,
                isDefault: false,
                isFlippedX: isFlippedX,
                isFlippedY: isFlippedY,
                forceFlipX: isFlippedX,
                forceFlipY: isFlippedY,
                showDataChip: smartData.showDataChip,
                showFlipBadge: smartData.showFlipBadge,
                sizeLabel: smartData.sizeLabel,
                scaleLabel: smartData.scaleLabel,
                isWildcard: (c.img || "").includes('*'),
                showDispositionChip: !!dispositionInfo,
                dispositionName: dispositionInfo?.name || "",
                dispositionClass: dispositionInfo?.class || "",
                hasRing: ringCtx.enabled,
                ringColor: ringCtx.colors.ring,
                ringBkg: ringCtx.colors.background,
                hasPulse: ringCtx.hasPulse,
                hasGradient: ringCtx.hasGradient,
                hasWave: ringCtx.hasWave,
                hasInvisibility: ringCtx.hasInvisibility,
                isVideo: foundry.helpers.media.VideoHelper.hasVideoExtension(c.img || "")
            };
        }

        // --- 4. Sort and Resolve ---
        const orderedForms = [forms["default"]];
        const alternateKeys = Object.keys(forms)
            .filter(k => k !== "default")
            .sort((a, b) => forms[a].name.localeCompare(forms[b].name));
            
        for(const key of alternateKeys) {
            orderedForms.push(forms[key]);
        }

        for (const form of orderedForms) {
            form.resolvedPath = await Visage.resolvePath(form.path);
        }

        // --- 5. PREPARE STACK DISPLAY ---
        const flags = token.document.flags[Visage.MODULE_ID] || {};
        const activeStack = flags.activeStack || flags.stack || [];
        
        const stackDisplay = activeStack.map(layer => {
            // Unpack Unified Model for display
            const img = layer.changes.img || layer.changes.texture?.src || "icons/svg/aura.svg";
            return {
                id: layer.id,
                label: layer.label,
                icon: img
            };
        }).reverse();

        return { 
            forms: orderedForms,
            activeStack: stackDisplay, 
            hasGlobalOverride: stackDisplay.length > 0 
        };
    }
    
    async _onSelectVisage(event, target) {
        const formKey = target.dataset.formKey;
        if (formKey) {
            await Visage.setVisage(this.actorId, this.tokenId, formKey);
            this.close();
        }
    }

    _onOpenConfig(event, target) {
        const configId = `visage-config-${this.actorId}-${this.tokenId}`;
        if (Visage.apps[configId]) {
            Visage.apps[configId].bringToTop();
        } else {
            const configApp = new VisageConfigApp({ 
                actorId: this.actorId, 
                tokenId: this.tokenId, 
                sceneId: this.sceneId, 
                id: configId 
            });
            configApp.render(true);
        }
        this.close();
    }

    /**
     * Handle removing a specific layer from the global stack.
     */
    async _onRemoveLayer(event, target) {
        const layerId = target.dataset.layerId;
        const token = canvas.tokens.get(this.tokenId);
        if (!token) return;

        // CHANGED: Use 'activeStack'
        const currentStack = token.document.getFlag(Visage.MODULE_ID, "activeStack") || [];
        const newStack = currentStack.filter(layer => layer.id !== layerId);

        // Re-compose
        await VisageComposer.compose(token, newStack);
    }

    _onClickAction(event, target) {
        const action = target.dataset.action;
        if (action === "selectVisage") this._onSelectVisage(event, target);
        else if (action === "openConfig") this._onOpenConfig(event, target);
        else if (action === "revertGlobal") this._onRevertGlobal(event, target);
        else if (action === "removeLayer") this._onRemoveLayer(event, target);
    }

    _onRender(context, options) {
        const rtlLanguages = ["ar", "he", "fa", "ur"];
        if (rtlLanguages.includes(game.i18n.lang)) {
            this.element.setAttribute("dir", "rtl");
            this.element.classList.add("rtl");
        }
        this._unbindDismissListeners();
        this._bindDismissListeners();
    }

    async close(options) {
        this._unbindDismissListeners();
        return super.close(options);
    }

    _bindDismissListeners() {
        this._onDocPointerDown = (ev) => {
            const root = this.element;
            if (!root) return;
            if (root.contains(ev.target)) return;
            const hudBtn = document.querySelector('.visage-button');
            if (hudBtn && (hudBtn === ev.target || hudBtn.contains(ev.target))) return;
            const configApp = ev.target.closest('.visage-config-app');
            if (configApp) return;
            this.close();
        };
        document.addEventListener('pointerdown', this._onDocPointerDown, true);
        this._onTokenUpdate = (document, change, options, userId) => {
            if (document.id === this.tokenId) {
                this.render();
            }
        };
        Hooks.on("updateToken", this._onTokenUpdate);
    }

    _unbindDismissListeners() {
        if (this._onDocPointerDown) {
            document.removeEventListener('pointerdown', this._onDocPointerDown, true);
            this._onDocPointerDown = null;
        }
        if (this._onTokenUpdate) {
            Hooks.off("updateToken", this._onTokenUpdate);
            this._onTokenUpdate = null;
        }
    }
}