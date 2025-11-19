/**
 * @file visage-selector.js
 * @description Defines the VisageSelector application.
 * This class renders the grid of available visage options in a pop-out window
 * next to the token HUD, allowing users to select and apply them.
 * @module visage
 */

import { Visage } from "./visage.js";
import { VisageConfigApp } from "./visage-config.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The VisageSelector Application (V2).
 * Renders a small, borderless window with a grid of available visages.
 * * @extends {HandlebarsApplicationMixin(ApplicationV2)}
 */
export class VisageSelector extends HandlebarsApplicationMixin(ApplicationV2) {
    /**
     * @param {object} options - Application options.
     * @param {string} options.actorId - The ID of the Actor associated with the token.
     * @param {string} options.tokenId - The ID of the Token being modified.
     * @param {string} options.sceneId - The ID of the Scene containing the token.
     */
    constructor(options = {}) {
        super(options);
        this.actorId = options.actorId;
        this.tokenId = options.tokenId;
        this.sceneId = options.sceneId;

        /**
         * Mapping of internal disposition integers to display names and CSS classes.
         * @type {Object<number, {name: string, class: string}>}
         */
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

    /** * Prepares the data context for rendering the Handlebars template.
     * Fetches the token/actor data, handles default data creation if missing,
     * and normalizes legacy vs. new data structures.
     * * @override
     * @param {object} options - Render options.
     * @returns {Promise<object>} The data object for the template.
     */
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
                disposition: currentToken.document.disposition ?? 0
            };
            updates[`flags.${ns}.${this.tokenId}.currentFormKey`] = 'default';
            
            await actor.update(updates);
            defaults = actor.flags?.[ns]?.[this.tokenId]?.defaults;
            if (!defaults) return { forms: [] };
        }

        const currentFormKey = actor.flags?.[ns]?.[this.tokenId]?.currentFormKey || "default";
        const forms = {};
        
        // 1. Default visage
        {
            const defaultPath = defaults.token || "";
            forms["default"] = {
                key: "default",
                name: defaults.name || "Default",
                path: defaultPath,
                isActive: currentFormKey === "default",
                isDefault: true,
                scale: 1.0,
                isFlippedX: false,
                displayScale: 100,
                showScaleChip: false,
                absScale: 1,
                isWildcard: defaultPath.includes('*'),
                showDispositionChip: false,
                isSecret: false
            };
        }
        
        // 2. Alternate visages (Using Centralized Normalization)
        const normalizedData = Visage.getVisages(actor);

        for (const data of normalizedData) {
            const isFlippedX = data.scale < 0;
            const absScale = Math.abs(data.scale);
            const displayScale = Math.round(absScale * 100);
            const showScaleChip = data.scale !== 1;
            const dispositionInfo = (data.disposition !== null) ? this._dispositionMap[data.disposition] : null;

            forms[data.id] = {
                key: data.id,
                name: data.name,
                path: data.path,
                scale: data.scale,
                isActive: data.id === currentFormKey,
                isDefault: false,
                isFlippedX: isFlippedX,
                displayScale: displayScale,
                showScaleChip: showScaleChip,
                absScale: absScale,
                isWildcard: data.path.includes('*'),
                showDispositionChip: !!dispositionInfo,
                dispositionName: dispositionInfo?.name || "",
                dispositionClass: dispositionInfo?.class || "",
                isSecret: (data.disposition === -2)
            };
        }

        // Array construction (Default first, then sorted alternates)
        const orderedForms = [forms["default"]];
        // normalizedData is already sorted by name from Visage.getVisages
        for(const data of normalizedData) {
            orderedForms.push(forms[data.id]);
        }

        // Path resolution
        for (const form of orderedForms) {
            form.resolvedPath = await Visage.resolvePath(form.path);
        }

        return { forms: orderedForms };
    }
    
    /**
     * Action Handler: Select Visage
     * Triggered when a visage tile is clicked.
     * @param {Event} event - The click event.
     * @param {HTMLElement} target - The element with the data-action attribute.
     */
    async _onSelectVisage(event, target) {
        const formKey = target.dataset.formKey;
        if (formKey) {
            await Visage.setVisage(this.actorId, this.tokenId, formKey);
            this.close();
        }
    }

    /**
     * Action Handler: Open Configuration
     * Opens the Visage Config App to edit visages for this actor.
     * @param {Event} event - The click event.
     * @param {HTMLElement} target - The element with the data-action attribute.
     */
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

    /** @override */
    _onRender(context, options) {
        // Re-bind the click-away listener on every render
        this._unbindDismissListeners();
        this._bindDismissListeners();
    }

    /** @override */
    async close(options) {
        // Clean up listeners when closed
        this._unbindDismissListeners();
        return super.close(options);
    }

    /**
     * Binds a document-level listener to close the window if the user clicks outside of it.
     * @private
     */
    _bindDismissListeners() {
        this._onDocPointerDown = (ev) => {
            const root = this.element;
            if (!root) return;
            
            // Don't close if clicking inside the selector
            if (root.contains(ev.target)) return;
            
            // Don't close if clicking the HUD button that opened this
            const hudBtn = document.querySelector('.visage-button');
            if (hudBtn && (hudBtn === ev.target || hudBtn.contains(ev.target))) return;
            
            // Don't close if clicking inside the config app
            const configApp = ev.target.closest('.visage-config-app');
            if (configApp) return;

            this.close();
        };
        document.addEventListener('pointerdown', this._onDocPointerDown, true);
    }

    /**
     * Removes the document-level dismiss listener.
     * @private
     */
    _unbindDismissListeners() {
        if (this._onDocPointerDown) {
            document.removeEventListener('pointerdown', this._onDocPointerDown, true);
            this._onDocPointerDown = null;
        }
    }
}