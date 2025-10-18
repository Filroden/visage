import { Visage } from "./visage.js";

export async function handleTokenConfig(app, html) {
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
}
