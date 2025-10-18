// visage-selector.js

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
            // --- UPDATED OPTIONS ---
            title: "Choose Visage", // New title
            classes: ["visage-selector-app", "borderless"], // Added 'borderless' class
            popOut: true, // Must be true for Application class
            width: 250, // Adjusted width for 2-column grid
            height: "auto",
            top: 0, // Initial positioning to be handled by CSS/Hooks
            left: 0,
            minimizable: false,
            resizable: false,
            closeOnUnfocus: false
            // --- END UPDATED OPTIONS ---
        });
    }

    /**
     * @override
     */
    async getData(options = {}) {
        const actor = game.actors.get(this.actorId);
        if (!actor) {
            ui.notifications.error("VisageSelector: Could not find actor with ID " + this.actorId);
            return { forms: {} };
        }

        const moduleData = actor.flags?.[Visage.DATA_NAMESPACE] || {};
        const alternateImages = moduleData.alternateImages || {};
        const currentFormKey = moduleData.currentFormKey || "default";

        // Separate default and alternatives for correct display order
        const forms = {};
        
        // 1. Add Default Visage
        forms["default"] = {
            key: "default",
            name: "Default",
            path: moduleData.defaults?.token || actor.prototypeToken.texture.src,
            isActive: currentFormKey === "default"
        };
        
        // 2. Add Alternate Visages
        for (const [key, path] of Object.entries(alternateImages)) {
            forms[key] = {
                key: key,
                name: key, // Use key as name for alternates
                path: path,
                isActive: key === currentFormKey
            };
        }

        const orderedForms = [forms["default"]];
        for(const key in forms) {
            if (key !== "default") {
                orderedForms.push(forms[key]);
            }
        }

        // Resolve wildcards for display and add key to each
        for (const form of orderedForms) {
            form.resolvedPath = await Visage.resolvePath(form.path);
        }

        return { forms: orderedForms }; // Pass the ordered array
    }

    /**
     * @override
     */
    activateListeners(html) {
        super.activateListeners(html);
        html.find('.visage-tile').on('click', this._onSelectVisage.bind(this));
        this._bindDismissListeners();
    }

/**
   * Close when clicking anywhere outside the app
   */
  _bindDismissListeners() {
    this._onDocPointerDown = (ev) => {
      const root = this.element?.[0];
      if (!root) return;

      // Click inside the selector → ignore
      if (root.contains(ev.target)) return;

      // Click on the HUD button that spawned this → let its own handler run
      const hudBtn = document.querySelector('.visage-button');
      if (hudBtn && (hudBtn === ev.target || hudBtn.contains(ev.target))) return;

      // Otherwise, dismiss
      this.close();
    };

    // Capture phase to win against other handlers
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
        const formKey = event.currentTarget.dataset.formKey;
        if (formKey) {
            await Visage.setVisage(this.actorId, formKey, this.tokenId);
            this.close();
        }
    }
}
