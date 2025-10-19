import { Visage } from "./visage.js";

export async function handleTokenConfig(app, html) {
    const tokenDocument = app.document;
    const actor = tokenDocument?.actor;
    if (!actor) return;

    const tokenId = tokenDocument.id;
    const jQueryHtml = $(html);

    // Add the nav link if it doesn't exist
    const nav = jQueryHtml.find('nav.sheet-tabs');
    if (nav.find('a[data-tab="visages"]').length === 0) {
        nav.append('<a data-action="tab" data-tab="visages" data-group="sheet"><img src="modules/visage/icons/switch_account.svg" alt="Visages" class="visage-tab-icon"><span>Visages</span></a>');
    }

    // Find our tab content area
    let tabContent = jQueryHtml.find('div[data-tab="visages"]');
    if (tabContent.length === 0) {
        tabContent = $('<div class="tab" data-tab="visages" data-group="sheet"></div>');
        jQueryHtml.find('.tab').last().after(tabContent);
    }

    // --- Prepare Data for the Template ---
    const moduleData = actor.flags?.[Visage.DATA_NAMESPACE] || {};
    const alternateImages = moduleData.alternateImages || {};
    
    // Get token-specific defaults, or use the token's current data as a fallback
    const tokenDefaults = moduleData[tokenId]?.defaults || {
        name: tokenDocument.name,
        token: tokenDocument.texture.src
    };

    const visageEntries = await Promise.all(Object.entries(alternateImages).map(async ([key, path]) => {
        return { key, path, resolvedPath: await Visage.resolvePath(path) };
    }));

    const templateData = {
        visages: visageEntries,
        defaultTokenName: tokenDefaults.name,
        defaultToken: tokenDefaults.token
    };

    // Render the template and inject it
    const tabHtml = await renderTemplate('modules/visage/templates/visage-config-tab.html', templateData);
    tabContent.html(tabHtml);

    // --- Event Listeners ---

    tabContent.find('.visage-add').on('click', (event) => {
        event.preventDefault();
        const list = tabContent.find('.visage-list');
        const newRow = $(`
            <li class="flexrow">
                <input type="text" name="visage-key" value="" placeholder="Visage Name (e.g. Wolf)" />
                <div class="form-fields" style="flex: 2;">
                    <input type="text" name="visage-path" value="" placeholder="path/to/image.webp" />
                    <button type="button" class="file-picker-button"><i class="fas fa-file-import fa-fw"></i></button>
                </div>
                <a class="visage-delete"><i class="fas fa-trash"></i></a>
            </li>
        `);
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

        // --- Validation Pass for Alternate Visages ---
        for (const row of visageRows.get()) {
            const jqRow = $(row);
            const keyInput = jqRow.find('input[name="visage-key"]');
            const pathInput = jqRow.find('input[name="visage-path"]');
            let key = keyInput.val().trim();
            const path = pathInput.val().trim();

            if (!key && !path) continue; // Skip blank rows

            if (!key) {
                let defaultKey;
                do {
                    defaultKey = `Visage ${newVisageCounter++}`;
                } while (keysInForm.has(defaultKey));
                key = defaultKey;
                keyInput.val(key);
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

        // Save Universal Alternate Visages
        const keysToKeep = new Set();
        visageRows.each((i, row) => {
            const key = $(row).find('input[name="visage-key"]').val().trim();
            const path = $(row).find('input[name="visage-path"]').val().trim();

            if (key && path) {
                keysToKeep.add(key);
                if (originalAlternates[key] !== path) {
                    updatePayload[`flags.${ns}.alternateImages.${key}`] = path;
                }
            }
        });

        // Determine which alternate keys were deleted
        for (const key of originalKeys) {
            if (!keysToKeep.has(key)) {
                updatePayload[`flags.${ns}.alternateImages.-=${key}`] = null;
            }
        }

        if (Object.keys(updatePayload).length > 0) {
            await actor.update(updatePayload);
            ui.notifications.info("Visage data saved.");
            
            // D) Force the HUD to refresh (ensuring the UI catches up)
            const canvasToken = canvas.tokens.get(tokenDocument.id);
            if (canvasToken) {
                canvasToken.refresh();
            }
            // ----------------------------------------------------------------------------------
            
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