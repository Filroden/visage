/**
 * @file main.js
 * @description Main entry point for the Visage module.
 * This file handles initialization, setting registration, application window tracking,
 * and the registration of core Foundry VTT hooks.
 * @module visage
 */

// --- Imports ---

// Core module class
import { Visage } from "./visage.js";

// UI Application classes
import { VisageSelector } from "./visage-selector.js";
import { VisageConfigApp } from "./visage-config.js";

// Dedicated handlers for specific hooks
import { handleTokenHUD } from "./visage-hud.js";
import { cleanseSceneTokens, cleanseAllTokens } from "./visage-cleanup.js";
import { migrateWorldData } from "./visage-migration.js";

// --- Module Initialization ---

/**
 * Initialization Hook.
 * Invoked when the Foundry VTT game world begins initialization.
 * Registers module settings, Handlebars helpers, and initializes the core API.
 */
Hooks.once("init", () => {
    // Run the main initialization logic from the Visage class
    Visage.initialize();

    // --- Register Handlebars Helpers ---
    
    /**
     * Helper: neq (Not Equal)
     * @param {any} a - First value.
     * @param {any} b - Second value.
     * @returns {boolean} True if a is not equal to b.
     */
    Handlebars.registerHelper("neq", (a, b) => a !== b);

    /**
     * Helper: selected
     * Returns the string "selected" if the condition is true, for use in HTML select options.
     * @param {boolean} condition - The condition to check.
     * @returns {string} "selected" or an empty string.
     */
    Handlebars.registerHelper("selected", (condition) => condition ? "selected" : "");

    // --- Register Module Settings ---

    /**
     * Setting: Cleanse Scene Tokens (Trigger)
     * Allows the GM to remove Visage data from all tokens on the current scene.
     */
    game.settings.register(Visage.MODULE_ID, "cleanseScene", {
        name: "[GM Only] Remove all Visage-related data from tokens on current scene",
        hint: "When you check this box and save, you will be asked for confirmation to remove Visage data from tokens in the current scene. This action cannot be undone.",
        scope: "world",
        config: true,
        restricted: true,
        type: Boolean,
        default: false,
        onChange: (value) => {
            if (value) {
                Dialog.confirm({
                    title: "Confirm Data Cleanse",
                    content: "<p>Are you sure you want to remove all Visage data from tokens on the <strong>current scene</strong>? This action cannot be undone.</p>",
                    yes: () => cleanseSceneTokens(),
                    no: () => ui.notifications.warn("Visage | Data cleanse cancelled."),
                    defaultYes: false
                }).finally(() => {
                    // Reset the setting to false immediately so it acts as a button
                    game.settings.set(Visage.MODULE_ID, "cleanseScene", false);
                });
            }
        },
    });

    /**
     * Setting: Cleanse All Tokens (Trigger)
     * Allows the GM to remove Visage data from all tokens in the entire world.
     */
    game.settings.register(Visage.MODULE_ID, "cleanseAll", {
        name: "[GM Only] Remove all Visage-related data from tokens in all scenes",
        hint: "When you check this box and save, you will be asked for confirmation to remove Visage data from tokens in ALL scenes. This action cannot be undone.",
        scope: "world",
        config: true,
        restricted: true,
        type: Boolean,
        default: false,
        onChange: (value) => {
            if (value) {
                Dialog.confirm({
                    title: "Confirm Data Cleanse",
                    content: "<p>Are you sure you want to remove all Visage data from tokens in <strong>all scenes</strong>? This action cannot be undone.</p>",
                    yes: () => cleanseAllTokens(),
                    no: () => ui.notifications.warn("Visage | Data cleanse cancelled."),
                    defaultYes: false
                }).finally(() => {
                    game.settings.set(Visage.MODULE_ID, "cleanseAll", false);
                });
            }
        },
    });

    /**
     * Setting: World Data Version (Internal)
     * Tracks the version of the module last used in this world to trigger migrations.
     */
    game.settings.register(Visage.MODULE_ID, "worldVersion", {
        name: "World Data Version",
        scope: "world",
        config: false,       // Hidden setting
        type: String,
        default: "0.0.0"     // Starting version for new worlds
    });
});

/**
 * Ready Hook.
 * Invoked when the Foundry VTT game world is fully ready.
 * Checks if the module has been updated and triggers data migration if necessary.
 */
Hooks.once("ready", () => {
    // 1. Get the last version the module ran on this world.
    const lastVersion = game.settings.get(Visage.MODULE_ID, "worldVersion");
    const currentVersion = game.modules.get(Visage.MODULE_ID).version;

    // 2. Check if the module version is newer than the stored version.
    if (isNewerVersion(currentVersion, lastVersion)) {
        
        // 3. Check specific migration thresholds.
        // Deep Scan migration required for versions older than 1.2.0.
        if (isNewerVersion("1.2.0", lastVersion)) {
             Visage.log(`World migration needed (Deep Scan): ${lastVersion} -> ${currentVersion}`, true);
             migrateWorldData();
        }
        
        // 4. Update the stored version to prevent re-running migration on reload.
        game.settings.set(Visage.MODULE_ID, "worldVersion", currentVersion);
    }
});

// --- Application Tracking ---

/**
 * Global registry of open Visage application instances.
 * Used to prevent duplicate windows and manage focus.
 * @type {Object<string, Application>}
 */
Visage.apps = {};

/**
 * Hook: renderApplication
 * Tracks open Visage applications in the Visage.apps registry.
 * @param {Application} app - The application instance being rendered.
 * @param {jQuery} html - The rendered HTML.
 * @param {object} data - The data used to render the application.
 */
Hooks.on("renderApplication", (app, html, data) => {
    if (app instanceof VisageSelector || app instanceof VisageConfigApp) {
        // Support both AppV2 (app.id) and AppV1 legacy (app.options.id)
        const appId = app.id || app.options?.id;
        if (appId) {
            Visage.apps[appId] = app;
        }
    }
});

/**
 * Hook: closeApplication
 * Removes closed Visage applications from the registry to prevent memory leaks.
 * @param {Application} app - The application instance being closed.
 */
Hooks.on("closeApplication", (app) => {
    if (app instanceof VisageSelector || app instanceof VisageConfigApp) {
        const appId = app.id || app.options?.id;
        if (appId && Visage.apps[appId]) {
            delete Visage.apps[appId];
        }
    }
});

// --- Core Event Hooks ---

/**
 * Hook: renderTokenHUD
 * Delegates logic to add the "Change Visage" button to the Token HUD.
 * @type {Function}
 */
Hooks.on("renderTokenHUD", handleTokenHUD);

/**
 * Hook: preUpdateToken
 * Intercepts token updates to sync changes (Name, Image, Scale) with Visage's defaults.
 * @param {TokenDocument} document - The token document being updated.
 * @param {object} change - The differential data object being applied.
 * @param {object} options - Options for the update operation.
 * @param {string} userId - The ID of the user triggering the update.
 */
Hooks.on("preUpdateToken", (document, change, options, userId) => {
    Visage.handleTokenUpdate(document, change, options, userId);
});