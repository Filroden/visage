/**
 * @file Main entry point for the Visage module.
 * Initializes the API, registers settings, and manages hooks for UI integration.
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
import { handleGhostEdit } from "./src/visage-ghost.js"; 

/**
 * Singleton instance of the global gallery when opened via Scene Controls.
 * @type {VisageGallery|null}
 */
let globalDirectoryInstance = null;

/**
 * The semantic version number where the Data Structure changed (Unified Model).
 * Worlds on a version older than this will trigger the migration utility.
 * @constant {string}
 */
const NEEDS_MIGRATION_VERSION = "2.2.0"; 

/**
 * Opens the Visage Configuration window (Gallery) for a specific actor or token.
 * Handles duplicate window checks to bring existing windows to focus.
 * * @param {Actor} actor - The target actor document.
 * @param {TokenDocument|null} [token=null] - The specific token document, if applicable.
 */
function openVisageConfig(actor, token = null) {
    if (!actor) return;
    try {
        let tokenId = token?.id || null;
        let sceneId = token?.parent?.id || null;

        // If no token provided but actor is a synthetic token actor, extract context.
        if (!tokenId && actor.isToken) {
            tokenId = actor.token.id;
            sceneId = actor.token.parent.id;
        }

        // Generate a unique App ID to prevent duplicate windows for the same entity.
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

/**
 * Helper to extract the Actor ID from a DOM element (directory entry).
 * Supports both jQuery and native DOM elements.
 * * @param {jQuery|HTMLElement} li - The list item element.
 * @returns {string|undefined} The Actor ID.
 */
function getActorIdFromElement(li) {
    const element = (li instanceof jQuery) ? li[0] : li;
    return element.dataset?.entryId || element.dataset?.documentId;
}

/* -------------------------------------------- */
/* Initialization Hooks                        */
/* -------------------------------------------- */

Hooks.once("init", () => {
    try {
        Visage.initialize();
        VisageData.registerSettings();

        // Expose API classes to the global scope and module API for third-party integration/debugging.
        window.VisageData = VisageData;
        window.VisageEditor = VisageEditor;
        window.VisageGallery = VisageGallery;
        
        game.modules.get("visage").api.Data = VisageData;
        game.modules.get("visage").api.Editor = VisageEditor;
        game.modules.get("visage").api.Gallery = VisageGallery;

        // Register Handlebars helpers
        Handlebars.registerHelper("visageNeq", (a, b) => a !== b);
        Handlebars.registerHelper("visageSelected", (condition) => condition ? "selected" : "");
        Handlebars.registerHelper("visageJson", (context) => JSON.stringify(context));

        loadTemplates([
            "modules/visage/templates/visage-selector.hbs",
            "modules/visage/templates/visage-editor.hbs",
            "modules/visage/templates/visage-gallery.hbs",
            "modules/visage/templates/parts/visage-preview.hbs"
        ]);

        registerSettings();

        /**
         * Inject "Visage" option into the Actor Directory context menu.
         */
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

        /**
         * Inject Header Button into Legacy Actor Sheets (ApplicationV1).
         */
        Hooks.on("getActorSheetHeaderButtons", (sheet, buttons) => {
            if (!sheet.actor.isOwner) return;
            buttons.unshift({
                label: "VISAGE.Title",
                class: "visage-config",
                icon: "visage-icon-mask",
                onclick: () => openVisageConfig(sheet.actor)
            });
        });

        /**
         * Inject Control Button into ApplicationV2 Actor Sheets.
         */
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

        // Capture tooltip events for Visage-specific elements to enforce custom styling classes.
        document.addEventListener("pointerover", (event) => {
            const target = event.target.closest('[data-tooltip]');
            if (target && target.closest('.visage')) {
                if (!target.hasAttribute("data-tooltip-class")) {
                    target.setAttribute("data-tooltip-class", "visage-tooltip");
                }
            }
        }, { capture: true, passive: true });

        Hooks.on("getHeaderControlsActorSheetV2", addAppV2Control);
        Hooks.on("getActorSheetV2HeaderControls", addAppV2Control);

    } catch (err) {
        console.error("Visage | Initialization failed:", err);
    }
});

/* -------------------------------------------- */
/* Scene Controls                              */
/* -------------------------------------------- */

Hooks.on("getSceneControlButtons", (controls) => {
    if (!game.user.isGM) return;

    let tokenLayer = null;
    if (Array.isArray(controls)) tokenLayer = controls.find(c => c.name === "token");
    else {
        // Fallback for systems that might use object-based controls
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
        // Using onChange ensures compatibility with newer Foundry versions (V13+)
        onChange: () => {
            if (!globalDirectoryInstance) globalDirectoryInstance = new VisageGallery();
            globalDirectoryInstance.render(true);
        }
    };

    if (Array.isArray(tokenLayer.tools)) tokenLayer.tools.push(visageTool);
    else tokenLayer.tools["visage-gallery"] = visageTool;
});

/**
 * Registers global and world-scope settings for the module.
 */
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

    // Hidden setting to track data versioning for migrations
    game.settings.register(Visage.MODULE_ID, "worldVersion", {
        name: "World Data Version",
        scope: "world",
        config: false,
        type: String,
        default: "0.0.0"
    });
}

/* -------------------------------------------- */
/* Ready & Runtime Hooks                       */
/* -------------------------------------------- */

Hooks.once("ready", () => {
    if (!game.user.isGM) return;

    try {
        // Clean up deleted items older than retention period
        VisageData.runGarbageCollection();

        const lastVersion = game.settings.get(Visage.MODULE_ID, "worldVersion");
        const currentVersion = game.modules.get(Visage.MODULE_ID).version;

        if (foundry.utils.isNewerVersion(currentVersion, lastVersion)) {
            // Trigger data migration if the previous version is older than the schema change
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

// Initialize application registry
Visage.apps = {};

/**
 * Tracks rendered Visage applications in the `Visage.apps` registry.
 * This allows singletons to be enforced by ID (e.g., prevent opening the same editor twice).
 */
Hooks.on("renderApplication", (app) => {
    if (app instanceof VisageSelector || 
        app instanceof VisageEditor ||
        app instanceof VisageGallery) {
        
        const appId = app.id || app.options?.id;
        if (appId) Visage.apps[appId] = app;
    }
});

/**
 * Removes closed Visage applications from the registry.
 */
Hooks.on("closeApplication", (app) => {
    if (app instanceof VisageSelector || 
        app instanceof VisageEditor ||
        app instanceof VisageGallery) {
        
        const appId = app.id || app.options?.id;
        if (appId && Visage.apps[appId]) delete Visage.apps[appId];
    }
});

/**
 * Handles Drag-and-Drop of Visage data onto the Canvas.
 * Supports applying a global visage to a specific token via drag.
 */
Hooks.on("dropCanvasData", async (canvas, data) => {
    if (data.type !== "Visage" || !data.id) return;
    
    // Dynamic import to prevent circular dependencies during load time
    const { VisageData } = await import("./src/visage-data.js");
    const { Visage } = await import("./src/visage.js");
    
    // Ensure the dropped ID is valid
    const visageData = VisageData.getGlobal(data.id); 
    if (!visageData) return;

    // Find the token under the cursor
    const target = canvas.tokens.placeables.find(t => {
        return t.visible && 
               data.x >= t.x && data.x < t.x + t.w &&
               data.y >= t.y && data.y < t.y + t.h;
    });

    if (target) {
        await Visage.apply(target, data.id, { clearStack: false });
        ui.notifications.info(game.i18n.format("VISAGE.Notifications.Applied", { label: visageData.label }));
    }
});

// Intercept Token Config rendering to handle Ghost Edits (modifications to tokens with active Visages)
Hooks.on("renderTokenConfig", handleGhostEdit); 
Hooks.on("closeTokenConfig", (app) => { delete app._visageWarned; });

// Integrate with the Token HUD
Hooks.on("renderTokenHUD", handleTokenHUD);

// Monitor token updates to capture default state changes or maintain Visage persistence
Hooks.on("updateToken", (document, change, options, userId) => {
    Visage.handleTokenUpdate(document, change, options, userId);
});