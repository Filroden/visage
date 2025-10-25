/**
 * Main entry point for the Visage module.
 *
 * This file is responsible for:
 * 1. Importing all core module components (classes, UI apps, handlers).
 * 2. Registering the primary 'init' hook to set up the module.
 * 3. Registering module settings, including data cleanup utilities.
 * 4. Setting up hooks to track the module's open application windows.
 * 5. Registering hooks for core Foundry VTT events like 'renderTokenHUD' and 'preUpdateToken',
 * delegating the logic to dedicated handler functions.
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

// --- Module Initialization ---

/**
 * Registers the 'init' hook, which fires once the game is ready.
 * This is the primary setup function for the module.
 */
Hooks.once("init", () => {
    // Run the main initialization logic from the Visage class
    Visage.initialize();

    // --- Register Handlebars Helpers ---
    Handlebars.registerHelper("neq", (a, b) => a !== b);
    Handlebars.registerHelper("selected", (condition) => condition ? "selected" : "");

    // Register a 'trigger' setting for cleansing data from the current scene.
    // This setting is a Boolean that, when checked, executes an action.
    game.settings.register("visage", "cleanseScene", {
        name: "[GM Only] Remove all Visage-related data from tokens on current scene",
        hint: "When you check this box and save, you will be asked for confirmation to remove Visage data from tokens in the current scene. This action cannot be undone.",
        scope: "world",
        config: true,       // Show this in the module settings menu
        restricted: true,   // Only GMs can see and use this
        type: Boolean,
        default: false,
        onChange: (value) => {
            // Only fire if the box is checked (set to true)
            if (value) {
                Dialog.confirm({
                    title: "Confirm Data Cleanse",
                    content: "<p>Are you sure you want to remove all Visage data from tokens on the <strong>current scene</strong>? This action cannot be undone.</p>",
                    yes: () => cleanseSceneTokens(), // Call the cleanup function if confirmed
                    no: () => ui.notifications.warn("Visage | Data cleanse cancelled."),
                    defaultYes: false
                }).finally(() => {
                    // IMPORTANT: Reset the setting to false immediately after.
                    // This makes it a one-time button rather than a persistent toggle.
                    game.settings.set("visage", "cleanseScene", false);
                });
            }
        },
    });

    // Register a 'trigger' setting for cleansing data from ALL scenes.
    game.settings.register("visage", "cleanseAll", {
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
                    yes: () => cleanseAllTokens(), // Call the global cleanup function
                    no: () => ui.notifications.warn("Visage | Data cleanse cancelled."),
                    defaultYes: false
                }).finally(() => {
                    // Reset the setting to false to act as a button
                    game.settings.set("visage", "cleanseAll", false);
                });
            }
        },
    });
});

// --- Application Tracking ---

/**
 * Adds a static 'apps' object to the Visage class.
 * This will serve as a simple registry to track all open instances
 * of this module's application windows.
 */
Visage.apps = {};

/**
 * Hooks into the 'renderApplication' event.
 * When any application window is rendered, this checks if it's one
 * of Visage's UIs and adds it to the `Visage.apps` registry.
 */
Hooks.on("renderApplication", (app, html, data) => {
    // Check if the rendered app is an instance of our specific UI classes
    if (app instanceof VisageSelector || app instanceof VisageConfigApp) {
        // Store the application instance, keyed by its unique app ID
        Visage.apps[app.options.id] = app;
    }
});

/**
 * Hooks into the 'closeApplication' event.
 * When a Visage application window is closed, this removes it from
 * the `Visage.apps` registry to prevent memory leaks.
 */
Hooks.on("closeApplication", (app) => {
    if (app instanceof VisageSelector || app instanceof VisageConfigApp) {
        // Remove the application instance from the registry
        delete Visage.apps[app.options.id];
    }
});

// --- Core Event Hooks ---

/**
 * Hooks into the 'renderTokenHUD' event.
 * This fires whenever the Token HUD (the circular menu) is displayed.
 * It delegates all logic to the imported `handleTokenHUD` function.
 */
Hooks.on("renderTokenHUD", handleTokenHUD);

/**
 * Hooks into the 'preUpdateToken' event.
 * This fires *before* any changes to a Token document are saved.
 * It delegates logic to the `Visage.handleTokenUpdate` static method,
 * which likely manages how Visage-related data is persisted on the token.
 */
Hooks.on("preUpdateToken", (document, change, options, userId) => {
    Visage.handleTokenUpdate(document, change, options, userId);
});