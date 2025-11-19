/**
 * @file visage-config.js
 * @description Defines the VisageConfigApp class.
 * This application provides the form interface for configuring alternate visages
 * on a specific Actor/Token. It handles data creation, modification, and deletion,
 * as well as the assignment of dispositions (disguises/illusions).
 * @module visage
 */

import { Visage } from "./visage.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The Visage Configuration Application (V2).
 * * This window allows a user to add, edit, and remove alternate visages
 * for an actor. It enforces data integrity (UUIDs) and handles the 
 * "smart default" logic when saving.
 * * @extends {HandlebarsApplicationMixin(ApplicationV2)}
 */
export class VisageConfigApp extends HandlebarsApplicationMixin(ApplicationV2) {
    
    /**
     * @param {object} options - Application options.
     * @param {string} options.actorId - The ID of the Actor being configured.
     * @param {string} options.tokenId - The ID of the Token this config was opened from.
     * @param {string} options.sceneId - The ID of the Scene the token is on.
     */
    constructor(options = {}) {
        super(options);
        this.actorId = options.actorId;
        this.tokenId = options.tokenId;
        this.sceneId = options.sceneId;

        /**
         * Internal state to hold form data during edits (prevents data loss on re-render).
         * @type {Array<object>|null}
         */
        this._tempVisages = null;
        
        /**
         * Map for readable disposition names.
         * @type {Object<number, {name: string}>}
         */
        this._dispositionMap = {
            [-2]: { name: "Secret"   },
            [-1]: { name: "Hostile"  },
            [0]:  { name: "Neutral"  },
            [1]:  { name: "Friendly" }
        };
    }

    /** * Default Application options.
     * @type {object}
     */
    static DEFAULT_OPTIONS = {
        tag: "form",
        id: "visage-config",
        classes: ["visage-config-app", "visage-dark-theme"],
        window: {
            title: "Visage Configuration",
            // Use custom CSS class for the icon mask
            icon: "visage-header-icon", 
            resizable: true,
            minimizable: true,
            contentClasses: ["standard-form"]
        },
        position: {
            width: 780,
            height: "auto"
        },
        actions: {
            addVisage: VisageConfigApp.prototype._onAddVisage,
            deleteVisage: VisageConfigApp.prototype._onDeleteVisage,
            save: VisageConfigApp.prototype._onSave,
            toggleDisposition: VisageConfigApp.prototype._onToggleDisposition,
            changeDispositionType: VisageConfigApp.prototype._onChangeDispositionType,
            changeDispositionValue: VisageConfigApp.prototype._onChangeDispositionValue,
            openFilePicker: VisageConfigApp.prototype._onOpenFilePicker
        }
    };

    /** * Configuration for rendering parts (templates).
     * @type {object}
     */
    static PARTS = {
        form: {
            template: "modules/visage/templates/visage-config-app.hbs",
            scrollable: [".visage-config-wrapper"] 
        }
    };

    /** * Prepares the data context for the Handlebars template.
     * Handles fetching the correct Actor (Linked vs Unlinked), normalizing legacy data,
     * and preparing the view model.
     * * @override
     * @param {object} options - Render options.
     * @returns {Promise<object>} The data context.
     */
    async _prepareContext(options) {
        const scene = game.scenes.get(this.sceneId);
        const tokenDocument = scene?.tokens.get(this.tokenId);
        const actor = tokenDocument?.actor ?? game.actors.get(this.actorId);

        if (!actor || !tokenDocument) return {};

        const ns = Visage.DATA_NAMESPACE;
        const moduleData = actor.flags?.[ns] || {};
        const tokenDefaults = moduleData[this.tokenId]?.defaults || {
            name: tokenDocument.name,
            token: tokenDocument.texture.src,
            scale: tokenDocument.texture.scaleX ?? 1.0
        };
        
        let visages = [];
        
        if (this._tempVisages) {
            visages = this._tempVisages;
        } else {
            // USE CENTRALIZED NORMALIZATION
            const normalizedData = Visage.getVisages(actor);
            
            // Add UI-specific properties for the config form
            visages = await Promise.all(normalizedData.map(async (data) => {
                return this._processVisageEntry(
                    data.id, 
                    data.name, 
                    data.path, 
                    data.scale, 
                    false, // isFlippedX logic handled inside _processVisageEntry using scale
                    data.disposition
                );
            }));
        }

        return {
            visages,
            defaultTokenName: tokenDefaults.name,
            defaultToken: tokenDefaults.token,
            isDirty: this._isDirty || false
        };
    }

    /** * Helper to process raw data into the format required by the handlebars template.
     * Calculates display text for buttons and resolves disposition logic.
     * * @param {string} id - The UUID of the visage.
     * @param {string} name - The name of the visage.
     * @param {string} path - The file path.
     * @param {number} scale - The scale multiplier (e.g. 1.0).
     * @param {boolean} isFlippedX - Whether the image is flipped horizontally.
     * @param {number|null} disposition - The disposition override value.
     * @returns {Promise<object>} The formatted visage object.
     */
    async _processVisageEntry(id, name, path, scale, isFlippedX, disposition) {
        let dispositionType = "none";
        let dispositionValue = 0; // Default select value (Neutral)
        let buttonText = "Default";

        if (disposition === -2) {
            // Case: Illusion
            dispositionType = "illusion";
            buttonText = "Illusion (Secret)";
        } else if (disposition !== null && disposition !== undefined) {
            // Case: Disguise (Friendly/Neutral/Hostile)
            dispositionType = "disguise";
            dispositionValue = disposition;
            buttonText = `Disguise: ${this._dispositionMap[disposition]?.name}`;
        } else {
            // Case: Default (null/undefined)
            dispositionType = "none";
            buttonText = "Default";
        }

        return {
            id,
            name,
            path,
            scale: Math.round(Math.abs(scale) * 100), // Convert to percentage for display
            isFlippedX: (scale < 0) || isFlippedX,
            dispositionType,
            dispositionValue,
            dispositionButtonText: buttonText,
            resolvedPath: await Visage.resolvePath(path)
        };
    }


    /* -------------------------------------------- */
    /* Actions                                     */
    /* -------------------------------------------- */

    /**
     * Action: Add Visage
     * Adds a new, blank visage row to the list.
     * @param {PointerEvent} event - The click event.
     * @param {HTMLElement} target - The button element.
     */
    async _onAddVisage(event, target) {
        this._tempVisages = await this._readFormData(this.element);
        
        const newEntry = await this._processVisageEntry(
            foundry.utils.randomID(16), 
            "", "", 1.0, false, null // Default disposition is null
        );
        this._tempVisages.push(newEntry);
        
        this._isDirty = true;
        this.render();
    }

    /**
     * Action: Delete Visage
     * Removes a visage row from the list.
     * @param {PointerEvent} event - The click event.
     * @param {HTMLElement} target - The delete button element.
     */
    async _onDeleteVisage(event, target) {
        const row = target.closest(".visage-list-item");
        const idToDelete = row.dataset.id;

        this._tempVisages = await this._readFormData(this.element);
        this._tempVisages = this._tempVisages.filter(v => v.id !== idToDelete);
        
        this._isDirty = true;
        this.render();
    }

    /**
     * Action: Toggle Disposition Popout
     * Shows/Hides the disposition configuration popout for a specific row.
     */
    _onToggleDisposition(event, target) {
        const row = target.closest(".visage-disposition-cell");
        const popout = row.querySelector(".visage-disposition-popout");
        
        this.element.querySelectorAll(".visage-disposition-popout").forEach(el => {
            if (el !== popout) el.classList.remove("active");
        });

        popout.classList.toggle("active");
    }

    /**
     * Internal helper to update the text on the disposition button when inputs change.
     * @param {HTMLElement} popout - The popout container element.
     */
    _updateButtonText(popout) {
        const cell = popout.closest(".visage-disposition-cell");
        const button = cell.querySelector(".visage-disposition-button");
        
        const dispoInput = popout.querySelector('input[name$=".dispositionType"]:checked');
        if (!dispoInput) return;
        
        const dispoType = dispoInput.value;
        const select = popout.querySelector('select');
        let buttonText = "Default";
        
        if (dispoType === "disguise") {
            select.disabled = false;
            const val = parseInt(select.value);
            buttonText = `Disguise: ${this._dispositionMap[val]?.name}`;
        } else {
            select.disabled = true;
            if (dispoType === "illusion") {
                buttonText = "Illusion (Secret)";
            }
        }

        button.textContent = buttonText;
        this._markDirty();
    }
    
    _onChangeDispositionType(event, target) { this._updateButtonText(target.closest(".visage-disposition-popout")); }
    _onChangeDispositionValue(event, target) { this._updateButtonText(target.closest(".visage-disposition-popout")); }

    /**
     * Action: Open File Picker
     * Opens the Foundry FilePicker to select an image.
     */
    _onOpenFilePicker(event, target) {
        const group = target.closest(".visage-path-group");
        const input = group.querySelector("input");
        
        const fp = new FilePicker({
            type: "image",
            current: input.value,
            callback: (path) => {
                input.value = path;
                this._markDirty();
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }
        });
        fp.browse();
    }

    /**
     * Marks the application as dirty and updates the save button style.
     */
    _markDirty() {
        this._isDirty = true;
        const btn = this.element.querySelector(".visage-save");
        if (btn) btn.classList.add("dirty");
    }

    /**
     * Action: Save Changes
     * Validates data, constructs the update object, handles "smart defaults", 
     * and saves to the Actor's flags. Also handles legacy data cleanup.
     */
    async _onSave(event, target) {
        event.preventDefault();

        const scene = game.scenes.get(this.sceneId);
        const tokenDocument = scene?.tokens.get(this.tokenId);
        const actor = tokenDocument?.actor ?? game.actors.get(this.actorId);
        
        if (!actor) return;
        
        // 1. Fetch Token Defaults for fallback (Smart Defaults)
        const ns = Visage.DATA_NAMESPACE;
        const moduleData = actor.flags?.[ns] || {};
        
        const tokenDefaults = moduleData[this.tokenId]?.defaults || {
            name: tokenDocument?.name,
            token: tokenDocument?.texture.src
        };

        // 2. Read Data from DOM
        const currentVisages = await this._readFormData(this.element);
        
        // 3. Validate & Apply Defaults
        const newKeys = new Set(); 
        const visagesToSave = [];

        for (const v of currentVisages) {
            // SMART DEFAULT: If path is empty, use default token image
            const finalPath = v.path ? v.path.trim() : (tokenDefaults.token || "");
            // SMART DEFAULT: If name is empty, use default token name
            const finalName = v.name ? v.name.trim() : (tokenDefaults.name || "Visage");

            if (!finalPath) {
                return ui.notifications.error(`Visage "${finalName}" has no image path and no default could be found.`);
            }
            
            newKeys.add(v.id); 
            
            // Update the object with the defaulted values
            visagesToSave.push({ ...v, name: finalName, path: finalPath });
        }

        // 4. Construct Update Object (Standardizing on new structure)
        const newVisages = {};
        for (const v of visagesToSave) {
            let scale = v.scale / 100;
            if (v.isFlippedX) scale = -Math.abs(scale);
            else scale = Math.abs(scale);

            let disposition = null;
            if (v.dispositionType === "illusion") {
                disposition = -2;
            } else if (v.dispositionType === "disguise") {
                disposition = parseInt(v.dispositionValue);
            }

            newVisages[v.id] = {
                name: v.name,
                path: v.path,
                scale: scale,
                disposition: disposition 
            };
        }

        const updates = {
            [`flags.${ns}.alternateVisages`]: newVisages,
            [`flags.${ns}.-=alternateImages`]: null // Clean up legacy key
        };

        // 5. Handle Explicit Deletions of keys that exist on Actor but not in form
        const currentFlags = actor.flags[ns]?.alternateVisages || {};
        for (const existingKey of Object.keys(currentFlags)) {
            if (!newKeys.has(existingKey)) {
                updates[`flags.${ns}.alternateVisages.-=${existingKey}`] = null;
            }
        }

        await actor.update(updates);
        
        this._isDirty = false;
        this._tempVisages = null;
        this.render();
        ui.notifications.info("Visage configuration saved.");
        
        // Refresh the token on canvas (using the object, not document)
        if (tokenDocument?.object) {
            tokenDocument.object.refresh();
        }
        
        this.close();
    }

    /**
     * Helper to scrape the HTML form into a structured Array of Objects.
     * Uses FormDataExtended to read values and regex to reconstruct the array.
     * * @param {HTMLElement} formElement - The form element to read.
     * @returns {Promise<Array<object>>} The parsed visage data.
     */
    async _readFormData(formElement) {
        // Use namespaced FormDataExtended (V13+)
        const formData = new foundry.applications.ux.FormDataExtended(formElement).object;
        const visages = [];
        
        // Extract unique indices from the flat FormData keys (e.g., "visages.0.name")
        const indices = new Set();
        for (const key of Object.keys(formData)) {
            const match = key.match(/^visages\.(\d+)\./);
            if (match) indices.add(parseInt(match[1]));
        }

        // Iterate indices in order
        for (const i of Array.from(indices).sort((a,b) => a - b)) {
            const id = formData[`visages.${i}.id`];
            const name = formData[`visages.${i}.name`];
            const path = formData[`visages.${i}.path`];
            
            // Convert string percentage back to number
            const rawScale = formData[`visages.${i}.scale`];
            const scale = (rawScale ? parseFloat(rawScale) : 100) / 100;

            const isFlippedX = formData[`visages.${i}.isFlippedX`] || false;
            
            const dispositionType = formData[`visages.${i}.dispositionType`];
            const dispositionValue = formData[`visages.${i}.dispositionValue`];

            let disposition = null;
            if (dispositionType === "illusion") {
                disposition = -2;
            } else if (dispositionType === "disguise") {
                disposition = parseInt(dispositionValue);
            }

            visages.push(await this._processVisageEntry(
                id, name, path, scale, isFlippedX, disposition
            ));
        }
        return visages;
    }

    /** * Post-render hooks.
     * Binds change listeners to inputs for 'dirty' state tracking and
     * sets up the click-away listener for popouts.
     * @override
     */
    _onRender(context, options) {
        const inputs = this.element.querySelectorAll("input, select");
        inputs.forEach(i => i.addEventListener("change", () => this._markDirty()));
        
        this.element.addEventListener('click', (event) => {
            if (!event.target.closest('.visage-disposition-popout') && 
                !event.target.closest('.visage-disposition-button')) {
                
                this.element.querySelectorAll('.visage-disposition-popout.active').forEach(el => {
                    el.classList.remove('active');
                });
            }
        });
    }
}