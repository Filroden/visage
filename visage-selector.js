/**
 * @file Defines the VisageSelector application, which provides a quick-selection UI for changing visages from the Token HUD.
 * @module visage
 */

import { Visage } from "./visage.js";
import { VisageConfigApp } from "./visage-config.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * A pop-up application that allows users to quickly select a visage for a token.
 * It appears next to the Token HUD and displays a grid of available visages.
 * @extends {HandlebarsApplicationMixin(ApplicationV2)}
 */
export class VisageSelector extends HandlebarsApplicationMixin(ApplicationV2) {
    /**
     * @param {object} [options={}] - Application configuration options.
     * @param {string} options.actorId - The ID of the actor.
     * @param {string} options.tokenId - The ID of the token.
     * @param {string} options.sceneId - The ID of the scene.
     */
    constructor(options = {}) {
        super(options);
        
        /**
         * The ID of the actor being targeted.
         * @type {string}
         * @protected
         */
        this.actorId = options.actorId;

        /**
         * The ID of the token being targeted.
         * @type {string}
         * @protected
         */
        this.tokenId = options.tokenId;

        /**
         * The ID of the scene the token is in.
         * @type {string}
         * @protected
         */
        this.sceneId = options.sceneId;

        /**
         * A map to translate disposition values to localized names and CSS classes.
         * @type {object}
         * @private
         */
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

    /**
     * Prepares the data context for rendering the selector's Handlebars template.
     * This method is responsible for fetching all visages associated with the actor, processing them into a
     * display-ready format, and sorting them for the UI.
     *
     * The process is as follows:
     * 1.  It ensures the token has "default" data saved, creating it if it's missing (as a fallback).
     * 2.  It constructs the special "Default" visage entry that allows reverting the token's appearance.
     * 3.  It retrieves all alternate visages using `Visage.getVisages()`.
     * 4.  For each visage (default and alternate), it computes a rich set of properties for the template:
     *     - `isActive`: To highlight the currently applied visage.
     *     - `isFlippedX`, `displayScale`: For showing token scale and orientation.
     *     - `showDataChip`, `showScaleChip`: Logic to determine when to show informational chips.
     *     - Disposition details (`dispositionName`, `dispositionClass`).
     *     - Dynamic Ring effects (`hasRing`, `ringColor`, `hasPulse`, etc.) are broken down into boolean flags
     *       and color values for easy use in the template.
     * 5.  The visages are sorted alphabetically and wildcard paths are resolved before being returned.
     *
     * @param {object} options - Options passed to the render cycle.
     * @returns {Promise<object>} The context object for the template.
     * @protected
     * @override
     */
    async _prepareContext(options) {
        const token = canvas.tokens.get(this.tokenId);
        if (!token || !token.actor) return { forms: [] };
        
        const actor = token.actor; 
        const ns = Visage.DATA_NAMESPACE;
        const moduleData = actor.flags?.[ns] || {};
        let tokenData = moduleData[this.tokenId] || {};
        let defaults = tokenData.defaults;

        // --- 1. Fallback Data Capture ---
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
                ring: currentToken.document.ring ? currentToken.document.ring.toObject() : undefined,
                width: currentToken.document.width ?? 1,
                height: currentToken.document.height ?? 1
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

        // Helper to generate the Smart Chip labels
        const getSmartData = (scale, width, height, isFlippedX) => {
            const absScale = Math.abs(scale);
            
            // Scale Label: Hide if 100% (1.0)
            const isScaleDefault = absScale === 1.0;
            const scaleLabel = isScaleDefault ? "" : `${Math.round(absScale * 100)}%`;

            // Size Label: Hide if 1x1
            // Use fallback to 1 to ensure we don't display "undefinedxundefined"
            const safeW = width || 1;
            const safeH = height || 1;
            const isSizeDefault = safeW === 1 && safeH === 1;
            const sizeLabel = isSizeDefault ? "" : `${safeW}x${safeH}`;

            // Logic Flags
            // Show Flip Badge if flipped (negative scale OR explict flag)
            const showFlipBadge = (scale < 0) || (isFlippedX === true);
            
            // Show Data Chip if there is text to display
            const showDataChip = (scaleLabel !== "") || (sizeLabel !== "");

            return { scaleLabel, sizeLabel, showFlipBadge, showDataChip };
        };
        
        // --- 2. Prepare "Default" Visage ---
        {
            const defaultPath = defaults.token || "";
            const defScale = defaults.scale ?? 1.0; 
            const defWidth = defaults.width ?? 1; 
            const defHeight = defaults.height ?? 1;
            const isFlipped = defScale < 0;

            const smartData = getSmartData(defScale, defWidth, defHeight, isFlipped);

            forms["default"] = {
                key: "default",
                name: defaults.name || game.i18n.localize("VISAGE.Selector.Default"),
                path: defaultPath,
                isActive: currentFormKey === "default",
                isDefault: true,
                scale: defScale,
                isFlippedX: isFlipped,
                showDataChip: smartData.showDataChip,
                showFlipBadge: smartData.showFlipBadge,
                sizeLabel: smartData.sizeLabel,
                scaleLabel: smartData.scaleLabel,
                isWildcard: defaultPath.includes('*'),
                showDispositionChip: false,
                isSecret: false,
                hasRing: false,
                isVideo: foundry.helpers.media.VideoHelper.hasVideoExtension(defaultPath)
            };
        }
        
        // --- 3. Process Alternate Visages ---
        const normalizedData = Visage.getVisages(actor);

        for (const data of normalizedData) {
            const isFlippedX = data.scale < 0;
            const isActive = data.id === currentFormKey;
            const dispositionInfo = (data.disposition !== null) ? this._dispositionMap[data.disposition] : null;

            // Generate Labels for this visage
            const smartData = getSmartData(data.scale, data.width, data.height, isFlippedX);

            // Ring Logic
            const hasRing = data.ring?.enabled === true;
            let ringColor = "", ringBkg = "", hasPulse = false, hasGradient = false, hasWave = false, hasInvisibility = false;
            
            if (hasRing) {
                ringColor = data.ring.colors?.ring || "#FFFFFF";
                ringBkg = data.ring.colors?.background || "#000000";
                const effects = data.ring.effects || 0;
                hasPulse = (effects & 2) !== 0;        
                hasGradient = (effects & 4) !== 0;     
                hasWave = (effects & 8) !== 0;         
                hasInvisibility = (effects & 16) !== 0; 
            }

            const isVideo = foundry.helpers.media.VideoHelper.hasVideoExtension(data.path);

            forms[data.id] = {
                key: data.id,
                name: data.name,
                path: data.path,
                scale: data.scale,
                isActive: isActive,
                isDefault: false,
                isFlippedX: isFlippedX,
                showDataChip: smartData.showDataChip,
                showFlipBadge: smartData.showFlipBadge,
                sizeLabel: smartData.sizeLabel,
                scaleLabel: smartData.scaleLabel,
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
                hasInvisibility: hasInvisibility,
                isVideo: isVideo
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

        return { forms: orderedForms };
    }
    
    /**
     * Handles the click event on a visage tile.
     * @param {PointerEvent} event - The triggering click event.
     * @param {HTMLElement} target - The visage tile element that was clicked.
     * @private
     */
    async _onSelectVisage(event, target) {
        const formKey = target.dataset.formKey;
        if (formKey) {
            await Visage.setVisage(this.actorId, this.tokenId, formKey);
            this.close();
        }
    }

    /**
     * Handles the click event on the configuration button.
     * @param {PointerEvent} event - The triggering click event.
     * @param {HTMLElement} target - The config button element that was clicked.
     * @private
     */
    _onOpenConfig(event, target) {
        const configId = `visage-config-${this.actorId}-${this.tokenId}`;
        // If the config app is already open, just bring it to the front.
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
     * Binds listeners to dismiss the app when the user clicks away.
     * @param {object} context - The data context used to render the template.
     * @param {object} options - Rendering options.
     * @protected
     * @override
     */
    _onRender(context, options) {
        // --- RTL Support ---
        // Apply direction only to this specific application window
        const rtlLanguages = ["ar", "he", "fa", "ur"];
        if (rtlLanguages.includes(game.i18n.lang)) {
            this.element.setAttribute("dir", "rtl");
            this.element.classList.add("rtl");
        }

        this._unbindDismissListeners();
        this._bindDismissListeners();
    }

    /**
     * Unbinds dismiss listeners before closing the application.
     * @param {object} [options] - Options for closing the application.
     * @returns {Promise<void>}
     * @override
     */
    async close(options) {
        this._unbindDismissListeners();
        return super.close(options);
    }

    /**
     * Binds a 'pointerdown' event to the document to detect clicks outside the selector.
     * This allows the selector to be automatically dismissed.
     * @private
     */
    _bindDismissListeners() {
        this._onDocPointerDown = (ev) => {
            const root = this.element;
            if (!root) return;
            // Ignore clicks inside the selector itself.
            if (root.contains(ev.target)) return;
            // Ignore clicks on the HUD button that opened the selector.
            const hudBtn = document.querySelector('.visage-button');
            if (hudBtn && (hudBtn === ev.target || hudBtn.contains(ev.target))) return;
            // Ignore clicks inside the config app if it's open.
            const configApp = ev.target.closest('.visage-config-app');
            if (configApp) return;
            this.close();
        };
        document.addEventListener('pointerdown', this._onDocPointerDown, true);
    }

    /**
     * Removes the 'pointerdown' event listener from the document.
     * @private
     */
    _unbindDismissListeners() {
        if (this._onDocPointerDown) {
            document.removeEventListener('pointerdown', this._onDocPointerDown, true);
            this._onDocPointerDown = null;
        }
    }
}