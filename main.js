/**
 * @file Main entry point for the Visage module.
 * @module visage
 * @description Handles module initialization, hook registration, and integration with the Foundry VTT UI (Sidebar, Actor Sheets, and Token Configuration).
 */

import { Visage } from "./visage.js";
import { VisageSelector } from "./visage-selector.js";
import { VisageConfigApp } from "./visage-config.js";
import { VisageRingEditor } from "./visage-ring-editor.js";
import { VisageGlobalData } from "./visage-global-data.js";
import { handleTokenHUD } from "./visage-hud.js";
import { cleanseSceneTokens, cleanseAllTokens } from "./visage-cleanup.js";
import { migrateWorldData } from "./visage-migration.js";

/**
 * Opens the Visage configuration application for a given actor.
 * determines the correct context (Actor vs. Token) and renders the config app.
 *
 * @param {Actor} actor - The actor document to configure.
 * @param {TokenDocument|null} [token=null] - Optional specific token context (e.g., for unlinked tokens).
 */
function openVisageConfig(actor, token = null) {
    if (!actor) return;

    try {
        let tokenId = token?.id || null;
        let sceneId = token?.parent?.id || null;

        // If no specific token is provided but the actor itself is a token (unlinked), use its context.
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

/**
 * Retrieves the Actor ID from a sidebar directory list element.
 * Handles both jQuery objects and raw DOM elements.
 *
 * @param {jQuery|HTMLElement} li - The list item element from the sidebar.
 * @returns {string|undefined} The document ID found in the dataset.
 */
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

        // Register Global Data Storage (Phase 1)
        VisageGlobalData.registerSettings();

        // Register Handlebars Helpers
        Handlebars.registerHelper("neq", (a, b) => a !== b);
        Handlebars.registerHelper("visageSelected", (condition) => condition ? "selected" : "");
        Handlebars.registerHelper("json", (context) => JSON.stringify(context));

        // Load Templates
        loadTemplates([
            "modules/visage/templates/visage-selector.hbs",
            "modules/visage/templates/visage-config-app.hbs",
            "modules/visage/templates/visage-ring-editor.hbs"
        ]);

        // Register Module Settings
        registerSettings();

        // ----------------------------------------------------
        // Context Menu Integration (Actor Directory)
        // ----------------------------------------------------
        
        /**
         * Adds the "Visage" option to the Actor Directory context menu.
         * @param {ContextMenuEntry[]} options - The array of context menu options.
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

        // Hook for standard context menu construction
        Hooks.on("getActorContextOptions", (html, options) => addSidebarOption(options));
        
        // Backup hook for core directory context menu (prevents duplication)
        Hooks.on("getActorDirectoryEntryContext", (html, options) => {
            if (!options.some(o => o.name === "VISAGE.Title")) addSidebarOption(options);
        });

        // ----------------------------------------------------
        // Actor Sheet Header Integration (Application V1)
        // ----------------------------------------------------
        
        Hooks.on("getActorSheetHeaderButtons", (sheet, buttons) => {
            if (!sheet.actor.isOwner) return;

            buttons.unshift({
                label: "VISAGE.Title",
                class: "visage-config",
                icon: "visage-icon-mask",
                onclick: () => openVisageConfig(sheet.actor)
            });
        });

        // ----------------------------------------------------
        // Actor Sheet Header Integration (Application V2)
        // ----------------------------------------------------

        /**
         * Adds the "Visage" control to ApplicationV2 based actor sheets.
         * Adheres to the ApplicationHeaderControlsEntry interface.
         * * @param {ApplicationV2} app - The application instance.
         * @param {ApplicationHeaderControlsEntry[]} controls - The array of header controls.
         */
        const addAppV2Control = (app, controls) => {
            const actor = app.document;
            if (!actor || !actor.isOwner) return;

            controls.push({
                label: "VISAGE.Title",
                icon: "visage-icon-mask",
                action: "visageConfigure",
                onClick: () => openVisageConfig(actor), // Required V13+ camelCase property
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

/**
 * Registers module-specific settings.
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

    game.settings.register(Visage.MODULE_ID, "worldVersion", {
        name: "World Data Version",
        scope: "world",
        config: false,
        type: String,
        default: "0.0.0"
    });
}

/**
 * Performs ready-state tasks such as version checks and data migration.
 */
Hooks.once("ready", () => {
    if (!game.user.isGM) return;

    try {
        // Run Garbage Collection (Phase 1)
        // Clean up any global visages deleted > 30 days ago
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

// Initialize application registry for window management
Visage.apps = {};

/**
 * Tracks Visage application instances when they render.
 */
Hooks.on("renderApplication", (app) => {
    if (app instanceof VisageSelector || app instanceof VisageConfigApp || app instanceof VisageRingEditor) {
        const appId = app.id || app.options?.id;
        if (appId) Visage.apps[appId] = app;
    }
});

/**
 * Cleans up application registry when Visage apps are closed.
 */
Hooks.on("closeApplication", (app) => {
    if (app instanceof VisageSelector || app instanceof VisageConfigApp || app instanceof VisageRingEditor) {
        const appId = app.id || app.options?.id;
        if (appId && Visage.apps[appId]) delete Visage.apps[appId];
    }
});

// Inject Token HUD controls
Hooks.on("renderTokenHUD", handleTokenHUD);

// Handle token updates for dynamic visual changes
Hooks.on("preUpdateToken", (document, change, options) => {
    Visage.handleTokenUpdate(document, change, options);
});