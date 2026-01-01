/**
 * @file Main entry point for the Visage module.
 * @module visage
 */

import { Visage } from "./src/visage.js";
import { VisageSelector } from "./src/visage-selector.js";
import { VisageConfigApp } from "./src/visage-config.js";
import { VisageRingEditor } from "./src/visage-ring-editor.js";
import { VisageGlobalData } from "./src/visage-global-data.js";
import { VisageGlobalEditor } from "./src/visage-global-editor.js";
import { VisageGlobalDirectory } from "./src/visage-global-directory.js";
import { handleTokenHUD } from "./src/visage-hud.js";
import { cleanseSceneTokens, cleanseAllTokens } from "./src/visage-cleanup.js";
import { migrateWorldData } from "./src/visage-migration.js";
import { VisageComposer } from "./src/visage-composer.js";

// Track the directory instance globally so we can toggle it
let globalDirectoryInstance = null;

/**
 * Opens the Visage configuration application for a given actor.
 */
function openVisageConfig(actor, token = null) {
    if (!actor) return;
    try {
        let tokenId = token?.id || null;
        let sceneId = token?.parent?.id || null;

        if (!tokenId && actor.isToken) {
            tokenId = actor.token.id;
            sceneId = actor.token.parent.id;
        }

        new VisageConfigApp({
            actorId: actor.id,
            tokenId: tokenId,
            sceneId: sceneId
        }).render(true);
    } catch (err) {
        console.error("Visage | Failed to open configuration window:", err);
    }
}

function getActorIdFromElement(li) {
    const element = (li instanceof jQuery) ? li[0] : li;
    return element.dataset?.entryId || element.dataset?.documentId;
}

/* -------------------------------------------- */
/* Initialization                              */
/* -------------------------------------------- */

Hooks.once("init", () => {
    try {
        Visage.initialize();

        // Register Global Data Settings
        VisageGlobalData.registerSettings();

        // --- EXPOSE FOR DEBUGGING/API ---
        window.VisageGlobalData = VisageGlobalData;
        window.VisageGlobalEditor = VisageGlobalEditor;
        window.VisageGlobalDirectory = VisageGlobalDirectory;
        
        game.modules.get("visage").api.Global = VisageGlobalData;
        game.modules.get("visage").api.Editor = VisageGlobalEditor;
        game.modules.get("visage").api.Directory = VisageGlobalDirectory;

        // Register Handlebars Helpers
        Handlebars.registerHelper("neq", (a, b) => a !== b);
        Handlebars.registerHelper("visageSelected", (condition) => condition ? "selected" : "");
        Handlebars.registerHelper("json", (context) => JSON.stringify(context));

        // Load Templates
        loadTemplates([
            "modules/visage/templates/visage-selector.hbs",
            "modules/visage/templates/visage-config-app.hbs",
            "modules/visage/templates/visage-ring-editor.hbs",
            "modules/visage/templates/visage-global-editor.hbs",
            "modules/visage/templates/visage-global-directory.hbs",
            "modules/visage/templates/parts/visage-preview.hbs"
        ]);

        registerSettings();

        // Context Menu Integration
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

        // Sheet Header Buttons
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

/* -------------------------------------------- */
/* Module Logic & Hooks                        */
/* -------------------------------------------- */

// Universal Scene Control Integration
Hooks.on("getSceneControlButtons", (controls) => {
    if (!game.user.isGM) return;

    let tokenLayer = null;

    // STEP 1: Find the Token Layer (Universal)
    if (Array.isArray(controls)) {
        tokenLayer = controls.find(c => c.name === "token");
    } else {
        for (const key in controls) {
            const layer = controls[key];
            if (layer.name === "token" || layer.name === "tokens") {
                tokenLayer = layer;
                break;
            }
        }
    }

    if (!tokenLayer) return;

    // STEP 2: Define the Tool (Simple Launcher)
    const visageTool = {
        name: "visage-global",
        title: "VISAGE.Directory.Title",
        icon: "visage-tool-icon",
        visible: true,
        toggle: false, 
        button: true,
        
        onClick: () => {
            if (!globalDirectoryInstance) {
                globalDirectoryInstance = new VisageGlobalDirectory();
            }
            // Always render (opens if closed, brings to front if open)
            globalDirectoryInstance.render(true);
        }
    };

    // STEP 3: Add the Tool
    if (Array.isArray(tokenLayer.tools)) {
        tokenLayer.tools.push(visageTool);
    } else {
        tokenLayer.tools["visage-global"] = visageTool;
    }
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
        VisageGlobalData.runGarbageCollection();

        const lastVersion = game.settings.get(Visage.MODULE_ID, "worldVersion");
        const currentVersion = game.modules.get(Visage.MODULE_ID).version;

        if (foundry.utils.isNewerVersion(currentVersion, lastVersion)) {
            if (foundry.utils.isNewerVersion("1.2.0", lastVersion)) {
                migrateWorldData();
            }
            game.settings.set(Visage.MODULE_ID, "worldVersion", currentVersion);
        }
    } catch (err) {
        console.warn("Visage | Version check failed:", err);
    }
});

Visage.apps = {};

// App Tracker (Updated)
Hooks.on("renderApplication", (app) => {
    if (app instanceof VisageSelector || 
        app instanceof VisageConfigApp || 
        app instanceof VisageRingEditor || 
        app instanceof VisageGlobalEditor ||
        app instanceof VisageGlobalDirectory) {
        
        const appId = app.id || app.options?.id;
        if (appId) Visage.apps[appId] = app;
    }
});

/**
 * Handle dropping a Visage card onto the canvas.
 */
Hooks.on("dropCanvasData", async (canvas, data) => {
    if (data.type !== "Visage" || !data.id) return;
    
    const { VisageGlobalData } = await import("./visage-global-data.js");
    const { Visage } = await import("./visage.js");
    
    const visageData = VisageGlobalData.get(data.id);
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
        app instanceof VisageConfigApp || 
        app instanceof VisageRingEditor || 
        app instanceof VisageGlobalEditor ||
        app instanceof VisageGlobalDirectory) {
        
        const appId = app.id || app.options?.id;
        if (appId && Visage.apps[appId]) delete Visage.apps[appId];
    }
});

Hooks.on("renderTokenHUD", handleTokenHUD);

Hooks.on("updateToken", (document, change, options, userId) => {
    Visage.handleTokenUpdate(document, change, options, userId);
});