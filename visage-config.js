/**
 * This file defines the VisageConfigApp class.
 * This class is a standalone Application window used to configure
 * the "visages" (alternate token appearances) for a specific actor.
 */

import { Visage } from "./visage.js";

/**
 * The Visage Configuration Application.
 *
 * This window allows a user to add, edit, and remove alternate visages
 * for an actor. It is opened from the VisageSelector (the HUD) and
 * edits the data stored in the actor's flags.
 */
export class VisageConfigApp extends Application {
    /**
     * @param {string} actorId - The ID of the Actor being configured.
     * @param {string} tokenId - The ID of the Token this config was opened from.
     * @param {string} sceneId - The ID of the Scene the token is on.
     * @param {object} [options={}] - Standard Application options.
     */
    constructor(actorId, tokenId, sceneId, options = {}) {
        super(options);
        this.actorId = actorId;
        this.tokenId = tokenId;
        this.sceneId = sceneId; 

        /**
         * A temporary flag to track if the "Add New" button was clicked,
         * which signals `getData` to add a blank row to the form.
         * @type {boolean}
         * @private
         */
        this._visage_addNewRow = false;

        /**
         * Tracks whether the form has unsaved changes.
         * @type {boolean}
         */
        this.isDirty = false;

        /**
         * Helper map for disposition names
         * @type {object}
         * @private
         */
        this._dispositionMap = {
            [-2]: { name: "Secret"   },
            [-1]: { name: "Hostile"  },
            [0]:  { name: "Neutral"  },
            [1]:  { name: "Friendly" }
        };
    }

    /**
     * Defines the default options for this application window.
     * @returns {object}
     * @override
     */
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            template: `modules/visage/templates/visage-config-app.hbs`,
            title: "Visage Configuration",
            classes: ["visage-config-app", "visage-dark-theme"], 
            popOut: true,
            width: "auto",
            height: "auto",
            minimizable: false,
            resizable: true, 
            closeOnUnfocus: false // Prevents closing when clicking the FilePicker
        });
    }

    /**
     * Prepares all data needed to render the application's template.
     * @param {object} [options={}] - Options passed during rendering.
     * @returns {Promise<object>} The data object for the template.
     * @override
     */
    async getData(options = {}) {
        const actor = game.actors.get(this.actorId);
        
        // Need the scene and token *document* to get the token's
        // original, unmodified default data.
        const scene = game.scenes.get(this.sceneId);
        const tokenDocument = scene?.tokens.get(this.tokenId);

        if (!actor || !tokenDocument) {
            ui.notifications.error("Visage | Could not find Actor or Token Document for config.");
            return {};
        }

        const moduleData = actor.flags?.[Visage.DATA_NAMESPACE] || {};

        // --- Prepare Visage Data ---
        // Get the saved defaults for *this specific token*.
        // If they don't exist, create them from the token document itself.
        const tokenDefaults = moduleData[this.tokenId]?.defaults || {
            name: tokenDocument.name,
            token: tokenDocument.texture.src,
            scale: tokenDocument.texture.scaleX ?? 1.0,
            disposition: tokenDocument.disposition ?? 0
        };
        // Convert scale (e.g., 1.0) to a percentage (e.g., 100) for the form input
        tokenDefaults.scale = Math.round(Math.abs(tokenDefaults.scale) * 100);

        // --- Process Alternate Visages ---
        // Use the new flag key
        const alternateVisages = moduleData[Visage.ALTERNATE_FLAG_KEY] || {};
        // Map the stored flag data into a standardised array for the template.
        const visageEntries = await Promise.all(Object.entries(alternateVisages).map(async ([uuid, data]) => {
            // Handle old string-only data format vs. new {path, scale} object format
            const isObject = typeof data === 'object' && data !== null;
            const path = isObject ? data.path : data;
            const scale = isObject ? (data.scale ?? 1.0) : 1.0;
            const isFlippedX = scale < 0; // Check if the saved scale is negative
            
            // Get disposition
            let disposition = (isObject && data.disposition !== undefined) ? data.disposition : null;
            
            // Determine disposition state for template
            let dispositionType, dispositionValue, dispositionButtonText;
            
            if (disposition === null || disposition === undefined) {
                dispositionType = "none";
                dispositionValue = 0; // Default select to neutral
                dispositionButtonText = "Default";
            } else if (disposition === -2) {
                dispositionType = "illusion";
                dispositionValue = -2; 
                dispositionButtonText = "Illusion (Secret)";
            } else if (this._dispositionMap[disposition]) {
                // Safely check if the key exists (handles -1, 0, 1)
                dispositionType = "disguise";
                dispositionValue = disposition; 
                dispositionButtonText = `Disguise: ${this._dispositionMap[disposition].name}`;
            } else {
                // Fallback for any other unknown value
                Visage.log(`Found unknown disposition value: ${disposition} for visage "${key}". Resetting to Default.`);
                dispositionType = "none";
                dispositionValue = 0;
                dispositionButtonText = "Default";
            }

            return {
                uuid: uuid,
                key: data.name,
                path: data.path,
                scale: Math.round(Math.abs(scale) * 100), // Form input shows positive percentage
                isFlippedX,            // Checkbox state
                dispositionType,       // 'none', 'disguise', 'illusion'
                dispositionValue,      // -1, 0, 1, -2
                dispositionButtonText, // "Default", "Disguise: Friendly", etc.
                // Resolve the path (for wildcards) to show a preview image
                resolvedPath: await Visage.resolvePath(path) 
            };
        }));
        
        // Sort visages alphabetically by key for a consistent UI
        visageEntries.sort((a, b) => a.key.localeCompare(b.key));

        // If the "Add New" button was clicked, push a blank entry
        if (this._visage_addNewRow) {
            visageEntries.push({
                uuid: "",
                key: "",
                path: "",
                scale: 100,
                isFlippedX: false,
                dispositionType: "none",
                dispositionValue: 0,
                dispositionButtonText: "Default",
                resolvedPath: ""
            });
            this._visage_addNewRow = false; // Reset the flag
        }

        // Data that will be passed to the .hbs template
        return {
            visages: visageEntries,
            defaultTokenName: tokenDefaults.name,
            defaultToken: tokenDefaults.token,
            isDirty: this.isDirty // Pass dirty state to show/hide save button state
        };
    }

    /**
     * Attaches event listeners to the application's HTML.
     * @param {jQuery} html - The jQuery-wrapped HTML of the application.
     * @override
     */
    activateListeners(html) {
        super.activateListeners(html);

        // --- Button: Add New Row ---
        html.on('click', '.visage-add', (event) => {
            event.preventDefault();
            this._visage_addNewRow = true; // Set the flag
            this.render(true); // Re-render the app to show the new row
        });

        // --- Button: Delete Row ---
        html.on('click', '.visage-delete', (event) => {
        const row = event.target.closest('li');
            // If the row has a UUID, handle it as a deletion of existing data
            if (row?.dataset?.uuid) {
                this._onFormChange(); 
            }
            row?.remove();
            this.setPosition({ height: "auto" });
        });

        // --- Button: File Picker ---
        html.on('click', '.file-picker-button', (event) => {
            event.preventDefault();
            // Find the text input field associated with this button
            const targetInput = event.target.closest('.form-fields')?.querySelector('input[type="text"]');
            if (!targetInput) return;

            new FilePicker({
                type: "image",
                current: targetInput.value,
                // When a file is selected, update the input's value
                callback: (path) => {
                    targetInput.value = path;
                    // Manually trigger a 'change' event to update the app's dirty state
                    targetInput.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }).browse(targetInput.value);
        });

        // --- Form Dirty State ---
        // Listen for any change on inputs or selects to mark the form as "dirty"
        html.on('input change', 'input, select', () => {
            this._onFormChange();
        });

        // --- Button: Save Changes ---
        html.find('.visage-save')?.on('click', (event) => this._onSaveChanges(event, html));

        // --- Disposition Pop-out Listeners ---

        // Click on button to open pop-out
        html.on('click', '.visage-disposition-button', (event) => {
            event.preventDefault();
            event.stopPropagation(); // Stop click from bubbling to 'click-away' listener
            const button = event.currentTarget;
            const popout = button.nextElementSibling; // Get the .visage-disposition-popout
            if (!popout) return;

            // Close all other open pop-outs
            html.find('.visage-disposition-popout').not(popout).hide();
            // Toggle this one
            $(popout).toggle();
        });

        // Click-away to close (namespaced to this app instance)
        $(document).on(`click.visageConfig.${this.appId}`, (event) => {
            const target = event.target;
            // If click is outside the config app, or *not* on a button/pop-out, close all
            if (!target.closest('.visage-config-app') || 
                (!target.closest('.visage-disposition-button') && !target.closest('.visage-disposition-popout'))) {
                html.find('.visage-disposition-popout').hide();
            }
        });

        // Change controls inside the pop-out
        html.on('change', '.visage-disposition-popout input[type="radio"], .visage-disposition-popout select', (event) => {
            event.preventDefault();
            this._onFormChange(); // Mark as dirty

            const popout = event.target.closest('.visage-disposition-popout');
            if (!popout) return;

            const button = popout.previousElementSibling; // Get the button
            const disguiseSelect = popout.querySelector('select[name="visage-disposition-value"]');
            
            // Get selected radio value
            const type = popout.querySelector('input[type="radio"]:checked').value;
            let buttonText = "Error";

            if (type === "none") {
                disguiseSelect.disabled = true;
                buttonText = "Default";
            } else if (type === "illusion") {
                disguiseSelect.disabled = true;
                buttonText = "Illusion (Secret)";
            } else if (type === "disguise") {
                disguiseSelect.disabled = false;
                const selectedVal = disguiseSelect.value;
                buttonText = `Disguise: ${this._dispositionMap[selectedVal].name}`;
            }

            button.textContent = buttonText;
        });
    }

    /**
     * Overrides the default close method to clean up global listeners.
     * @override
     */
    async close(options) {
        // Unbind the global click listener namespaced to this app
        $(document).off(`click.visageConfig.${this.appId}`);
        return super.close(options);
    }
    
    /**
     * A helper function called when any form field changes.
     * It sets the `isDirty` flag and updates the save button's CSS.
     * @private
     */
    _onFormChange() {
        if (this.isDirty) return; // Already.
        this.isDirty = true;
        // Add a 'dirty' class to the save button (e.g., to make it glow)
        this.element.find('.visage-save').addClass('dirty');
    }

    /**
     * Handles the logic for validating and saving all form data.
     * @param {Event} event - The click event from the save button.
     * @param {jQuery} html - The application's HTML.
     * @private
     */
    async _onSaveChanges(event, html) {
        event.preventDefault();
        this.isDirty = false; // Reset dirty state immediately

        const actor = game.actors.get(this.actorId);
        if (!actor) {
            ui.notifications.error("Visage | Actor not found. Cannot save changes.");
            return;
        }

        const visageRows = html.find('.visage-list li');
        const keysInForm = new Set();
        let validationFailed = false;
        let newVisageCounter = 1;

        // --- 1. VALIDATION PASS ---
        // First, loop through and validate all data before saving anything.
        for (const row of visageRows) {
            const keyInput = row.querySelector('input[name="visage-key"]');
            const pathInput = row.querySelector('input[name="visage-path"]');
            if (!keyInput || !pathInput) continue;

            let key = keyInput.value.trim();
            const path = pathInput.value.trim();

            if (!key && !path) continue; // Skip totally blank rows (e.g., an empty "new" row)

            // Auto-generate a key
            if (!key) {
                key = `Visage ${newVisageCounter++}`;
                keyInput.value = key; // Update the form input field
            }

            // Check for empty paths
            if (!path) {
                ui.notifications.error(`Image path for "${key}" cannot be empty.`);
                validationFailed = true;
                break;
            }
        }

        if (validationFailed) {
            this.isDirty = true; // Re-set dirty state since save failed
            return;
        }

        // --- 2. SAVE PASS ---
        // If validation passed, build the update payload.
        const ns = Visage.DATA_NAMESPACE;
        const alternateFlagKey = Visage.ALTERNATE_FLAG_KEY; // "alternateVisages"

        const currentFlags = actor.flags?.[ns] || {};
        const originalAlternates = currentFlags[alternateFlagKey] || {}; // <- Use new flag key

        const updatePayload = {};
        const keysToKeep = new Set(); 
        let uuid;

        // Loop through all <li> rows again to build the update
        visageRows.each((i, row) => {
            // Check for an existing UUID data attribute
            uuid = row.dataset.uuid || null;

            const key = row.querySelector('input[name="visage-key"]')?.value.trim();
            const path = row.querySelector('input[name="visage-path"]')?.value.trim();
            const scaleInput = row.querySelector('input[name="visage-scale"]')?.value;
            // Convert percentage string back to a float (default to 100% -> 1.0)
            let scale = (scaleInput ? parseInt(scaleInput, 10) : 100) / 100; 
            const isFlippedX = row.querySelector('input[name="visage-flip-x"]')?.checked;

            // Apply flip: store scale as negative if flipped
            if (isFlippedX) {
                scale = -Math.abs(scale); 
            } else {
                scale = Math.abs(scale); 
            }

            // Get Disposition Value
            let savedDisposition = null; // Default to 'null' (No Change)
            const dispoType = row.querySelector('input[name^="visage-disposition-type-"]:checked')?.value;
            if (dispoType === "illusion") {
                savedDisposition = -2;
            } else if (dispoType === "disguise") {
                const val = row.querySelector('select[name="visage-disposition-value"]')?.value;
                savedDisposition = parseInt(val, 10); // -1, 0, or 1
            }

            // Only process rows that have valid data
            if (key && path) {
                    // If it's a new row, assign a UUID
                    if (!uuid) {
                        uuid = foundry.utils.randomID(16); // Generate a new UUID
                    }
                    keysToKeep.add(uuid);

                    // The data object to be saved
                    const newVisageData = { 
                        name: key,
                        path, 
                        scale,
                        disposition: savedDisposition
                    };
                
                // --- Check for changes ---
                const currentData = originalAlternates[uuid];
                // If it's a new entry OR if the JSON stringified data differs
                if (!currentData || JSON.stringify(currentData) !== JSON.stringify(newVisageData)) {
                    updatePayload[`flags.${ns}.${alternateFlagKey}.${uuid}`] = newVisageData;
                }
            }
        });

        // --- Handle Deletions ---
        const originalUUIDs = Object.keys(originalAlternates); // <- Use UUIDs
        for (const originalUUID of originalUUIDs) {
            // If an old UUID is NOT in the new set, it was deleted
            if (!keysToKeep.has(originalUUID)) {
                // Use Foundry's `.-=key` syntax to remove a key from an object
                updatePayload[`flags.${ns}.${alternateFlagKey}.-=${originalUUID}`] = null;
            }
        }

        // --- Final Actor Update ---
        if (Object.keys(updatePayload).length > 0) {
            await actor.update(updatePayload);
            ui.notifications.info("Visage data saved.");
            
            // Refresh the token this app was opened from, in case its
            // active visage was one that just got edited or deleted.
            const canvasToken = canvas.tokens.get(this.tokenId);
            if (canvasToken) {
                canvasToken.refresh();
            }
            
        } else {
            ui.notifications.info("No changes to save.");
        }

        // Close the config window
        this.close();
    }
}