import { Visage } from "./visage.js";

export async function handleTokenConfig(app, html) {
    const tokenDocument = app.document;
    const actor = tokenDocument?.actor;
    if (!actor) return;

    const tokenId = tokenDocument.id;

    // Add the nav link if it doesn't exist
    const nav = html.querySelector('nav.sheet-tabs');
    if (nav && !nav.querySelector('a[data-tab="visages"]')) {
        nav.insertAdjacentHTML('beforeend', '<a data-action="tab" data-tab="visages" data-group="sheet"><img src="modules/visage/icons/switch_account.svg" alt="Visages" class="visage-tab-icon"><span>Visages</span></a>');
    }

    // Find our tab content area
    let tabContent = html.querySelector('div[data-tab="visages"]');
    if (!tabContent) {
        const newTab = document.createElement('div');
        newTab.classList.add('tab');
        newTab.dataset.tab = 'visages';
        newTab.dataset.group = 'sheet';
        
        const lastTab = html.querySelector('.tab:last-of-type');
        if (lastTab) {
            lastTab.after(newTab);
        } else { // Fallback if no tabs exist
            const sheetBody = html.querySelector('.sheet-body');
            if (sheetBody) {
                sheetBody.append(newTab);
            }
        }
        tabContent = newTab;
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
    tabContent.innerHTML = tabHtml;

    // --- Event Listeners (using event delegation) ---
    tabContent.addEventListener('click', (event) => {
        const addBtn = event.target.closest('.visage-add');
        const deleteBtn = event.target.closest('.visage-delete');
        const pickerBtn = event.target.closest('.file-picker-button');

        if (addBtn) {
            event.preventDefault();
            const list = tabContent.querySelector('.visage-list');
            if (!list) return;
            
            const newRowHtml = `
                <li class="flexrow">
                    <input type="text" name="visage-key" value="" placeholder="Visage Name (e.g. Wolf)" />
                    <div class="form-fields" style="flex: 2;">
                        <input type="text" name="visage-path" value="" placeholder="path/to/image.webp" />
                        <button type="button" class="file-picker-button"><i class="fas fa-file-import fa-fw"></i></button>
                    </div>
                    <a class="visage-delete"><i class="fas fa-trash"></i></a>
                </li>
            `;
            list.insertAdjacentHTML('beforeend', newRowHtml);
            app.setPosition({ height: "auto" });
            return;
        }

        if (deleteBtn) {
            event.preventDefault();
            deleteBtn.closest('li')?.remove();
            app.setPosition({ height: "auto" });
            return;
        }

        if (pickerBtn) {
            event.preventDefault();
            const targetInput = pickerBtn.closest('.form-fields')?.querySelector('input[type="text"]');
            if (!targetInput) return;

            new FilePicker({
                type: "image",
                current: targetInput.value,
                callback: (path) => {
                    targetInput.value = path;
                }
            }).browse(targetInput.value);
            return;
        }
    });

    // --- Data Saving ---
    tabContent.querySelector('.visage-save')?.addEventListener('click', async (event) => {
        event.preventDefault();

        const visageRows = tabContent.querySelectorAll('.visage-list li');
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

        // Save Universal Alternate Visages
        visageRows.forEach(row => {
            const key = row.querySelector('input[name="visage-key"]')?.value.trim();
            const path = row.querySelector('input[name="visage-path"]')?.value.trim();

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
            
            const canvasToken = canvas.tokens.get(tokenDocument.id);
            if (canvasToken) {
                canvasToken.refresh();
            }
            
        } else {
            ui.notifications.info("No changes to save.");
        }
    });
    
    // --- Final UI Adjustments ---
    if (app._tabs && app._tabs[0]?.active === 'visages') {
        tabContent.classList.add('active');
    }
    app.setPosition({ height: "auto" });
}