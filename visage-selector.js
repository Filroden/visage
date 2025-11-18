/**
 * This file defines the VisageSelector class.
 * This class is a small, temporary Application window that pops up
 * next to the Token HUD.
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
            [-2]: { name: "Secret",   class: "secret"   },
            [-1]: { name: "Hostile",  class: "hostile"  },
            [0]:  { name: "Neutral",  class: "neutral"  },
            [1]:  { name: "Friendly", class: "friendly" }
        };
    }

    /** @override */
    static DEFAULT_OPTIONS = {
        tag: "div",
        id: "visage-selector",
        classes: ["visage-selector-app", "borderless"],
        position: {
            width: 200, // This sets the inline style
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

        // --- Failsafe: Create Default Data ---
        if (!defaults) {
            const currentToken = canvas.tokens.get(this.tokenId);
            if (!currentToken) return { forms: [] };

            const updates = {};
            updates[`flags.${ns}.${this.tokenId}.defaults`] = {
                name: currentToken.document.name,
                token: currentToken.document.texture.src,
                scale: currentToken.document.texture.scaleX ?? 1.0,
                disposition: currentToken.document.disposition ?? 0,
                secret: currentToken.document.secret ?? false
            };
            updates[`flags.${ns}.${this.tokenId}.currentFormKey`] = 'default';
            
            await actor.update(updates);
            defaults = actor.flags?.[ns]?.[this.tokenId]?.defaults;
            if (!defaults) return { forms: [] };
        }

        // --- Determine Which Data Source to Use ---
        // 1. Try New Structure (alternateVisages)
        // 2. Fallback to Old Structure (alternateImages)
        const rawVisages = moduleData.alternateVisages || moduleData.alternateImages || {};
        
        const currentFormKey = actor.flags?.[ns]?.[this.tokenId]?.currentFormKey || "default";
        const forms = {};
        
        // 1. Default visage
        {
            const scale = 1.0; 
            const defaultPath = defaults.token || "";

            forms["default"] = {
                key: "default",
                name: defaults.name || "Default",
                path: defaultPath,
                isActive: currentFormKey === "default",
                isDefault: true,
                scale: scale,
                isFlippedX: false,
                displayScale: 100,
                showScaleChip: false,
                absScale: 1,
                isWildcard: defaultPath.includes('*'),
                showDispositionChip: false,
                isSecret: false
            };
        }
        
        // 2. Alternate visages
        for (const [key, data] of Object.entries(rawVisages)) {
            const isObject = typeof data === 'object' && data !== null;
            
            // DATA NORMALIZATION: Handle New vs Old Structure
            let name = key; // Default to key (Old structure behavior)
            let path = data; // Default to data string (Old legacy behavior)
            let scale = 1.0;
            let disposition = null;
            let secret = false;

            if (isObject) {
                // If it's an object, extract properties safely
                // New Structure: has .name property
                // Old Structure: key IS the name
                name = data.name || key; 
                path = data.path || "";
                scale = data.scale ?? 1.0;
                
                // Handle legacy disposition `2` mapping
                disposition = (data.disposition !== undefined) ? data.disposition : null;
                if (disposition === 2) disposition = -2;
                
                secret = (data.secret === true);
            }

            const isFlippedX = scale < 0;
            const absScale = Math.abs(scale);
            const displayScale = Math.round(absScale * 100);
            const showScaleChip = scale !== 1;
            const dispositionInfo = (disposition !== null) ? this._dispositionMap[disposition] : null;

            forms[key] = {
                key: key, // This is the ID used for saving/loading
                name: name,
                path: path,
                scale: scale,
                isActive: key === currentFormKey,
                isDefault: false,
                isFlippedX: isFlippedX,
                displayScale: displayScale,
                showScaleChip: showScaleChip,
                absScale: absScale,
                isWildcard: path.includes('*'),
                showDispositionChip: !!dispositionInfo,
                dispositionName: dispositionInfo?.name || "",
                dispositionClass: dispositionInfo?.class || "",
                isSecret: secret
            };
        }

        // Sorting: Default first, then alphabetical by NAME (not key)
        const orderedForms = [forms["default"]];
        const alternateKeys = Object.keys(forms)
            .filter(k => k !== "default")
            .sort((a, b) => forms[a].name.localeCompare(forms[b].name));
            
        for(const key of alternateKeys) {
            orderedForms.push(forms[key]);
        }

        // Path resolution
        for (const form of orderedForms) {
            form.resolvedPath = await Visage.resolvePath(form.path);
        }

        return { forms: orderedForms };
    }

    // ... [Keep _onSelectVisage, _onOpenConfig, _onRender, close, listeners] ...
    // (These methods from the previous correct version remain unchanged)
    
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
            const configApp = new VisageConfigApp(this.actorId, this.tokenId, this.sceneId, { id: configId });
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