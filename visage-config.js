import { Visage } from "./visage.js";

/**
 * A standalone application window for configuring Visages.
 * This is opened from the VisageSelector HUD.
 */
export class VisageConfigApp extends Application {
    constructor(actorId, tokenId, sceneId, options = {}) {
        super(options);
        this.actorId = actorId;
        this.tokenId = tokenId;
        this.sceneId = sceneId; 

        // Track if a new row has been requested
        this._visage_addNewRow = false;

        // Track if the form has changes
        this.isDirty = false;
    }

    /**
     * @override
     */
    static get defaultOptions() {
        return mergeObject(super.defaultOptions, {
            template: `modules/visage/templates/visage-config-app.hbs`,
            title: "Visage Configuration",
            // *** ADDED dark theme class, REMOVED height: 500 ***
            classes: ["visage-config-app", "visage-dark-theme"], 
            popOut: true,
            width: 550,
            height: "auto", // *** CHANGED to auto ***
            minimizable: false,
            resizable: true, 
            closeOnUnfocus: false
        });
    }

    /**
     * @override
     */
    async getData(options = {}) {
        const actor = game.actors.get(this.actorId);
        
        const scene = game.scenes.get(this.sceneId);
        const tokenDocument = scene?.tokens.get(this.tokenId);

        if (!actor || !tokenDocument) {
            ui.notifications.error("Visage | Could not find Actor or Token Document for config.");
            return {};
        }

        const moduleData = actor.flags?.[Visage.DATA_NAMESPACE] || {};
        const alternateImages = moduleData.alternateImages || {};
        
        const tokenDefaults = moduleData[this.tokenId]?.defaults || {
            name: tokenDocument.name,
            token: tokenDocument.texture.src,
            scale: tokenDocument.texture.scaleX ?? 1.0,
            isFlippedX: (tokenDocument.texture.scaleX ?? 1.0) < 0
        };
        tokenDefaults.scale = Math.round(Math.abs(tokenDefaults.scale) * 100);

        const visageEntries = await Promise.all(Object.entries(alternateImages).map(async ([key, data]) => {
            const isObject = typeof data === 'object' && data !== null;
            const path = isObject ? data.path : data;
            const scale = isObject ? (data.scale ?? 1.0) : 1.0;
            const isFlippedX = scale < 0;
            return {
                key,
                path,
                scale: Math.round(Math.abs(scale) * 100), 
                isFlippedX,
                resolvedPath: await Visage.resolvePath(path)
            };
        }));
        
        visageEntries.sort((a, b) => a.key.localeCompare(b.key));

        if (this._visage_addNewRow) {
            visageEntries.push({
                key: "",
                path: "",
                scale: 100,
                isFlippedX: false,
                resolvedPath: ""
            });
            this._visage_addNewRow = false; 
        }

        return {
            visages: visageEntries,
            defaultTokenName: tokenDefaults.name,
            defaultToken: tokenDefaults.token,
            isDirty: this.isDirty // Pass dirty state to template
        };
    }

    /**
     * @override
     */
    activateListeners(html) {
        super.activateListeners(html);

        html.on('click', '.visage-add', (event) => {
            event.preventDefault();
            this._visage_addNewRow = true;
            this.render(true);
        });

        html.on('click', '.visage-delete', (event) => {
            event.preventDefault();
            event.target.closest('li')?.remove();
            this._onFormChange(); // Deleting a row is a change
            this.setPosition({ height: "auto" }); 
        });

        html.on('click', '.file-picker-button', (event) => {
            event.preventDefault();
            const targetInput = event.target.closest('.form-fields')?.querySelector('input[type="text"]');
            if (!targetInput) return;

            new FilePicker({
                type: "image",
                current: targetInput.value,
                callback: (path) => {
                    targetInput.value = path;
                    // Manually trigger the change event for the input
                    targetInput.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }).browse(targetInput.value);
        });

        // *** NEW: Listener for any form change to set dirty state ***
        html.on('input change', 'input, select', () => {
            this._onFormChange();
        });

        // Data Saving
        html.find('.visage-save')?.on('click', (event) => this._onSaveChanges(event, html));
    }
    
    /**
     * Sets the dirty flag and updates the save button.
     * @private
     */
    _onFormChange() {
        if (this.isDirty) return; // No need to do it more than once
        this.isDirty = true;
        this.element.find('.visage-save').addClass('dirty');
    }

    /**
     * Handles saving the changes from the config form.
     * @param {Event} event - The click event.
     * @param {jQuery} html - The application's HTML.
     * @private
     */
    async _onSaveChanges(event, html) {
        event.preventDefault();
        this.isDirty = false; // Reset dirty state on save

        const actor = game.actors.get(this.actorId);
        if (!actor) {
            ui.notifications.error("Visage | Actor not found. Cannot save changes.");
            return;
        }

        const visageRows = html.find('.visage-list li');
        const keysInForm = new Set();
        let validationFailed = false;
        let newVisageCounter = 1;

        // --- Validation Pass for Alternate Visages ---
        for (const row of visageRows) {
            const keyInput = row.querySelector('input[name="visage-key"]');
            const pathInput = row.querySelector('input[name="visage-path"]');
            if (!keyInput || !pathInput) continue;

            let key = keyInput.value.trim();
            const path = pathInput.value.trim();

            if (!key && !path) continue; // Skip blank rows

            if (!key) {
                let defaultKey;
                do {
                    defaultKey = `Visage ${newVisageCounter++}`;
                } while (keysInForm.has(defaultKey));
                key = defaultKey;
                keyInput.value = key;
            }

            if (keysInForm.has(key)) {
                ui.notifications.error(`Duplicate visage name found: "${key}". Please use unique names.`);
                validationFailed = true;
                break;
            }

            if (!path) {
                ui.notifications.error(`Image path for "${key}" cannot be empty.`);
                validationFailed = true;
                break;
            }

            keysInForm.add(key);
        }

        if (validationFailed) return;

        // --- Save Pass ---
        const ns = Visage.DATA_NAMESPACE;
        const currentFlags = actor.flags?.[ns] || {};
        const originalAlternates = currentFlags.alternateImages || {};
        const originalKeys = Object.keys(originalAlternates);

        const updatePayload = {};
        const keysToKeep = new Set();

        visageRows.each((i, row) => {
            const key = row.querySelector('input[name="visage-key"]')?.value.trim();
            const path = row.querySelector('input[name="visage-path"]')?.value.trim();
            const scaleInput = row.querySelector('input[name="visage-scale"]')?.value;
            let scale = (scaleInput ? parseInt(scaleInput, 10) : 100) / 100; 
            const isFlippedX = row.querySelector('input[name="visage-flip-x"]')?.checked;

            if (isFlippedX) {
                scale = -Math.abs(scale); 
            } else {
                scale = Math.abs(scale); 
            }

            if (key && path) {
                keysToKeep.add(key);
                const currentData = originalAlternates[key];
                const isObject = typeof currentData === 'object' && currentData !== null;
                
                const currentPath = isObject ? currentData.path : currentData;
                const currentScale = isObject ? (currentData.scale ?? 1.0) : 1.0;

                const pathChanged = currentPath !== path;

                const scaleTolerance = 0.0001;
                const scaleChanged = Math.abs(currentScale - scale) > scaleTolerance;

                if (pathChanged || scaleChanged) {
                    updatePayload[`flags.${ns}.alternateImages.${key}`] = { path, scale };
                }
            }
        });

        for (const key of originalKeys) {
            if (!keysToKeep.has(key)) {
                updatePayload[`flags.${ns}.alternateImages.-=${key}`] = null;
            }
        }

        if (Object.keys(updatePayload).length > 0) {
            await actor.update(updatePayload);
            ui.notifications.info("Visage data saved.");
            
            const canvasToken = canvas.tokens.get(this.tokenId);
            if (canvasToken) {
                canvasToken.refresh();
            }
            
        } else {
            ui.notifications.info("No changes to save.");
        }

        this.close();
    }
}