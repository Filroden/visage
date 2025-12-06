/**
 * @file Defines the configuration application for managing an actor's visages.
 * @module visage
 */

import { Visage } from "./visage.js";
import { VisageRingEditor } from "./visage-ring-editor.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The application class for configuring an actor's visages.
 * This interface allows users to add, edit, and delete alternate forms (visages) for an actor,
 * including their appearance, token settings, and disposition.
 * @extends {HandlebarsApplicationMixin(ApplicationV2)}
 */
export class VisageConfigApp extends HandlebarsApplicationMixin(ApplicationV2) {
    
    /**
     * @param {object} [options={}] - Application configuration options.
     * @param {string} options.actorId - The ID of the actor being configured.
     * @param {string} options.tokenId - The ID of the token associated with this configuration.
     * @param {string} options.sceneId - The ID of the scene the token is in.
     */
    constructor(options = {}) {
        super(options);
        /**
         * The ID of the actor being configured.
         * @type {string}
         * @protected
         */
        this.actorId = options.actorId;

        /**
         * The ID of the token instance this configuration is for.
         * @type {string}
         * @protected
         */
        this.tokenId = options.tokenId;

        /**
         * The ID of the scene containing the token.
         * @type {string}
         * @protected
         */
        this.sceneId = options.sceneId;

        /**
         * A temporary store for visage data that has been modified but not yet saved.
         * This allows for UI updates without immediate database writes.
         * @type {Array<object>|null}
         * @private
         */
        this._tempVisages = null;

        /**
         * A set of all active child application instances, like the Ring Editor.
         * @type {Set<ApplicationV2>}
         * @protected
         */
        this.childApps = new Set();
        
        /**
         * A map to translate disposition numeric values to localized names.
         * @type {object}
         * @private
         */
        this._dispositionMap = {
            [-2]: { name: game.i18n.localize("VISAGE.Disposition.Secret")   },
            [-1]: { name: game.i18n.localize("VISAGE.Disposition.Hostile")  },
            [0]:  { name: game.i18n.localize("VISAGE.Disposition.Neutral")  },
            [1]:  { name: game.i18n.localize("VISAGE.Disposition.Friendly") }
        };
    }

    /** @override */
    static DEFAULT_OPTIONS = {
        tag: "form",
        id: "visage-config",
        // PRESERVED: Your specific classes
        classes: ["visage", "visage-config-app", "visage-dark-theme"],
        window: {
            title: "VISAGE.Config.Title",
            icon: "visage-header-icon", 
            resizable: true,
            minimizable: true,
            contentClasses: ["standard-form"]
        },
        position: {
            width: "auto", // Responsive width
            height: "auto"
        },
        actions: {
            addVisage: VisageConfigApp.prototype._onAddVisage,
            deleteVisage: VisageConfigApp.prototype._onDeleteVisage,
            save: VisageConfigApp.prototype._onSave,
            toggleDisposition: VisageConfigApp.prototype._onToggleDisposition,
            changeDispositionType: VisageConfigApp.prototype._onChangeDispositionType,
            changeDispositionValue: VisageConfigApp.prototype._onChangeDispositionValue,
            openFilePicker: VisageConfigApp.prototype._onOpenFilePicker,
            openRingEditor: VisageConfigApp.prototype._onOpenRingEditor
        }
    };

    /** @override */
    static PARTS = {
        form: {
            template: "modules/visage/templates/visage-config-app.hbs",
            scrollable: [".visage-config-wrapper"] 
        }
    };

    /**
     * The localized title of the application window.
     * @returns {string}
     */
    get title() {
        return game.i18n.localize(this.options.window.title);
    }

    /**
     * Helper to retrieve the token's default data.
     * Used by _prepareContext and _onOpenRingEditor to resolve inheritance.
     * @returns {object} The default token data (name, texture, etc).
     * @private
     */
    _getTokenDefaults() {
        const scene = game.scenes.get(this.sceneId);
        const tokenDocument = scene?.tokens.get(this.tokenId);
        const actor = tokenDocument?.actor ?? game.actors.get(this.actorId);
        
        if (!actor) return {};

        const ns = Visage.DATA_NAMESPACE;
        const moduleData = actor.flags?.[ns] || {};
        
        return moduleData[this.tokenId]?.defaults || {
            name: tokenDocument?.name,
            token: tokenDocument?.texture.src,
            scale: tokenDocument?.texture.scaleX ?? 1.0,
            disposition: tokenDocument?.disposition ?? 0,
            ring: tokenDocument?.ring?.toObject() ?? {}
        };
    }

    /**
     * Prepares the data context for rendering the Handlebars template.
     * This method orchestrates fetching all necessary data, merging it with defaults, and preparing it for
     * display in the form. It handles both saved data from the actor and temporary, unsaved data held in `_tempVisages`.
     *
     * @param {object} options - Options passed to the render cycle.
     * @returns {Promise<object>} The context object for the template.
     * @protected
     * @override
     */
    async _prepareContext(options) {
        const scene = game.scenes.get(this.sceneId);
        const tokenDocument = scene?.tokens.get(this.tokenId);
        const actor = tokenDocument?.actor ?? game.actors.get(this.actorId);
        if (!actor || !tokenDocument) return {};

        const ns = Visage.DATA_NAMESPACE;
        const moduleData = actor.flags?.[ns] || {};
        
        // Use helper to get defaults
        const tokenDefaults = this._getTokenDefaults();
        
        const defaultVisage = await this._processVisageEntry(
            "default", 
            tokenDefaults.name, 
            tokenDefaults.token, 
            tokenDefaults.scale || 1.0, 
            false,
            tokenDefaults.disposition, 
            tokenDefaults.ring,
            false
        );

        if (defaultVisage.hasRing) {
            const r = tokenDefaults.ring;
            const parts = [game.i18n.localize("VISAGE.RingConfig.Title")];
            if (r.subject?.texture) parts.push(`${game.i18n.localize("VISAGE.RingConfig.SubjectTexture")}: ${r.subject.texture}`);
            if (r.subject?.scale) parts.push(`${game.i18n.localize("VISAGE.RingConfig.SubjectScale")}: ${r.subject.scale}`);
            if (r.colors?.ring) parts.push(`${game.i18n.localize("VISAGE.RingConfig.RingColor")}: ${r.colors.ring}`);
            if (r.colors?.background) parts.push(`${game.i18n.localize("VISAGE.RingConfig.BackgroundColor")}: ${r.colors.background}`);
            
            defaultVisage.ringTooltip = parts.join("<br>");
        } else {
            defaultVisage.ringTooltip = game.i18n.localize("VISAGE.RingConfig.RingDisabled");
        }

        let visages = [];
        if (this._tempVisages) {
             visages = this._tempVisages;
        } else {
            const normalizedData = Visage.getVisages(actor);
            visages = await Promise.all(normalizedData.map(async (data) => {
                return this._processVisageEntry(
                    data.id, data.name, data.path, data.scale, false, data.disposition, data.ring, false
                );
            }));
        }
        
        const normalizedSource = Visage.getVisages(actor);
        
        const processedVisages = await Promise.all(visages.map(async (v) => {
            const original = normalizedSource.find(s => s.id === v.id);
            const originalRing = original ? (original.ring || {}) : {};
            const currentRing = v.ring || {};
            const currentEmpty = foundry.utils.isEmpty(currentRing);
            const originalEmpty = foundry.utils.isEmpty(originalRing);
            
            let isRingDirty = false;
            if (currentEmpty && originalEmpty) isRingDirty = false;
            else isRingDirty = !foundry.utils.objectsEqual(currentRing, originalRing);
            
            v.ringClass = (v.hasRing ? "ring-active" : "") + (isRingDirty ? " ring-dirty" : "");
            return v;
        }));

        return {
            visages: processedVisages,
            defaultVisage: defaultVisage, 
            isDirty: this._isDirty || false
        };
    }

    /**
     * Processes a single visage data object to prepare it for template rendering.
     * This function takes raw visage data and computes several derived properties needed by the UI.
     *
     * @param {string} id - The unique ID of the visage.
     * @param {string} name - The name of the visage.
     * @param {string} path - The token image path.
     * @param {number} scale - The token scale.
     * @param {boolean} isFlippedX - Whether the token is horizontally flipped.
     * @param {number|null} disposition - The token disposition value.
     * @param {object|null} ring - The dynamic ring configuration.
     * @returns {Promise<object>} A promise that resolves to the processed context object for the template.
     * @private
     */
    async _processVisageEntry(id, name, path, scale, isFlippedX, disposition, ring) {
        let dispositionType = "none";
        let dispositionValue = 0; 
        let buttonText = game.i18n.localize("VISAGE.Config.Disposition.Button.Default");

        if (disposition === -2) {
            dispositionType = "illusion";
            buttonText = game.i18n.localize("VISAGE.Config.Disposition.Button.Illusion");
        } else if (disposition !== null && disposition !== undefined) {
            dispositionType = "disguise";
            dispositionValue = disposition;
            const dispoName = this._dispositionMap[disposition]?.name || "";
            buttonText = game.i18n.format("VISAGE.Config.Disposition.Button.Disguise", { name: dispoName });
        } else {
            dispositionType = "none";
            buttonText = game.i18n.localize("VISAGE.Config.Disposition.Button.Default");
        }

        const cleanRing = (ring && !foundry.utils.isEmpty(ring)) ? ring : null;
        const hasRing = !!(cleanRing && cleanRing.enabled);
        
        const ringIcon = hasRing ? "fas fa-bullseye" : "far fa-circle";
        let ringClass = hasRing ? "ring-active" : "";
        
        const ringTooltip = hasRing ? "Dynamic Ring Configured" : "Configure Dynamic Ring";

        return {
            id,
            name,
            path,
            scale: Math.round(Math.abs(scale) * 100),
            isFlippedX: (scale < 0) || isFlippedX,
            dispositionType,
            dispositionValue,
            dispositionButtonText: buttonText,
            resolvedPath: await Visage.resolvePath(path),
            
            ring: cleanRing || {},
            hasRing,
            ringIcon,
            ringClass,
            ringTooltip
        };
    }

    /**
     * Handles the 'Add Visage' button click event.
     * It reads the current form data into `_tempVisages`, adds a new blank visage entry,
     * marks the form as dirty, and triggers a re-render.
     * @param {PointerEvent} event - The triggering click event.
     * @param {HTMLElement} target - The button element that was clicked.
     * @private
     */
    async _onAddVisage(event, target) {
        this._tempVisages = await this._readFormData(this.element);
        
        const newEntry = await this._processVisageEntry(
            foundry.utils.randomID(16), 
            "", "", 1.0, false, null, null
        );
        this._tempVisages.push(newEntry);
        
        this._isDirty = true;
        this.render();
    }

    /**
     * Handles the 'Delete Visage' button click event.
     * It reads the current form data, filters out the visage to be deleted by its ID,
     * marks the form as dirty, and triggers a re-render.
     * @param {PointerEvent} event - The triggering click event.
     * @param {HTMLElement} target - The button element that was clicked.
     * @private
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
     * Handles opening the VisageRingEditor application for a specific visage.
     * It creates a new `VisageRingEditor` instance, passing the current ring data and a callback
     * function to update the data in this parent application upon save.
     * @param {PointerEvent} event - The triggering click event.
     * @param {HTMLElement} target - The button element that was clicked.
     * @private
     */
    _onOpenRingEditor(event, target) {
        this._readFormData(this.element).then(currentData => {
            this._tempVisages = currentData;
            
            const row = target.closest(".visage-list-item");
            const index = parseInt(row.dataset.index);
            const visageData = this._tempVisages[index];

            // 1. Calculate Effective Path for validation
            const defaults = this._getTokenDefaults();
            // Use visage path if present, otherwise fall back to default token path
            const effectivePath = visageData.path || defaults.token || "";

            const editorId = `visage-ring-editor-${this.actorId}-${this.tokenId}-${visageData.id}`;
            
            const ringEditor = new VisageRingEditor({
                ringData: visageData.ring,
                visageName: visageData.name,
                // NEW: Pass the resolved path to the editor so it can check file type
                effectivePath: effectivePath, 
                id: editorId,
                callback: (newRingData) => {
                    this.updateRingData(index, newRingData);
                },
                position: {
                    left: event.clientX + 20,
                    top: event.clientY - 50
                }
            });
            this.childApps.add(ringEditor);
            ringEditor.render(true);
        });
    }

    /**
     * Callback function for the VisageRingEditor to update ring data on the parent config app.
     * @param {number} index - The index of the visage in the `_tempVisages` array.
     * @param {object} ringData - The new ring data object from the editor.
     * @protected
     */
    updateRingData(index, ringData) {
        if (this._tempVisages && this._tempVisages[index]) {
            this._tempVisages[index].ring = ringData;
            this._markDirty();
            this.render();
        }
    }

    /**
     * Toggles the visibility of the disposition settings popout for a visage row.
     * @param {PointerEvent} event - The triggering click event.
     * @param {HTMLElement} target - The button element that was clicked.
     * @private
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
     * Updates the disposition button text based on the current selection in the popout.
     * @param {HTMLElement} popout - The popout element containing the disposition controls.
     * @private
     */
    _updateButtonText(popout) {
        const cell = popout.closest(".visage-disposition-cell");
        const button = cell.querySelector(".visage-disposition-button");
        const dispoInput = popout.querySelector('input[name$=".dispositionType"]:checked');
        if (!dispoInput) return;
        const dispoType = dispoInput.value;
        const select = popout.querySelector('select');
        let buttonText = game.i18n.localize("VISAGE.Config.Disposition.Button.Default");
        if (dispoType === "disguise") {
            select.disabled = false;
            const val = parseInt(select.value);
            const dispoName = this._dispositionMap[val]?.name || "";
            buttonText = game.i18n.format("VISAGE.Config.Disposition.Button.Disguise", { name: dispoName });
        } else {
            select.disabled = true;
            if (dispoType === "illusion") {
                buttonText = game.i18n.localize("VISAGE.Config.Disposition.Button.Illusion");
            }
        }
        button.textContent = buttonText;
        this._markDirty();
    }
    
    /**
     * Handles changes to the disposition type radio buttons.
     * @param {Event} event - The triggering change event.
     * @param {HTMLElement} target - The input element that changed.
     * @private
     */
    _onChangeDispositionType(event, target) { this._updateButtonText(target.closest(".visage-disposition-popout")); }
    
    /**
     * Handles changes to the disposition value dropdown.
     * @param {Event} event - The triggering change event.
     * @param {HTMLElement} target - The select element that changed.
     * @private
     */
    _onChangeDispositionValue(event, target) { this._updateButtonText(target.closest(".visage-disposition-popout")); }

    /**
     * Opens a FilePicker to select a token image.
     * @param {PointerEvent} event - The triggering click event.
     * @param {HTMLElement} target - The button element that was clicked.
     * @private
     */
    _onOpenFilePicker(event, target) {
        const group = target.closest(".visage-path-group");
        const input = group.querySelector("input");
        const fp = new FilePicker({
            type: "imagevideo",
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
     * Marks the form as "dirty," indicating there are unsaved changes.
     * @private
     */
    _markDirty() {
        this._isDirty = true;
        const btn = this.element.querySelector(".visage-save");
        if (btn) btn.classList.add("dirty");
    }

    /**
     * Closes the application and all its child applications.
     * @param {object} [options] - Options for closing the application.
     * @returns {Promise<void>}
     * @override
     */
    async close(options) {
        for (const app of this.childApps) {
            app.close(); 
        }
        this.childApps.clear();
        return super.close(options);
    }

    /**
     * Validate a file path against allowed image and video extensions.
     * STRICT MODE: Must have a valid extension.
     * @param {string} path
     * @returns {boolean}
     */
    _isValidPath(path) {
        if (!path) return true; // Empty path is valid (inherits default)
        
        const validExtensions = new Set([
            ...Object.keys(CONST.IMAGE_FILE_EXTENSIONS),
            ...Object.keys(CONST.VIDEO_FILE_EXTENSIONS)
        ]);

        // Clean query parameters
        const cleanPath = path.split("?")[0].trim();
        
        // Extract extension
        const parts = cleanPath.split(".");
        // If no dot, or it ends with a dot, it has no valid extension
        if (parts.length < 2) return false; 
        
        const extension = parts.pop().toLowerCase();
        
        // Strict check: The extension MUST be in the allowlist.
        // This permits "file_*.webp" (valid) but rejects "file_*" (invalid) or "file.txt" (invalid).
        return validExtensions.has(extension);
    }

    /**
     * Handles the 'Save' button click event.
     * It reads the final form data, validates it, and updates the actor's flags
     * with the new visage configuration.
     * @param {PointerEvent} event - The triggering click event.
     * @param {HTMLElement} target - The button element that was clicked.
     * @returns {Promise<void>}
     * @private
     */
    async _onSave(event, target) {
        event.preventDefault();
        const scene = game.scenes.get(this.sceneId);
        const tokenDocument = scene?.tokens.get(this.tokenId);
        const actor = tokenDocument?.actor ?? game.actors.get(this.actorId);
        if (!actor) return;
        
        const ns = Visage.DATA_NAMESPACE;
        const moduleData = actor.flags?.[ns] || {};
        const tokenDefaults = moduleData[this.tokenId]?.defaults || {
            name: tokenDocument?.name,
            token: tokenDocument?.texture.src
        };

        const currentVisages = await this._readFormData(this.element);
        
        const newKeys = new Set(); 
        const visagesToSave = [];

        for (const v of currentVisages) {
            // Validate Path
            const rawPath = v.path ? v.path.trim() : "";
            if (rawPath && !this._isValidPath(rawPath)) {
                ui.notifications.error(game.i18n.format("VISAGE.Notifications.InvalidPath", { name: v.name || "Visage" }));
                return; // BLOCK SAVE
            }

            const finalPath = rawPath || (tokenDefaults.token || "");
            const finalName = v.name ? v.name.trim() : (tokenDefaults.name || "Visage");

            if (!finalPath) {
                return ui.notifications.error(game.i18n.format("VISAGE.Notifications.NoPath", { name: finalName }));
            }
            
            newKeys.add(v.id); 
            visagesToSave.push({ ...v, name: finalName, path: finalPath });
        }

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

            const ringToSave = (v.ring && !foundry.utils.isEmpty(v.ring)) ? v.ring : null;

            newVisages[v.id] = {
                name: v.name,
                path: v.path,
                scale: scale,
                disposition: disposition,
                ring: ringToSave
            };
        }

        const updates = {
            [`flags.${ns}.alternateVisages`]: newVisages,
            [`flags.${ns}.-=alternateImages`]: null 
        };

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
        ui.notifications.info(game.i18n.localize("VISAGE.Notifications.Saved"));
        
        if (tokenDocument?.object) {
            tokenDocument.object.refresh();
        }
        this.close();
    }

    /**
     * Helper to Scrape HTML Form into Array of Objects.
     * The HTML form presents the data in a flat structure (e.g., `visages.0.name`, `visages.1.name`). This method
     * uses `FormDataExtended` to parse these fields into a JavaScript object. It then identifies all unique
     * visage indices and iterates through them to rebuild each visage object, processing and normalizing
     * values like scale and disposition along the way. It also safely parses JSON data for the ring configuration.
     * This is the reverse of `_prepareContext`, turning the UI state back into structured data.
     *
     * @param {HTMLElement} formElement - The <form> element containing the input fields.
     * @returns {Promise<Array<object>>} A promise that resolves to an array of processed visage objects.
     * @private
     */
    async _readFormData(formElement) {
        const formData = new foundry.applications.ux.FormDataExtended(formElement).object;
        const visages = [];
        
        const indices = new Set();
        for (const key of Object.keys(formData)) {
            const match = key.match(/^visages\.(\d+)\./);
            if (match) indices.add(parseInt(match[1]));
        }

        for (const i of Array.from(indices).sort((a,b) => a - b)) {
            const id = formData[`visages.${i}.id`];
            const name = formData[`visages.${i}.name`];
            const path = formData[`visages.${i}.path`];
            const rawScale = formData[`visages.${i}.scale`];
            const scale = (rawScale ? parseFloat(rawScale) : 100) / 100;
            const isFlippedX = formData[`visages.${i}.isFlippedX`] || false;
            const dispositionType = formData[`visages.${i}.dispositionType`];
            const dispositionValue = formData[`visages.${i}.dispositionValue`];

            let ring = null; 
            try {
                const ringRaw = formData[`visages.${i}.ringJSON`];
                if (ringRaw) ring = JSON.parse(ringRaw);
            } catch (e) { console.warn("Visage | Failed to parse ring data", e); }

            let disposition = null;
            if (dispositionType === "illusion") {
                disposition = -2;
            } else if (dispositionType === "disguise") {
                disposition = parseInt(dispositionValue);
            }

            visages.push(await this._processVisageEntry(
                id, name, path, scale, isFlippedX, disposition, ring
            ));
        }
        return visages;
    }

    /**
     * Attaches event listeners after the application is rendered.
     * @param {object} context - The data context used to render the template.
     * @param {object} options - Rendering options.
     * @protected
     * @override
     */
    _onRender(context, options) {
        // --- RTL Support ---
        const rtlLanguages = ["ar", "he", "fa", "ur"];
        if (rtlLanguages.includes(game.i18n.lang)) {
            this.element.setAttribute("dir", "rtl");
            this.element.classList.add("rtl");
        }

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