/**
 * This file defines the VisageSelector class.
 * This class is a small, temporary Application window that pops up
 * next to the Token HUD, allowing the user to quickly select a
 * pre-configured visage (appearance) for their token.
 */

// Import the main Visage class for its API (setVisage, resolvePath)
import { Visage } from "./visage.js";
// Import the configuration app to open it from this selector
import { VisageConfigApp } from "./visage-config.js";

/**
 * The VisageSelector Application.
 * Renders a small, borderless window with a grid of available visages.
 */
export class VisageSelector extends Application {
    /**
     * @param {string} actorId - The ID of the Actor this token represents.
     * @param {string} tokenId - The ID of the specific Token on the canvas.
     * @param {string} sceneId - The ID of the Scene the token is on.
     * @param {object} [options={}] - Standard Application options.
     */
    constructor(actorId, tokenId, sceneId, options = {}) {
        super(options);
        this.actorId = actorId;
        this.tokenId = tokenId;
        this.sceneId = sceneId;

        /**
         * Helper map for disposition names and classes
         * @type {object}
         * @private
         */
        this._dispositionMap = {
            [-2]: { name: "Secret",   class: "secret"   },
            [-1]: { name: "Hostile",  class: "hostile"  },
            [0]:  { name: "Neutral",  class: "neutral"  },
            [1]:  { name: "Friendly", class: "friendly" }
        };
    }

    /**
     * Defines the default options for this application window.
     * @returns {object}
     * @override
     */
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            template: `modules/visage/templates/visage-selector.hbs`,
            title: "Choose Visage",
            classes: ["visage-selector-app", "borderless"],
            popOut: true,
            width: 200,
            height: "auto", // Automatically size height based on content
            top: 0,         // Will be positioned manually by visage-hud.js
            left: 0,        // Will be positioned manually by visage-hud.js
            minimizable: false,
            resizable: false,
            // This is set to false because a custom "close on unfocus" logic is
            // implemented in _bindDismissListeners to have more control.
            closeOnUnfocus: false
        });
    }

    /**
     * Gathers all data needed to render the selector tiles.
     * @param {object} [options={}] - Options passed during rendering.
     * @returns {Promise<object>} The data object for the template.
     * @override
     */
    async getData(options = {}) {
        const token = canvas.tokens.get(this.tokenId);
        if (!token) {
            ui.notifications.error(`VisageSelector: Could not find token with ID ${this.tokenId}`);
            return { forms: [] };
        }

        const actor = token.actor;
        if (!actor) {
            ui.notifications.error("VisageSelector: Could not find actor for token " + this.tokenId);
            return { forms: [] };
        }

        const ns = Visage.DATA_NAMESPACE;
        const moduleData = actor.flags?.[ns] || {};
        let tokenData = moduleData[this.tokenId] || {};
        let defaults = tokenData.defaults;

        // --- Failsafe: Create Default Data ---
        // This logic acts as a fallback in case the 'handleTokenHUD'
        // function didn't get to run and create the initial default data.
        if (!defaults) {
            // Re-fetch token just in case
            const currentToken = canvas.tokens.get(this.tokenId);
            if (!currentToken) {
                ui.notifications.error(`VisageSelector: Could not find token with ID ${this.tokenId}`);
                return { forms: [] };
            }

            // Prepare the flag updates
            const updates = {};
            updates[`flags.${ns}.${this.tokenId}.defaults`] = {
                name: currentToken.document.name,
                token: currentToken.document.texture.src,
                scale: currentToken.document.texture.scaleX ?? 1.0,
                disposition: currentToken.document.disposition ?? 0
            };
            updates[`flags.${ns}.${this.tokenId}.currentFormKey`] = 'default';

            // Update the actor and re-fetch the defaults
            await actor.update(updates);
            defaults = actor.flags?.[ns]?.[this.tokenId]?.defaults;

            if (!defaults) {
                ui.notifications.error(`Visage defaults for token ${this.tokenId} could not be created.`);
                return { forms: [] };
            }
        }

        // --- Prepare Form Data for Template ---
        const alternateVisages = moduleData[Visage.ALTERNATE_FLAG_KEY] || {}; 
        const currentFormKey = actor.flags?.[ns]?.[this.tokenId]?.currentFormKey || "default";

        const forms = {};

        // 1. Manually add the "Default" visage as the first option
        {
            // Note: Default form scale is assumed to be 1.0 for this preview.
            // The *actual* default scale is stored but not used for this tile's chip.
            const scale = 1.0;
            const isFlippedX = scale < 0;
            const absScale = Math.abs(scale);
            const displayScale = Math.round(absScale * 100);
            const showScaleChip = scale !== 1;
            const defaultPath = defaults.token || ""; // Ensure path is a string

            forms["default"] = {
                key: "default",
                name: defaults.name || "Default", // Use saved default name
                path: defaultPath,
                isActive: currentFormKey === "default", // Check if it's active
                isDefault: true,
                scale: scale,
                isFlippedX: isFlippedX,
                displayScale: displayScale,
                showScaleChip: showScaleChip,
                absScale: absScale,
                // Check if the path is a wildcard, used to show an icon
                isWildcard: defaultPath.includes('*'),
                // Disposition properties (always false for default tile)
                showDispositionChip: false,
                dispositionName: "",
                dispositionClass: ""
            };
        }

        // 2. Add all configured alternate visages
        // Loop over UUIDs and data
        for (const [uuid, data] of Object.entries(alternateVisages)) {
            // Handle old string-only data format vs. new {path, scale} object
            const isObject = typeof data === 'object' && data !== null;
            const path = isObject ? (data.path || "") : (data || ""); // Ensure path
            const scale = isObject ? (data.scale ?? 1.0) : 1.0;

            let disposition = (isObject && data.disposition !== undefined) ? data.disposition : null;

            // Calculate display values
            const isFlippedX = scale < 0;
            const absScale = Math.abs(scale);
            const displayScale = Math.round(absScale * 100);
            // Only show the scale chip if it's not 100%
            const showScaleChip = scale !== 1;

            // Disposition properties
            const dispositionInfo = (disposition !== null) ? this._dispositionMap[disposition] : null;

            forms[uuid] = {
                key: uuid,
                name: data.name,
                path: data.path,
                scale: data.scale,
                isActive: uuid === currentFormKey, // Check against UUID
                isDefault: false,
                isFlippedX: isFlippedX,
                displayScale: displayScale,
                showScaleChip: showScaleChip,
                absScale: absScale,
                // Check if the path is a wildcard
                isWildcard: path.includes('*'),
                showDispositionChip: !!dispositionInfo,
                dispositionName: dispositionInfo?.name || "",
                dispositionClass: dispositionInfo?.class || ""
            };
        }

        // --- Sort and Resolve Paths ---
        // Create an ordered array: Default first, then all others alphabetically
        const orderedForms = [forms["default"]];
        const alternateKeys = Object.keys(forms).filter(k => k !== "default").sort((a, b) => {
            // Sort by name property, accessing the form data using the UUID (a and b)
            return forms[a].name.localeCompare(forms[b].name); 
        });
        for(const key of alternateKeys) {
            orderedForms.push(forms[key]);
        }

        // Asynchronously resolve all paths (handles wildcards for previews)
        for (const form of orderedForms) {
            form.resolvedPath = await Visage.resolvePath(form.path);
        }

        // Return the final, ordered list of forms to the template
        return { forms: orderedForms };
    }

    /**
     * Attaches event listeners to the application's HTML.
     * @param {jQuery} html - The jQuery-wrapped HTML of the application.
     * @override
     */
    activateListeners(html) {
        super.activateListeners(html);
        // Main action: Click a tile to change the visage
        html.on('click', '.visage-tile', this._onSelectVisage.bind(this));
        // Button: Open the full configuration window
        html.on('click', '.visage-config-button', this._onOpenConfig.bind(this));
        // Activate custom "close on unfocus" behavior
        this._bindDismissListeners();
    }

    /**
     * Handles opening the full VisageConfigApp window.
     * @param {Event} event - The click event.
     * @private
     */
    _onOpenConfig(event) {
        event.preventDefault();
        // Create a unique ID for the config app
        const configId = `visage-config-${this.actorId}-${this.tokenId}`;

        // Check global app tracker (from main.js)
        if (Visage.apps[configId]) {
            // If it's already open, just bring it to the front
            Visage.apps[configId].bringToTop();
        } else {
            // Otherwise, create and render a new config app
            const configApp = new VisageConfigApp(this.actorId, this.tokenId, this.sceneId, { id: configId });
            configApp.render(true);
        }

        // Close this selector window
        this.close();
    }

    /**
     * Binds a global 'pointerdown' event listener to handle closing
     * the window when the user clicks outside of it.
     * @private
     */
    _bindDismissListeners() {
        this._onDocPointerDown = (ev) => {
            const root = this.element[0];
            if (!root) return; // App is gone

            // 1. Don't close if clicking *inside* this app
            if (root.contains(ev.target)) return;

            // 2. Don't close if clicking the HUD button that opened this
            // (Let the HUD button's own logic handle toggling)
            const hudBtn = document.querySelector('.visage-button');
            if (hudBtn && (hudBtn === ev.target || hudBtn.contains(ev.target))) return;

            // 3. Don't close if clicking *inside* the config app
            const configApp = ev.target.closest('.visage-config-app');
            if (configApp) return;

            // If none of the above, close the app
            this.close();
        };
        // Add the listener to the whole document, in the capture phase
        document.addEventListener('pointerdown', this._onDocPointerDown, true);
    }

    /**
     * Removes the global 'pointerdown' listener to prevent memory leaks.
     * @private
     */
    _unbindDismissListeners() {
        if (this._onDocPointerDown) {
            document.removeEventListener('pointerdown', this._onDocPointerDown, true);
            this._onDocPointerDown = null;
        }
    }

    /**
     * Overrides the default close method to ensure global
     * listener is always cleaned up.
     * @override
     */
    async close(options) {
        this._unbindDismissListeners();
        return super.close(options);
    }

    /**
     * Handles the click event on a visage tile to select it.
     * @param {Event} event - The click event.
     * @private
     */
    async _onSelectVisage(event) {
        const tile = event.target.closest('.visage-tile');
        if (!tile) return;

        // Get the form key from the tile's data- attribute
        const formKey = tile.dataset.formKey; // formKey is the UUID or "default"
        if (formKey) {
            // Call the main API to change the token's appearance
            await Visage.setVisage(this.actorId, this.tokenId, formKey);
            // Close this selector window
            this.close();
        }
    }
}