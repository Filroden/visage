import { Visage } from "./visage.js";

/**
 * The application for selecting a visage.
 */
export class VisageSelector extends Application {
    constructor(actorId, tokenId, options = {}) {
        super(options);
        this.actorId = actorId;
        this.tokenId = tokenId;
    }

    /**
     * @override
     */
    static get defaultOptions() {
        return mergeObject(super.defaultOptions, {
            template: `modules/visage/templates/visage-selector.html`,
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
        // Find the specific token instance on the canvas
        const token = canvas.tokens.get(this.tokenId);
        if (!token) {
            ui.notifications.error(`VisageSelector: Could not find token with ID ${this.tokenId}`);
            return { forms: [] };
        }
        
        // Use the token's actor, which correctly references the embedded data for unlinked tokens.
        const actor = token.actor; 
        
        if (!actor) {
            ui.notifications.error("VisageSelector: Could not find actor for token " + this.tokenId);
            return { forms: [] };
        }

        const ns = Visage.DATA_NAMESPACE;
        const moduleData = actor.flags?.[ns] || {};
        let tokenData = moduleData[this.tokenId] || {};
        let defaults = tokenData.defaults;

        // --- Self-Healing Default Creation ---
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

            // Re-fetch the data now that it should exist
            defaults = actor.flags?.[ns]?.[this.tokenId]?.defaults;

            if (!defaults) {
                ui.notifications.error(`Visage defaults for token ${this.tokenId} could not be created.`);
                return { forms: [] };
            }
        }

        const alternateImages = moduleData.alternateImages || {};
        const currentFormKey = actor.flags?.[ns]?.[this.tokenId]?.currentFormKey || "default";

        const forms = {};
        
        // 1. Add Default Visage from token-specific defaults
        forms["default"] = {
            key: "default",
            name: defaults.name || "Default",
            path: defaults.token,
            isActive: currentFormKey === "default",
            isDefault: true
        };
        
        // 2. Add Alternate Visages (Universal)
        for (const [key, path] of Object.entries(alternateImages)) {
            forms[key] = {
                key: key,
                name: key, // Use key as name for alternates
                path: path,
                isActive: key === currentFormKey,
                isDefault: false
            };
        }

        // Create an ordered array for the template
        const orderedForms = [forms["default"]];
        for(const key in forms) {
            if (key !== "default") {
                orderedForms.push(forms[key]);
            }
        }

        // Resolve wildcards for display
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
        this._bindDismissListeners();
    }

    /**
     * Close when clicking anywhere outside the app
     */
    _bindDismissListeners() {
        this._onDocPointerDown = (ev) => {
            const root = this.element[0];
            if (!root) return;

            // Do not close if the click is inside the application
            if (root.contains(ev.target)) return;

            // Do not close if the click is on the HUD button that opened the app
            const hudBtn = document.querySelector('.visage-button');
            if (hudBtn && (hudBtn === ev.target || hudBtn.contains(ev.target))) return;

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
        // Since this is a popOut: true app, super.close() will handle element removal
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