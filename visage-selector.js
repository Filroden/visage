import { Visage } from "./visage.js";
// Import the new config application
import { VisageConfigApp } from "./visage-config.js";

/**
 * The application for selecting a visage.
 */
export class VisageSelector extends Application {
    constructor(actorId, tokenId, sceneId, options = {}) {
        super(options);
        this.actorId = actorId;
        this.tokenId = tokenId;
        this.sceneId = sceneId;
    }

    /**
     * @override
     */
    static get defaultOptions() {
        return mergeObject(super.defaultOptions, {
            template: `modules/visage/templates/visage-selector.hbs`,
            title: "Choose Visage",
            classes: ["visage-selector-app", "borderless"],
            popOut: true,
            width: 200,
            height: "auto",
            top: 0,
            left: 0,
            minimizable: false,
            resizable: false,
            closeOnUnfocus: false
        });
    }

    /**
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

        if (!defaults) {
            const token = canvas.tokens.get(this.tokenId);
            if (!token) {
                ui.notifications.error(`VisageSelector: Could not find token with ID ${this.tokenId}`);
                return { forms: [] };
            }

            const updates = {};
            updates[`flags.${ns}.${this.tokenId}.defaults`] = {
                name: token.document.name,
                token: token.document.texture.src
            };
            updates[`flags.${ns}.${this.tokenId}.currentFormKey`] = 'default';
            
            await actor.update(updates);
            defaults = actor.flags?.[ns]?.[this.tokenId]?.defaults;

            if (!defaults) {
                ui.notifications.error(`Visage defaults for token ${this.tokenId} could not be created.`);
                return { forms: [] };
            }
        }

        const alternateImages = moduleData.alternateImages || {};
        const currentFormKey = actor.flags?.[ns]?.[this.tokenId]?.currentFormKey || "default";

        const forms = {};
        
        // 1. Add Default Visage
        {
            const scale = 1.0; 
            const isFlippedX = scale < 0;
            const absScale = Math.abs(scale);
            const displayScale = Math.round(absScale * 100);
            const showScaleChip = scale !== 1;
            const defaultPath = defaults.token || ""; // Ensure path is a string

            forms["default"] = {
                key: "default",
                name: defaults.name || "Default",
                path: defaultPath,
                isActive: currentFormKey === "default",
                isDefault: true,
                scale: scale,
                isFlippedX: isFlippedX,
                displayScale: displayScale,
                showScaleChip: showScaleChip,
                absScale: absScale,
                // *** NEW: Add wildcard check ***
                isWildcard: defaultPath.includes('*')
            };
        }
        
        // 2. Add Alternate Visages
        for (const [key, data] of Object.entries(alternateImages)) {
            const isObject = typeof data === 'object' && data !== null;
            const path = isObject ? (data.path || "") : (data || ""); // Ensure path is a string
            const scale = isObject ? (data.scale ?? 1.0) : 1.0;
            const isFlippedX = scale < 0;
            const absScale = Math.abs(scale);
            const displayScale = Math.round(absScale * 100);
            const showScaleChip = scale !== 1;

            forms[key] = {
                key: key,
                name: key,
                path: path,
                scale: scale,
                isActive: key === currentFormKey,
                isDefault: false,
                isFlippedX: isFlippedX,
                displayScale: displayScale,
                showScaleChip: showScaleChip,
                absScale: absScale,
                // *** NEW: Add wildcard check ***
                isWildcard: path.includes('*')
            };
        }

        const orderedForms = [forms["default"]];
        const alternateKeys = Object.keys(forms).filter(k => k !== "default").sort();
        for(const key of alternateKeys) {
            orderedForms.push(forms[key]);
        }

        for (const form of orderedForms) {
            form.resolvedPath = await Visage.resolvePath(form.path);
        }

        return { forms: orderedForms };
    }

    /**
     * @override
     */
    activateListeners(html) {
        super.activateListeners(html);
        html.on('click', '.visage-tile', this._onSelectVisage.bind(this));
        html.on('click', '.visage-config-button', this._onOpenConfig.bind(this));
        this._bindDismissListeners();
    }

    /**
     * Handle opening the configuration window.
     * @param {Event} event - The click event.
     * @private
     */
    _onOpenConfig(event) {
        event.preventDefault();
        const configId = `visage-config-${this.actorId}-${this.tokenId}`;
        if (Visage.apps[configId]) {
            Visage.apps[configId].bringToTop();
        } else {
            const configApp = new VisageConfigApp(this.actorId, this.tokenId, this.sceneId, { id: configId });
            configApp.render(true);
        }
        this.close();
    }

    /**
     * Close when clicking anywhere outside the app
     */
    _bindDismissListeners() {
        this._onDocPointerDown = (ev) => {
            const root = this.element[0];
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

    async close(options) {
        this._unbindDismissListeners();
        return super.close(options);
    }

    /**
     * Handle the click event on a visage tile.
     * @param {Event} event - The click event.
     * @private
     */
    async _onSelectVisage(event) {
        const tile = event.target.closest('.visage-tile');
        if (!tile) return;

        const formKey = tile.dataset.formKey;
        if (formKey) {
            await Visage.setVisage(this.actorId, this.tokenId, formKey);
            this.close();
        }
    }
}

