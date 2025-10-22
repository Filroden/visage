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

    // If a new row was requested, add a temporary empty entry
    if (app._visage_addNewRow) {
        visageEntries.push({
            key: "",
            path: "",
            scale: 100,
            isFlippedX: false,
            resolvedPath: ""
        });
        app._visage_addNewRow = false;
    }

    const templateData = {
        visages: visageEntries,
        defaultTokenName: tokenDefaults.name,
        defaultToken: tokenDefaults.token
    };

    // Render the template and inject it
    const tabHtml = await renderTemplate('modules/visage/templates/visage-config-tab.hbs', templateData);
    tabContent.innerHTML = tabHtml;

    // --- Event Listeners (using event delegation) ---
    tabContent.addEventListener('click', (event) => {
        const addBtn = event.target.closest('.visage-add');
        const deleteBtn = event.target.closest('.visage-delete');
        const pickerBtn = event.target.closest('.file-picker-button');

        if (addBtn) {
            event.preventDefault();
            app._visage_addNewRow = true;
            app.render(true);
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
            const scaleInput = row.querySelector('input[name="visage-scale"]')?.value;
            let scale = (scaleInput ? parseInt(scaleInput, 10) : 100) / 100;
            const isFlippedX = row.querySelector('input[name="visage-flip-x"]')?.checked;

            if (isFlippedX) {
                scale = -Math.abs(scale); // Ensure scale is negative for flipping
            } else {
                scale = Math.abs(scale); // Ensure scale is positive if not flipped
            }

            if (key && path) {
                keysToKeep.add(key);
                const currentData = originalAlternates[key];
                const isObject = typeof currentData === 'object' && currentData !== null;
                
                // Default to the simplest version if data is old/missing
                const currentPath = isObject ? currentData.path : currentData;
                const currentScale = isObject ? (currentData.scale ?? 1.0) : 1.0;

                // 1. Check for Path Change
                const pathChanged = currentPath !== path;

                // 2. Check for Scale/Flip Change (using tolerance)
                const scaleTolerance = 0.0001;
                // Check if the absolute difference between the current scale and the new scale 
                // exceeds the small tolerance value. This accounts for float precision issues.
                const scaleChanged = Math.abs(currentScale - scale) > scaleTolerance;

                // If EITHER the path OR the scale/flip has changed, update the entire object.
                if (pathChanged || scaleChanged) {
                    updatePayload[`flags.${ns}.alternateImages.${key}`] = { path, scale };
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