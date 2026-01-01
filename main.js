/**
 * @file Main entry point for the Visage module.
 * @module visage
 */

import { Visage } from "./src/visage.js";
import { VisageSelector } from "./src/visage-selector.js";
import { VisageData } from "./src/visage-data.js"; 
import { VisageEditor } from "./src/visage-editor.js"; 
import { VisageGallery } from "./src/visage-gallery.js"; 
import { handleTokenHUD } from "./src/visage-hud.js";
import { cleanseSceneTokens, cleanseAllTokens } from "./src/visage-cleanup.js";
import { migrateWorldData } from "./src/visage-migration.js";
import { VisageComposer } from "./src/visage-composer.js";

let globalDirectoryInstance = null;

// --- CONFIGURATION ---
// The version number where the Data Structure changed (Unified Model).
// Any world older than this MUST migrate.
const NEEDS_MIGRATION_VERSION = "1.6.3"; 

function openVisageConfig(actor, token = null) {
    if (!actor) return;
    try {
        let tokenId = token?.id || null;
        let sceneId = token?.parent?.id || null;

        if (!tokenId && actor.isToken) {
            tokenId = actor.token.id;
            sceneId = actor.token.parent.id;
        }

        const appId = `visage-gallery-${actor.id}-${tokenId || "sidebar"}`;

        if (Visage.apps[appId]) {
            Visage.apps[appId].bringToTop();
            return;
        }

        new VisageGallery({
            actorId: actor.id,
            tokenId: tokenId,
            sceneId: sceneId,
            id: appId
        }).render(true);

    } catch (err) {
        console.error("Visage | Failed to open configuration window:", err);
    }
}

function getActorIdFromElement(li) {
    const element = (li instanceof jQuery) ? li[0] : li;
    return element.dataset?.entryId || element.dataset?.documentId;
}

Hooks.once("init", () => {
    try {
        Visage.initialize();

        // Register Settings (Unified)
        VisageData.registerSettings();

        // --- EXPOSE FOR DEBUGGING/API ---
        window.VisageData = VisageData;
        window.VisageEditor = VisageEditor;
        window.VisageGallery = VisageGallery;
        
        game.modules.get("visage").api.Data = VisageData;
        game.modules.get("visage").api.Editor = VisageEditor;
        game.modules.get("visage").api.Gallery = VisageGallery;

        Handlebars.registerHelper("neq", (a, b) => a !== b);
        Handlebars.registerHelper("visageSelected", (condition) => condition ? "selected" : "");
        Handlebars.registerHelper("json", (context) => JSON.stringify(context));

        loadTemplates([
            "modules/visage/templates/visage-selector.hbs",
            "modules/visage/templates/visage-editor.hbs",
            "modules/visage/templates/visage-gallery.hbs",
            "modules/visage/templates/parts/visage-preview.hbs"
        ]);

        registerSettings();

        // Context Menu
        const addSidebarOption = (options) => {
            options.push({
                name: "VISAGE.Title",
                icon: '<i class="visage-icon-mask"></i>',
                condition: (li) => {
                    const documentId = getActorIdFromElement(li);
                    if (!documentId) return false;
                    const actor = game.actors.get(documentId);
                    return actor && actor.isOwner;
                },
                callback: (li) => {
                    const documentId = getActorIdFromElement(li);
                    const actor = game.actors.get(documentId);
                    if (actor) openVisageConfig(actor);
                }
            });
        };

        Hooks.on("getActorContextOptions", (html, options) => addSidebarOption(options));
        Hooks.on("getActorDirectoryEntryContext", (html, options) => {
            if (!options.some(o => o.name === "VISAGE.Title")) addSidebarOption(options);
        });

        Hooks.on("getActorSheetHeaderButtons", (sheet, buttons) => {
            if (!sheet.actor.isOwner) return;
            buttons.unshift({
                label: "VISAGE.Title",
                class: "visage-config",
                icon: "visage-icon-mask",
                onclick: () => openVisageConfig(sheet.actor)
            });
        });

        const addAppV2Control = (app, controls) => {
            const actor = app.document;
            if (!actor || !actor.isOwner) return;
            controls.push({
                label: "VISAGE.Title",
                icon: "visage-icon-mask",
                action: "visageConfigure",
                onClick: () => openVisageConfig(actor),
                order: 0
            });
        };

        Hooks.on("getHeaderControlsActorSheetV2", addAppV2Control);
        Hooks.on("getActorSheetV2HeaderControls", addAppV2Control);

    } catch (err) {
        console.error("Visage | Initialization failed:", err);
    }
});

Hooks.on("getSceneControlButtons", (controls) => {
    if (!game.user.isGM) return;

    let tokenLayer = null;
    if (Array.isArray(controls)) tokenLayer = controls.find(c => c.name === "token");
    else {
        for (const key in controls) {
            const layer = controls[key];
            if (layer.name === "token" || layer.name === "tokens") {
                tokenLayer = layer;
                break;
            }
        }
    }

    if (!tokenLayer) return;

    const visageTool = {
        name: "visage-gallery", 
        title: "VISAGE.Directory.Title.Global", 
        icon: "visage-tool-icon",
        visible: true,
        toggle: false, 
        button: true,
        onClick: () => {
            if (!globalDirectoryInstance) globalDirectoryInstance = new VisageGallery();
            globalDirectoryInstance.render(true);
        }
    };

    if (Array.isArray(tokenLayer.tools)) tokenLayer.tools.push(visageTool);
    else tokenLayer.tools["visage-gallery"] = visageTool;
});

function registerSettings() {
    game.settings.register(Visage.MODULE_ID, "cleanseScene", {
        name: "VISAGE.Settings.CleanseScene.Name",
        hint: "VISAGE.Settings.CleanseScene.Hint",
        scope: "world",
        config: true,
        restricted: true,
        type: Boolean,
        default: false,
        onChange: (value) => {
            if (value) {
                cleanseSceneTokens();
                game.settings.set(Visage.MODULE_ID, "cleanseScene", false);
            }
        },
    });

    game.settings.register(Visage.MODULE_ID, "cleanseAll", {
        name: "VISAGE.Settings.CleanseAll.Name",
        hint: "VISAGE.Settings.CleanseAll.Hint",
        scope: "world",
        config: true,
        restricted: true,
        type: Boolean,
        default: false,
        onChange: (value) => {
            if (value) {
                cleanseAllTokens();
                game.settings.set(Visage.MODULE_ID, "cleanseAll", false);
            }
        },
    });

    game.settings.register(Visage.MODULE_ID, "worldVersion", {
        name: "World Data Version",
        scope: "world",
        config: false,
        type: String,
        default: "0.0.0"
    });
}

Hooks.once("ready", () => {
    if (!game.user.isGM) return;

    try {
        VisageData.runGarbageCollection();

        const lastVersion = game.settings.get(Visage.MODULE_ID, "worldVersion");
        const currentVersion = game.modules.get(Visage.MODULE_ID).version;

        // Check if we updated the module
        if (foundry.utils.isNewerVersion(currentVersion, lastVersion)) {
            
            // Check if the PREVIOUS version was older than our Migration Threshold
            if (foundry.utils.isNewerVersion(NEEDS_MIGRATION_VERSION, lastVersion)) {
                console.log(`Visage | Detected legacy data (v${lastVersion}). Migrating to v${NEEDS_MIGRATION_VERSION}...`);
                migrateWorldData();
            }
            
            game.settings.set(Visage.MODULE_ID, "worldVersion", currentVersion);
        }
    } catch (err) {
        console.warn("Visage | Version check failed:", err);
    }
});

Visage.apps = {};

Hooks.on("renderApplication", (app) => {
    if (app instanceof VisageSelector || 
        app instanceof VisageEditor ||
        app instanceof VisageGallery) {
        
        const appId = app.id || app.options?.id;
        if (appId) Visage.apps[appId] = app;
    }
});

Hooks.on("dropCanvasData", async (canvas, data) => {
    if (data.type !== "Visage" || !data.id) return;
    
    // Lazy Import
    const { VisageData } = await import("./src/visage-data.js");
    const { Visage } = await import("./src/visage.js");
    
    const visageData = VisageData.getGlobal(data.id); 
    if (!visageData) return;

    const target = canvas.tokens.placeables.find(t => {
        return t.visible && 
               data.x >= t.x && data.x < t.x + t.w &&
               data.y >= t.y && data.y < t.y + t.h;
    });

    if (target) {
        await Visage.applyGlobalVisage(target, visageData);
    }
});

Hooks.on("closeApplication", (app) => {
    if (app instanceof VisageSelector || 
        app instanceof VisageEditor ||
        app instanceof VisageGallery) {
        
        const appId = app.id || app.options?.id;
        if (appId && Visage.apps[appId]) delete Visage.apps[appId];
    }
});

Hooks.on("renderTokenHUD", handleTokenHUD);

Hooks.on("updateToken", (document, change, options, userId) => {
    Visage.handleTokenUpdate(document, change, options, userId);
});