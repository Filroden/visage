import { VisageSelector } from "./visage-selector.js";

/**
 * Main class for the Visage module.
 *
 * This class handles the initialization of the module, setting up the API,
 * and registering any necessary hooks.
 */
export class Visage {
    /**
     * The ID of the module.
     * @type {string}
     */
    static MODULE_ID = "visage";

    /**
     * The developer's preferred namespace for storing module data.
     * @type {string}
     */
    static DATA_NAMESPACE = "visage";

    /**
     * A helper for logging messages to the console.
     * @param {string} message - The message to log.
     * @param {boolean} force - Whether to force the message to be logged, regardless of debug settings.
     */
    static log(message, force = false) {
        const shouldLog = force || game.modules.get('_dev-mode')?.api?.getPackageDebugValue(this.MODULE_ID);
        if (shouldLog) {
            console.log(`${this.MODULE_ID} | ${message}`);
        }
    }

    /**
     * Resolves a path that may contain wildcards to a single, concrete file path.
     * @param {string} path - The path to resolve.
     * @returns {Promise<string>} - The resolved file path.
     */
    static async resolvePath(path) {
        if (!path || !path.includes('*')) return path;
        try {
            const browseOptions = { wildcard: true };
            let source = "data";
            if (/\.s3\./.test(path)) {
                source = 's3';
                const { bucket, keyPrefix } = foundry.applications.apps.FilePicker.implementation.parseS3URL(path);
                if (bucket) {
                    browseOptions.bucket = bucket;
                    path = keyPrefix;
                }
            } else if (path.startsWith('icons/')) {
                source = 'public';
            }
            const content = await foundry.applications.apps.FilePicker.implementation.browse(source, path, browseOptions);
            if (content.files.length) {
                return content.files[Math.floor(Math.random() * content.files.length)];
            }
        } catch (err) {
            this.log(`Error resolving wildcard path: ${path} | ${err}`, true);
        }
        return path;
    }

    /**
     * Initializes the module and sets up the public API.
     */
    static initialize() {
        this.log("Initializing Visage");

        // Expose the public API.
        game.modules.get(this.MODULE_ID).api = {
            setVisage: this.setVisage.bind(this),
            resetToDefault: this.resetToDefault.bind(this),
            getForms: this.getForms.bind(this),
            isFormActive: this.isFormActive.bind(this),
            resolvePath: this.resolvePath.bind(this)
        };
    }

    /**
     * Switches the actor to the specified form.
     * @param {string} actorId - The ID of the actor to update.
     * @param {string} formKey - The key of the form to switch to.
     * @param {string|null} tokenId - The ID of the specific token to update on the canvas.
     * @returns {Promise<boolean>} - True on success, false otherwise.
     */
    static async setVisage(actorId, formKey, tokenId = null) {
        this.log(`Setting visage for actor ${actorId} to ${formKey}`);
        const actor = game.actors.get(actorId);
        if (!actor) {
            this.log(`Actor not found: ${actorId}`, true);
            return false;
        }

        const moduleData = actor.flags?.[this.DATA_NAMESPACE] || {};
        let newPortraitPath;
        let newTokenPath;

        if (formKey === 'default') {
            const defaults = moduleData.defaults;
            if (!defaults) {
                this.log(`Cannot reset to default; no defaults saved for actor ${actorId}.`, true);
                return false;
            }
            newPortraitPath = defaults.portrait;
            newTokenPath = defaults.token;
        } else {
            const alternateImages = moduleData.alternateImages || {};
            const imagePath = alternateImages[formKey];
            if (!imagePath) {
                this.log(`Form key "${formKey}" not found for actor ${actorId}`, true);
                return false;
            }
            newPortraitPath = imagePath;
            newTokenPath = imagePath;
        }

        const isWildcard = newTokenPath && newTokenPath.includes('*');

        try {
            await actor.update({
                "img": newPortraitPath,
                "prototypeToken.texture.src": newTokenPath,
                "prototypeToken.randomImg": isWildcard,
                [`flags.${this.DATA_NAMESPACE}.currentFormKey`]: formKey
            });

            if (tokenId) {
                const token = canvas.tokens.get(tokenId);
                if (token) {
                    const resolvedTokenPath = await this.resolvePath(newTokenPath);
                    await token.document.update({ "texture.src": resolvedTokenPath });
                }
            }

            this.log(`Successfully updated actor ${actorId} to form ${formKey}`);
            return true;
        } catch (error) {
            this.log(`Failed to update actor ${actorId}: ${error}`, true);
            return false;
        }
    }

    /**
     * Switches the actor back to the default form.
     * @param {string} actorId - The ID of the actor to update.
     * @returns {Promise<boolean>} - True on success, false otherwise.
     */
    static async resetToDefault(actorId) {
        this.log(`Resetting visage for actor ${actorId}`);
        return await this.setVisage(actorId, "default");
    }

    /**
     * Retrieves the stored alternateImages data for the actor.
     * @param {string} actorId - The ID of the actor.
     * @returns {object|null} - The alternate images data, or null if not found.
     */
    static getForms(actorId) {
        const actor = game.actors.get(actorId);
        return actor?.flags?.[this.DATA_NAMESPACE]?.alternateImages || null;
    }

    /**
     * Checks if the specified form is currently active on the actor.
     * @param {string} actorId - The ID of the actor.
     * @param {string} formKey - The key of the form to check.
     * @returns {boolean} - True if the form is active, false otherwise.
     */
    static isFormActive(actorId, formKey) {
        const actor = game.actors.get(actorId);
        const currentFormKey = actor?.flags?.[this.DATA_NAMESPACE]?.currentFormKey;
        return currentFormKey === formKey;
    }
}

/**
 * Hook to initialize the module once the game is ready.
 */
Hooks.once("init", () => {
    Visage.initialize();
});

// Add a static property to the Visage class to track open apps.
Visage.apps = {};

/**
 * Hook to register the application when rendered.
 */
Hooks.on("renderApplication", (app, html, data) => {
    if (app instanceof VisageSelector) {
        Visage.apps[app.options.id] = app;
    }
});

/**
 * Hook to unregister the application when closed.
 */
Hooks.on("closeApplication", (app) => {
    if (app instanceof VisageSelector) {
        delete Visage.apps[app.options.id];
    }
});

// Keep stored defaults in sync with manual portrait/token changes
Hooks.on("updateActor", async (actor, changed) => {
  if (!actor?.isOwner) return;

  const ns = Visage.DATA_NAMESPACE;
  const mod = actor.flags?.[ns] || {};
  const isDefault = (mod.currentFormKey ?? "default") === "default";
  if (!isDefault) return;

  const updates = {};
  if (changed.img) {
    updates[`flags.${ns}.defaults.portrait`] = actor.img;
  }
  if (foundry.utils.getProperty(changed, "prototypeToken.texture.src") !== undefined) {
    updates[`flags.${ns}.defaults.token`] = actor.prototypeToken.texture.src;
  }

  if (Object.keys(updates).length) {
    await actor.update(updates); // flags-only, no loop (we only react to img/prototypeToken changes)
  }
});

/**
 * Hook for the Token HUD.
 */
Hooks.on("renderTokenHUD", (app, html, data) => {
    const jQueryHtml = $(html);
    if (jQueryHtml.find('.visage-button').length) return; // Prevent duplicate buttons

    const actor = game.actors.get(data.actorId);
    if (!actor || !actor.isOwner) return;

    // Show button if there are any alternate forms OR if a default has been changed.
    const moduleData = actor.flags?.[Visage.DATA_NAMESPACE] || {};
    const hasAlternates = moduleData.alternateImages && Object.keys(moduleData.alternateImages).length > 0;
    const isNotDefault = moduleData.currentFormKey && moduleData.currentFormKey !== 'default';

    if (!hasAlternates && !isNotDefault) return;

    const token = app.object; // Get the token document from the HUD
    if (!token) return;

    const button = $(
        `<div class="control-icon visage-button" title="Change Visage">
            <img src="modules/visage/icons/switch_account.svg" alt="Change Visage" class="visage-icon">
        </div>`
    );

    button.on("click", () => {
        const actorId = actor.id;
        const selectorId = `visage-selector-${actorId}`; 

        // *** GUARD CHECK: If selector is already open for this actor, close it or return. ***
        if (Visage.apps[selectorId]) {
            Visage.apps[selectorId].close();
            return; 
        }

        // Get button position and window size BEFORE rendering
        const buttonRect = button[0].getBoundingClientRect();
        const selectorWidth = 250; 
        const gap = 16;
        
        // Calculate the desired position (to the left, aligned top)
        const top = buttonRect.top; 
        const left = buttonRect.left - selectorWidth - gap; 

        // Create the application with the consistent ID and calculated position
        const selectorApp = new VisageSelector(actor.id, token.id, {
            id: selectorId, // Pass the consistent ID here
            left: left,
            top: top
        });
        
        // Render it
        selectorApp.render(true);
    });

    jQueryHtml.find(".col.left").append(button);
});

/**
 * Hook for the Token Configuration.
 * Injects a new "Visages" tab for managing alternate actor images.
 */
Hooks.on('renderTokenConfig', async (app, html, data) => {
    const actor = app.document?.actor;
    if (!actor) return;

    const jQueryHtml = $(html);

    // Add the nav link if it doesn't exist
    const nav = jQueryHtml.find('nav.sheet-tabs');
    if (nav.find('a[data-tab="visages"]').length=== 0) {
        nav.append('<a data-action="tab" data-tab="visages" data-group="sheet"><img src="modules/visage/icons/switch_account.svg" alt="Visages" class="visage-tab-icon"><span>Visages</span></a>');
        }

    // Find our tab content area. Foundry may have already created a placeholder.
    let tabContent = jQueryHtml.find('div[data-tab="visages"]');
    if (tabContent.length === 0) {
        tabContent = $('<div class="tab" data-tab="visages" data-group="sheet"></div>');
        jQueryHtml.find('.tab').last().after(tabContent);
    }

    // Prepare data for the template
    const moduleData = actor.flags?.[Visage.DATA_NAMESPACE] || {};
    const forms = moduleData.alternateImages || {};
    const defaults = moduleData.defaults || { portrait: actor.img, token: actor.prototypeToken.texture.src };

    const visageEntries = await Promise.all(Object.entries(forms).map(async ([key, path]) => {
        return { key, path, resolvedPath: await Visage.resolvePath(path) };
    }));

    const templateData = {
        visages: visageEntries,
        defaultPortrait: defaults.portrait,
        defaultToken: defaults.token,
        resolvedDefaultPortrait: await Visage.resolvePath(defaults.portrait),
        resolvedDefaultToken: await Visage.resolvePath(defaults.token)
    };

    // Render the template and inject it into our tab pane
    const tabHtml = await renderTemplate('modules/visage/templates/visage-config-tab.html', templateData);
    tabContent.html(tabHtml);

    // --- Event Listeners for the new tab ---

    tabContent.find('.visage-add').on('click', (event) => {
        event.preventDefault();
        const list = tabContent.find('.visage-list');
        const newRow = $(
            `<li class="flexrow">
                <input type="text" name="visage-key" value="" placeholder="Visage Name (e.g. Wolf)" />
                <div class="form-fields" style="flex: 2;">
                    <input type="text" name="visage-path" value="" placeholder="path/to/image.webp" />
                    <button type="button" class="file-picker-button"><i class="fas fa-file-import fa-fw"></i></button>
                </div>
                <a class="visage-delete"><i class="fas fa-trash"></i></a>
            </li>`
        );
        list.append(newRow);
        app.setPosition({ height: "auto" });
    });

    tabContent.on('click', '.visage-delete', (event) => {
        event.preventDefault();
        $(event.currentTarget).closest('li').remove();
        app.setPosition({ height: "auto" });
    });
    
    tabContent.on('click', '.file-picker-button', (event) => {
        event.preventDefault();
        const targetInput = $(event.currentTarget).closest('.form-fields').find('input[type="text"]');
        new FilePicker({
            type: "image",
            current: targetInput.val(),
            callback: (path) => {
                targetInput.val(path);
            }
        }).browse(targetInput.val());
    });

    // --- Data Saving ---
    tabContent.find('.visage-save').on('click', async (event) => {
        event.preventDefault();

        const visageRows = tabContent.find('.visage-list li');
        const keysInForm = new Set();
        let validationFailed = false;
        let newVisageCounter = 1;

        // --- Validation Pass ---
        for (const row of visageRows.get()) {
            const jqRow = $(row);
            const keyInput = jqRow.find('input[name="visage-key"]');
            const pathInput = jqRow.find('input[name="visage-path"]');
            let key = keyInput.val().trim();
            const path = pathInput.val().trim();

            // If both are empty, it's a blank row that will be skipped by the save logic.
            if (!key && !path) continue;

            // 1. Handle blank names
            if (!key) {
                let defaultKey;
                // Find a unique default key that isn't already in the form
                do {
                    defaultKey = `Visage ${newVisageCounter++}`;
                } while (keysInForm.has(defaultKey));
                key = defaultKey;
                keyInput.val(key); // Visually update the input for the user
            }

            // 2. Check for duplicate names
            if (keysInForm.has(key)) {
                ui.notifications.error(`Duplicate visage name found: "${key}". Please use unique names.`);
                validationFailed = true;
                break;
            }

            // 3. Check for empty file path
            if (!path) {
                ui.notifications.error(`Image path for "${key}" cannot be empty.`);
                validationFailed = true;
                break;
            }

            keysInForm.add(key);
        }

        if (validationFailed) {
            return; // Halt the save if validation fails
        }

        // --- Save Pass (if validation succeeded) ---
        const moduleData = actor.flags?.[Visage.DATA_NAMESPACE] || {};
        const originalForms = moduleData.alternateImages || {};
        const originalKeys = Object.keys(originalForms);

        const updatePayload = {};
        const keysToKeep = new Set();

        // Capture defaults if they don't exist
        if (!moduleData.defaults) {
            updatePayload[`flags.${Visage.DATA_NAMESPACE}.defaults`] = {
                portrait: actor.img,
                token: actor.prototypeToken.texture.src
            };
        }

        // Get current forms from the DOM (now that they are validated)
        visageRows.each((i, row) => {
            const key = $(row).find('input[name="visage-key"]').val().trim();
            const path = $(row).find('input[name="visage-path"]').val().trim();

            if (key && path) {
                keysToKeep.add(key);
                if (originalForms[key] !== path) {
                    updatePayload[`flags.${Visage.DATA_NAMESPACE}.alternateImages.${key}`] = path;
                }
            }
        });

        // Determine which keys were deleted
        for (const key of originalKeys) {
            if (!keysToKeep.has(key)) {
                updatePayload[`flags.${Visage.DATA_NAMESPACE}.alternateImages.-=${key}`] = null;
            }
        }

        if (Object.keys(updatePayload).length > 0) {
            await actor.update(updatePayload);
            ui.notifications.info("Visage forms have been saved.");
        } else {
            ui.notifications.info("No changes to save.");
        }
    });
    
    // --- Final UI Adjustments ---
    if (app._tabs && app._tabs[0] && app._tabs[0].active === 'visages') {
        tabContent.addClass('active');
    }
    app.setPosition({ height: "auto" });
});