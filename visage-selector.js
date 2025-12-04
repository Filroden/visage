/**
 * @file visage-selector.js
 * @description Defines the VisageSelector application.
 * @module visage
 */

import { Visage } from "./visage.js";
import { VisageConfigApp } from "./visage-config.js";

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
        classes: ["visage-selector-app", "borderless"],
        position: {
            width: "auto",
            height: "auto" 
        },
        window: {
            frame: false,
            positioned: true
        },
        actions: {
            selectVisage: VisageSelector.prototype._onSelectVisage,
            openConfig: VisageSelector.prototype._onOpenConfig
        }
    };

    /** @override */
    static PARTS = {
        form: {
            template: "modules/visage/templates/visage-selector.hbs",
            scrollable: [".visage-selector-grid-wrapper"] 
        }
    };

    /** @override */
    async _prepareContext(options) {
        const token = canvas.tokens.get(this.tokenId);
        if (!token || !token.actor) return { forms: [] };
        
        const actor = token.actor; 
        const ns = Visage.DATA_NAMESPACE;
        const moduleData = actor.flags?.[ns] || {};
        let tokenData = moduleData[this.tokenId] || {};
        let defaults = tokenData.defaults;

        if (!defaults) {
            const currentToken = canvas.tokens.get(this.tokenId);
            if (!currentToken) return { forms: [] };

            const updates = {};
            updates[`flags.${ns}.${this.tokenId}.defaults`] = {
                name: currentToken.document.name,
                token: currentToken.document.texture.src,
                scale: currentToken.document.texture.scaleX ?? 1.0,
                disposition: currentToken.document.disposition ?? 0,
                secret: currentToken.document.secret ?? false,
                ring: currentToken.document.ring ? currentToken.document.ring.toObject() : undefined
            };
            updates[`flags.${ns}.${this.tokenId}.currentFormKey`] = 'default';
            
            await actor.update(updates);
            defaults = actor.flags?.[ns]?.[this.tokenId]?.defaults;

            if (!defaults) {
                ui.notifications.error(game.i18n.format("VISAGE.Notifications.ErrorDefaultsFailed", { id: this.tokenId }));
                return { forms: [] };
            }
        }

        const currentFormKey = actor.flags?.[ns]?.[this.tokenId]?.currentFormKey || "default";
        const forms = {};
        
        // 1. Default visage setup
        {
            const defaultPath = defaults.token || "";
            forms["default"] = {
                key: "default",
                name: defaults.name || game.i18n.localize("VISAGE.Selector.Default"),
                path: defaultPath,
                isActive: currentFormKey === "default",
                isDefault: true,
                scale: 1.0,
                isFlippedX: false,
                displayScale: 100,
                showDataChip: true,
                absScale: 1,
                showScaleChip: false, 
                isWildcard: defaultPath.includes('*'),
                showDispositionChip: false,
                isSecret: false,
                hasRing: false
            };
        }
        
        // 2. Alternate visages processing
        const normalizedData = Visage.getVisages(actor);

        for (const data of normalizedData) {
            const isFlippedX = data.scale < 0;
            const absScale = Math.abs(data.scale);
            const displayScale = Math.round(absScale * 100);
            const showScaleChip = data.scale !== 1.0; 
            const isActive = data.id === currentFormKey;
            const showDataChip = isActive || showScaleChip || isFlippedX;
            const dispositionInfo = (data.disposition !== null) ? this._dispositionMap[data.disposition] : null;

            // Ring Logic
            const hasRing = data.ring?.enabled === true;
            let ringColor = "";
            let ringBkg = "";
            let hasPulse = false;
            let hasGradient = false;
            let hasWave = false;
            let hasInvisibility = false;
            
            if (hasRing) {
                ringColor = data.ring.colors?.ring || "#FFFFFF";
                ringBkg = data.ring.colors?.background || "#000000";
                const effects = data.ring.effects || 0;
                hasPulse = (effects & 2) !== 0;      // RING_PULSE = 2
                hasGradient = (effects & 4) !== 0;   // RING_GRADIENT = 4
                hasWave = (effects & 8) !== 0;       // BKG_WAVE = 8
                hasInvisibility = (effects & 16) !== 0; // NEW: INVISIBILITY = 16
            }

            forms[data.id] = {
                key: data.id,
                name: data.name,
                path: data.path,
                scale: data.scale,
                isActive: isActive,
                isDefault: false,
                isFlippedX: isFlippedX,
                displayScale: displayScale,
                showDataChip: showDataChip,
                showScaleChip: showScaleChip, 
                absScale: absScale,
                isWildcard: data.path.includes('*'),
                showDispositionChip: !!dispositionInfo,
                dispositionName: dispositionInfo?.name || "",
                dispositionClass: dispositionInfo?.class || "",
                hasRing: hasRing,
                ringColor: ringColor,
                ringBkg: ringBkg,
                hasPulse: hasPulse,
                hasGradient: hasGradient,
                hasWave: hasWave,
                hasInvisibility: hasInvisibility
            };
        }

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

        return { forms: orderedForms };
    }
    
    // ... (Actions, Render, Close, Listeners remain unchanged) ...
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

    _onRender(context, options) {
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
    }

    _unbindDismissListeners() {
        if (this._onDocPointerDown) {
            document.removeEventListener('pointerdown', this._onDocPointerDown, true);
            this._onDocPointerDown = null;
        }
    }
}