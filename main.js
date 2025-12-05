/**
 * @file Main entry point for the Visage module. This file handles initialization, setting registration,
 * application window tracking, and the registration of core Foundry VTT hooks.
 * @module visage
 */

// --- Imports ---

// Core module logic
import { Visage } from "./visage.js";

// UI Application classes
import { VisageSelector } from "./visage-selector.js";
import { VisageConfigApp } from "./visage-config.js";
import { VisageRingEditor } from "./visage-ring-editor.js";

// Hook handlers and utility functions
import { handleTokenHUD } from "./visage-hud.js";
import { cleanseSceneTokens, cleanseAllTokens } from "./visage-cleanup.js";
import { migrateWorldData } from "./visage-migration.js";

// --- Module Initialization ---

/**
 * Foundry VTT "init" hook.
 * Fired once during Foundry's initialization process. This is the primary setup location for the module.
 * It registers module settings, Handlebars helpers, preloads templates, and initializes the core API.
 */
Hooks.once("init", () => {
    Visage.initialize();

    // --- Register Handlebars Helpers ---
    
    /**
     * Handlebars Helper: Not Equal (`neq`).
     * @param {*} a - The first value to compare.
     * @param {*} b - The second value to compare.
     * @returns {boolean} True if the values are not strictly equal.
     */
    Handlebars.registerHelper("neq", (a, b) => a !== b);

    /**
     * Handlebars Helper: `selected`.
     * Returns the string "selected" if the provided condition is true.
     * Useful for setting the selected option in a <select> element.
     * @param {boolean} condition - The condition to evaluate.
     * @returns {string} "selected" or an empty string.
     */
    Handlebars.registerHelper("selected", (condition) => condition ? "selected" : "");

    /**
     * Handlebars Helper: `json`.
     * Converts a JavaScript object into a JSON string, suitable for embedding in HTML attributes.
     * @param {object} context - The object to stringify.
     * @returns {string} The JSON representation of the object.
     */
    Handlebars.registerHelper("json", (context) => JSON.stringify(context));

    // Preload templates to ensure they are available for quick rendering.
    loadTemplates([
        "modules/visage/templates/visage-selector.hbs",
        "modules/visage/templates/visage-config-app.hbs",
        "modules/visage/templates/visage-ring-editor.hbs"
    ]);

    // --- Register Module Settings ---

    /**
     * Setting: Cleanse Scene Tokens (GM-only trigger).
     * This setting acts as a button for GMs to remove all Visage data from tokens on the current scene.
     */
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
                Dialog.confirm({
                    title: game.i18n.localize("VISAGE.Settings.CleanseConfirm.Title"),
                    content: `<p>${game.i18n.localize("VISAGE.Settings.CleanseScene.Confirm")}</p>`,
                    yes: () => cleanseSceneTokens(),
                    no: () => ui.notifications.warn("Visage | Data cleanse cancelled."),
                    defaultYes: false
                }).finally(() => {
                    // Reset the setting to false to make it behave like a button.
                    game.settings.set(Visage.MODULE_ID, "cleanseScene", false);
                });
            }
        },
    });

    /**
     * Setting: Cleanse All Tokens (GM-only trigger).
     * This setting acts as a button for GMs to remove all Visage data from all tokens in all scenes.
     */
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
                Dialog.confirm({
                    title: game.i18n.localize("VISAGE.Settings.CleanseConfirm.Title"),
                    content: `<p>${game.i18n.localize("VISAGE.Settings.CleanseAll.Confirm")}</p>`,
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
     * Setting: World Data Version (Internal).
     * An internal setting to track the module version last used with this world, used for migrations.
     */
    game.settings.register(Visage.MODULE_ID, "worldVersion", {
        name: "World Data Version",
        scope: "world",
        config: false, // Hidden from the settings UI.
        type: String,
        default: "0.0.0"
    });
});

/**
 * Foundry VTT "ready" hook.
 * Fired once when the game world is fully loaded and ready to play.
 * This hook is used to check for module updates and trigger data migrations if necessary.
 */
Hooks.once("ready", () => {
    if (!game.user.isGM) return;

    const lastVersion = game.settings.get(Visage.MODULE_ID, "worldVersion");
    const currentVersion = game.modules.get(Visage.MODULE_ID).version;

    // Check if the installed module version is newer than the one last recorded for this world.
    if (isNewerVersion(currentVersion, lastVersion)) {
        
        // Data structures changed significantly in v1.2.0, requiring a deep scan migration.
        if (isNewerVersion("1.2.0", lastVersion)) {
             Visage.log(`World migration needed (Deep Scan): ${lastVersion} -> ${currentVersion}`, true);
             migrateWorldData();
        }
        
        // Update the stored version to the current one to prevent re-running migrations.
        game.settings.set(Visage.MODULE_ID, "worldVersion", currentVersion);
    }
});

// --- Application Tracking ---

/**
 * A global registry of open Visage application instances.
 * This is used to prevent duplicate windows and manage focus (e.g., bringing an open app to top).
 * @type {Object<string, Application>}
 */
Visage.apps = {};

/**
 * Hook: `renderApplication`.
 * Tracks open Visage applications by adding them to the `Visage.apps` registry.
 * @param {Application} app - The application instance being rendered.
 */
Hooks.on("renderApplication", (app) => {
    if (app instanceof VisageSelector || app instanceof VisageConfigApp || app instanceof VisageRingEditor) {
        // Support both ApplicationV2 `id` and legacy `options.id`.
        const appId = app.id || app.options?.id;
        if (appId) {
            Visage.apps[appId] = app;
        }
    }
});

/**
 * Hook: `closeApplication`.
 * Removes closed Visage applications from the registry to prevent memory leaks and dangling references.
 * @param {Application} app - The application instance being closed.
 */
Hooks.on("closeApplication", (app) => {
    if (app instanceof VisageSelector || app instanceof VisageConfigApp || app instanceof VisageRingEditor) {
        const appId = app.id || app.options?.id;
        if (appId && Visage.apps[appId]) {
            delete Visage.apps[appId];
        }
    }
});

// --- Core Event Hooks ---

/**
 * Hook: `renderTokenHUD`.
 * Delegates to `handleTokenHUD` to add the "Change Visage" button to the token's interface.
 */
Hooks.on("renderTokenHUD", handleTokenHUD);

/**
 * Hook: `preUpdateToken`.
 * Intercepts token updates to synchronize changes (e.g., name, image) with Visage's default data for that token.
 * This ensures that the "Default" visage option always reflects the token's last known manual state.
 * @param {TokenDocument} document - The token document being updated.
 * @param {object} change - The differential data being applied.
 * @param {object} options - Options for the update operation.
 */
Hooks.on("preUpdateToken", (document, change, options) => {
    Visage.handleTokenUpdate(document, change, options);
});